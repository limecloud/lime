## Lime v1.150.0

### 新功能

- ChatWidget 继续收敛终端会话状态，统一承接运行时快捷键、剪贴板与右键粘贴、排队提交、按线程草稿快照、回合生命周期和启动警告展示。
- 历史分页、恢复预览和 transcript 加载改为异步 completion/event 流，支持线程与 cursor 归属校验，并在分页期间保持键盘、重绘和 App Server 通知处理。
- 交互层补齐审批详情、transcript 滚轮、选择拖拽、恢复/Agent/模型/导出 picker 以及外部编辑器生命周期的 ChatWidget owner。

### 修复

- 修复历史分页、恢复预览、滚动、搜索、重连和终端恢复期间的状态回流、重复请求和 loading 误复位。
- 修复输入禁用、草稿恢复、队列编辑、剪贴板竞态、modal/pager selection 和 picker 取消路径的交互边界。
- 修复 TUI 在窄终端、焦点切换、审批详情和外部编辑器异步返回时的渲染与生命周期问题。

### 优化与重构

- 删除 App 中残留的 ChatWidget 平行字段、getter/setter 和旧 `thread_settings`、command popup、status indicator 等入口，直接迁移到 current ChatWidget/BottomPane owner。
- 将 ChatWidget 拆分为 input、interaction、settings、transcript、footer 等窄职责模块；App 继续只负责 host 生命周期、transport/session、Thread 路由和 canonical projection。
- 保持 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection` 唯一主链，不新增本地 history/queue backend、平行 runtime 或兼容层。

### 测试与质量

- 扩展 TUI ChatWidget、历史分页、选择器、队列、输入、恢复、PTY 和结构守卫测试，并更新 Codex 对齐与结构 inventory。
- 补充 CLI/TUI Gate B 场景覆盖，继续复用 App Server JSON-RPC 与 canonical Thread/Turn/Item 事实源。
- 修复 Windows N-1 升级门禁：在上一版本尚未检查更新时，通过真实“设置 → 关于”入口观察自动检查，保留下载、重启安装和版本匹配验证。
- 发布验证执行 `npm run verify:app-version`、`npm run typecheck`、`npm run test:contracts`、Rust TUI 定向测试与 `npm run verify:gui-smoke`；未通过的门禁会在发布计划中记录。

### 文档

- 更新架构确认、TUI/CLI Codex 对齐执行计划、TUI 结构 inventory 与发布执行计划。

### 其他

- 本版本继续保持 Desktop 与 CLI/TUI 共享同一个 App Server/runtime/canonical projection，未恢复已退役 runtime 或生产 mock fallback。

**完整变更**: `v1.149.0` -> `v1.150.0`
