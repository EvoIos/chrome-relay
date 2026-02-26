/**
 * Relay Server — WebSocket + HTTP
 * - WebSocket: /ws/browser-relay?token=xxx（Chrome 扩展连接）
 * - HTTP: GET /api/browser-relay/config（扩展自动发现配置）
 */
import type { Config } from "./config.ts";
import { browserClient } from "./browser-client.ts";

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

  // HTTP: 配置自动发现
  if (req.method === "GET" && url.pathname === "/api/browser-relay/config") {
    return Response.json({ port: config.port, token: config.token });
  }

  // WebSocket: 插件连接
  if (url.pathname === "/ws/browser-relay") {
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

    // onmessage / onclose 由 browserClient 管理

    return response;
  }

  return new Response("Not Found", { status: 404 });
}
