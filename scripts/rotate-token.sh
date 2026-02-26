#!/bin/bash
# 生成新 token 并同步更新 chrome-extension/config.json 和环境变量提示
# 用法: ./scripts/rotate-token.sh [自定义token]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$ROOT_DIR/chrome-extension/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ 找不到 $CONFIG_FILE"
  exit 1
fi

# 生成或使用自定义 token
if [ -n "$1" ]; then
  NEW_TOKEN="$1"
else
  NEW_TOKEN=$(openssl rand -hex 32)
fi

# 读取当前 port
PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['port'])")

# 写入新配置
cat > "$CONFIG_FILE" << EOF
{
  "port": $PORT,
  "token": "$NEW_TOKEN"
}
EOF

echo "✅ Token 已更新"
echo ""
echo "   config.json: $CONFIG_FILE"
echo "   new token:   $NEW_TOKEN"
echo ""
echo "📋 下一步:"
echo "   1. 重新加载 Chrome 扩展（chrome://extensions → 刷新）"
echo "   2. MCP 配置中更新 RELAY_TOKEN:"
echo "      \"RELAY_TOKEN\": \"$NEW_TOKEN\""
