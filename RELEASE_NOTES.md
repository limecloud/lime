## Lime v1.149.0

### 新功能

- TUI 持续对齐 Codex ChatWidget：输入、交互、transcript presentation、Agent Center 以及模型/Agent/恢复/导出选择器收敛到单一 ChatWidget owner。
- 侧栏新增可折叠 rail、项目对话分组的展开/收起与按需加载，并支持插件、技能和已安装目录的搜索导航。
- Agent transcript 对暂不支持的 Item 提供稳定的多语言占位卡片，诊断字段默认折叠，需要时可展开查看。
- 定时任务页面重做为更紧凑的任务列表与编辑器，支持即时创建、编辑、筛选、搜索、重复计划和运行预览。

### 修复

- 修复插件目录在侧栏内切换筛选、搜索和详情时路由参数与页面状态不同步的问题。
- 修复 TUI 在 Thread 切换、恢复、滚动、搜索、焦点变化和 transient picker 生命周期中出现的状态回流与重复 owner 问题。
- 修复窄终端、全屏 Agent Center、重排、重连和终端恢复场景下的渲染与交互边界。
- 修复定时任务编辑时标题、时间、时区、星期和启用状态的校验与回填，保持五语言文案一致。

### 优化与重构

- 删除 App 中旧的 BottomPane、transcript、Agent Center 和 picker 平行字段及 mapper 命名，直接迁移到 current ChatWidget/BottomPane owner，不保留兼容壳。
- 拆分侧栏、设置导航、rail、插件定制区和加载更多组件，统一使用 Lime 设计 token 与可访问交互。
- 将定时任务创建与编辑表单拆为共享 editor owner，列表操作与弹窗生命周期复用同一表单事实源。
- 将未知 Item 渲染、TUI 结构 inventory、PTY/stdio fixture 和 Vitest 批处理逻辑拆为独立 owner，保持共享 App Server JSON-RPC 与 canonical Thread/Turn/Item 主链。

### 测试与质量

- 补充 TUI ChatWidget owner、Agent Center、picker、transcript、PTY Gate B、CLI Gate B、侧栏、设置布局、插件目录和未知 Item 的回归覆盖。
- 发布验证执行 `npm run verify:app-version`、`npm run typecheck`、`npm run test:contracts` 与 `npm run verify:gui-smoke`；跨平台打包、签名、公证和 npm optional packages 由发布流水线继续验证。

### 文档

- 更新架构说明、TUI/CLI Codex 对齐执行计划、结构 inventory 与 v1.149.0 发布执行计划。

### 其他

- 本版本不新增平行 runtime、协议后端、历史存储或兼容实现；Desktop 与 CLI/TUI 继续共享 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item` 主链。

**完整变更**: `v1.148.0` -> `v1.149.0`
