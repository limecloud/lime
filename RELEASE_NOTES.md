## Lime v1.148.0

### 新功能

- TUI 输入与快捷键继续对齐 Codex：编辑器、Vim modal、搜索、历史、kill/yank register、列表分页和模型/推理强度选择统一消费可配置 keymap。
- Thread resume 现在可以携带同一份 rich draft 与正在编辑的问答备注、审批选择和 MCP 表单，并在连接断开、恢复和终态通知时按 Thread 精确清理。
- Prompt history 与 App Server 的公共 identity 统一使用 canonical Thread ID；TUI/CLI 继续复用同一 App Server JSON-RPC、RuntimeCore 和 Thread/Turn/Item 投影。

### 修复

- 修复结构化输入在 UTF-8 编辑、trim、queue edit、历史、重试和 external editor 之间丢失 `TextElement` placeholder、图片 detail、附件或 Skill identity 的问题。
- 统一 start、steer、queue add/update 与 RuntimeCore 的输入长度校验和结构化错误，拒绝时保留完整 draft、附件、mention、cursor 与本地历史。
- 修复 thread 切换、断线恢复、交互请求 resolved/terminal 通知、历史搜索和输入缓冲的状态串线；避免 foreign Thread 的请求写入当前 BottomPane。
- 改进 diff、transcript、textarea、request-user-input 和 MCP elicitation 的布局、渲染与模块边界，覆盖窄终端、重排、焦点和终端恢复。

### 优化与重构

- 将 TUI 的 submission、thread input、message history、composer、textarea、Vim、model catalog、resume picker 和交互视图拆到单一职责 owner，继续沿用共享 App Server 主链。
- 补充 canonical prompt history、typed input lowering、queue/turn projection、CLI stdio 与 TUI PTY 的 current fixture 和结构守卫。
- 更新 TUI keymap、App Server 命令合同、架构说明、操作文档和 Codex 对齐执行记录。

### 测试与质量

- 扩展 App Server protocol/schema/client、输入限制、prompt history、TUI 交互、Vim、编辑器、历史恢复、queue edit、stdio 和 PTY Gate B 回归覆盖。
- 发版验证以 `npm run verify:app-version`、`npm run typecheck`、受影响 Rust/协议测试和 GUI smoke 结果为准；完整 Rust CI、跨平台打包、签名、公证与 npm 分发由发布流水线继续验证。

### 文档

- 更新 `docs/ops.md`、App Server 架构与命令边界、TUI/CLI Codex 对齐计划及结构 inventory。

### 其他

- 本版本没有新增平行 runtime、历史存储或兼容后端；Desktop 与 CLI/TUI 继续共享 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item` 主链。

**完整变更**: `v1.147.0` -> `v1.148.0`
