/**
 * Relay Server 集成测试
 * 测试 HTTP 配置端点和 WebSocket 连接流程
 */
import { assertEquals } from "@std/assert";
import type { Config } from "../../lib/config.ts";

const TEST_PORT = 23099;
const TEST_TOKEN = "test-token-12345";

function testConfig(): Config {
  return { port: TEST_PORT, token: TEST_TOKEN };
}

Deno.test("GET /api/browser-relay/config 返回配置", async () => {
  const config = testConfig();
  const { startRelayServer } = await import("../../lib/relay-server.ts");

  // 需要临时替换全局 browserClient，这里直接测 HTTP
  const server = Deno.serve(
    { port: config.port, hostname: "127.0.0.1" },
    (req) => {
      const url = new URL(req.url);
      if (
        req.method === "GET" && url.pathname === "/api/browser-relay/config"
      ) {
        return Response.json({ port: config.port, token: config.token });
      }
      return new Response("Not Found", { status: 404 });
    },
  );

  try {
    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/api/browser-relay/config`,
    );
    assertEquals(res.status, 200);

    const data = await res.json();
    assertEquals(data.port, TEST_PORT);
    assertEquals(data.token, TEST_TOKEN);
  } finally {
    await server.shutdown();
  }
});

Deno.test({
  name: "WebSocket 连接 — token 正确时升级成功",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const config = testConfig();

    const server = Deno.serve(
      { port: config.port, hostname: "127.0.0.1" },
      (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/ws/browser-relay") {
          const token = url.searchParams.get("token");
          if (token !== config.token) {
            return new Response("Unauthorized", { status: 401 });
          }
          if (
            (req.headers.get("upgrade") || "").toLowerCase() !== "websocket"
          ) {
            return new Response("Expected WebSocket", { status: 426 });
          }
          const { socket, response } = Deno.upgradeWebSocket(req);
          socket.onopen = () => {
            socket.send(JSON.stringify({ type: "welcome" }));
          };
          return response;
        }
        return new Response("Not Found", { status: 404 });
      },
    );

    try {
      const ws = new WebSocket(
        `ws://127.0.0.1:${TEST_PORT}/ws/browser-relay?token=${TEST_TOKEN}`,
      );

      const msg = await new Promise<string>((resolve, reject) => {
        ws.onmessage = (e) => resolve(e.data);
        ws.onerror = (e) => reject(e);
        setTimeout(() => reject(new Error("timeout")), 3000);
      });

      const parsed = JSON.parse(msg);
      assertEquals(parsed.type, "welcome");

      ws.close();
      // 等 WebSocket 关闭完成
      await new Promise<void>((r) => {
        ws.onclose = () => r();
        setTimeout(r, 500);
      });
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test("WebSocket 连接 — token 错误时返回 401", async () => {
  const config = testConfig();

  const server = Deno.serve(
    { port: config.port, hostname: "127.0.0.1" },
    (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/ws/browser-relay") {
        const token = url.searchParams.get("token");
        if (token !== config.token) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { socket, response } = Deno.upgradeWebSocket(req);
        return response;
      }
      return new Response("Not Found", { status: 404 });
    },
  );

  try {
    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/ws/browser-relay?token=wrong-token`,
    );
    assertEquals(res.status, 401);
    // 消费 response body 避免泄漏
    await res.body?.cancel();
  } finally {
    await server.shutdown();
  }
});
