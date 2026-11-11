---
name: lime-windows-cloud-test
description: 在阿里云无影 Windows 云电脑测试 Lime；复用实例、同步候选源码、执行 Electron 与安装更新验收、导出真实桌面证据并按预算收尾。
---

# Lime Windows 云端测试

CLI/API 管理无影资源、源码同步、远程命令和证据传输；Computer Use 操作本地无影客户端及真实 Windows 桌面。适用于本仓库的 Windows 构建、安装、会话、界面与原生能力排错，不替代 GitHub Release 流程。

先读仓库 `AGENTS.md`、[质量事实源](../../../internal/aiprompts/quality-workflow.md)和 [Windows 验收入口](references/windows-validation.md)。准备连接、同步或收尾时读[快速驱动](references/quick-drive.md)；首次配置或 API 排错时读[无影接口](references/aliyun-cli.md)。

## 资源与费用

- 先完成可在本机完成的修复、候选打包和验收计划，再启动云电脑集中验证。开发等待期间按本次授权使用 `StopCharging` 关机，保留磁盘与工具缓存。
- 复用当前会话已有授权，核对实例、地域、用户、办公网络及 `PostPaid`。创建 skill 不授权购买、开机、接受协议、系统提权或释放资源；也不继承参考项目的历史预算、UAC 或保留授权。
- 元数据放技能外的 `~/.local/share/lime-cloud-test/`。只保存 CLI profile 和钥匙串引用，凭据留在官方 CLI/安全存储中。不要输出配置、密码、Token 或完整用户数据。
- 预算、保留期限和关机/释放策略采用本次用户要求；缺失且将产生费用时补齐。新购前核对实际报价、镜像、规格、磁盘和网络，预留导出及收尾时间。模板是选择条件，不是价格或库存事实。
- 用户明确要求复用其他项目的环境时，可复用其非敏感账号引用及同一已授权实例；在独立 Lime 测试目录登记，不改原项目状态。不能复用已释放的历史 ID。
- `retain_until` 是本地记录，不是定时器；没有实际调度器就不声称自动到期关机。关机后磁盘及独立网络仍可能收费。

## 候选与真实桌面

1. 固定候选 SHA、版本、run ID 与写集；保留并行改动。安装包记录下载来源与 SHA256。工作树候选显式选择 overlay 文件，逐文件摘要并核对本机预期的完整包摘要；不能只验证云端包自己的 manifest。
2. 在 Windows 本地盘复用 Node、pnpm、Rust/MSVC 和缓存，版本以当前仓库与 CI 为准。长作业在远端落盘日志、阶段和退出码，再观察状态；不因 API 超时重复提交构建或安装。
3. GUI、Squirrel 安装、当前用户凭据与 UIA 必须在已登录、解锁的交互用户会话执行。SYSTEM 命令只证明机器级准备，不代替用户桌面。UAC/管理员能力按实际令牌和系统设置记录，不关闭安全保护促成通过。
4. 通过最新 Computer Use 截图连接无影 viewer，确认目标是本轮实例。控制台和远程 viewer 可能属于不同进程；不要沿用旧坐标、凭证或假定 Retina 缩放。
5. 优先跑仓库 current 测试入口，失败先导出原始日志/截图再修根因，复测同一候选及夹具。不得用生产 mock fallback、跳过失败步骤、放宽断言或改变产品 timeout 把失败改成通过。

## Lime 证据边界

- 主链为 `Electron -> preload/IPC -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI`。浏览器投影是 Gate A；无影窗口截图与 Electron 启动本身不能证明 Gate B。
- 真实 Electron 检查 `window.__LIME_ELECTRON__`、`window.electronAPI.invoke`、`electron-ipc` trace、current method 和同一 thread/turn 的 read model。截图覆盖原生窗口/viewport 一致、主内容铺满、Composer 无重影，以及本轮登录状态与会话终态。
- `external` 本地 provider fixture、真实 live Provider、安装包、CLI/TUI 与 Windows native helper 各自报告。`hello` 要有可见回复及 completed canonical Turn/持久化 Item；fixture 通过不能冒充 live 模型成功。
- Squirrel 安装、N-1 更新、Code Mode、native host 与卸载分别取证，保持同一 `candidateSha`/`candidateRunId`。native helper 的观察/无租约拒绝通过，不代表已授权输入、CLI 或完整 Computer Use 通过。
- UI 对齐使用 Lime 的 [设计事实源](../../../internal/aiprompts/design-language.md)，保留 Lime 品牌和多模型边界；不复制参考项目的 WinUI/.NET 布局和工具链要求。

## 收尾

优先导出失败现场、summary、trace 与截图，再导出大日志；传输核对长度、`Dropped`、退出码及 SHA256。资源操作只作用于本轮清单。

按本次选择关机或释放，轮询最终状态；提交成功、断开客户端均不等于关机或释放完成。到预算截止或遇阻塞时执行已授权的收尾策略，不让实例空转等待改代码，不自动重购补证。

报告候选身份、通过/失败/未执行、证据等级与路径、未验证的平台/云端能力，以及最终资源状态和费用边界。完整测试未结束时，checkpoint 必须明确未完成。
