/**
 * MCP Server — 注册浏览器控制工具，通过 stdio 与 agent 通信
 * 通过 RelayClient 连接到常驻 relay 进程，不直接持有浏览器连接
 */
import { McpServer } from "npm:@modelcontextprotocol/sdk@latest/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@latest/server/stdio.js";
import { z } from "npm:zod";
import { RelayClient } from "./relay-client.ts";

export async function startMcpServer(
  relay: RelayClient,
): Promise<void> {
  const server = new McpServer({ name: "alma-browser", version: "1.0.0" });

  server.tool(
    "browser_status",
    "Check if Chrome extension is connected",
    {},
    async () => {
      if (!relay.isConnected()) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              relayConnected: false,
              error: "Not connected to relay. Is the relay process running?",
            }),
          }],
        };
      }
      const status = await relay.getStatus();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ relayConnected: true, ...status }),
        }],
      };
    },
  );

  server.tool(
    "browser_list_tabs",
    "List all open Chrome tabs",
    {},
    async () => {
      const tabs = await relay.sendCommand("tabs.list");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(tabs, null, 2),
        }],
      };
    },
  );

  server.tool("browser_new_tab", "Create a new Chrome tab", {
    url: z.string().optional().describe("URL to open, defaults to about:blank"),
  }, async ({ url }: { url?: string }) => {
    const tab = await relay.sendCommand("tabs.create", { url, active: true });
    return { content: [{ type: "text" as const, text: JSON.stringify(tab) }] };
  });

  server.tool("browser_navigate", "Navigate a tab to a URL", {
    tabId: z.number().describe("Tab ID to navigate"),
    url: z.string().describe("URL to navigate to"),
  }, async ({ tabId, url }: { tabId: number; url: string }) => {
    const result = await relay.sendCommand("tabs.navigate", { tabId, url });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  });

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
    async (
      { format, quality }: { format?: "png" | "jpeg"; quality?: number },
    ) => {
      const result = await relay.sendCommand("tabs.screenshot", {
        format: format ?? "png",
        quality: quality ?? 80,
      }) as { dataUrl: string };
      const base64 = result.dataUrl.split(",")[1];
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
      return { content: [{ type: "image" as const, data: base64, mimeType }] };
    },
  );

  server.tool("browser_click", "Click an element on the page by CSS selector", {
    tabId: z.number().describe("Tab ID"),
    selector: z.string().describe("CSS selector of the element to click"),
  }, async ({ tabId, selector }: { tabId: number; selector: string }) => {
    const evalResult = await relay.sendCommand("cdp.send", {
      tabId,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => { const el = document.querySelector(${
          JSON.stringify(selector)
        }); if (!el) return { error: "Element not found: ${selector}" }; const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`,
        returnByValue: true,
      },
    }) as { result: { value: { x?: number; y?: number; error?: string } } };
    const pos = evalResult.result.value;
    if (pos.error) {
      return {
        content: [{ type: "text" as const, text: pos.error }],
        isError: true,
      };
    }
    await relay.sendCommand("cdp.send", {
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
    await relay.sendCommand("cdp.send", {
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
        type: "text" as const,
        text: `Clicked "${selector}" at (${pos.x}, ${pos.y})`,
      }],
    };
  });

  server.tool(
    "browser_type",
    "Type text into an input element",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().describe("CSS selector of the input element"),
      text: z.string().describe("Text to type"),
    },
    async (
      { tabId, selector, text }: {
        tabId: number;
        selector: string;
        text: string;
      },
    ) => {
      await relay.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => { const el = document.querySelector(${
            JSON.stringify(selector)
          }); if (!el) throw new Error("Element not found: ${selector}"); el.focus(); })()`,
        },
      });
      for (const char of text) {
        await relay.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchKeyEvent",
          params: { type: "keyDown", text: char },
        });
        await relay.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchKeyEvent",
          params: { type: "keyUp", text: char },
        });
      }
      return {
        content: [{
          type: "text" as const,
          text: `Typed "${text}" into "${selector}"`,
        }],
      };
    },
  );

  server.tool(
    "browser_get_content",
    "Get text content of the page or a specific element",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().optional().describe(
        "CSS selector, defaults to document.body",
      ),
    },
    async ({ tabId, selector }: { tabId: number; selector?: string }) => {
      const sel = selector ?? "document.body";
      const target = selector
        ? `document.querySelector(${JSON.stringify(selector)})`
        : "document.body";
      const result = await relay.sendCommand("cdp.send", {
        tabId,
        method: "Runtime.evaluate",
        params: {
          expression:
            `(() => { const el = ${target}; if (!el) return { error: "Element not found: ${sel}" }; return { text: el.innerText, html: el.innerHTML.substring(0, 50000) }; })()`,
          returnByValue: true,
        },
      }) as {
        result: { value: { text?: string; html?: string; error?: string } };
      };
      const val = result.result.value;
      if (val.error) {
        return {
          content: [{ type: "text" as const, text: val.error }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: val.text ?? "" }] };
    },
  );

  server.tool("browser_evaluate", "Execute JavaScript in the page context", {
    tabId: z.number().describe("Tab ID"),
    expression: z.string().describe("JavaScript expression to evaluate"),
  }, async ({ tabId, expression }: { tabId: number; expression: string }) => {
    const result = await relay.sendCommand("cdp.send", {
      tabId,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true },
    }) as { result: { value: unknown }; exceptionDetails?: { text: string } };
    if (result.exceptionDetails) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${result.exceptionDetails.text}`,
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: "text" as const,
        text: typeof result.result.value === "string"
          ? result.result.value
          : JSON.stringify(result.result.value, null, 2),
      }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Server started on stdio");
}
