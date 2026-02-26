# Chrome Browser MCP

让 AI Agent（Kiro 等）通过 MCP 协议控制你已经打开的 Chrome 浏览器 — 截图、点击、输入、读取页面、执行 JS，无需重启 Chrome。

```
Kiro ──(MCP/stdio)──▶ chrome-browser-mcp ──(WebSocket)──▶ Chrome Extension ──(CDP)──▶ 浏览器
```

## 前置要求

- [Deno](https://deno.land/) ≥ 2.0
- Chrome 浏览器

## 快速开始

### 1. 安装 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension/` 目录
4. 扩展图标显示红色 "OFF"（服务端未启动）

### 2. 启动 MCP Server

```bash
cd chrome-browser-mcp
deno task start
```

扩展图标变为绿色 "ON" 表示连接成功。

### 3. 配置 Kiro

在 `.kiro/settings/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "chrome-browser": {
      "command": "deno",
      "args": ["run", "--allow-net", "--allow-env", "/你的路径/chrome-browser-mcp/main.ts"],
      "env": {
        "RELAY_PORT": "23002",
        "RELAY_TOKEN": "bd5d4a4354c66c6dae7c2e60a8d4025a4ca64a48d6f5bb8f0fb7106b74bbf2bf"
      },
      "autoApprove": ["browser_list_tabs", "browser_status", "browser_screenshot"]
    }
  }
}
```

## MCP 工具

| 工具 | 说明 |
|------|------|
| `browser_status` | 检查 Chrome 扩展是否已连接 |
| `browser_list_tabs` | 列出所有打开的 tab |
| `browser_new_tab` | 创建新 tab |
| `browser_navigate` | 导航到指定 URL |
| `browser_screenshot` | 截取当前可见页面 |
| `browser_click` | 通过 CSS 选择器点击元素 |
| `browser_type` | 在输入框中输入文字 |
| `browser_get_content` | 获取页面文本内容 |
| `browser_evaluate` | 执行任意 JavaScript |

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_PORT` | `23002` | WebSocket 监听端口 |
| `RELAY_TOKEN` | config.json 中的值 | 认证 token |

### 更换 Token

```bash
./scripts/rotate-token.sh          # 自动生成随机 token
./scripts/rotate-token.sh my-token # 使用自定义 token
```

更换后需要：重新加载 Chrome 扩展 + 更新 MCP 配置中的 `RELAY_TOKEN`。

## 开发

```bash
cd chrome-browser-mcp

deno task dev          # 开发模式（watch）
deno task test         # 运行所有测试
deno task test:unit    # 仅单元测试
deno task compile      # 编译为单个二进制
```

## 项目结构

```
chrome-browser-mcp/
├── main.ts                 # 入口
├── lib/
│   ├── config.ts           # 配置管理
│   ├── relay-server.ts     # WebSocket + HTTP 服务
│   ├── browser-client.ts   # 与扩展的通信封装
│   └── mcp-server.ts       # MCP 工具定义
└── tests/                  # 测试

chrome-extension/           # Chrome 扩展（Manifest V3）
```
