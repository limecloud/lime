# Lime v1.177.2 发布修复

日期：2026-11-14。状态：用户恢复发布并要求立即递交全部当前改动；保持 `v1.177.2`，仅发布 macOS/Windows。

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

## 全量前端迁移补齐

- `eedcf2e83f95a9f4b64545e55b58c68c4f91e730` 已提交并推送；Quality run `43593983127` 的审计、Integrity、Lint、Typecheck 和 GUI Smoke 通过。
- 全量前端在批次 `54/155` 被 4 份 Provider 测试的 6 个旧 OEM 登录断言阻断；此前批次通过。该路径已在 `shared-cloud-capabilities.md` 明确退役，现役源码和设置入口的负向测试均不再提供旧参数。
- 不恢复 `exposeOemLoginPrompt`、旧登录 helper 或 `login_required` 模型选项；将 VM、列表与 UI 测试迁移为未配置 Provider 过滤、默认模型保持及不可见旧选择恢复，删除只覆盖已退役路径的 `ApiKeyProviderSection.oem.test.tsx`。
- 仅迁移测试和记录，产品实现不变；3 文件 43 项定向回归、定向 ESLint（零 warning）与 whitespace 检查均通过。
- 测试迁移已提交并推送：`bd77ea194054cead6aad6dcba4ffcea9320f10be`；冻结候选质量 run：`43595677708`。
- `eedcf2e83` 的 Windows Shell Runtime 已通过，包括原生安全矩阵、Shell fallback 与 App Server 合同；后续提交只迁移前端测试，不改变 Windows 产品代码。
- 本地分层 Rust 入口会额外选择 `--tests`，已停止本次两份扩大选择并复用隔离配置与 V8 helper，以精确 Cargo target 串行验证。`app-server/model_provider_capabilities_jsonrpc` 1 项通过；CLI OAuth 仍在运行。
- 精确 Rust 验证已完成：公共能力查询 1 项和 CLI OAuth 真实进程 8 项全部通过，包含五语言成功、失败、关联、断开与中断终态。`bd77ea194` 的 CI GUI Smoke 也已通过。

## 本地化断言迁移

- `bd77ea194` 的全量前端前 61 批通过，批次 `62/154` 被 namespace loader 的三个旧断言阻断：第三方导入来源误判为产品品牌、退役插件目录文案、旧版号 build 展示。
- 本轮只认领 `src/i18n/__tests__/{loadNamespace,types}.test.ts` 与本计划；五语言资源及其他会话进行中的外观/浏览器/快捷键写集保持原状。
- 按已登记的第三方集成边界列出精确导入 key 例外，普通文案品牌守卫继续生效；插件断言迁入 current MCP 管理入口，版本回落断言同步现役 About 展示。
- loader 测试原已超过千行，本次仅迁移相关断言和显式第三方例外，不添加业务逻辑；退出条件为该文件完整用例及类型测试通过，不扩大重构。
- 两份本地化测试 10 项全部通过，定向 ESLint（零 warning）和 whitespace 检查通过；不修改产品资源或品牌合同。

## Runtime facade 大小收敛

- 冻结副本后续前端批次发现 `appServerRuntimeBoundary` 的有效守卫失败：`runtime_backend.rs` 已有 817 行，超过既定 800 行 facade 上限。
- 窄写集只增加该主文件、现有 `agent_skills_context.rs` 与 `plugin_hooks.rs`；将技能列表读取与插件回合快照读取原样迁入对应子模块，调用结构、错误传播和当前数据源保持一致，不提高门禁上限。
- 这属于现有 owner 内部的职责迁移，不改变架构、公开协议或产品行为；退出条件为边界守卫与受影响 App Server Rust 回归通过。
- facade 已收敛为 799 行，`appServerRuntimeBoundary` 的 24 项回归通过。
- 后续存储根守卫遗漏了现有 Host 构造器注入的四个浏览器 store 文件；在 `storageRootBoundary.test.ts` 精确登记各一次路径，密码继续由 `BrowserPasswordStore` 使用原生加密。没有新增数据目录、数据源、路径回退或放开通配符。
- 存储根守卫 15 项通过；`npm run test:rust:unit -- -p app-server runtime_backend::` 的 346 项通过（1826 项未选择），只验证本次 owner 内职责迁移。
- macOS 与 Linux 测试发现顺序不同，按 CI 已通过文件与本地跳过清单计算缺口，补查 56 文件；发现一份 registry 旧断言仍隐藏未绑定命令，迁移为可配置列表且键盘不拦截、显式菜单执行同一 handler 的现役合同。
- 冻结副本共享 `node_modules` 导致 PDF 资源 URL 触发 Vite 文件访问限制；原目录 `pdfDocument.test.ts` 四项通过，不为副本环境修改产品加载逻辑。
- `registry.test.ts` 的 11 项回归通过。冻结副本仅为测试允许其共享依赖目录，不修改原仓库 `vite.config.ts`；所有测试逻辑及失败时限不变。
- Workspace owner 守卫将 Composer hook 的无参数调用写死，误拒绝现役 `controllerOptions` 注入；仅将定位改为函数调用前缀，继续检查唯一 LocalDisplayState owner 和禁止第二业务 store。测试文件为本轮窄写集，未改 Workspace 产品源码。
- Workspace 边界 15 项通过；冻结候选 `bd77ea194` 的完整 Rust CI job `132449597310`（run `43595677708`）已成功，包括公共能力查询和 CLI OAuth；后续 Rust 仅有上述已通过 346 项回归的纯职责迁移。
- 收敛修正已提交推送为 `f10b0518e4d903bf39dcaa8c627186df67ec6f43`，最终候选 Quality run 为 `43599954983`。
- 冻结副本批次 114 用时 574 秒，首个用户问答面板用例触发原 5 秒超时后产生 15 项级联失败；同一原目录 `RequestUserInputPanel.component.test.tsx` 单独运行 17 项全部通过（模块加载约 50 秒、测试共 11 秒），不提高时限或改产品。保留失败 checkpoint，独立按原 runner 参数补跑其余 pending 批次，最终以干净 checkout CI 复核完整矩阵。

## macOS 启动权限检查

- `f10b0518e` 的完整 Rust、Windows Shell Runtime、Integrity 与依赖审计通过，Frontend Full 继续运行；GUI Smoke 的三视口、设置与真实 App Server 均通过，唯一起始原生 IPC 错误使 `noInvokeErrors` 失败。
- 当前 artifact 未记录原生子方法与错误详情，不能据此断言具体错误码。沿启动调用核查发现：`AppSnapshotRuntime` 无条件调用 `bareModifierMonitor.start`，Swift helper 在输入监控未授权时明确抛出 `notGranted`。
- 在 current `appSnapshot.ts` 先调用现有 `inputMonitoring.read`，只有 `ready` 才启动；未就绪返回 `started:false`，查询失败仍传播，不授予系统权限，不改原生拒绝逻辑或 smoke 门禁。手动快照入口保持现役行为。
- 窄写集：`src/lib/appSnapshot.ts`、对应测试、中英文发布说明与本计划；不触碰其他会话外观、浏览器、快捷键写集。
- 补充已授权启动、未授权/不可用/非法状态阻止启动、查询错误传播回归；真实 Electron CI 继续确认新候选无调用错误。
- 权限预检与组件回归 2 文件 16 项通过；定向 ESLint（零 warning）、完整 `npm run typecheck`、`npm run test:contracts` 和 whitespace 检查通过。协议与现役 host 命令不变。
- 修复提交并推送为 `1b014d276061f1a00cd1705dcf9ef93a8be36655`，Quality run `43602433003` 的真实 GUI Smoke 通过，启动、重载、三视口、Memory 设置与零 IPC 错误断言全部通过；Lint、Typecheck、依赖审计和版本完整性检查通过。
- `f10b0518e` 的完整前端 CI 前 131 批通过，第 132 批唯一失败是 `ComputerUseSettings.test.tsx` 导航顺序漏掉现役 `AppSnapshots`。原工作树已有同一行修正，核对差异后仅纳入该必要断言，不夹带其他并行改动。
- 本地 pending 批次 136 同样暴露该断言；批次 138 的配置/执行策略用例出现原 5 秒超时，尚未发现断言不一致。独立 Computer Use 验证中首个渲染用例也超时，其余 16 项通过；保留失败记录，等待后台批次结束后复核，不延长超时或据此修改产品。
- 导航断言定向验证通过（1 项，16 项未选择），定向 ESLint 零 warning。修正仅一行测试预期，16 项组件行为已有上述干净 CI 成功证据；最新候选完整 CI 继续复核，不将本地超时标为成功。

## 最终候选与发布跟踪

- 最终候选 `8217c0fefa9c63abe1ec22bbb38380c8723b9807` 已提交并推送；相对已通过真实 GUI Smoke 的 `1b014d276` 仅增加上述一行测试预期及执行记录。
- 核对 GitHub Release 仍为 draft、npm 根包 `1.177.2` 仍为 E404、无活跃 Release run，draft 只有四份 CLI tarball，无 Linux guest 残留。
- 以旧 tag object `a25f17b724fd184ebdbb5ce7a8eda97ceada5e9d` 的准确租约推送同版本 annotated tag；新 tag object 为 `af605c14802f2dd6b6902c094acefc2e757f2564`，远端解引用确认指向最终候选。
- 最终 Quality run：`43604619853`；Release run：`43604757999`。全量测试和同 SHA 多平台打包并行继续核对，当前尚未宣称发布完成。

## Linux CLI 缓存修复

- Release `43604757999` 的 Windows 构建、安装更新与打包后验收通过；macOS arm64 签名、公证与 packaged native host Gate B 通过，原始权限向导失败已在真实产物关闭。
- Linux CLI job `132476998302` 链接失败：`unable to find library -lsherpa-onnx-c-api`、`-lonnxruntime`。恢复的 Cargo build-script output 保留了 `target/sherpa-onnx-prebuilt/.../lib` 链接目录，实际原生库未被恢复。
- `sherpa-onnx-sys@1.13.0/build.rs` 在正常执行时负责下载并复制 Unix 运行库，但缓存复用跳过了该脚本。沿用现役 CLI native artifact refresh，仅在相同 release profile 和 target 的 `cargo clean` 增加 `--package sherpa-onnx-sys`，促使既有脚本重新准备库；不增加 fallback、依赖或绕开 native payload 校验。
- 窄写集为 release workflow、现有 candidate guard、发布守卫测试、中英文发布说明和本计划。发布守卫增加缺失 sherpa 清理时的拒绝回归，47 项全部通过，定向 ESLint 零 warning。
- 本地 pending 批次 115..154 已全部收集，失败保留为 136（已修正导航断言）、138 和 150（首个 5 秒超时及级联失败）；其余批次通过。对 7 份相关文件串行复核，配置文件仍有超时，等待干净 CI 完整复核，不延长限制或记为通过。
- 7 文件复核完成：6 文件通过，配置页 `system/configuration/index.test.tsx` 仍有 3 项原 5 秒超时，总计 69 通过、3 超时；保留该失败证据。导航完整 17 项在此轮通过，未改产品或时限。
- 缓存修复后的 `npm run test:contracts` 全部通过；TypeScript 产品源码相对已通过完整 typecheck 和 Electron Smoke 的候选没有变化，发布修复仅涉及已通过 47 项回归的 workflow/JS guard。后续以新的同版本候选重新构建全部发布产物。
- 后台验证退出后，将配置页剩余 3 项超时用例独立按原 5 秒限制复核，3 项全部通过（其余 24 项未选择）。不修改组件、fixture 或时限；原批次和首次复核的失败记录继续保留。
- 缓存修复已提交并推送为 `8a307a11c66f707d7124b2048a433539401a8f80`，版本一致性与 release workflow guard 再次通过。
- 已取消阻断的 Release `43604757999`，确认剩余任务仅 post-action 缓存收尾、无产物写入后带准确租约更新同版本 tag；新 tag object `45f0f6fa73e7b93f706fb938c4884f8dbf816a15`，远端解引用确认指向 `8a307a11c`。
- 当前最终 Quality run：`43606739298`；当前最终 Release run：`43606988271`。旧 run 已确认 cancelled，草稿无 Linux guest 残留，不放宽版本产物不可变检查。

## Linux 发布目标删除

- 用户明确本产品没有 Linux 版本，应删除对应目标；发布 Goal 已暂停，本轮不恢复发版、不重打 tag，版本继续为 `1.177.2`。
- Release `43606988271` 已确认 `completed/cancelled`；GitHub Release 仍为 draft，未公开或发布 npm。
- 本轮窄写集：Release workflow、CLI launcher/staging/测试/README、CLI Gate B 平台选择、发布矩阵与 CLI 边界守卫及其测试、两份发布说明、治理/命令/架构文档和本计划。避让其他会话的 Electron、前端与 Rust WIP。
- current 发布平台只保留 macOS arm64/x64、Windows x64；删除 Linux npm 包、动态库环境分支、Linux 构建依赖、guest 打包与上传、专用 release 脚本及强制发布守卫。Linux 专用 sherpa 缓存修复与发布说明同时撤回。
- `linux-guest-release.mjs` 及对应云端发布守卫为 dead/deleted/forbidden-to-restore，不新增 compat 或 deprecated 包装。
- Linux 源码装配与共享 runtime 的独立 BYOC 消费者继续保留；当前无官方 guest 资产，release 来源自动安装/购买前准备按既有合同拒绝继续，不宣称云桌面交付可用。
- 退出条件：CLI 真正 npm tarball/launcher 测试、发布守卫回归、contracts、scripts 治理和版本检查通过，legacy 扫描无本轮新增违规，当前 draft 的 Linux tarball 清除。正式发布保持暂停。
- 本轮是分发目标收敛，没有重建 runtime 或改动架构图；架构文档仅同步现行制品边界，不作为产品 Gate B 证据。
- 验证通过：`node --test packages/cli/tests/npm-package.test.mjs` 12 项；release workflow、CLI boundary、CLI npm Gate B 守卫 3 文件 62 项；完整 `npm run test:contracts`（含 scripts、release/CLI guard 与文档边界）；`verify:app-version` 为 `1.177.2`；9 份 JS 定向 ESLint 零 warning；8 个 CLI 发布 Bash step 的语法检查和窄写集 whitespace 检查。
- 草稿资产 `lime-npm-linux-x64-1.177.2.tgz` 已删除并复核，草稿仅剩 macOS arm64/x64 与 Windows x64 三份 CLI 平台包；草稿发布说明同步删除 Linux 缓存修复声明。
- legacy 扫描唯一违规是原有 `app-server/src/main.rs` 单元测试中的 `/tmp/lime-legacy/app.db`；核对该文件与 HEAD 无差异，命中内容在 HEAD 已存在，不改无关 runtime 或降低守卫。
- `smoke:cli-npm-gate-b` 因本机 `lime-rs/target/debug` 不存在而未进入产品进程；尝试读取当前草稿的 macOS 包，网络约 1.7 MB/96 秒，停止本进程发起的下载，未用旧版全局 CLI 冒充本次 Gate B。当前 74 项是打包/launcher/守卫证据，不是新的跨平台打包或完整发版验收。

## 恢复发布与全部递交

- 用户明确要求“继续推进发布”“马上递交发布，所有的都递交”，撤销暂停并将当前全部 tracked/untracked 产品改动纳入候选；原先避让的并行写集本轮按用户明确授权一起冻结递交。
- 候选包括 Electron 菜单/浏览器、工作区快捷键与应用快照、外观和 Markdown/差异展示、实时语音 Provider/协议/schema/客户端/会话链路、五语言资源及测试；本地缓存和 ignored 验证产物不进入 Git。
- 版本继续 `1.177.2`，发布矩阵只有 macOS arm64/x64 与 Windows x64。补全中英文说明，以准确租约将既有未公开 tag 更新到完整候选后构建全部产物，避免跨 SHA 混发。
- 按 release skill 的“马上递交”规则将本机完整 typecheck 作为非阻断并行检查；已启动 typecheck、contracts 与版本校验，结果如实记录。后续打包、签名、公证和平台验收由同 SHA Release 流水线完成。
