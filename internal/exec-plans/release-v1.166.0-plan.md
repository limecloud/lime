# v1.166.0 发布执行计划

状态：v1.166.0 全渠道已发布并验证，完成度 100%；负责人：root；完成日期：2026-10-22。

## 目标与范围

- 用户确认目标为 `v1.166.0`，沿用端到端发布授权，完成版本、候选、门禁、commit/tag/push 与公开渠道核验。
- 基底 `85dcb9930a1a0b7f75a1666d94225558caae2501`；上一标签 `v1.165.0`。冻结 tree `29e1ab860dc77bab85a12fd4ac9a10792ca0ec29`，共 337 个候选路径。后续新增留待下一版；生成缓存 `tsconfig.node.tsbuildinfo` 排除。
- 候选包含 GUI 侧面板/链接/浏览器偏好、Electron IPC、线程生命周期与实验后台压缩、协议 schema/client、测试和原 owner 记录，完整路径与 SHA 在 `artifacts/release-v1.166.0/candidate-manifest.json`。
- 独立源码副本 `.lime/release-v11660/source`，独立 Git index/admin；外部 npm 依赖只读链接，workspace package 指向副本。原树并行热区不覆盖；门禁修正先在冻结副本认领窄写集。

## 写集与架构

- 发布事实源：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、两份 `RELEASE_NOTES*.md`。
- 发布记录：本计划、`artifacts/release-v1.166.0/` 与 `.gitignore` 的精确放行；产品候选来自冻结 tree，不自动追入后续改动。
- current：Electron/Forge -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item。writer/maintenance、archive/metadata 仍归既有 canonical rollout/ThreadStore owner；实验压缩默认 false。候选架构已在 architecture 与原 owner 计划确认，发版不改变领域方向。
- compat/deprecated 不新增；已删除的重复 Workbench 面板、标签与旧 metadata/unarchive 分支保持 deleted。DevBridge 候选仅同步现役 policy/catalog 合同，不恢复 mock fallback。

## Verification Contract 与退出条件

1. 版本一致性、完整 `npm run typecheck`、`npm run test:contracts`、改动前端/脚本定向与相关 Rust owner/public JSON-RPC 回归。
2. GUI 先定向，再串行真实 Agent current fixture 与标准 GUI smoke；记录场景、identity、controlled backend 和正常退出边界。
3. 上一版公开 npm 的 `thread/archive` 后台命令失败必须在本候选复验；如重现，保留原证据并在唯一 canonical rollout owner 定位，不能放宽摘要/进程/线程隔离断言。
4. 沿用标准 freshness、writer ownership、timeout、协议与版本合同；冻结副本与被验证源码保持摘要一致。
5. release commit/tag/push 后，跟踪同 SHA 的 Quality 和 Release 终态；验证 GitHub stable、14 类预期资产、四平台 CLI/npm 与三个 updater feeds/downloads。
6. 不将 Gate A、standard smoke 或历史 r31/r33 通过计作本次任意 GUI、TUI PTY、live 或跨平台 packaged 证据。完整 Codex/Memory 对齐不因本次发布核销。

## 初始证据

- 当前版本 1.165.0；远端 main 与基底一致；远端无 v1.166.0 tag。
- 全候选冻结完成；仅缓存排除，其他未跟踪产品、schema、测试与 owner 文档均纳入。尚未 commit/tag/push。
- 原工作树存在其他进程持续改动；本轮验证在副本执行。版本与 release notes 六份文件修改前均干净。

## 门禁进展

- 版本一致性、完整 `npm run typecheck` 与完整 `npm run test:contracts` 均 exit 0。副本首次 package build 缺四条 workspace 链接，补齐同一副本内链接后正常重跑；原环境失败单独保留。
- 31 个改动前端测试文件 312 项通过；2 个脚本文件误用 Node test runner，已原样改用其 Vitest runner，17 项通过。合计 33 files / 329 tests，无源码、超时或断言改动。
- 额外对全部改动 TS/JS 执行 ESLint，SDK request-client.ts 的既有 class/interface 合并触发 3 条错误；精确 HEAD 源码 stdin 复核同样失败，标准 npm lint 仅覆盖 src。其余改动路径定向 lint 通过；不修改既有 SDK owner 或关闭规则，原失败单独记账。
- Rust 首次目录名误当 package `core`，命令立即 exit 101，无测试执行；已核对 manifest 使用 `lime-core`，正常环境 helper 与独立 CARGO_TARGET_DIR 下运行 owner/public 回归，不把命令错误计作产品失败。
- 本机原 Rust target 已不存在，当前为独立全新编译；GUI renderer 与此编译分别推进，两个 Electron 聚合不并行争用同一构建锁。上一版背景命令归档故障的只读摘要诊断同步进行。

## 归档浮点摘要门禁修复

- 读取上一版公开 npm 的真实失败 rollout 后，直接调用现役 serde_json + SHA-256 可精确复现：最后一批 `wall_time_seconds=2.5593350839999998` 被默认 JSON parser 读取为 `2.559335084`，内容摘要不再匹配；原 JSON、身份、sequence 与 fingerprint 均未损坏。
- 独立最小 Cargo 复验：未开启 float_roundtrip 的原始记录 1 批摘要失败，开启后两条原始 rollout 全部摘要一致。只开启 workspace 既有 serde_json 的 float_roundtrip 特性，不升级版本、新增依赖或改变 schema/digest 格式，不吞掉完整性错误。
- 追加窄写集 `lime-rs/Cargo.toml` 与既有 `canonical_rollout/tests/digest.rs`：同一精确浮点值经过 runtime event 持久化、严格冷读、尾部续写、物理归档与再次冷读。原树该测试与基底 hash 一致后才同步，其他 rollout/GUI 生产热区保持冻结快照。
- 对本任务旧输入的 Rust/GUI 构建后代发送 SIGTERM 并保存 process 收据；这些任务记 superseded、不记通过。原 lime-core config 定向已通过；特性修复后的 canonical/public 协议/客户端与真实 sidecar 重建继续，随后串行执行 CLI、GUI 和 Agent 聚合。
- 原 owner 日志中的尾部空格/空行是原始终端输出；保持字节与来源摘要，不为了 whitespace 抹改不可变证据。源码/文档 whitespace 单独核验。两份 release notes 已补该归档修复，只有后继实际通过证据才可关闭该项。
- 此次静态及定向测试通过后的提交为远端 Quality 候选检查点；不代表 tag、GitHub stable、npm 或 updater 已发布，发布依实际后继终态收口。

## 远端 Quality 首次与队列夹具修正

- 发布检查点 `4ffd025662b675900e036e36eaabc2fa114d8e0f` 已推送 main；没有 tag。Quality `39618511788` 完成，前端 lint/typecheck/全量 Vitest、版本一致性、Bridge/contracts、macOS GUI smoke 和 Windows 安全/shell/App Server/Plugin MCP 均成功；Rust Full 在 App Server lib 的 2010 passed / 1 failed 处停止，不记全量通过。
- 唯一失败为既有 `projection_rebuild/queue_tests.rs` 冷重建整对象比较，只有 Thread.updated_at_ms 不同。当前 architecture 与 rollout r26 已明确 read/rebuild 从物理 mtime 恢复 updated_at；队列追加后的 SQLite 旧值不能作为冷读时间预期。原候选已在本机精确复现，保留完整失败日志。
- 只认领该测试文件：将隔离 rollout 的 mtime 确定设置为旧 updated_at + 60 秒，再用该精确值构造完整 Thread 预期。继续比较所有 Thread/Turn/Item identity、recency、队列输入、图片字节、顺序和公开排除语义；不删除断言、不放宽时间区间、不修改生产实现。测试修正后的 targeted 和远端后继结果单独收口。
- 本地最终 canonical 相关 294 项与公共 thread_v2_jsonrpc 23 项全部通过，包含浮点 append/archive/cold-scan 新回归。Protocol/client、真实 CLI/GUI 仍在执行。原首次 Quality 及前端/GUI/Rust 原始日志已冻结入本版证据。


## 最终真实进程验证与 fixture 修正

- Rust 最终 canonical 294、公共 thread_v2_jsonrpc 23、client 50、protocol 147 与 doc test 1 全部通过，真实 sidecars/bins 构建成功。queue rebuild 两项通过。远端后继 Quality `39623362323` 的前端全量、GUI smoke、版本与 Windows 运行验证成功；Rust 全量待终态，不能提前计为通过。
- 本地完整真实 CLI Gate B 通过，覆盖 stream/JSON/reasoning/五语言 human、interrupt、resume/fork/review、images/schema/stdin/output-file、unavailable fail closed，以及默认/active stdio 和实际 CLI 命令 shutdown。上一版归档摘要故障在修正后不再重现；正式公开 npm 仍须 fresh install 后复验。
- 标准 GUI smoke 通过；首次 Agent 聚合在 Coding 全部业务完成后因正常 Main 退出超过原 15 秒失败。原始失败保留，后续 r2/r3/r4 分开记账；未改生产退出路径或延长期限，也不声称已定位退出根因。
- 网站 fixture 的 240 条有界 trace ring 无法承担累计 createTab 计数。改为复用 caller 已安装且通过 provenance 校验的 continuous ledger，并在原 deadline 内等待新的 native identity 与完成的真实 preload 回执。保留新增数量、identity、真实 IPC 断言；补延迟回执单测。r3 曾漏传 collector context，已修正并保留失败证据。
- Web Search 导航 fixture 原先把完整 config 与 untouched fields JSON.stringify 后比较，Rust map 的 key 顺序变化会造成假失败。统一改为内存结构严格比较，仍逐字段保值且不输出含凭证配置。
- 本轮窄写集仅四个 fixture 文件（详见 gui-fixture-repair.json）。16 个 fixture 单测、定向 ESLint、Prettier 通过；Coding r4 全业务与正常退出成功（只读 quit observer），Settings r4 完整场景及正常退出成功。最终标准 Agent 聚合无额外 wrapper 执行中，不能用这些局部结果替代聚合终态。
- 原树后续 document-preview、office lifecycle、Electron localAsset 等其他 owner 改动保持工作树，按冻结规则留下一版；不进入本版 tag。

- 最终标准 `npm run smoke:agent-runtime-current-fixture` exit 0，用时 399 秒：全部 22 个真实 Electron 场景通过，包括 Coding 业务与正常退出；没有诊断 wrapper 或人为 build-ready override。原失败完整保留。总结见 agent-final-scenarios.json；本地发布门禁完成，远端 Rust 全量与公开发布渠道仍待后继终态。


## 标签与远端终态进展

- 最终产品/测试候选提交 `a7429000993b1516a3a58fd1b0e531f7974e13e5`，tree `6cbf390d8676ee77383bd494db664f4dbed5c4fc`；正常 hooks 75 passed / 0 failed。main 已推送，annotated `v1.166.0` 已显式推送，远端 peeled ref 与该 SHA 一致。冻结副本 444 个存在的变更文件逐一与 tag Git 对象精确核对，删除路径也保持删除；后续并行产品改动未混入。
- Quality `39623362323` 全部成功；Rust Full 日志汇总 8,040 passed / 27 ignored、156 个测试程序。精确 tag SHA 的 Quality `39628117773` 也已全成功（Frontend Full、Rust Full、GUI Smoke、总门禁）。原首轮失败仍保留。
- Release `39628179175` 使用同一 SHA。Windows-x64 与 macOS-arm64 构建、打包验证通过；macOS-x64 仍在构建。未提前声称 GitHub stable、npm 或 R2 发布完成。
- 已下载实际 packaged evidence。Windows CodeMode 截图显示最终文本及工具完成，但同时有“模型未输出最终答复”toast；对照 v1.165.0 的相同截图也存在。两版 canonical turn 均 completed，final assistant 可见，Gate B 断言均通过。该既有可见问题记录为下一版 owner 待复现，不声称已修复、无 UI 错误或 live 正确性；对照 PNG 和候选身份见 windows-code-mode-toast-observation.json。
- 发布收尾仍需全部 Release jobs 成功、14 个资产/5 个 npm 包/3 个 feeds 的公开 HTTP 核验及公开 npm fresh-install CLI Gate B。后继纯证据提交不移动版本标签。

- 2026-10-22：三个桌面构建 job 与 R2 job 全成功，GitHub stable 9 个桌面资产已公开；desktop-public-channels.json 对 3 个公开 feeds、版本与实际下载链接逐一核验，全部 HTTP 200。四平台 CLI npm 仍在编译/runner 排队，尚未声称 npm 完成。

- macOS arm64 CLI job `119344747409` 在 runner 队列约 15 分钟后被 GitHub 自动 cancelled，runner_name 为空、steps 为空。官方 annotation 明确 hosted runner 多次分配失败和 macOS arm64 capacity constraints。其余编译继续；即时重试被 GitHub 以 job cannot be rerun 拒绝，待矩阵终态后仅重试该 job 和依赖发布，不改变源 SHA/tag。见 release-arm64-runner-capacity.json。

- Release attempt 1 收口为 failure，仅因 macOS arm64 CLI 在未分配 runner 前被取消；其他桌面、R2 与三平台 CLI jobs 均 success。矩阵结束后按原 SHA 成功 rerun 仅 arm64 job，attempt 2 已立即分配 runner 并开始执行。未重建已成功的资产、未移动 tag；npm 发布待该 job 与依赖发布终态。


## 最终交付与完成审计

- Release `39628179175` attempt 2 已全部 success，共 11 个 job；源 SHA 始终为 `a7429000993b1516a3a58fd1b0e531f7974e13e5`。arm64 runner 容量问题只重试缺失 job 和其依赖发布，其他成功资产复用；版本 tag 未移动。
- GitHub stable release 的 14 个资产全部 uploaded 且非空；5 个 npm 包的精确版本、四个平台 optionalDependencies、各自 dist-tag 与 root latest 均正确，registry tarballs 可下载；macOS 两架构与 Windows 共 3 个 R2 feeds 均为 1.166.0，feed 与下载链接全部 HTTP 200。见 public-channels.json 与 github-release.json。
- 在全新依赖目录从公开 registry 安装 `@limecloud/lime@1.166.0`，launcher 输出 `lime 1.166.0`；使用随包 sibling App Server，完整 CLI Gate B exit 0，fixture 源与 tag 精确一致，记录 launcher/CLI/App Server 的 SHA-256。覆盖流式 JSON、reasoning、五语言 human、interrupt、resume/fork/review、images/schema/stdin/output-file、unavailable fail closed。
- 公开产物的默认 stdio、active stdio、实际 CLI 命令 shutdown 三场景均证明真实 OS 进程退出、原线程 identity 与 terminal 冷读；上一版浮点摘要导致归档失败不再重现。三份原始 JSON 和完整 log 已入库，见 published-npm-shutdown-summary.json。该项至此以正式安装包证据关闭。
- 精确 tag 的 Quality 全成功；Rust 8,040 passed / 27 ignored。完整 typecheck/contracts、329 项改动定向、标准 GUI smoke、22 个真实 Electron 聚合、Settings 全场与 macOS/Windows packaged gates 均有独立证据。既有 SDK all-path ESLint 基线错误单列，标准 CI lint 成功；不声称所有额外诊断全绿。
- 本次发布完成度 100%（分母为版本/候选冻结、最低门禁、commit/tag/push、精确源码 CI、所有公开渠道、公开 npm 真进程回归和仓库证据）。完整 Codex/Memory 路线图、live provider、outer human TTY、TUI PTY 不在本次发布验收内；Windows CodeMode 的既有 toast 对照问题保持下一版待处理，不计作本版修复。
- 分类：current 仍为既有 Desktop/CLI、App Server、RuntimeCore、canonical Thread/Turn/Item 与公开发布渠道；compat/deprecated 不新增；冻结候选的重复 Workbench 与旧 metadata/unarchive 分支保持 deleted。本轮发布后仅提交 `.gitignore` 的两条精确 PNG 例外、此计划与本版本 evidence；其他 owner 后续文件保留原树且不夹写、不进入 v1.166.0。
- 发布后事实提交只是留存成功渠道和原始证据，不改变发布源码或标签。最终验证方法源码与边界见 public-verification-method.json；主摘要见 verification-summary.json。
