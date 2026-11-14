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
- 状态：门禁结果已记录，准备 commit、带租约更新同版本 tag 并推送；最终结果继续补充。
