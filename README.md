# Alma Browser MCP

让 AI Agent 通过 MCP 协议控制你已经打开的 Chrome 浏览器 — 截图、点击、输入、读取页面、执行 JS，无需重启 Chrome。

支持多个 Agent 同时连接同一个浏览器。

## 架构

```
Agent A ──(stdio)──┐
Agent B ──(stdio)──┤                                    Chrome Extension
Agent C ──(stdio)──┼──(WebSocket)──▶ Relay Server ──(WebSocket)──▶ ──(CDP)──▶ 浏览器
                   │                 (常驻进程)
```

- Relay Server：常驻进程，桥接 Chrome 扩展和所有 MCP client
- MCP Server：每个 Agent 各启动一个实例，通过 stdio 通信，内部连接 Relay

## 前置要求

- [Deno](https://deno.land/) ≥ 2.0
- Chrome 浏览器

## 快速开始

### 1. 安装 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension/` 目录
4. 扩展图标显示红色 "OFF"（Relay 未启动）

### 2. 启动 Relay（常驻进程）

```bash
cd chrome-browser-mcp
deno task relay
```

扩展图标变为绿色 "ON" 表示连接成功。Relay 只需启动一次，所有 Agent 共享。

### 3. 配置你的 Agent

每个 Agent 只需配置 MCP Server 指向 `main.ts`，它会自动通过 WebSocket 连接到 Relay。

#### Kiro

`.kiro/settings/mcp.json`：

```json
{
  "mcpServers": {
    "alma-browser": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "/你的路径/chrome-browser-mcp/main.ts"],
      "env": {
        "RELAY_PORT": "23002",
        "RELAY_TOKEN": "你的token"
      },
      "autoApprove": [
        "browser_status", "browser_list_tabs", "browser_screenshot",
        "browser_click", "browser_type", "browser_get_content",
        "browser_evaluate", "browser_navigate", "browser_new_tab"
      ]
    }
  }
}
```

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

```json
{
  "mcpServers": {
    "alma-browser": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "/你的路径/chrome-browser-mcp/main.ts"],
      "env": {
        "RELAY_PORT": "23002",
        "RELAY_TOKEN": "你的token"
      }
    }
  }
}
```

#### Cursor

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "alma-browser": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "/你的路径/chrome-browser-mcp/main.ts"],
      "env": {
        "RELAY_PORT": "23002",
        "RELAY_TOKEN": "你的token"
      }
    }
  }
}
```

#### 其他 MCP 兼容 Agent

任何支持 MCP stdio 协议的 Agent 都可以使用，配置模式相同：
- command: `deno`
- args: `["run", "--allow-net", "--allow-env", "<绝对路径>/chrome-browser-mcp/main.ts"]`
- env: `RELAY_PORT`（默认 23002）+ `RELAY_TOKEN`（与 Chrome 扩展一致）

## MCP 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `browser_status` | 无 | 检查 Relay 和 Chrome 扩展连接状态 |
| `browser_list_tabs` | 无 | 列出所有打开的 tab（返回 id、url、title） |
| `browser_new_tab` | `url?` | 创建新 tab |
| `browser_navigate` | `tabId`, `url` | 导航到指定 URL |
| `browser_screenshot` | `format?`, `quality?` | 截取当前可见页面，返回 base64 图片 |
| `browser_click` | `tabId`, `selector` | 通过 CSS 选择器点击元素 |
| `browser_type` | `tabId`, `selector`, `text` | 在输入框中输入文字 |
| `browser_get_content` | `tabId`, `selector?` | 获取页面或元素的文本内容 |
| `browser_evaluate` | `tabId`, `expression` | 在页面上下文执行任意 JavaScript |

> `tabId` 通过 `browser_list_tabs` 获取。

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_PORT` | `23002` | Relay 监听端口 |
| `RELAY_TOKEN` | config.ts 中的默认值 | 认证 token，需与 Chrome 扩展一致 |

### 更换 Token

```bash
./scripts/rotate-token.sh          # 自动生成随机 token
./scripts/rotate-token.sh my-token # 使用自定义 token
```

更换后需要：重新加载 Chrome 扩展 + 重启 Relay + 更新各 Agent 的 `RELAY_TOKEN`。

## 开发

```bash
cd chrome-browser-mcp

deno task relay        # 启动 Relay 常驻进程
deno task relay:dev    # Relay 开发模式（watch）
deno task mcp          # 启动 MCP Server
deno task dev          # MCP 开发模式（watch）
deno task test         # 运行所有测试
deno task test:unit    # 仅单元测试
deno task compile:relay  # 编译 Relay 为单个二进制
deno task compile:mcp    # 编译 MCP Server 为单个二进制
```

## 项目结构

```
chrome-browser-mcp/
├── relay.ts                # Relay 常驻进程入口
├── main.ts                 # MCP Server 入口（每个 Agent 一个）
├── lib/
│   ├── config.ts           # 配置管理
│   ├── relay-server.ts     # Relay：WebSocket 桥接
│   ├── relay-client.ts     # MCP→Relay 的 WebSocket 客户端
│   ├── browser-client.ts   # Relay→Chrome 扩展的通信封装
│   └── mcp-server.ts       # MCP 工具定义
└── tests/

chrome-extension/           # Chrome 扩展（Manifest V3）
```
