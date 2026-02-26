/**
 * MCP Server — 注册浏览器控制工具，通过 stdio 与 Kiro 通信
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "npm:zod";
import { browserClient } from "./browser-client.ts";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "alma-browser",
    version: "1.0.0",
  });

  // --- browser_status ---
  server.tool(
    "browser_status",
    "Check if Chrome extension is connected",
    {},
    async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            connected: browserClient.isConnected(),
            attachedTabs: browserClient.getAttachedTabs(),
          }),
        }],
      };
    },
  );

  // --- browser_list_tabs ---
  server.tool(
    "browser_list_tabs",
    "List all open Chrome tabs",
    {},
    async () => {
      const tabs = await browserClient.sendCommand("tabs.list");
      return {
        content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }],
      };
    },
  );

  // --- browser_new_tab ---
  server.tool(
    "browser_new_tab",
    "Create a new Chrome tab",
    {
      url: z.string().optional().describe(
        "URL to open, defaults to about:blank",
      ),
    },
    async ({ url }) => {
      const tab = await browserClient.sendCommand("tabs.create", {
        url,
        active: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(tab) }] };
    },
  );

  // --- browser_navigate ---
  server.tool(
    "browser_navigate",
    "Navigate a tab to a URL",
    {
      tabId: z.number().describe("Tab ID to navigate"),
      url: z.string().describe("URL to navigate to"),
    },
    async ({ tabId, url }) => {
      const result = await browserClient.sendCommand("tabs.navigate", {
        tabId,
        url,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- browser_screenshot ---
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current visible tab",
    {
      format: z.enum(["png", "jpeg"]).optional().describe(
        "Image format, defaults to png",
      ),
      quality: z.number().optional().describe(
        "JPEG quality 0-100, defaults to 80",
      ),
    },
    async ({ format, quality }) => {
      const result = await browserClient.sendCommand("tabs.screenshot", {
        format: format ?? "png",
        quality: quality ?? 80,
      }) as { dataUrl: string };

      // dataUrl 格式: data:image/png;base64,xxxxx
      const base64 = result.dataUrl.split(",")[1];
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

      return {
        content: [{
          type: "image",
          data: base64,
          mimeType,
        }],
      };
    },
  );

  // --- browser_click ---
  server.tool(
    "browser_click",
    "Click an element on the page by CSS selector",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().describe("CSS selector of the element to click"),
    },
    async ({ tabId, selector }) => {
      // 1. 获取元素坐标
      const evalResult = await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { error: "Element not found: ${selector}" };
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          })()`,
          returnByValue: true,
        },
      }) as { result: { value: { x?: number; y?: number; error?: string } } };

      const pos = evalResult.result.value;
      if (pos.error) {
        return { content: [{ type: "text", text: pos.error }], isError: true };
      }

      // 2. 模拟点击
      await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: pos.x,
          y: pos.y,
          button: "left",
          clickCount: 1,
        },
      });
      await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: pos.x,
          y: pos.y,
          button: "left",
          clickCount: 1,
        },
      });

      return {
        content: [{
          type: "text",
          text: `Clicked "${selector}" at (${pos.x}, ${pos.y})`,
        }],
      };
    },
  );

  // --- browser_type ---
  server.tool(
    "browser_type",
    "Type text into an input element",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().describe("CSS selector of the input element"),
      text: z.string().describe("Text to type"),
    },
    async ({ tabId, selector, text }) => {
      // 聚焦元素
      await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error("Element not found: ${selector}");
            el.focus();
          })()`,
        },
      });

      // 逐字符输入
      for (const char of text) {
        await browserClient.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchKeyEvent",
          params: { type: "keyDown", text: char },
        });
        await browserClient.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchKeyEvent",
          params: { type: "keyUp", text: char },
        });
      }

      return {
        content: [{ type: "text", text: `Typed "${text}" into "${selector}"` }],
      };
    },
  );

  // --- browser_get_content ---
  server.tool(
    "browser_get_content",
    "Get text content of the page or a specific element",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().optional().describe(
        "CSS selector, defaults to document.body",
      ),
    },
    async ({ tabId, selector }) => {
      const sel = selector ?? "document.body";
      const target = selector
        ? `document.querySelector(${JSON.stringify(selector)})`
        : "document.body";

      const result = await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            const el = ${target};
            if (!el) return { error: "Element not found: ${sel}" };
            return { text: el.innerText, html: el.innerHTML.substring(0, 50000) };
          })()`,
          returnByValue: true,
        },
      }) as {
        result: { value: { text?: string; html?: string; error?: string } };
      };

      const val = result.result.value;
      if (val.error) {
        return { content: [{ type: "text", text: val.error }], isError: true };
      }

      return { content: [{ type: "text", text: val.text ?? "" }] };
    },
  );

  // --- browser_evaluate ---
  server.tool(
    "browser_evaluate",
    "Execute JavaScript in the page context",
    {
      tabId: z.number().describe("Tab ID"),
      expression: z.string().describe("JavaScript expression to evaluate"),
    },
    async ({ tabId, expression }) => {
      const result = await browserClient.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }) as { result: { value: unknown }; exceptionDetails?: { text: string } };

      if (result.exceptionDetails) {
        return {
          content: [{
            type: "text",
            text: `Error: ${result.exceptionDetails.text}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: typeof result.result.value === "string"
            ? result.result.value
            : JSON.stringify(result.result.value, null, 2),
        }],
      };
    },
  );

  // --- 启动 stdio 传输 ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Server started on stdio");
}
