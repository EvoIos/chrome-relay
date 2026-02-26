#!/bin/bash
# JavasRelay Browser — macOS 安装脚本
# 安装预编译的 Relay 二进制到系统路径，注册开机启动服务
#
# 用法:
#   开发机（有 Deno）: bash scripts/install-service.sh          — 自动编译并安装
#   部署机（无 Deno）: bash scripts/install-service.sh          — 安装已编译的二进制
#   指定二进制路径:    bash scripts/install-service.sh /path/to/javas-relay

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$PROJECT_DIR/chrome-browser-mcp"
PLIST_NAME="com.javasrelay.browser-relay.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"
INSTALL_PATH="/usr/local/bin/javas-relay"
BINARY="${1:-}"

# 查找或编译二进制
if [ -n "$BINARY" ] && [ -f "$BINARY" ]; then
  echo "📦 使用指定的二进制: $BINARY"
elif [ -f "$MCP_DIR/javas-relay" ]; then
  echo "📦 使用已编译的二进制: $MCP_DIR/javas-relay"
  BINARY="$MCP_DIR/javas-relay"
elif command -v deno &>/dev/null; then
  echo "📦 编译 Relay..."
  cd "$MCP_DIR"
  deno compile --allow-net --allow-env --output javas-relay relay.ts
  BINARY="$MCP_DIR/javas-relay"
else
  echo "❌ 未找到预编译的二进制，且 Deno 未安装"
  echo ""
  echo "请先在开发机上编译:"
  echo "  cd chrome-browser-mcp && deno task compile:relay"
  echo ""
  echo "然后将 javas-relay 二进制复制到本机后重新运行此脚本"
  exit 1
fi

echo "📁 安装到 $INSTALL_PATH..."
if [ -w /usr/local/bin ]; then
  cp "$BINARY" "$INSTALL_PATH"
else
  sudo cp "$BINARY" "$INSTALL_PATH"
fi

echo "⚙️  注册系统服务..."
if [ -f "$TARGET" ]; then
  launchctl unload "$TARGET" 2>/dev/null || true
fi
cp "$SCRIPT_DIR/$PLIST_NAME" "$TARGET"
launchctl load "$TARGET"

echo ""
echo "✅ 安装完成"
echo "   二进制: $INSTALL_PATH"
echo "   日志:   /tmp/javas-relay.log"
echo "   状态:   launchctl list | grep javasrelay"
echo "   卸载:   bash scripts/uninstall-service.sh"
