#!/bin/bash

echo "🚀 Tauri 打包进度监控"
echo "===================="
echo ""

while true; do
    clear
    echo "🚀 Tauri 打包进度监控"
    echo "===================="
    echo ""
    echo "⏰ 当前时间: $(date '+%H:%M:%S')"
    echo ""

    # 检查 Rust 编译进度
    if [ -f /tmp/tauri-build.log ]; then
        echo "📝 最新日志 (最后 20 行):"
        echo "---"
        tail -20 /tmp/tauri-build.log
        echo ""
    fi

    # 检查是否完成
    if [ -d "src-tauri/target/release/bundle" ]; then
        echo "✅ 打包完成!"
        echo ""
        echo "📦 生成的安装包:"
        ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || echo "  DMG 文件生成中..."
        ls -lh src-tauri/target/release/bundle/macos/*.app 2>/dev/null || echo "  APP 文件生成中..."
        break
    fi

    # 检查进程是否还在运行
    if ! pgrep -f "tauri build" > /dev/null; then
        echo "⚠️  打包进程已结束"
        break
    fi

    sleep 10
done

echo ""
echo "监控结束"
