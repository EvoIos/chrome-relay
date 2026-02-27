/**
 * MCP Server — 注册浏览器控制工具，通过 stdio 与 agent 通信
 * 通过 RelayClient 连接到常驻 relay 进程，不直接持有浏览器连接
 */
import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "npm:zod";
import { RelayClient } from "./relay-client.ts";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

export async function startMcpServer(
  relay: RelayClient,
): Promise<void> {
  const server = new McpServer({
    name: "javas-relay",
    version: "1.0.0",
  });

  // --- browser_status ---
  server.tool(
    "browser_status",
    "Check if Chrome extension is connected to the relay",
    {},
    async () => {
      if (!relay.isConnected()) {
        return errorResult(
          "Not connected to relay. Is the relay process running?",
        );
      }
      try {
        const status = await relay.getStatus();
        return textResult({ relayConnected: true, ...status });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_list_tabs ---
  server.tool(
    "browser_list_tabs",
    "List all open Chrome tabs with their id, url, title, and attached status",
    {},
    async () => {
      try {
        const tabs = await relay.sendCommand("tabs.list");
        return textResult(tabs);
      } catch (e) {
        return errorResult((e as Error).message);
      }
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
      try {
        const tab = await relay.sendCommand("tabs.create", {
          url,
          active: true,
        });
        return textResult(tab);
      } catch (e) {
        return errorResult((e as Error).message);
      }
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
      try {
        const result = await relay.sendCommand("tabs.navigate", { tabId, url });
        return textResult(result);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_screenshot ---
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current visible tab. Returns a base64 PNG image.",
    {},
    async () => {
      try {
        const result = await relay.sendCommand("tabs.screenshot", {
          format: "png",
        }) as { dataUrl: string };
        const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, "");
        return {
          content: [{
            type: "image" as const,
            data: base64,
            mimeType: "image/png",
          }],
        };
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_click ---
  server.tool(
    "browser_click",
    "Click an element on the page using a CSS selector. Uses CDP to find and click.",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().describe("CSS selector of the element to click"),
    },
    async ({ tabId, selector }) => {
      try {
        // Find element center coordinates
        const evalResult = await relay.sendCommand("cdp.send", {
          tabId,
          method: "Runtime.evaluate",
          params: {
            expression: `(() => {
              const el = document.querySelector('${
              selector.replace(/'/g, "\\'")
            }');
              if (!el) return { error: 'Element not found: ${selector}' };
              const rect = el.getBoundingClientRect();
              return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName };
            })()`,
            returnByValue: true,
          },
        }) as {
          result: {
            value: { x?: number; y?: number; tag?: string; error?: string };
          };
        };

        const val = evalResult.result.value;
        if (val.error) return errorResult(val.error);

        // Dispatch click
        await relay.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchMouseEvent",
          params: {
            type: "mousePressed",
            x: val.x,
            y: val.y,
            button: "left",
            clickCount: 1,
          },
        });
        await relay.sendCommand("cdp.send", {
          tabId,
          method: "Input.dispatchMouseEvent",
          params: {
            type: "mouseReleased",
            x: val.x,
            y: val.y,
            button: "left",
            clickCount: 1,
          },
        });

        return textResult({ clicked: true, selector, tag: val.tag });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_type ---
  server.tool(
    "browser_type",
    "Type text into a focused element or a specific element on the page",
    {
      tabId: z.number().describe("Tab ID"),
      text: z.string().describe("Text to type"),
      selector: z.string().optional().describe("CSS selector to focus first"),
    },
    async ({ tabId, text, selector }) => {
      try {
        if (selector) {
          // Focus the element first
          await relay.sendCommand("cdp.send", {
            tabId,
            method: "Runtime.evaluate",
            params: {
              expression: `document.querySelector('${
                selector.replace(/'/g, "\\'")
              }')?.focus()`,
            },
          });
        }
        // Type using CDP
        await relay.sendCommand("cdp.send", {
          tabId,
          method: "Input.insertText",
          params: { text },
        });
        return textResult({ typed: true, text, selector });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_evaluate ---
  server.tool(
    "browser_evaluate",
    "Execute JavaScript in a tab and return the result",
    {
      tabId: z.number().describe("Tab ID"),
      expression: z.string().describe("JavaScript expression to evaluate"),
    },
    async ({ tabId, expression }) => {
      try {
        const result = await relay.sendCommand("cdp.send", {
          tabId,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }) as {
          result: { value: unknown };
          exceptionDetails?: { text: string };
        };

        if (result.exceptionDetails) {
          return errorResult(`JS Error: ${result.exceptionDetails.text}`);
        }
        return textResult(result.result.value);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- browser_get_content ---
  server.tool(
    "browser_get_content",
    "Get the text content or HTML of the page or a specific element",
    {
      tabId: z.number().describe("Tab ID"),
      selector: z.string().optional().describe(
        "CSS selector. If omitted, returns document body text.",
      ),
    },
    async ({ tabId, selector }) => {
      try {
        const expr = selector
          ? `document.querySelector('${
            selector.replace(/'/g, "\\'")
          }')?.innerText ?? '(element not found)'`
          : `document.body.innerText`;
        const result = await relay.sendCommand("cdp.send", {
          tabId,
          method: "Runtime.evaluate",
          params: { expression: expr, returnByValue: true },
        }) as { result: { value: string } };
        return textResult({ content: result.result.value });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  // --- Connect transport and start ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
