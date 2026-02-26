# Alma Browser MCP Server — 设计方案

## 1. 背景与目标

### 问题
需要让 AI Agent（如 Kiro）能操控用户已经打开的 Chrome 浏览器，包括：截图、点击、输入、读取页面内容、导航等。不希望重启 Chrome 或使用 `--remote-debugging-port`。

### 现有资源
已有一个 Chrome 扩展 **Alma Browser Relay**（位于 `/Users/zlc/alma/chrome-extension`），它能：
- 通过 Chrome `debugger` API attach 到任意已打开的 tab
- 通过 WebSocket 接收命令并执行
- 支持完整的 Chrome DevTools Protocol (CDP)

但缺少服务端 — 即那个 WebSocket Server + MCP Server。

### 目标
构建一个服务端项目，同时充当：
1. **WebSocket Server** — 供 Chrome 插件连接（Relay 中继）
2. **MCP Server** — 供 Kiro/AI Agent 调用工具

```
Kiro ──(MCP/stdio)──▶ alma-browser-mcp ──(WebSocket)──▶ Chrome Extension ──(CDP)──▶ 浏览器 Tab
```

## 2. Chrome 插件分析（已有代码）

### 插件基本信息
- Manifest V3，Service Worker 架构
- 权限：`debugger`, `tabs`, `activeTab`, `storage`, `alarms`
- 默认连接地址：`ws://127.0.0.1:23001/ws/browser-relay?token=<token>`
- 认证方式：URL query 参数 `token`
- 配置存储：`chrome.storage.local`（relayPort, authToken）
- 支持从服务端自动获取配置：`GET http://127.0.0.1:<port>/api/browser-relay/config`

### 插件支持的命令（服务端 → 插件）

插件通过 WebSocket 接收 JSON 消息，格式为 `{ id, method, params }`，返回 `{ id, result }` 或 `{ id, error }`。

| method | params | 说明 |
|--------|--------|------|
| `tabs.list` | 无 | 列出所有打开的 tab（含 url, title, attached 状态） |
| `tabs.create` | `{ url?, active? }` | 创建新 tab |
| `tabs.navigate` | `{ tabId, url }` | 导航指定 tab 到新 URL |
| `tabs.screenshot` | `{ windowId?, format?, quality? }` | 截取当前可见 tab 的截图（返回 dataUrl） |
| `debugger.attach` | `{ tabId, version? }` | attach debugger 到指定 tab |
| `debugger.detach` | `{ tabId }` | detach debugger |
| `cdp.send` | `{ tabId, method, params? }` | 发送任意 CDP 命令（自动 attach） |

### 插件的 WebSocket 协议

**连接地址**：`ws://127.0.0.1:{port}/ws/browser-relay?token={token}`

**消息类型**（插件 → 服务端）：
- `{ type: "status", attachedTabs: number[] }` — 连接后自动发送，tab 变化时也会发送
- `{ type: "ping" }` / `{ type: "pong" }` — 心跳
- `{ id: string, result: any }` — 命令执行成功
- `{ id: string, error: string }` — 命令执行失败
- `{ type: "cdp_event", tabId, method, params }` — CDP 事件转发

**消息类型**（服务端 → 插件）：
- `{ type: "ping" }` / `{ type: "pong" }` — 心跳
- `{ id: string, method: string, params: object }` — 命令请求

### 插件配置自动发现

插件启动时会尝试 `GET http://127.0.0.1:{port}/api/browser-relay/config`，期望返回：
```json
{ "port": 23001, "token": "xxx" }
```
服务端应实现此接口，方便插件自动配置。

### 插件默认配置（config.json）
```json
{
  "port": 23001,
  "token": "bd5d4a4354c66c6dae7c2e60a8d4025a4ca64a48d6f5bb8f0fb7106b74bbf2bf"
}
```

## 3. 服务端架构设计

### 技术选型
- **语言**：TypeScript (Deno) — 内置 TS 支持、WebSocket、更小内存占用
- **HTTP 框架**：Hono（`jsr:@hono/hono`）— 轻量，与 Deno 原生集成
- **WebSocket**：Deno 原生支持（`Deno.serve` 内置 upgrade），无需第三方库
- **MCP**：`npm:@modelcontextprotocol/sdk`（通过 Deno npm 兼容层）
- **MCP 传输**：stdio（Kiro 通过 stdin/stdout 通信）
- **测试**：`Deno.test` + `jsr:@std/assert`
- **参考项目**：`local-server-gateway`（同为 Deno + Hono 架构）

### 项目结构
```
alma-browser-mcp/
├── deno.json                 # Deno 配置（tasks, imports）
├── main.ts                   # 入口：启动 MCP Server + Relay Server
├── lib/
│   ├── mcp-server.ts         # MCP Server 定义（工具注册）
│   ├── relay-server.ts       # WebSocket + HTTP Server（Hono，与插件通信）
│   ├── browser-client.ts     # 封装与插件的通信逻辑（发命令、等响应）
│   └── config.ts             # 配置管理（port, token，从环境变量读取）
├── tests/
│   ├── browser-client_test.ts    # 单元测试：命令匹配、超时
│   └── integration/
│       └── relay_test.ts         # 集成测试：模拟插件连接、命令流转
└── README.md
```

### 测试策略
- **单元测试**：直接 import 模块，mock WebSocket，测试 `browser-client.ts` 的命令 id 匹配、超时逻辑、配置加载
- **集成测试**：用 Hono 的 `app.request()` 测 HTTP 端点；用 WebSocket 客户端模拟 Chrome 扩展，验证完整命令流转
- **运行方式**：`deno test --allow-net --allow-env tests/`
- **可编译**：`deno compile` 生成单个二进制文件

### 核心模块

#### 3.1 relay-server.ts — WebSocket + HTTP 服务

职责：
- 监听 `127.0.0.1:23001`
- WebSocket 路径：`/ws/browser-relay`（验证 token）
- HTTP 路径：`GET /api/browser-relay/config`（返回 port + token）
- 管理插件连接状态（connected/disconnected）
- 转发 CDP 事件

关键逻辑：
```
插件连接 → 验证 token → 保存 ws 连接 → 接收 status 消息 → 就绪
```

#### 3.2 browser-client.ts — 命令发送与响应匹配

职责：
- 封装 `sendCommand(method, params): Promise<result>` 
- 生成唯一 `id`，发送命令，等待对应 `id` 的响应
- 超时处理（建议 30 秒）
- 连接状态检查

核心接口：
```typescript
interface BrowserClient {
  isConnected(): boolean;
  sendCommand(method: string, params?: object): Promise<any>;
  onCdpEvent(callback: (tabId: number, method: string, params: object) => void): void;
}
```

#### 3.3 mcp-server.ts — MCP 工具定义

通过 stdio 与 Kiro 通信，注册以下工具：

### MCP 工具设计

| 工具名 | 参数 | 返回 | 说明 |
|--------|------|------|------|
| `browser_list_tabs` | 无 | Tab 列表 | 列出所有打开的 tab |
| `browser_navigate` | `tabId, url` | Tab 信息 | 导航到指定 URL |
| `browser_screenshot` | `tabId?` | base64 图片 | 截取当前可见页面 |
| `browser_click` | `tabId, selector` | 成功/失败 | 点击页面元素（通过 CDP） |
| `browser_type` | `tabId, selector, text` | 成功/失败 | 在输入框中输入文字 |
| `browser_get_content` | `tabId, selector?` | HTML/文本 | 获取页面内容 |
| `browser_evaluate` | `tabId, expression` | 执行结果 | 执行任意 JavaScript |
| `browser_new_tab` | `url?` | Tab 信息 | 创建新 tab |
| `browser_status` | 无 | 连接状态 | 检查插件是否已连接 |

#### 工具实现示例（伪代码）

`browser_click` 的实现：
```typescript
// 1. 通过 relay 发送 cdp.send 命令
// 2. 先用 Runtime.evaluate 找到元素并获取坐标
// 3. 再用 Input.dispatchMouseEvent 模拟点击

async function browserClick(tabId: number, selector: string) {
  // 获取元素位置
  const result = await client.sendCommand('cdp.send', {
    tabId,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        })()
      `,
      returnByValue: true
    }
  });
  
  const { x, y } = result.result.value;
  
  // 模拟点击
  await client.sendCommand('cdp.send', {
    tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }
  });
  await client.sendCommand('cdp.send', {
    tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }
  });
}
```

`browser_screenshot` 的实现：
```typescript
// 直接用插件的 tabs.screenshot 命令，返回 dataUrl
// 转换为 base64 供 MCP 返回
async function browserScreenshot(tabId?: number) {
  const result = await client.sendCommand('tabs.screenshot', {
    format: 'png',
    quality: 80
  });
  return result.dataUrl; // data:image/png;base64,...
}
```

## 4. MCP 配置（Kiro 端）

项目完成后，在 Kiro 的 `.kiro/settings/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "alma-browser": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "/path/to/alma-browser-mcp/main.ts"],
      "env": {
        "RELAY_PORT": "23001",
        "RELAY_TOKEN": "bd5d4a4354c66c6dae7c2e60a8d4025a4ca64a48d6f5bb8f0fb7106b74bbf2bf"
      },
      "disabled": false,
      "autoApprove": ["browser_list_tabs", "browser_status", "browser_screenshot"]
    }
  }
}
```

或使用编译后的二进制：
```json
{
  "mcpServers": {
    "alma-browser": {
      "command": "/path/to/alma-browser-mcp/alma-browser-mcp",
      "env": {
        "RELAY_PORT": "23001",
        "RELAY_TOKEN": "bd5d4a4354c66c6dae7c2e60a8d4025a4ca64a48d6f5bb8f0fb7106b74bbf2bf"
      },
      "disabled": false,
      "autoApprove": ["browser_list_tabs", "browser_status", "browser_screenshot"]
    }
  }
}
```

## 5. 使用流程

1. 启动 MCP Server（Kiro 自动管理，或手动 `node dist/index.js`）
2. 打开 Chrome，确保 Alma Browser Relay 插件已安装并启用
3. 插件自动连接到 `ws://127.0.0.1:23001`，badge 显示 "ON"
4. 在 Kiro 中使用工具：
   - `browser_list_tabs` → 看到所有 tab
   - `browser_screenshot` → 截取当前页面
   - `browser_click` → 点击元素
   - `browser_evaluate` → 执行 JS

## 6. 注意事项与边界情况

- **插件未连接**：所有工具应返回清晰的错误信息 "Chrome extension not connected"
- **Tab 已关闭**：命令执行时 tab 可能已关闭，需要处理错误
- **CDP attach**：`cdp.send` 会自动 attach，但 attach 会在 tab 上显示调试提示条
- **截图限制**：`tabs.screenshot` 只能截取当前可见的 tab（Chrome API 限制）
- **跨域限制**：CDP 的 `Runtime.evaluate` 不受跨域限制，可以操作任何页面
- **Token 安全**：token 仅用于本地通信，不暴露到外网
- **并发命令**：通过唯一 id 匹配请求/响应，天然支持并发

## 7. 后续扩展（可选）

- 支持多个 Chrome 实例（多个插件连接）
- 添加 `browser_scroll`、`browser_wait_for` 等高级工具
- 支持 CDP 事件订阅（如 Network.requestWillBeSent）
- 录制/回放操作序列
- 页面元素高亮标注（辅助 AI 理解页面结构）
