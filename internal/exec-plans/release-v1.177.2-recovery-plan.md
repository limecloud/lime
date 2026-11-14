# Lime v1.177.2 发布修复

日期：2026-11-14。状态：修复与验证中。

## 目标与授权

- 用户要求修复发布报错后递交全部改动，保持 `v1.177.2`，并明确要求不再确认。
- 范围包含初始工作树全部 76 个产品、测试、协议、schema、生成客户端与锁文件改动，以及本轮修复与发布说明。
- 现役 owner：Forge Release workflow、共享 Desktop first-run fixture、Electron 权限向导与 App Server；不新增兼容路径。
- 本轮窄写集：`scripts/lib/desktop-first-run.mjs`、对应测试、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`、本计划；必要时修复验证暴露的问题。
- 退出条件：必要门禁通过，全部候选 commit/push，同版本 tag 指向修复候选，Release、GitHub 产物、R2 updater 与 CLI npm 发布完成并核实。

## 已确认事实

- 失败 run：<https://github.com/limecloud/lime/actions/runs/43573100891>，原 tag SHA：`b3521bdc9d315a265370c16b331a55f9d2bb336e`。
- `Build Electron macOS-arm64` 已完成签名、公证及打包，失败于 `Run packaged macOS native host Gate B`。
- 点击 `app-sidebar-nav-settings` 时 `PermissionsSetup` overlay 拦截指针，120 秒超时。
- 共享 `finishDesktopFirstRun` 只做一次 `isVisible()`，早于权限 hook 初次查询返回时会漏过向导。
- 其余 macOS x64、Windows x64 与四平台 CLI 构建成功；后续发布任务 skipped，GitHub Release 仍为 draft。
- 本地初始 main：`b4792269518d87572512788548d03049aadc3721`。
- 用户明确保留同版本；使用带旧 SHA 租约的 tag 更新，重新构建全部平台以避免不同候选混发。CLI draft 产物由现役工作流覆盖；推送前仅清理失败 draft 中两份 Linux guest 资产，不放开已发布版本的不可变守卫。

## 修复与验证

- 通过真实 Electron IPC 读取 `setupComplete`，未完成时等待权限向导出现，通过已有“稍后设置”按钮关闭并等待消失；不授予 OS 权限。
- 覆盖延迟出现、已完成偏好、非法响应和向导失败回归；五语言按钮定位继续使用现役 i18n。
- 必需：`verify:app-version`、`typecheck`、`test:contracts`、受影响前端与 Rust 测试、`verify:gui-smoke`。
- 当前结果在执行后补充，不将历史或静态证据作为新候选打包验收。

## 递交前验证结果

- `npm run verify:app-version`：通过，`1.177.2`。
- `npm run typecheck`：最新候选通过。首轮读取旧候选时发现附件 BlobPart 与密码弹窗错误类型不一致；工作树对应修正纳入候选后重跑通过。
- `npm run test:contracts`：全部通过，协议生成物无漂移，App Server client 合同 294 项通过。
- 候选 TypeScript/JavaScript 的定向 ESLint：通过；32 个候选 Rust 文件 `rustfmt --check --config skip_children=true`：通过。
- 发布修复、MCP fixture 与 macOS Gate B 定向回归：3 文件、22 项通过。
- 初始候选回归：17 文件、258 项通过、4 项 5 秒超时。单独重跑后输入栏通过，设置搜索剩余一项集中循环超时。
- 将设置搜索逐语言集中遍历改为逐目标参数化用例，保持断言与 5 秒限制；最新设置搜索、附件、密码、应用快照与 pending snapshot 回归：6 文件、718 项全部通过。
- `npm run test:changed -- HEAD` 的大范围依赖收集由本进程停止，改跑明确候选测试文件。
- Rust domain 与公共 JSON-RPC 首轮编译因本机 16GB 内存压力由本进程停止；domain 已按 `CARGO_BUILD_JOBS=1` 恢复。尚未完成，不记为通过，CI 继续验证完整 Rust 构建与测试。
- `npm run verify:gui-smoke` 首轮 Vite 编译完成，但因并行源码变更被输入一致性守卫拒绝；已对稳定候选启动第二轮，递交时仍在运行。
- 三个受影响浏览器/权限向导消息 key 的五语言存在性检查：通过。
- 三个 crate 的整体格式检查发现原有未改文件格式问题；只整理候选中的协议导出，未扩大到无关源码。

## 递交与远端验收

- 本轮候选共 81 个文件；包含用户要求的全部初始改动、本轮测试与发布说明、执行记录。
- 分类：产品与协议 owner 为 current；first-run helper 与相关用例为 test-only；未新增 compat/deprecated 路径，未删除产品能力。
- 已提交：`b0374606b`，81 文件，包含请求时全部 76 文件及本轮修复。
- 随后补入应用快照辅助功能搜索入口及对应两份测试；3 文件最新回归共 686 项通过，与主提交合计 82 个不同文件。
- 第二轮 GUI 编译完成（3 分 40 秒），但又因并行源码变化被输入一致性守卫拒绝；不能作为 smoke 通过。发布 CI 使用冻结 commit 的干净 checkout 继续真实打包验收。
- 候选冻结后新出现的 `src/lib/appearance/{codeFontSize,fontSmoothing,reducedMotion,separateModes}.ts` 属于另一份进行中的写集，均非请求时 76 文件或发布修复；保留原状，不将后续未完成开发混入冻结候选。
- 原失败 draft 的两份 Linux guest 资产已按 draft 状态和旧 target SHA 核对后清理；其他 CLI draft 资产由现役工作流覆盖，不放开正式版本不可变守卫。
- 状态：补充候选后带租约更新同版本 tag 并推送，最终远端结果继续补充。

## CI 阻塞修复

- `c950de482c96a707bcae1a12637736651fd675b1` 已推送 main 与同版本 tag；Release run `43591079445` 在正式发布前主动取消，未发布 npm，GitHub Release 仍为 draft。
- Quality run `43591071030` 的 Integrity、Bridge & Contracts 通过；Frontend Full 被 `AppSnapshotRuntime.tsx` 导出内部函数产生的 Fast Refresh lint warning 阻断，移除无消费者的 export，保留行为。
- Dependency review 的 Rust 审计通过；JavaScript 审计发现 `smol-toml <=1.7.0` 命中 `GHSA-7w5x-hrqm-74c2`，升级到最小修复版本 `1.7.1` 并同步 manifest、锁文件，不忽略公告或降低审计级别。
- 本节修复仅修改应用快照组件、依赖事实源、发布说明与本计划；持续避让冻结后外观写集。
- 串行 Rust domain 验证已完成：`app-server-protocol` 155 项、`model-provider` 308 项均通过。
- `c950de482` 的 CI GUI Smoke 已通过。本机冻结副本编译受并行内存竞争持续运行超过 15 分钟，在 CI 已提供相同候选 smoke 成功证据后停止本轮重复编译，不记为本机通过。
- 应用快照组件定向 ESLint（`--max-warnings 0`）通过。
- 最终依赖更新只保留 `smol-toml` manifest 版本及锁文件对应 resolution/snapshot；已撤销包管理器本次重解析产生的无关 workspace registry 漂移与排序，现役包仍链接工作区源码。
- `pnpm install --frozen-lockfile --ignore-scripts --link-workspace-packages` 通过，跳过解析；实际安装 `smol-toml@1.7.1`。再次 `verify:app-version` 通过，版本仍为 `1.177.2`。
- `pnpm audit --prod --audit-level=high` 通过，高危项已消除；保留审计发现的 2 low、3 moderate，不调整门禁阈值。
- 安全升级后的应用快照、本地环境 TOML 序列化与环境对话框回归全部通过；连同 Electron 入口守卫共 64 项通过，1 项权限 owner 文件扫描在本机 5 秒限制下超时，保持原限制单独复跑，不扩大该守卫实现。
- 权限 owner 守卫在 Vitest 下单独复跑仍超时；直接运行同一检测器并执行完整断言通过，保留 Vitest 超时的环境限制，不提高门禁时限。
- CI Rust Full 仅两个 target 失败：`model_provider_capabilities_jsonrpc` 的旧完整响应断言缺少新增实时语音字段；`cli/mcp_oauth` 清空子进程环境时丢弃 Cargo 原生动态库查找路径，CLI 在启动前找不到 `libsherpa-onnx-c-api.dylib`，8 项均未进入 fixture。
- 同步 official/compatible 两条公共 JSON-RPC 响应的完整断言；CLI test-only fixture 继续隔离配置与凭据，只透传 `DYLD_LIBRARY_PATH`、`DYLD_FALLBACK_LIBRARY_PATH`、`LD_LIBRARY_PATH`，不改变生产路径或权限。
- 最终 `npm run typecheck` 通过；两份 Rust 测试的 `rustfmt --check` 与变更 whitespace 检查通过。新增 Rust 集成测试仍编译中，下一轮冻结 CI 继续验证完整矩阵，不预记通过。
