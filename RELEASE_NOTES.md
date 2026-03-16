## ProxyCast v0.88.0

### ✨ 新功能

- **自动化任务中心**：新增 `automation` 命令、服务、DAO 与设置页，支持定时任务、计划预览、健康检查、运行历史，以及 `Agent 对话任务 / 浏览器会话任务` 两种执行形态
- **浏览器资料与环境预设**：新增 Browser Profile / Browser Environment Preset 管理，支持托管浏览器与附着当前 Chrome 两种资料模式，并可直接复用于浏览器运行时
- **浏览器现有会话接管**：补齐 existing session attach、页签切换、桥接状态同步与 Browser Runtime 工作区协同链路
- **Agent Chat 决策与空状态升级**：新增 `DecisionPanel`、空状态 Hero / Quick Actions、A2UI 预览卡、线程分组与消息轮次分组，强化新任务入口与浏览器协助预热

### 🔧 优化与重构

- **执行系统收敛**：移除旧 `batch` 页面/API 与 `heartbeat` 命令/设置入口，统一收口到 `automation` 与 `execution tracker`
- **OpenClaw 工作台重做**：重排安装、配置、运行、Dashboard 与进度页，补强 Windows 环境检测、修复引导与诊断复制
- **Settings v2 持续整理**：合并媒体服务设置，重构 Chrome Relay、Execution Tracker、About、Appearance 等页面，统一导航与信息架构
- **资源与创作工作台更新**：重构资源页、图像生成、视频画布、项目选择器与多处内容创作界面，提升工作区一致性

### 🐛 修复

- **插件兼容与更新提示补强**：插件管理页新增 Windows 主程序升级入口和最低版本提示，降低插件与主程序版本错配的排障成本
- **Browser Runtime / DevBridge 稳定性提升**：补齐浏览器会话启动参数、流诊断、桥接 mock 与状态同步，减少运行时偏差
- **Provider 配置读写修复**：完善 API Key Provider 的 `api_version`、`project` 等配置项读写与表单校验
- **Windows 启动与安装诊断改进**：补充安装说明、常见问题与构建文档，降低受限网络与依赖缺失场景下的排障摩擦

### ⚠️ 兼容性调整

- 旧 `Batch` / `Heartbeat` 相关前端入口与后端命令已下线；既有流程请迁移到新的 `Automation` 设置页与统一执行记录

### 🧪 测试

- 新增 Automation、Browser Profile / Environment Preset、Existing Session Attach、Agent Chat 分组与插件版本提示等测试覆盖
- 补充 Browser Runtime、OpenClaw、Execution Tracker、Chrome Relay 与多处设置页交互测试
- 发布前已执行：`cargo fmt --all`、`cargo test`、`cargo clippy`、`npm run lint`

### 📝 文档

- 更新 README、架构概览、安装、故障排查、构建与运维文档
- 补充 NextBrowser 相关研究资料与浏览器自动化设计记录

### 🛠️ 开发体验

- **Windows 发布流程增强**：Release Workflow 现同时产出在线 / 离线两个 Windows 安装包
- **版本源保持一致**：统一 `package.json`、Cargo workspace、两份 Tauri 配置与 `RELEASE_NOTES.md` 的发布版本入口

### 📦 Windows 下载说明

- `ProxyCast_*_x64-online-setup.exe`：默认推荐，体积更小，安装时按需下载 WebView2
- `ProxyCast_*_x64-offline-setup.exe`：适用于离线、内网或受限网络环境
- 如果在线安装失败，请改用离线安装包

---

**完整变更**: v0.87.0...v0.88.0
