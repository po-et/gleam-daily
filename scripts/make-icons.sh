#!/usr/bin/env bash
# 生成 resources/ 下的全部图标产物：见 docs/SPEC.md §14。
#   - resources/icon.png            1024px 应用图标位图（electron-vite 开发期 Dock 图标可用）
#   - resources/icon.icns           electron-builder mac 打包用（electron-builder.yml 引用此路径）
#   - resources/trayTemplate.png    22px 菜单栏 template 图（黑色 alpha）
#   - resources/trayTemplate@2x.png 44px 菜单栏 template 图（黑色 alpha）
#
# 依赖：swift（CoreGraphics 绘制）、iconutil（iconset -> icns），均为 macOS 自带。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
RES="$ROOT/resources"
SWIFT="$DIR/make-icons.swift"

mkdir -p "$RES"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[make-icons] 绘制应用图标各尺寸 PNG …"
sizes=(16 32 64 128 256 512 1024)
for s in "${sizes[@]}"; do
  swift "$SWIFT" app "$s" "$TMP/app_${s}.png"
done

# 1024 主图直接落地为 resources/icon.png
cp "$TMP/app_1024.png" "$RES/icon.png"

echo "[make-icons] 组装 .iconset 并用 iconutil 生成 icon.icns …"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
cp "$TMP/app_16.png"   "$ICONSET/icon_16x16.png"
cp "$TMP/app_32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$TMP/app_32.png"   "$ICONSET/icon_32x32.png"
cp "$TMP/app_64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$TMP/app_128.png"  "$ICONSET/icon_128x128.png"
cp "$TMP/app_256.png"  "$ICONSET/icon_128x128@2x.png"
cp "$TMP/app_256.png"  "$ICONSET/icon_256x256.png"
cp "$TMP/app_512.png"  "$ICONSET/icon_256x256@2x.png"
cp "$TMP/app_512.png"  "$ICONSET/icon_512x512.png"
cp "$TMP/app_1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$RES/icon.icns"

echo "[make-icons] 绘制菜单栏 template 托盘图 22 / 44px …"
swift "$SWIFT" tray 22 "$RES/trayTemplate.png"
swift "$SWIFT" tray 44 "$RES/trayTemplate@2x.png"

echo "[make-icons] 完成，产物："
ls -la "$RES"
