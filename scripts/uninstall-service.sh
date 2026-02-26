#!/bin/bash
# 卸载 JavasRelay Browser 开机启动服务

PLIST_NAME="com.javasrelay.browser-relay.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ -f "$TARGET" ]; then
  launchctl unload "$TARGET"
  rm "$TARGET"
  echo "✅ 服务已卸载"
else
  echo "⚠️  服务未安装"
fi
