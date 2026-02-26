/**
 * MCP Server — 注册浏览器控制工具，通过 stdio 与 agent 通信
 * 通过 RelayClient 连接到常驻 relay 进程，不直接持有浏览器连接
 */
import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "npm:zod";
import { RelayClient } from "./relay-client.ts";

export async function startMcpServer(
  relay: RelayClient,
): Promise<void> {
  const server = new McpServer({
    name: "javas-relay",
    version: "1.0.0",
  });

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
