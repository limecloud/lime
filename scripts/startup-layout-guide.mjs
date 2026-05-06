#!/usr/bin/env node

/**
 * 启动排版诊断 - 简化版
 *
 * 使用 Playwright MCP 工具进行交互式测试
 * 适合在 Claude Code 中直接调用
 */

console.log("🚀 启动排版诊断测试\n");
console.log("请确保已启动开发服务器:");
console.log("  npm run tauri:dev:headless\n");
console.log("然后在 Claude Code 中使用 Playwright MCP 工具:\n");

console.log("1. 导航到应用:");
console.log('   mcp__playwright__browser_navigate({ url: "http://127.0.0.1:1420/?debug-startup&debug-layout-shift" })\n');

console.log("2. 等待加载完成:");
console.log('   等待 2-3 秒,观察页面渲染过程\n');

console.log("3. 截图记录:");
console.log('   mcp__playwright__browser_take_screenshot({ filename: "startup-initial.png" })\n');

console.log("4. 检查控制台:");
console.log('   mcp__playwright__browser_console_messages({ level: "error" })\n');

console.log("5. 查看性能报告:");
console.log('   打开浏览器 DevTools,查看 Console 中的:');
console.log('   - 🚀 Startup Performance Report');
console.log('   - 📐 Layout Shift Report\n');

console.log("6. 分析结果:");
console.log('   - CLS < 0.1: 优秀');
console.log('   - CLS 0.1-0.25: 需要改进');
console.log('   - CLS > 0.25: 差\n');

console.log("📝 完整的自动化测试脚本:");
console.log("   node scripts/startup-layout-e2e.mjs\n");
