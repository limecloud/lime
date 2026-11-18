# DeepSWE 基础会话跑通

- 目标：在 Lime 的现役会话链路运行一题 DeepSWE，保留同一 Thread/Turn、工具执行、候选 patch 与独立评分证据。
- 当前阶段：基础会话真实 completed，候选 patch 的原始测试 native 评分 reward=1；本轮产品修复与最终桌面回归完成，固定 amd64 镜像评分保留基础设施阻塞。
- 写集：本执行计划、`.lime/benchmark/**` 运行缓存与证据、仓库外临时任务 workspace；发现产品阻塞后再按最小文件范围登记修复。
- 避让：工作树已有 Rust、Cargo、协议、MCP、Provider 与架构文档改动，本轮只读，不覆盖。
- 退出条件：基础任务真实完成，候选 patch 固化，任务测试与 Pier 评分结果明确；桌面会话需同时关联 Electron/IPC、canonical read model 和用户可见终态。基础链路通过不等于 DeepSWE 整套评测通过。
- 验证：固定 source commit、source preflight、单题真实会话、patch identity、独立 verifier；仅执行与实际修复相关的回归。
- 初始环境：没有运行中的 Lime/Electron；仓库任务缓存缺失；已有 App Server debug binary、Node 依赖与安装版 Lime；Docker daemon 可访问（29.5.2），Pier 尚未发现。
- 状态：基础会话与本轮产品修复完成（100%）。真实 DeepSWE completed、Enter 接受后清空、约 1 GB 旧历史三次冷恢复及最终 current Electron 三场景通过；候选原始测试 native 重放 F2P 14/14、P2P 165/165、reward=1。固定 amd64 容器评分因 QEMU 停滞未完成；默认全仓门禁被共享工作树 446 个未引用翻译 key 候选阻断，不声明全面 Codex 对齐或全量 DeepSWE 评测完成。

## 产品缺陷修复写集

- `src/components/input-kit/ComposerDraftCoordinator*` 及必要的现役提交/草稿接线：修复已接受消息的草稿清理，保留失败输入与新 revision。
- `src/components/input-kit/ModelSelector.tsx` 及对应测试：配置按钮必须以零参数调用业务回调，避免 React 点击事件进入导航参数并递归溢出。
- `lime-rs/crates/app-server/src/runtime/session_runtime_defaults.rs` 及其测试：将 thread 的 developerInstructions 传入 runtime，与 collaboration instructions 共存。
- 上述产品文件开始时干净；已有 Rust/Cargo/MCP/Provider 及架构文件的无关改动继续避让。

## 验证合同

- current owner：Electron Desktop Host → App Server JSON-RPC → RuntimeCore → canonical Thread/Turn/Item；DeepSWE harness 只准备输入和采集证据。
- 输入：固定版本的原始 DeepSWE instruction 与其 base commit，不注入解法或 reference patch。
- 用户可见结果：会话展示工具执行、测试和真实终态，workspace 中可核对候选变更。
- 失败终态：记录模型、工具、协议、环境或 verifier 的具体阻塞；超时中断 current turn，保留 partial evidence，不合成通过。
- 证据边界：受控 fixture、真实模型运行和 Pier 评分分别记录，不相互替代。

## 本轮执行记录

- 固定任务源 `435ee89ec2f2e2289f33b0da4f992f0b7b7266b9` 已恢复；Release 20 source preflight `205/205` 通过，Desktop Smoke 5 preflight 通过。
- 真实开发态 Electron `1.179.0` 已启动，URL 为 `http://127.0.0.1:1420/?nativeStartup=1`，CDP 为 `9223`；`bridge:health` 通过。启动入口检测到共享 Cargo 锁后，复用已有 App Server binary，不声称本轮重编译了当前脏工作树。
- 任务：`happy-dom-abort-pending-body-reads`，base `82a0888cb2c87a6123e05424b528f8e8c9b3e426`。真实模型：已配置的 `Sub2API 备用 / gpt-6.1-sol`。
- 用户入口：`DeepSWE 基础 · happy-dom`；workspace `a9a38f14-191d-4bb4-8275-790756c9e0cd`；Thread/Session `01a1e9ea-81d4-7165-88db-aef76c2ff873`。原始 instruction 经 GUI 输入，与 canonical user item 文本完全一致。
- 首轮 `turn_0b882502caaf440995d6a61a82e729c7` 停在审批，已真实 `turn/interrupt` 并进入 `interrupted`。没有执行分支或提交。后续会话追加通用运行约束，明确禁止任务原文要求的分支、提交和推送；任务内容及解法未修改。
- 第二轮 `turn_75b1cc3279b041f888c4fe98b765b886` 已执行真实读取、代码修改和本地测试。首轮测试因未捕获异常失败；修正后 Request/Response/BodyDisposal 三文件 `177/177` 通过，模型继续检查中。
- 活动回合刷新恢复通过：同一 Thread、同一 Turn 保持 `inProgress`，刷新后的 console/page error 均为零。
- 初始化阶段捕获 `useAppNavigation.normalizeNavigationParamValue` 栈溢出；恢复到本次会话后尚未复现。另发现 `thread/start.developerInstructions` 已存入 metadata，但默认 runtime 只消费 collaboration mode 的 instructions，首轮模型未遵守该字段；已通过显式用户运行约束避免执行 Git 操作。两项为待独立复现的产品缺口，不以本轮任务运行掩盖。
- 评分环境：Docker daemon 可用，但 Colima DNS 指向 `[::1]:53` 且拒绝连接，标准 pull 失败。正在用宿主机读取公开 ECR blobs、核对 digest 后流式导入本地 Docker；不修改系统或 VM DNS。Pier `0.3.1` 在隔离 Python `3.12.12` 环境安装中。
- 证据目录：`.lime/benchmark/v2/session/20261117-basic/`。任务修改只在仓库外隔离 workspace，Lime 产品源码保持未修改。

## Codex 对照与本轮根因修复

- 对照 revision：`69231e119bfca0b14453515e97d99688ce1c47c9`，许可证 Apache-2.0。公开 TUI 源码 `codex-rs/tui/src/bottom_pane/chat_composer.rs::prepare_submission_text_with_options` 先捕获提交内容再清空编辑器，校验失败恢复；公开仓库没有可直接复制的 Desktop React Composer。本轮在现役 `ComposerDraftCoordinator` / `composerSubmissionSettlement` 适配同一提交生命周期，保留 Lime 多模态 draft、CAS 和跨窗口身份保护，不声称直接复制 Desktop 源码。
- 接受后的清空与存储成功解耦；root promotion 只约束 consume 顺序；原 revision、导航 generation、失败输入及后续编辑仍受保护。新增慢存储、失败存储、旧通知与迁移期间新编辑回归。
- 上游 `codex-rs/core/src/session/mod.rs` 拼装 thread developer instructions 与模式指令；修复 Lime `session_runtime_defaults.rs` 只读取模式指令而丢失 thread 指令的问题。
- 上游 `codex-rs/rollout/src/policy.rs` 按完整 Item/事件增量持久化，跳过 transient delta。Lime current canonical store 本轮发现 normalized Turn 在每次 delta 中携带全部旧 Item（单条约 725 KiB），已在 `canonical_thread_store/history.rs` 复用既有 `turn_without_items` 去除重复读投影；Item 增量继续由原 owner 存储，保留 digest、重放与冷恢复校验。此修改并非整个 rollout policy 迁移。
- `session_operations.rs` 对完全相同的 metadata 更新直接返回，避免无效写入触发全历史校验并长期持有 RuntimeCore mutex。新增回归证明未修改 session 时间或内容。真实 metadata 编辑仍执行完整校验；历史旧文件的体积不通过删除或重写用户日志处理。
- 新增窄写集：上述 settlement 文件与测试、`session_operations/tests.rs`、`canonical_thread_store/history.rs`、独立 incremental 回归模块；共享测试入口只增加模块注册，不覆盖已有并行内容。未修改协议、Provider、Cargo、架构、侧栏等其他进程写集。
- 架构影响：minor，原 Product Surface → App Server → RuntimeCore → canonical projection 主链及唯一 owner 不变，无新增协议、后台或存储格式。

## 已观察的运行结果

- 原任务真实回合 `turn_75b1cc3279b041f888c4fe98b765b886` 实际为 `failed`：完整最终 agentMessage 输出后触发 `Provider step exceeded the absolute deadline of 300000ms`。thread idle 与完整回答不能代表回合成功；此前完成判断已纠正。
- 候选 patch `model.patch`：28,651 bytes，base 与 detached HEAD 未变。模型核心测试 296/296；扩展 980/981，唯一 SyncFetch 缓存用例已在未修改 HEAD 重复复现，不扩大基准修复范围。
- 草稿与 ModelSelector 第一批定向验证 112/112 通过。后续新增 promotion 顺序修复正在执行集成回归，不沿用第一批结果作为全部最终验证。
- Pier CLI Compose 创建阶段停滞；同一固定 amd64 镜像已由宿主机公开 ECR 下载并逐 blob 验证，不修改系统 DNS。已改用直接 Docker、禁网络、相同资源限制与原始 tests/test.sh + grader.py + test.patch 执行独立评分，标准未修改，结果待完成。
- Rust App Server lib 测试仍编译；contracts、typecheck、GUI smoke 与 current Electron fixture 正在执行。实际终态与最终源码 freshness 尚待收口，不标记全部通过。

## 超时修复与证据恢复

- 新增窄写集 `agent-runtime/src/provider_turn.rs`、测试模块注册与 `provider_turn/tests/deadline.rs`。本轮开始时干净；仅调整同步事件 sink 耗时的预算归属，不改变取消优先级、显式 deadline 或持续流保护。该大文件仅最小接线，不继续堆叠测试，测试放独立模块。
- 上游 `codex-rs/codex-api/src/sse/responses.rs` 在 SSE `stream.next()` 使用 idle timeout；Lime 保留现役多协议 Provider 与显式 step deadline，扣除本地同步投影/落盘耗时，避免缓冲完成响应被本地存储延迟误判超时。此处是边界适配，不声明直接复制整个上游 SSE owner。
- 23:50 左右观察到 `.lime/benchmark/**` 与 Rust target 内容被外部清理，仍运行 verifier 的挂载目录也已为空。原任务临时 workspace 尚存；缓存丢失导致证据与构建需要恢复。后续证据存 `.lime/qc/deepswe-session-20261117/`，不沿用已丢失文件为可复核证据。
- 前端最终集成 5 文件 98/98 通过；其后 coordinator 同步重入回归 34/34 通过。CodeMode 脚本测试退出 0。current smoke 的 CodeMode 实际 turn completed，但末尾诊断环形缓冲已不含 turn/start，桥接证据断言失败，不能记门禁通过。
- 最终前端源码复验：5 文件 119/119 通过，证据 `frontend-final.log`；CodeMode 脚本及已有 trace collector 2 文件 9/9 通过，证据 `code-mode-script-final.log`。CodeMode GUI 门禁复用已有 trace collector 连续收集实际 Electron IPC 诊断，保留原桥接断言，新增 Enter 与接受后输入为空断言。
- 原任务 workspace 的 staged patch 已恢复，28,651 bytes，SHA-256 `7b4f0f3bb019a124a53256bdac62bbfe0d3eb52e07a4a026cd7846e7564c3329`；没有重置原题工作区。只读 canonical SQLite 重新确认原 Turn 为 failed，证据 `original-turn-status.json`。
- 已从固定 DeepSWE commit 恢复原始 grader/config/test.patch/test.sh；被清理挂载目录的旧 verifier 无法产出有效报告，已停止并保留容器，重新用同一固定镜像、禁网络、2 CPU/8 GiB 和原始评分脚本运行 `lime-deepswe-basic-verifier-20261118`。不修改参考 patch 或评分条件，最终 reward 待出。
- 首次 Rust 构建退出 101，原日志已被外部清理，失败原因无法复核；GUI smoke renderer 构建被 SIGTERM 打断（退出 143），均不能记通过。最终 Rust no-run 正在从清理后的 target 重建；相关测试选择器扩展到五个消费者后已停止该未执行队列，改为只运行 agent-runtime 的 provider_turn 定向测试。
- TypeScript 最终检查退出 0；本轮前端/Rust 格式与窄 diff 检查通过。原 typecheck/contracts 输出日志已被清理，只保留先前进程退出证据与 `verification-status.json` 记录，不虚构日志文件。
- 直接 Cargo 的最终 no-run 退出 101，原因是未注入仓库现有 V8 解析器，Deno 默认 sandbox archive URL 返回 404。已调用 `scripts/lib/rusty-v8-artifacts.mjs`，通过既有校验的 Codex 同版本 archive/binding 缓存恢复命令级环境；不更改 Cargo 版本、feature 或校验。后续定向 provider-turn、App Server 新增回归和运行 binary 构建按顺序执行，Cargo 并发限制为 2，日志 `rust-resolved-final.log`。
- `composer-electron-existing-runtime` 单独验证新版前端 + 已保存运行时的 Enter 发送，不能作为本轮 Rust 修复验收。新 runtime 构建完成后仍需复测 current smoke 和真实 DeepSWE 后续回合。

## 最新 runtime 验收与冷恢复修复

- 最新 binary 的 CodeMode Electron Gate B 退出 0，22 项断言全部通过；Enter 提交后可见输入为空、工具完成、canonical Turn completed。Thread `01a1ea54-e87a-77a0-808c-172cdbb1c297`、Turn `turn_2e2c30ec63fe45d3aa0a1c6cb375ba86`；证据 `.lime/qc/deepswe-session-20261117/composer-electron-current-runtime.json`。旧保存 runtime 的恢复失败不能覆盖这份 current 结果。
- 真实 DeepSWE 原会话首次恢复超出 IPC 30 秒期限，冷恢复会从约 831 MiB 的旧重复历史中保留全部 Turn 快照，再提取 runtime events。再次打开后可编辑；不能以重试替代根因修复。
- 新认领写集（开始时干净）：`canonical_rollout/scan.rs`、`canonical_rollout/read.rs`、`canonical_rollout/tests/runtime.rs`、`thread_fork/hydration.rs`。恢复读取逐条扫描、校验并立即重放增量，保留最终 Thread 与 events，释放旧快照；保留 digest、identity、严格 sequence、event identity collision 和 metadata chain 校验。冷扫描通过 blocking worker 执行，不占异步 runtime 线程。
- 对照同 revision Codex `rollout/src/recorder.rs::load_rollout_items` 与 `rollout/src/compression/blocking_reader.rs` 的逐行后台读取；Lime canonical digest/metadata 合同不同，本轮仅适配现役 owner，没有复制第二套 recorder。新增回归同时验证相对/绝对路径恢复完整 events（继续经过 ThreadHistoryBuilder 校验），以及早期历史损坏失败关闭。新写集的 Rust 测试和最新 binary 验证尚待完成。
- GUI smoke 和其余 recovery Gate B 正在执行；Rust 使用现有 V8 resolver 重建依赖，尚未出现本轮源码编译错误。独立 amd64 verifier 仍未产出 XML/reward，不能记通过。

- 后续 GUI Enter 动作未进入 turn/start：thread/read、queue/list 与 goal/get 超过 IPC 30 秒，草稿按失败语义保留。此前“正在执行”判断纠正为未被 runtime 接受；证据 `deepswe-followup-submit-trace.json`，不写 acceptedInputCleared=true。
- GUI smoke 编译结束后 freshness guard 因其他进程修改 `ThreadWorkspaceHeader.tsx` 和 `ScheduledTaskList.tsx` 拒绝，退出 1。第二次 recovery packaged renderer 编译耗时过长，已仅停止本进程该编译队列（退出 130），改用仓库支持的 `--app-url` + current Vite dev server 验证真实 Electron 边界。没有放宽 build receipt，也没有修改其他进程源码。
- 原参考 tests 在独立 native replay 中执行：新增 suite 19/19（F2P 14/14），base 160/163；原版 pinned junit-to-ctrf 0.0.14 与原 grader 评分 P2P 163/165、reward=0。只映射 report 文件位置，whitelist/评分逻辑/测试内容/timeout 未改。第二次 native base 157/163，时间断言失败数量变化；未修改 base commit 的对照也出现 Response waitUntilComplete 与 DetachedWindowAPI abort 时序断言失败。不能将这些结果写成全绿或覆盖固定容器评分。

- Provider-turn 定向 Rust 回归 90/90 通过，包含同步 sink 超时回归。包含冷恢复修复的 App Server binary 于 01:10:47 构建完成，退出 0；日志 `cold-resume-build.log`。
- App Server lib test 首次编译失败为新增 metadata no-op 回归的 `ThreadMemoryMode` 路径错误，已在原始 owner 修正为继承类型；定向回归重跑队列中，不记通过。
- Session recovery dev warm 真实 Electron Gate B 已通过，21 项断言全 true、consoleErrors=[]，Thread `01a1ea74-a8ab-7061-b5ea-4b93a1916838`，证据 `recovery/recovery-dev-warm-summary.json`。停止指令发生前该门禁已产出成功结果，已按落盘证据纠正状态。
- 验证快照 `.lime/verification/deepswe-session-20261117/` 于 01:03 由原始源码生成，13191 个文件与 SHA-256 清单 `source-manifest.json`。仅用于稳定 renderer 构建，不在副本开发产品。最新 live App Server 继续来自原始仓库构建。snapshot GUI smoke 与 running-turn Gate B 仍在运行。
- 候选 native serial：Request 62/62、Browser 16/16、BrowserPage 31/31 通过；Response 36/37、DetachedWindowAPI 16/17。Request arrayBuffer 与 Response blob 在单独执行时均通过；并发与 serial 的错误项不稳定，原始 base 同样出现 timer 断言失败。原始测试和评分逻辑未改。

- 固定 amd64 verifier 在 QEMU 的第一套测试中超过 70 分钟，仍未产生 base XML/new XML/reward。已保留进程状态和空报告事实，并对本轮容器执行有界停止，记 infrastructure_stall，不以 native 结果冒充官方镜像通过；不再无界占用验证资源。

- 原会话最新 IPC 探针仍失败：thread/read 32,393 ms、thread/resume 36,568 ms，均超出桥接 30 秒期限。运行时 sample 同时看到 queue/list → load_projection_session → read_repaired_session 的同步完整投影读取，以及 blocking worker 中的 rollout digest 校验。不能把新的冷恢复实现记成已验收。
- 新增窄写集 `runtime/load_context.rs` 与原先干净的 `runtime/tests/session_hydration_projection.rs`：将完整 projection repair/read 放入 `spawn_blocking`，防止大历史或 SQLite 锁阻塞 Tokio executor；不改 canonical owner、数据格式或完整性校验。新增 current-thread executor 回归，用隔离 SQLite 读锁证明定时器仍能执行并释放读取。测试待验证。
- Codex 同 revision 的 `rollout/src/compression/blocking_reader.rs::scan_lines` 同样将整段读取置于 blocking worker。本轮沿用 Lime 的 projection repair 合同，仅适配执行边界，不复制第二份 reader 或恢复 deprecated EventLog 为生产 fallback。
- 固定容器已停止，退出 137；保留容器与停滞证据，reward 仍为空。

- 新增窄写集 `runtime/thread_queue.rs` 与原先干净的 `runtime/tests/thread_queue.rs`：冷会话列空队列先读 canonical Turn summary；没有 queued Turn 时直接返回，不走全 transcript hydration。归档/ephemeral 校验保留，有待处理项继续原恢复路径。新增隔离回归证明不安装 EventLog reader 也能列空队列，且会话仍不在 loaded threads 中；补测现有 queue CRUD/restart 与 rollout-only rebuild。未增加协议/配置/owner。
- 最新 rollout 逐类型盘点：1 个 session_meta、1,896 个 thread_history、5 个 metadata，总 987,400,107 bytes（此前约 831 MiB 为不精确快照）；文件 mtime 仍为 23:25，没有后续 turn 被悄然接受。证据 `original-rollout-inventory.json`。
- Running-turn Gate B 本轮未完成：刷新后真实 Electron CDP 页签消失，主进程在请求 normal quit 前已退出，consoleErrors=[]。证据 `reopen/reopen-current-summary.json`。不将该结果归因于未证实的产品断言错误，也不记通过。
- 01:37 发现另一进程已重新启动仓库 Electron 并占用 9223，本轮 run-dev 因 single instance 正常退出；不终止该进程。仅复用 current Electron 做原会话长耗时诊断，显式请求 600,000 ms 只是测量真实耗时，不修改产品 timeout，也不作为正常 UI 冷恢复通过。

- 冻结 renderer production 构建完成于 01:35，构建收据 `ready`，input SHA-256 `2dbd678f3f5ea6332206f02c9f462defdc0b704a122738843b72a6146becbb66`；在独立 1421 preview 提供验收页面，不更改共享 1420 dev server。验证记录 `frozen-renderer-receipt-check.json`。
- 冻结 GUI smoke 的 host 已完成；后续 prepare-app-server-assets 默认忽略 APP_SERVER_BIN，排入了旧快照的 Rust 构建。已停止本轮该待锁构建（未开始），防止旧快照覆盖共享 target；后续使用现有 prepareElectronAppServerAssets 的显式 sourceBinary 装配原始仓库新 binary，再执行 smoke，不放宽 renderer receipt。
- 原会话长耗时诊断 read 85,845 ms 返回 notLoaded；resume 在 50,202 ms 时收到 app-server host is stopping，没有得到恢复结果。9223 所属并行窗口其后再次退出，不能作本轮冷恢复证据。

- App Server canonical rollout 定向测试 29/29 通过，包含本轮 streaming read 与 corruption 拒绝。构建耗时 36m41s，测试耗时 1.07s。后续 source 已新增 projection/queue 修改，不将这份 executable 记为新增修改的验收。
- 已停止原 driver 的重复待锁 Cargo 阶段，直接调用同一已完成 test executable 的三个既有回归 filter，3/3 通过（指令合并、metadata no-op、增量幂等冷恢复）；独立启动首次缺少 Cargo 自动配置的 Sherpa dylib 路径，随后仅为命令补相同 prebuilt 路径并通过。日志 `metadata-incremental-direct.log` 保留初始缺库和通过结果。新增 projection/queue 回归在自己的 current source 编译队列继续执行。

- 01:57 左右，projection-read 与 queue-read 两个 Cargo 子进程均被 SIGTERM 终止；本轮没有发送该终止指令。没有输出源码编译错误，不计测试通过。另一父进程随后在共享 target 启动 App Server binary 构建；本轮不终止它，等待并核对源码收据后继续。两项新增修复源码哈希均未变化。

## 2026-11-18 继续验收

- 冻结 renderer + 原始仓库 current binary 的 GUI smoke 24/24 通过，证据 `gui-smoke-current/summary.json`。普通恢复 21 项与本轮 running-turn reload/stop 25 项均通过，后者证据 `reopen-final-isolated/reopen-final-isolated-summary.json`，consoleErrors=[]，无 mock fallback。
- 新增 App Server 定向测试首次 42/43：锁住空会话的测试无法得到实际历史投影。仅修正 `session_hydration_projection.rs` 的测试夹具，先执行真实完成回合再锁库，保留 current-thread executor 的 timer/锁释放检查；修正后 2/2，通过当前 executable 聚合复验 43/43，日志 `current-final-regressions.log`。未降低生产超时或损坏校验。
- 共享开发 Electron 被其他构建反复重启。为继续 live 回合，用 SQLite backup 和 APFS copy 保存隔离的原会话快照；冻结原始源码构建的 runtime 与既有合格 host/renderer，仅用于验收，不在副本修改产品。证据与复制品仅存 `.lime/qc/deepswe-session-20261117/`，原用户数据未重写。
- 原会话暖恢复后可见完整历史并可编辑；大历史冷恢复曾超时，仍需隔离验证，不能记正常 UI 冷恢复通过。原失败回合不改写为 completed。

- 隔离原历史快照的新 live 回合 `turn_67390a30a87d4c51b20571e556978e32` 已通过 GUI Enter 接受，输入为空，真实 runtime / 已配置 Provider 正在执行并进一步修复 empty buffered Response 边界；证据 `live-followup-accepted.png`、`live-followup-trace.json`。原 failed 回合保持原状态。
- 冷恢复采样 `cold-resume-current.sample.txt` 显示主要 CPU 时间在旧 JSON 的解析和 canonical digest 重序列化；暖 resume 9,577 ms 成功。正在仅通过 Cargo 命令参数优化 `serde_json` 和 `lime-core` 做性能对照，未修改共享 Cargo.toml；候选落点为当前干净的根 `.cargo/config.toml`，是否需要落地以实测为准。
- 最新 `test:contracts` 在协议生成检查通过后失败：并行 session facade 从 `appServerThreadReadParams(threadId, false)` 改为 `true`，静态 guard 未同步；脚本和 session facade 均为其他进程脏写集，本轮只读登记，未夹写。
- 本地 Node20 的原官方 base 五 suite 163 项中 1 项 Request waitUntilComplete 超时，证据 `native-node20/base.xml`；保持原测试及 timeout，未作评分通过声明。

- 新认领干净写集 `canonical_thread_store/history_builder.rs`：普通追加/更新仅加载 changed Item 的先前快照，Turn 仍读取 canonical summary；按 Item ID 查询保留跨 Turn 身份冲突检查，继续使用同一 ThreadHistoryBuilder 做文本/终态归并。回滚或删除仍使用完整历史。新增现有 incremental 测试模块回归，验证未触及的大历史、文本合并、原 ordinal/createdAt 和终态。此处是 Lime SQLite 投影的必要适配；上游按完整 Item 事件持久化，无此 SQLite delta-normalization 可直接复制 owner。没有新 owner/格式/协议。

- 合同 guard 已由并行 owner 同步，本轮重新执行完整 `npm run test:contracts` 退出 0，日志 `contracts-rerun.log`；没有夹写该脚本。旧失败日志保留。

- live 运行回合刷新失败，出现 session detail 12 秒/IPC 30 秒 timeout，证据 `live-reload-timeout.sample.txt`。采样显示命令输出 appender 持有 RuntimeCoreState 锁并在 `event_batch.rs` 克隆整段 stored.events，释放大 Vec<AgentEvent> 时 provider sink 等待同一锁；没有将受控 fixture 的恢复通过扩大为这次 live 通过。
- 新认领开始时干净的 `canonical_thread_store/event_batch.rs` 与 `thread_item_projection/materializer.rs`：materialize_events 接受借用事件迭代器，命令输出重放直接 chain 借用已有事件，移除整段克隆/析构，不改顺序、归并、校验或数据格式。现有 materializer 与命令输出回归纳入同次 Rust 验证。

- 新 live 回合最终仍 failed（Provider step absolute deadline 300000ms），不能记成功。模型已补空/无 body Response 边界与 32 项测试，首轮扩大测试 978/981，后续串行复测未执行完成。该回合来自旧 02:21 runtime，尚未包含本次增量 seed / 借用重放修复。为新 runtime 复验保存隔离 SQLite online backup 与日志快照 `optimized-userdata/`，不更改原用户数据。

- 同型克隆亦存在于开始时干净的 `event_store/canonical_message_lifecycle.rs::attach_canonical_item_entity`；同样改为借用 stored/pending/current 事件 chain，无新语义，复用现有 lifecycle/materializer 回归验证。停止的仅为本轮隔离 Electron PID 6541（其 live turn 已 failed），退出 0；没有停止共享开发窗口。

- failed followup 的实际补丁已单独固化为 `model-followup.patch`（29,375 bytes，SHA-256 `ccd9d0c51eca86d0951f083f35357fd542168b9dc5c60b625536f9fbf47ba065`），原 `model.patch` 保留。独立工作区 BodyDisposal 126/126 退出 0，包含新增 32 项空响应测试；该证据不代替 live completed 或官方评分。

- 新候选在独立 native replay 使用 Node20.19.3、原始 base 五 suite 及 AsyncTeardown：163/163 + 19/19，均退出 0。固定 junit-to-ctrf@0.0.14 与原 grader 的 `grade` 通过既有 APP_DIR/TESTS_DIR/VERIFIER_DIR 参数及仅替换原 config 的 grade.reports 映射本机报告目录，得到 F2P 14/14、P2P 165/165、reward=1，证据 `native-followup/reward.json`。未修改测试、timeout、whitelist 或 grader；这是新 patch 的 native 结果，不覆盖旧 reward=0 或固定 amd64/QEMU verifier 停滞事实。

- 首次 grade 误沿用旧 native-replay config 的绝对报告路径，读取旧失败报告；原结果保留为 `native-followup/grade-stale-report-path.log` 与 `reward-stale-report-path.json`。改为从恢复的原 config 生成只映射 `grade.reports` 的本机配置，断言其余字段完全一致后重算，最终 reward=1；未重跑测试或改 whitelist。

- 本轮新增五文件源码的原仓库构建退出 0，冻结 `optimized-runtime/`，SHA-256 与 `optimized-runtime-receipt.json` 一致；不是在验证副本开发产品。canonical_thread_store 定向 Rust 测试仍在编译。
- 仅优化 serde_json/lime-core 的 runtime 首次打开约 1 GB 原历史仍超过 IPC 30 秒，`optimized-cold-restore-failed.json` 与 `optimized-cold.sample.txt` 保留失败；样本热点在泛型 JSON 编码的未优化实例（code-mode crate）。没有拉长产品超时，也没有跳过任何 digest/identity/sequence 校验。
- 同一 20 MB JSON 合成诊断中，普通泛型编码 5,586 ms，调用方 opt-level=2 为 91 ms，输出逐字节相同；这是性能定位，不能替代产品验收。App Server opt-level=2 的命令级对照构建排队，尚未落地 profile。
- 已加载状态下重新从侧栏进入原会话，13,423 ms 后编辑器可用；真实 Enter 后 turn/start 走 electron-ipc 成功，已接受输入为空。此次仅要求执行 BodyDisposal 定向核验并结束，`optimized-live-submission.json` 与 `optimized-live-accepted.png`；尚未判定 Turn completed。

- 真实后续核验已完成：同一 Thread 的 `turn_bd4a18ad8bdc4ad0a92047bbb358f73e` 为 canonical `completed`，commandExecution `completed`、exitCode=0、BodyDisposal 126/126，用户可见最终答复与 read model 一致且不再 streaming。`turn/start` 为真实 electron-ipc，接受后输入为空；pageErrors=[]。证据 `optimized-live-result.json` / `optimized-live-completed.png`。本轮使用隔离原历史副本及真实已配置 Provider，不改写两个旧 failed Turn；基础任务闭环通过，大历史首次恢复与新增 Rust 回归仍待收尾。

- 新增性能修复回归：canonical_thread_store 104/104；materializer、canonical_message_lifecycle、canonical_rollout、hydration、queue、projection、session_operations 消费者 185/185，均退出 0，日志 `incremental-scoped-regressions.log` / `incremental-consumer-regressions.log`。
- 真实完成截图额外发现最新 Turn 的耗时显示成 4h44m。canonical Turn 已有本轮 createdAtMs、completedAtMs，但 current runtime 仅发 turn.accepted/turn.completed，v2 startedAt 缺失，renderer 回退到 Thread 创建时间。认领开始时干净的 `processor/thread/projection.rs` 与独立 `projection/timing_tests.rs`，在原 v2 projection 使用该执行 Turn 自身 createdAtMs 兜底，显式 startedAtMs 优先；排队提交仍在相同边界拒绝。不新增协议字段、文案或第二时间源。对应同 revision 上游 v2 Turn started_at 可选合同；这是 Lime canonical projection 必要适配，不声称复制上游默认时间逻辑。新回归/二进制与 GUI 复验待完成。

- 耗时投影变更后完整 `npm run test:contracts` 再次退出 0，日志 `contracts-timing-final.log`；候选 patch 在 completed 后仍为原 reward=1 的 SHA-256，`completed-live-patch-identity.json`。仅关闭自己的隔离 Electron PID 3143，无共享进程变更。

- App Server opt-level=2 对照构建退出 0（`profile-runtime-receipt.json`），首次 UI 恢复仍超过 30 秒；重启进程后同一历史 21,169 ms 可编辑，仅为对照、尚非稳定交付，不落地 profile 设置。完整校验和原 960 MiB 日志均保留。
- 进一步静态定位 `ThreadHistoryBuilder::apply_change_set` 在每次重放时 clone 整份 builder 作为事务 checkpoint；冷读取任意错误会丢弃整个 builder，无需保留可恢复的 mutable handle。新认领开始时干净的 `thread-store/src/history.rs`（仅模块注册）、`history/replay.rs`、`history_tests.rs`（仅模块注册）与 `history_tests/replay.rs`；现役 `canonical_rollout/read.rs` 调用取得 builder 所有权的 `replay_change_set`。该入口复用同一个 apply_change_set_inner，返回 Self 或错误，错误时没有可供调用者观察的部分状态；不跳过 digest、identity、sequence、rollback 或 metadata 校验。
- `history.rs` 已超过 1,000 行，本轮不堆业务逻辑，仅加模块接线，新实现落在同一 history owner 的子模块；未创建第二 runtime、格式或协议。上游无可直接复制的 Lime SQLite/digest transactional replay 对应实现，此处是现役 canonical builder 的必要存储适配。
- 已停止本轮尚在编译的旧 timing-final-build（自己的 84636/84658/41372），避免对已被新根因修改替代的源码继续构建；待执行的 timing-final-regressions 没有启动。新验证顺序为 thread-store 全 lib 回归 → 原仓库最终 binary → App Server projection/rollout/hydration 定向回归。性能使用 app-server opt-level=2 的 binary 测量，语义回归使用已有 opt-level=0 lib 缓存；不把编译参数差异作为性能通过证据。

- owned replay 首轮回归 36/37，新增身份断言暴露通用 builder 的既有缺口：`new().apply_change_set` 未固定首批 Session/Thread 身份，跨批或首批 Turn/Item 混合身份可漏检。现役 cold reader 使用 `for_thread` 已绑定身份，但通用 API 同样需要修复。将既有 `adopt_identity` 移至同 owner 的 `history/identity.rs`，在统一 inner 校验前从首个 Turn/Item 绑定身份；mutable API 失败仍完整回滚，owned API 失败消耗整个 builder。新增混合身份与事务原子性回归，没有放宽校验。
- identity 修复后 thread-store 全 lib 38/38 通过（退出 0），日志 `owned-replay-tests-final.log`；初次失败日志与结果保留。最终 App Server binary 正在构建，后续 projection/rollout/hydration 回归及真实 Electron 冷恢复尚待完成。
- 默认 `npm run verify:local` 已执行，版本一致性与五语言资源结构通过；在 `i18n:unused -- --check` 因共享工作树 446 个未引用 key 候选退出 1（`local-gate-final.log` / `local-gate-final-result.json`），尚未进入其后前端/Rust/GUI 阶段。本轮没有增删文案 key；这些候选分布于并行 owner 的设置、导航、插件等领域，保留事实，不批量修改他人资源或声称默认门禁全绿。

## 最终验收

- 最终 owned replay / identity / timing 源码在原仓库构建成功，源码收据 13/13 一致；App Server projection、rollout、hydration 定向 71/71，thread-store 全 lib 38/38，均退出 0。先前增量存储及消费者 104/104 + 185/185、Provider deadline 90/90 和前端 119/119 结果继续按各自修改范围保留，不虚构成一份全量测试。
- 新认领此前干净的 `.cargo/config.toml`，落地实测 dev package 优化：serde_json=3、lime-core=3、app-server=2；test package app-server=0 保持与语义回归命令一致。旧日志必须解析和重编码校验摘要，调用方泛型编码也需优化；仅优化依赖不足。未调整产品 timeout、格式、校验或依赖版本。普通无 profile 覆盖参数的 Cargo build 2.34 秒退出 0，产物与冻结验收 binary SHA-256 相同，证据 `default-profile-build-result.json` / `owned-runtime-receipt.json`。这是 Lime 存储热点适配，不声称复制上游 profile。
- 约 960 MiB 原历史副本在三个独立 Electron / App Server 进程中首次从侧栏打开，分别 16,269 / 16,964 / 17,927 ms 后编辑器可用，输入为空、pageErrors=[]；第一和第三次完整采集真实 electron-ipc 的同 Thread `thread/read` / `thread/resume` 成功，最后一次 resume 14,512 ms，无 invoke error。第二次采集器仍引用旧 page，未采集到 trace，只作恢复时间复现，不能单独作为完整 Gate B。证据 `owned-cold-first.json`、`owned-cold-restart.json`、`owned-cold-final.json`；没有删除、压缩或重写旧用户日志。
- 同一 completed Turn 的 public startedAt=1794942969、completedAt=1794943106，GUI 显示「用时 2m 17s」，与本轮差值一致；不再回退 Thread 创建时间。证据 `owned-timing-canonical.json`、`owned-final-session.png`。原两个 failed Turn 保持原状态。
- 最终 binary 的 CodeMode 真 runtime + 本地 Provider fixture 通过 21 项具名断言及 Enter 接受后清空前置断言，canonical Turn completed、工具 completed、生产 mock fallback=0；普通恢复 21/21、受控活动 Turn 刷新与停止 25/25，consoleErrors=[]。证据 `owned-code-mode.json`、`owned-recovery/owned-recovery-summary.json`、`owned-running-recovery/owned-running-summary.json`。前者使用真实 model-provider / CodeMode，后两类恢复证据按各自 backend 合同报告；不冒充新增 live Provider 运行。
- 最新 live completed 证据仍为 `optimized-live-result.json`，最终 timing/owned 修复通过上述 current 真实桌面 Gate B 和 canonical 旧回合恢复验收；没有为补截图额外调用付费模型。最终 patch identity 与 native reward=1 结果保持一致。
- current：原 Composer、App Server、agent-runtime、thread-store、model-provider 与工具主链；没有新增 compat/deprecated 入口、第二 runtime 或数据库 owner。移除了重复完整 Turn 写入和全事件链克隆，旧日志原样保留；本轮未删除产品文件。避让共享 Cargo manifest/lock、Provider/MCP、架构、协议与其他并行 UI 改动。所有验证窗口、采集 timer 和本轮 1421 preview 已关闭，未停止共享开发窗口；无 commit、push 或分支操作。
- 完成边界：本轮基础会话与发现的主链产品缺陷修复 100%；固定镜像评分仍 infrastructure_stall，全仓默认门禁仍因其他 owner 的 i18n 未引用候选退出 1，不能报告全量评测或全仓全绿。
