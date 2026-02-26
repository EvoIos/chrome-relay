/**
 * Alma Browser MCP — 入口
 * 同时启动 Relay Server（WebSocket + HTTP）和 MCP Server（stdio）
 */
import { loadConfig } from "./lib/config.ts";
import { startRelayServer } from "./lib/relay-server.ts";
import { startMcpServer } from "./lib/mcp-server.ts";

const config = loadConfig();

// 启动 WebSocket/HTTP Relay（供 Chrome 扩展连接）
startRelayServer(config);

// 启动 MCP Server（供 Kiro 通过 stdio 调用）
await startMcpServer();
