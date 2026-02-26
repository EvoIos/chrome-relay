# Alma Browser MCP — 开发规范

## 技术栈
- Deno + TypeScript
- Hono (HTTP 框架)
- Deno 原生 WebSocket
- @modelcontextprotocol/sdk (MCP)

## 项目结构
- `alma-browser-mcp/` — 服务端代码
- `chrome-extension/` — Chrome 扩展（已有，不修改）

## 开发约定
- 使用 `deno fmt` 格式化代码
- 使用 `deno test` 运行测试
- 配置通过环境变量 `RELAY_PORT` 和 `RELAY_TOKEN` 传入
- MCP 通过 stdio 传输，WebSocket/HTTP 监听 127.0.0.1
- 错误信息要清晰，特别是插件未连接时
