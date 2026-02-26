/**
 * Relay 常驻进程入口
 * 只负责桥接 Chrome 扩展和 MCP server，不暴露 HTTP 命令接口
 *
 * 启动: deno run --allow-net --allow-env relay.ts
 */
import { loadConfig } from "./lib/config.ts";
import { startRelayServer } from "./lib/relay-server.ts";

const config = loadConfig();
startRelayServer(config);

console.error(
  `[Relay] Ready. Chrome extension → ws://127.0.0.1:${config.port}/ws/browser-relay`,
);
console.error(
  `[Relay] MCP clients  → ws://127.0.0.1:${config.port}/ws/mcp-relay`,
);

// 保持进程运行
await new Promise(() => {});
