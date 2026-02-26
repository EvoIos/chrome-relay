/**
 * 浏览器客户端 — 封装与 Chrome 扩展的 WebSocket 通信
 * 负责：发送命令、匹配响应、超时处理、CDP 事件转发
 */

const COMMAND_TIMEOUT_MS = 30_000;
let commandCounter = 0;

type CdpEventCallback = (
  tabId: number,
  method: string,
  params: Record<string, unknown>,
) => void;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: number;
}

export class BrowserClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCommand>();
  private cdpListeners: CdpEventCallback[] = [];
  private attachedTabs: number[] = [];
  private pingTimer: number | null = null;

  /** 绑定 WebSocket 连接（由 relay-server 调用） */
  attach(ws: WebSocket): void {
    this.detach();
    this.ws = ws;

    ws.onmessage = (event) => this.handleMessage(event.data as string);
    ws.onclose = () => this.handleClose();

    this.startPing();
  }

  /** 断开当前连接 */
  detach(): void {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
    // 拒绝所有等待中的命令
    for (const [id, cmd] of this.pending) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error("Connection closed"));
      this.pending.delete(id);
    }
    this.attachedTabs = [];
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getAttachedTabs(): number[] {
    return [...this.attachedTabs];
  }

  /** 发送命令并等待响应 */
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error("Chrome extension not connected"));
        return;
      }

      const id = `cmd_${++commandCounter}_${Date.now()}`;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Command "${method}" timed out after ${COMMAND_TIMEOUT_MS}ms`,
          ),
        );
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /** 注册 CDP 事件监听 */
  onCdpEvent(callback: CdpEventCallback): void {
    this.cdpListeners.push(callback);
  }

  // --- 内部方法 ---

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 心跳
    if (msg.type === "ping") {
      this.ws?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "pong") {
      return;
    }

    // 状态更新
    if (msg.type === "status" && Array.isArray(msg.attachedTabs)) {
      this.attachedTabs = msg.attachedTabs as number[];
      return;
    }

    // CDP 事件
    if (msg.type === "cdp_event") {
      for (const cb of this.cdpListeners) {
        try {
          cb(
            msg.tabId as number,
            msg.method as string,
            (msg.params ?? {}) as Record<string, unknown>,
          );
        } catch { /* listener error, ignore */ }
      }
      return;
    }

    // 命令响应
    if (typeof msg.id === "string") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(msg.error as string));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private handleClose(): void {
    this.ws = null;
    this.stopPing();
    // 拒绝所有等待中的命令
    for (const [id, cmd] of this.pending) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error("Connection closed"));
      this.pending.delete(id);
    }
    this.attachedTabs = [];
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.ws!.send(JSON.stringify({ type: "ping" }));
      }
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

/** 全局单例 */
export const browserClient = new BrowserClient();
