# Lime Chrome 电脑操控

本目录是重写后的 MV3 扩展。旧 observer/control WebSocket、URL key、站点执行器和旧页面均已删除。

在 Lime「设置 → 集成 → 电脑操控」开启 Google Chrome，点击「管理 → 安装并打开」。安装器导出本目录的构建版本并注册当前 OS 用户的 Native Messaging host；在 `chrome://extensions` 开启开发者模式，选择「加载已解压的扩展程序」，加载打开的文件夹。

保持 Chrome 运行。在 Lime 管理页选择目标标签页并授权，再在扩展弹窗点击允许。开关、扩展连接和标签页授权是独立状态。导航、断连和回合结束使对应控制授权失效；CLI 复用相同 App Server 与工具协议，Electron 无须运行。

唯一传输链：MV3 → Chrome Native Messaging → App Server 可执行文件的纯适配器模式 → 私有本机消息目录 → tool-runtime 的 ComputerUseService。Native Messaging 模式不启动第二 runtime；业务授权、策略、回合租约、互斥、取消和历史仍由现役 App Server 管理。

运行真实 Google Chrome adapter 回归：`node scripts/chrome-bridge-e2e.mjs`。测试使用隔离 profile、真实 Native Messaging 和 runtime，并通过本地模型协议 fixture 检查 canonical 工具结果与页面回读。指定 `LIME_COMPUTER_USE_HOST=desktop|cli|tui` 可分别从真实 Desktop Composer、CLI exec 或 TUI/PTY 发起同一分组用例；默认 adapter 回归不替代这三个产品入口，所有 fixture 均不代表 live model 验收。

公开上游没有对应插件原始源码。`tab-groups.js` 与 `Bf` 分类函数直接提取自已安装 ChatGPT 扩展 1.26.1020.11845 的发货 bundle，其余接线为 Lime 适配；不得将整个目录标记为公开 Codex 源码复制。

扩展弹窗支持输入任务名称（含 emoji）和起始网址，创建 Chrome 原生标签页分组。
任务页打开的子页自动加入同组；接管用户已有标签页时保留原分组。组标题、颜色和
元数据在 Chrome 本地保存，分组不授予页面操控权限，仍须在 Lime 选择目标并明确批准。
模型通过共享 `computer_use` 工具的 `name_session`、`create_tab`、`mark_tab` 管理任务。
线程/回合归属来自 host；新页不会继承源页授权。回合结束关闭未标记的任务页，
`deliverable` 保留并移出任务组，`handoff` 保留供下轮接续且下轮必须重新标记。
用户已有页只释放任务归属，保留页面和原分组；popup 手动创建的任务不会被模型回合误关。
终态/断线清理经现役 App Server hook 与有界 Native Messaging 通知，浏览器临时失败会重试；
扩展 worker 恢复时清理中断回合，保留已完成的 handoff。清理不创建任何新授权。

`tab-groups.js` 和 `browser-session.js` 的 `Bf` 分类函数从已安装扩展的发货 bundle 提取，
其余生命周期接线是 Lime 适配；分组管理仅改默认产品名和模块导出。
方法名沿用发货属性名，压缩符号不是上游原始源码名。来源、摘要、必要适配、测试和
商店状态见[执行记录](../../internal/exec-plans/native-computer-use-chrome-groups-20261025.md)。
旧 WebSocket 后端路由及诊断 IPC 已删除，回流守卫接入 contracts。macOS Desktop、CLI、TUI 分组专项各两轮 **10/10**，源码、安装器导出与候选 ZIP 的 **16/16** 运行资源一致；详见[真实 Host 验收](../../internal/exec-plans/native-computer-use-chrome-hosts-20261026.md)。Windows 实机、live model、签名发行及商店发布仍未完成，不包含在该专项通过范围内。
