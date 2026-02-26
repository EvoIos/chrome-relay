/**
 * MCP Server 入口 — 每个 agent 各启动一个
 * 通过 WebSocket 连接到常驻 relay 进程，通过 stdio 与 agent 通信
 *
 * 启动: deno run --allow-net --allow-env main.ts
 * 前提: relay.ts 已在运行
 */
import { loadConfig } from "./lib/config.ts";
import { RelayClient } from "./lib/relay-client.ts";
import { startMcpServer } from "./lib/mcp-server.ts";

const config = loadConfig();

// 连接到 relay
const relay = new RelayClient(config.port, config.token);
relay.connect();

// 等待连接建立（最多 5 秒）
const deadline = Date.now() + 5_000;
while (!relay.isConnected() && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200));
}

if (!relay.isConnected()) {
  console.error(
    "[MCP] Warning: Could not connect to relay. Tools will fail until relay is available.",
  );
}

// 启动 MCP Server（stdio）
await startMcpServer(relay);
