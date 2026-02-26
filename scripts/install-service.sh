#!/bin/bash
# JavasRelay Browser — 一站式安装脚本
# 编译 Relay 二进制 → 安装到 /usr/local/bin → 注册 macOS 开机启动服务

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$PROJECT_DIR/chrome-browser-mcp"
PLIST_NAME="com.javasrelay.browser-relay.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"
INSTALL_PATH="/usr/local/bin/javas-relay"

echo "📦 编译 Relay..."
cd "$MCP_DIR"
deno compile --allow-net --allow-env --output javas-relay relay.ts

echo "📁 安装到 $INSTALL_PATH..."
if [ -w /usr/local/bin ]; then
  cp javas-relay "$INSTALL_PATH"
else
  sudo cp javas-relay "$INSTALL_PATH"
fi
rm javas-relay

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
