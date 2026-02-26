/**
 * Relay Server — 常驻进程，桥接 Chrome 扩展和 MCP server
 * - /ws/browser-relay?token=xxx — Chrome 扩展连接
 * - /ws/mcp-relay?token=xxx    — MCP server 连接（内部通信）
 * - GET /api/browser-relay/config — 扩展配置发现
 *
 * 不暴露任何 HTTP 命令接口，所有浏览器操作只能通过 MCP 协议。
 */
import type { Config } from "./config.ts";
import { BrowserClient } from "./browser-client.ts";

/** 全局浏览器客户端（relay 进程持有） */
const browserClient = new BrowserClient();

/** 已连接的 MCP client WebSocket 列表 */
const mcpClients = new Set<WebSocket>();

export function startRelayServer(config: Config): Deno.HttpServer {
  const server = Deno.serve(
    { port: config.port, hostname: "127.0.0.1" },
    (req) => handleRequest(req, config),
  );

  console.error(`[Relay] Listening on 127.0.0.1:${config.port}`);
  return server;
}

function handleRequest(req: Request, config: Config): Response {
  const url = new URL(req.url);

  // 扩展配置发现
  if (req.method === "GET" && url.pathname === "/api/browser-relay/config") {
    return Response.json({ port: config.port, token: config.token });
  }

  // Chrome 扩展 WebSocket
  if (url.pathname === "/ws/browser-relay") {
    return handleBrowserWs(req, config);
  }

  // MCP server WebSocket
  if (url.pathname === "/ws/mcp-relay") {
    return handleMcpWs(req, config);
  }

  return new Response("Not Found", { status: 404 });
}

function handleBrowserWs(req: Request, config: Config): Response {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== config.token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.error("[Relay] Chrome extension connected");
    browserClient.attach(socket);
  };

  return response;
}

function handleMcpWs(req: Request, config: Config): Response {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== config.token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.error("[Relay] MCP client connected");
    mcpClients.add(socket);
  };

  socket.onclose = () => {
    console.error("[Relay] MCP client disconnected");
    mcpClients.delete(socket);
  };

  socket.onmessage = async (event) => {
    // MCP client 发来的命令，转发给浏览器
    let msg: { id: string; method: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    // 特殊命令：查询状态
    if (msg.method === "__status") {
      socket.send(JSON.stringify({
        id: msg.id,
        result: {
          connected: browserClient.isConnected(),
          attachedTabs: browserClient.getAttachedTabs(),
        },
      }));
      return;
    }

    // 转发到浏览器
    try {
      const result = await browserClient.sendCommand(msg.method, msg.params);
      socket.send(JSON.stringify({ id: msg.id, result }));
    } catch (err) {
      socket.send(JSON.stringify({
        id: msg.id,
        error: (err as Error).message,
      }));
    }
  };

  return response;
}
