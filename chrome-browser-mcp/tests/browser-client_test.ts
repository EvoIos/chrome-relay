/**
 * BrowserClient 单元测试
 * 用 mock WebSocket 测试命令发送、响应匹配、超时、断连处理
 */
import { assertEquals, assertRejects } from "@std/assert";
import { BrowserClient } from "../lib/browser-client.ts";

/** 创建一对互联的 WebSocket（通过本地服务器） */
async function createSocketPair(): Promise<{
  server: WebSocket;
  client: WebSocket;
  cleanup: () => void;
}> {
  let serverSocket: WebSocket | null = null;
  const serverReady = Promise.withResolvers<WebSocket>();

  const httpServer = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (req) => {
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.onopen = () => serverReady.resolve(socket);
      return response;
    }
    return new Response("Not found", { status: 404 });
  });

  const addr = httpServer.addr;
  const clientSocket = new WebSocket(`ws://127.0.0.1:${addr.port}`);
  await new Promise<void>((r) => (clientSocket.onopen = () => r()));
  serverSocket = await serverReady.promise;

  return {
    server: serverSocket,
    client: clientSocket,
    cleanup: () => {
      try {
        clientSocket.close();
      } catch { /* */ }
      try {
        serverSocket?.close();
      } catch { /* */ }
      httpServer.shutdown();
    },
  };
}

Deno.test("sendCommand — 正常响应", async () => {
  const { server, client, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    bc.attach(server);

    // 模拟扩展端：收到命令后回复
    client.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && msg.method) {
        client.send(
          JSON.stringify({ id: msg.id, result: { tabs: [1, 2, 3] } }),
        );
      }
    };

    const result = await bc.sendCommand("tabs.list");
    assertEquals((result as { tabs: number[] }).tabs, [1, 2, 3]);

    bc.detach();
  } finally {
    cleanup();
  }
});

Deno.test("sendCommand — 错误响应", async () => {
  const { server, client, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    bc.attach(server);

    client.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        client.send(JSON.stringify({ id: msg.id, error: "Tab not found" }));
      }
    };

    await assertRejects(
      () =>
        bc.sendCommand("tabs.navigate", {
          tabId: 999,
          url: "https://example.com",
        }),
      Error,
      "Tab not found",
    );

    bc.detach();
  } finally {
    cleanup();
  }
});

Deno.test("sendCommand — 未连接时抛错", async () => {
  const bc = new BrowserClient();
  await assertRejects(
    () => bc.sendCommand("tabs.list"),
    Error,
    "Chrome extension not connected",
  );
});

Deno.test("isConnected — 状态正确", async () => {
  const { server, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    assertEquals(bc.isConnected(), false);

    bc.attach(server);
    assertEquals(bc.isConnected(), true);

    bc.detach();
    assertEquals(bc.isConnected(), false);
  } finally {
    cleanup();
  }
});

Deno.test("status 消息更新 attachedTabs", async () => {
  const { server, client, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    bc.attach(server);

    // 模拟扩展发送 status
    client.send(JSON.stringify({ type: "status", attachedTabs: [101, 202] }));

    // 等一下让消息处理完
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(bc.getAttachedTabs(), [101, 202]);

    bc.detach();
  } finally {
    cleanup();
  }
});

Deno.test("CDP 事件回调", async () => {
  const { server, client, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    bc.attach(server);

    const events: { tabId: number; method: string }[] = [];
    bc.onCdpEvent((tabId, method) => {
      events.push({ tabId, method });
    });

    client.send(JSON.stringify({
      type: "cdp_event",
      tabId: 42,
      method: "Network.requestWillBeSent",
      params: { url: "https://example.com" },
    }));

    await new Promise((r) => setTimeout(r, 50));

    assertEquals(events.length, 1);
    assertEquals(events[0].tabId, 42);
    assertEquals(events[0].method, "Network.requestWillBeSent");

    bc.detach();
  } finally {
    cleanup();
  }
});

Deno.test("detach 拒绝所有等待中的命令", async () => {
  const { server, cleanup } = await createSocketPair();
  try {
    const bc = new BrowserClient();
    bc.attach(server);

    // 发送命令但不回复
    const promise = bc.sendCommand("tabs.list");

    // 立即断开
    bc.detach();

    await assertRejects(
      () => promise,
      Error,
      "Connection closed",
    );
  } finally {
    cleanup();
  }
});
