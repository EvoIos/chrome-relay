/**
 * Relay Client — MCP server 用来连接 relay 的 WebSocket 客户端
 * 替代原来直接持有浏览器 WebSocket 的 browserClient 单例
 */

const COMMAND_TIMEOUT_MS = 30_000;
const RECONNECT_INTERVAL_MS = 3_000;
let commandCounter = 0;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCommand>();
  private relayUrl: string;
  private reconnectTimer: number | null = null;
  private _connected = false;

  constructor(port: number, token: string) {
    this.relayUrl = `ws://127.0.0.1:${port}/ws/mcp-relay?token=${
      encodeURIComponent(token)
    }`;
  }

  /** 连接到 relay server */
  connect(): void {
    if (this.ws) return;
    this._tryConnect();
  }

  /** 断开连接 */
  disconnect(): void {
    this._stopReconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
    this._connected = false;
    this._rejectAll("Disconnected");
  }

  isConnected(): boolean {
    return this._connected;
  }

  /** 发送命令到 relay，relay 转发给浏览器 */
  sendCommand(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this.ws) {
        reject(
          new Error(
            "Not connected to relay server. Is the relay process running?",
          ),
        );
        return;
      }

      const id = `mcp_${++commandCounter}_${Date.now()}`;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Command "${method}" timed out after ${COMMAND_TIMEOUT_MS}ms`,
          ),
        );
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /** 查询浏览器连接状态 */
  async getStatus(): Promise<{
    connected: boolean;
    attachedTabs: number[];
  }> {
    const result = await this.sendCommand("__status");
    return result as { connected: boolean; attachedTabs: number[] };
  }

  // --- 内部方法 ---

  private _tryConnect(): void {
    try {
      const ws = new WebSocket(this.relayUrl);

      ws.onopen = () => {
        console.error("[RelayClient] Connected to relay");
        this._connected = true;
        this.ws = ws;
        this._stopReconnect();
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

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
      };

      ws.onclose = () => {
        console.error("[RelayClient] Disconnected from relay");
        this.ws = null;
        this._connected = false;
        this._rejectAll("Relay connection closed");
        this._scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._tryConnect();
    }, RECONNECT_INTERVAL_MS);
  }

  private _stopReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _rejectAll(reason: string): void {
    for (const [id, cmd] of this.pending) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
