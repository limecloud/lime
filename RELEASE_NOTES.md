## Lime v0.92.0

### ✨ 主要更新

- **Team Workspace 正式成型**：Agent 聊天页新增 Team Workspace 主工作台、建议栏、Dock 与 Home Shell，围绕多代理协作视图重组交互结构
- **Team 配置与发布稳定性收尾**：补齐 Team Selector 自定义 Team 配置链路、当前 Team 展示与相关测试，并修复通知、Provider Runtime 与前端类型兼容问题，确保 `v0.92.0` 可稳定构建发布
- **运行态与工具可视化增强**：`ToolCallDisplay`、Harness 状态面板、Runtime Strip、执行日志与子代理时间线继续增强，工具调用与运行态反馈更完整
- **Aster Agent 运行时继续收口**：Rust 侧补齐 session store、subagent control、agent tools inventory / execution、runtime queue 及命令桥接，统一现役 Agent Runtime 路径
- **治理与测试基建升级**：新增 `pr-gate`、本地校验脚本、命令契约检查、workspace smoke 与治理报告更新，发布前自检链路更清晰
- **Provider / 模型兼容性继续补强**：补充 Novita 与多种 OpenAI/Claude 兼容 provider 细节，推理内容与工具调用适配继续完善

### ⚠️ 兼容性说明

- Agent 聊天页结构继续向 Team Workspace 与现役 Runtime API 收口，旧 compat 会话 / 子代理展示路径不再建议扩展
- 工具面板、Harness 状态与时间线展示依赖新的事件元数据与运行时映射，历史 UI 分支需要逐步跟进

### 🔗 依赖同步

- `src-tauri/Cargo.toml` 中的 `aster-rust` 依赖固定到 `v0.20.0`
- 应用版本同步提升到 `v0.92.0`，覆盖 `package.json`、Tauri 配置与 Rust workspace 版本入口

### 🧪 测试

- 发布前执行：`cd src-tauri && cargo test`
- 发布前执行：`cd src-tauri && cargo fmt --all --check`
- 发布前执行：`cd src-tauri && cargo clippy`
- 发布前执行：`npm run lint`

### 📝 文档

- 更新治理、测试、工具体系与 Aster 集成相关文档，补充当前现役架构与发布说明

### 📦 Windows 下载说明

- `Lime_*_x64-offline-setup.exe`：推荐优先使用，内置 WebView2 离线安装器，安装更完整
- `Lime_*_x64-online-setup.exe`：体积更小，适合网络稳定且可访问微软下载源的环境
- 如果在线安装失败，请改用离线安装包

---

**完整变更**: v0.91.0...v0.92.0
