# v1.168.0 发布执行计划

状态：PR 已合并，新增改动已纳入候选，本地硬门禁通过，待最终远端验证及发布；负责人：root；日期：2026-10-23。

## 目标与授权

用户要求发布 v1.168.0，审查并合并 PR #153，核查其他模型并清理过时内容。后续明确授权先合并再完善、一起递交发布，并要求完成发布且不要再次确认。合并、必要修复、清理、提交、标签及推送均在授权范围内；不创建分支，不覆盖并行改动。

## 候选与写集

- 基底：`348e0a03a7dc61e34f984ae490e0a18e40367764`，即 PR #153 的 squash 提交；上一标签 v1.167.0。
- 纳入冻结时全部产品、文档、测试、协议、生成客户端及五语资源，包含 Browser 批注/Design/下载、设置重组、记忆与指令、听写、Git/worktree、Storage 和模型更新。
- release metadata：package.json、packages/cli/package.json、Rust workspace/Cargo.lock、两份当前版本单页发布说明。Forge 与 manifest 继续读取应用版本。
- 排除生成缓存 tsconfig.node.tsbuildinfo；用户后续明确要求其他当前修改一并纳入，本轮扩大候选覆盖该授权时的全部产品、文档、测试及未跟踪源码。
- 冻结源码、独立 index 和最终 tree identity 位于本地 `.lime/release-v11680/`；逐文件 blob 校验确认冻结源码与候选 index 一致。提交仅使用该候选，避免隐式混入后续修改。

## PR #153 审查结论

- 作者 octo-patch 为独立开发者/首次贡献者，提交 unsigned，不能确认其官方身份；MiniMax 官方文档确认对应模型、订阅地址和 Anthropic endpoint。
- 用户后续授权先合并再修复；已 ready 并 squash 合并，原 PR head 为 80452266aaef190c8f700a4cd56eddabc77920f3。
- 补齐 Flash/M3 图片能力和从订阅配置到发送门禁的回归，保留未确认 Preview/文本兄弟型号负向验证。
- 修复新增 Rust capture 测试引用不存在 helper 的编译问题，复用现有 provider_config 与多模态工具历史请求夹具。

## 模型核查与清理

- 官方文档和公开目录依据保存在模型审计 JSON（URL、内容 SHA、限制，不含凭证）；未发起付费推理请求。
- 默认模型更新覆盖 OpenAI、Claude、Gemini、Kimi、GLM、Qwen、DeepSeek、Grok、MiMo 和 MiniMax；对应前后端图片能力与上下文窗口同步。仅改变新建默认，不修改用户已保存 ID。
- OpenAI 当前默认使用 Responses；Kimi Code 使用官方 kimi-for-coding alias，套餐推荐选择通用可用档位。
- canonical 目录：180 → 253，更新 83、新增 158、删除当前 OpenRouter 源已不存在的 85 条。源缺失不等于供应商全局停用，自定义 ID 仍可请求。
- 保留 12 条独立维护的 Agnes 元数据；其公开 API 401/文档 403，无法 live 核实。6 条原有未知上下文继续使用既有 0 哨兵，不猜测窗口。
- 删除退休 OAuth 默认、SenseNova 未核实推荐值、Submodel 旧静态默认及三个接口的重复模型表；HTTP/WebSocket 委托 ModelsConfig 的启用项稳定排序/去重投影。
- canonical 映射优先精确匹配，修复 Codestral/Ministral 有效日期版本被剥离；上下文消费者统一使用 agent-protocol 既有解析器。
- 大文件退出条件：仅机械默认数据/既有推断和共享投影修复、参数化预设回归；完成定向验证后不继续叠加业务逻辑。

## 架构与分类

- current：Desktop/CLI → App Server JSON-RPC → RuntimeCore → canonical Thread/Turn/Item；网络仍归 model-provider，工具与持久化 owner 不变。
- 版本与模型数据更新不增加业务后端。候选既有 Browser/配置合同变更由 architecture.md 与领域计划记录责任开发者确认；发布不代表完整 Codex GUI/Browser 路线图验收。
- compat/deprecated：本轮不新增。deleted：旧设置首页、重复 memory/Soul UI、旧 fixture、重复模型表及上述旧目录记录。
- KISS/DRY：复用既有能力推断、canonical registry、context resolver 和配置模型投影；不增加并行事实源或兼容包装。

## 验证与退出条件

- 必须通过版本检查、完整 typecheck、contracts；相关前端/脚本和 Rust owner 定向回归按风险执行，真实 GUI smoke 尽量完成。
- 最终候选已通过模型/Storage 6 文件 103 项、定向 ESLint、版本检查、完整 contracts、模型数据完整性及新增 Rust 文件格式检查。完整 typecheck 已通过；Rust 和 GUI 构建仍在运行，未计作通过。详见发布验证收据。
- 初轮 broader frontend 集合 1235 pass/3 fail；旧 i18n 合同和听写终态等待已修复并定向通过。脚本集合 214 pass/1 timeout，权限 AST 扫描受本机负载影响，未降低断言或延长 timeout；两个 node:test 文件 6 项通过。
- 本机 16 GiB 且有并行重型构建；Rust 曾等待外部锁，缓存重建与换页限制本地速度。不终止其他任务，不用历史二进制或 mock 冒充真实 Gate B。
- 本地硬门禁通过后可先推 main，由同提交 GitHub Quality 补足完整 Rust/GUI/前端证据；通过后打 v1.168.0 标签，跟踪 Release 三平台桌面、CLI、npm 和 updater 发布终态。
- 不覆盖已存在 tag，不以 commit/tag/push 成功代替公开产物发布；未完成或失败按实际状态记录。收尾核对远端 main、tag、Release 和 npm 身份。

## 发布候选追加修复

- 首次推送 ad5ae600d：本地 model-provider 298 pass/1 fail，capture 指出 current URL builder 将 Anthropic 兼容根 /anthropic 拼为 /anthropic/messages；MiniMax 官方明确 /anthropic/v1/messages。修复既有 endpoint builder 的 Anthropic 根路径，保留完整 version/custom endpoint；不降低 capture 断言。该大文件仅修改既有 URL 分支和对应回归，不继续扩展业务。
- 远端 contracts 揭示两份发布审计 JSON 被 .gitignore 排除；增加与前版一致的精确发布证据目录例外，保留 docs 边界守卫。后续冻结验证显式使用候选 GIT_WORK_TREE / GIT_INDEX_FILE，让依赖 Git 索引的检查覆盖实际发布集。
- 纳入并行完成的 Storage 修复：未知/畸形来源与 cloud descendants 不得进入本地清理，支持合法空 feature，并修复两层对话框的键盘焦点恢复；同步领域回归和真实 fixture 断言，不改外部任务文件。
- 旧候选 GUI 构建仅由本任务正常停止，不计通过；新候选重新进行类型、前端、contracts，Rust 与 GUI 继续按实际终态记录。

- 追加候选完整 typecheck exit0（684.46 秒）；Storage UI/API 回归、定向 lint、Markdown 30 项和测试分层 38/38 通过。首候选远端 GUI smoke、全前端 lint/typecheck 通过。完整 contracts 用显式候选 Git 索引重跑中；最终远端 Quality 通过前不创建标签。

## 全量验证追加修复

- 远端 39947149402 全量前端在批次 25/148 暴露 embeddedBrowserHost 测试 Session 夹具缺失 removeListener，3 项 dispose 回归失败；补齐与真实 Session 一致的监听移除语义，不增加生产容错或降低断言。
- 同一轮 Rust 在 host_boundary_guard 暴露工作树队列依赖带实现名的客户端标识。将已有 clientInfo.name 统一为短领域名 desktop，同步 Electron producer、App Server consumer 和真实 JSON-RPC cleanup fixture，直接迁移、不保留旧标识。仅标识值迁移，不改协议 schema、owner 或依赖方向；root 确认 minor 架构影响及上述调用流，不新增后端。

- 第三候选：54 项 Host 回归、两项原始宿主边界守卫、完整 typecheck（109.22 秒）与 contracts（36.4 秒）通过；修复后的 model-provider 299/299 通过。准备推送最终修复等待完整远端矩阵。

## 当前设置导航验证迁移

- 远端 39949266868 的 Frontend Full 在批次 32/148 暴露 7 个过期 Sidebar 断言：设置页 current 行为是仅保留图标栏且入口为 General。会话场景迁移到同样没有 agent project 作用域的已安排任务页，导航结构场景使用 agent 页；保留会话标题、查询隔离、focus 刷新和导航动作断言。既有设置折叠偏好测试继续覆盖设置页。三文件 65/65 与定向 ESLint 通过。
- 本地从批次 33 续跑，在 38/148 揭示 SETTINGS Gate A 清单仍含退休 home 且缺少当前章节；同步 21 个 current sections 与 general 关键页，保留对实际 sections 的完整相等守卫。该证据构造器 7/7 与定向 ESLint 通过，续跑继续。
- 第四候选完整 npm run typecheck exit0。上一候选 Integrity、Bridge & Contracts、真实 GUI Smoke 已通过；Rust Full 和 Windows Shell Runtime 仍在运行。测试迁移仅修复验证与清单，不改运行时或协议。最终矩阵及公开产物完成前不标记发布成功。

## 全量治理与异步分发修复

- 本地续跑批次 70/148 暴露 dispatch 中央文件 818 行超过既有 800 行上限。将 8 个 Git/worktree method 的 boxed-future 构造搬入既有 processor/project_git.rs，仿照 model/skill 的 Option<BoxFuture> 分组；未知方法不消费 params。dispatch 现为 799 实际行（守卫 split 计 800），不提高门槛，不改公开方法、handler、参数或通知。architecture.md 已同步此 minor owner 调整，root 确认数据流和依赖方向。
- 同批次两份隔离 Storage/Worktree Electron 夹具漏登记 ExternalBackend 的 test-only 例外；只补精确文件路径，生产默认 runtime 与全目录扫描保持原样。两份夹具明确受控 backend、隔离数据与证据范围；未修改正在并行开发的 fixture。批次 70 的 114/114 通过。
- 批次 71/148 的方法证据仍指向已删除 MemoryStoreStatusPanel；更新为实际调用 memory/reset 的 DeleteMemoriesDialog，保持 implemented 状态与存在性守卫，批次重跑通过。
- 远端 39949266868 的 Rust Full 在 scheduled_tasks_jsonrpc 的 paused_manual_run_is_allowed_and_does_not_shift_schedule_anchor 发生 stack overflow。上述 command group 拆分后，本机未设置 RUST_MIN_STACK，原始 7 项 public JSON-RPC 场景全部通过（含暂停手动运行/调度锚点/显式模型路由/通知）。直接请求 future 3208 字节、定时任务入口 33408 字节的类型诊断只用于排查，未作为产品通过证据。最终远端完整 Rust 仍需通过。
- 远端 39951976493 真实 GUI Smoke 通过，前端批次 31/148 的启动页测试受继承 URL nativeStartup 状态影响：beforeEach 显式恢复 /，afterEach 恢复 spies，保留超时与原生启动页断言；两文件 6/6 通过。

- 本地批次 83 的 HTML 限制测试将 6 个大输入放在同一 5 秒用例，本机并行 Rust 换页时聚合超时；迁移为逐输入具名参数化，不减少断言或延长单项 timeout。该文件 58/58、批次 83 的 384/384 通过。批次 84 的五语言导航仍写死 20 项，改为覆盖全部 current sections 并校验分组顺序、唯一项和所有 settings.* key 均已翻译；8/8、整批 114/114 通过。完整 typecheck、contracts、定向 ESLint 再次通过。Git/worktree 公共 JSON-RPC 定向回归正在等待外部 Cargo 锁，最终远端完整 Rust 未计通过。

## 发布守卫与恢复流验证收口

- 远端 39955087389 的真实 GUI Smoke、Integrity 与 Windows Shell Runtime 通过；Rust Full 尚在运行。前端批次 34 的旧聚合守卫仍要求内联 renderer/host 路径：迁移为 aggregate 对 electron-fixture-build 唯一 owner 的委托和 build-ready 接线守卫，保留 fixture 清单、删除项负向检查与顺序。共享 owner 的文件完整性、新鲜度和构建行为继续由原有 helper 测试覆盖；8 文件 123 项通过。
- 本地与 CI 测试排序不同，按文件比较已执行清单，补跑原先跳过但 CI 尚未覆盖的 7 份脚本测试，均包含在上述通过集合中；不按相同批次号推定同一测试范围。
- 本地续跑批次 110 暴露恢复绑定测试仍期待增量正文覆盖 item/completed 的 canonical 权威快照；补齐终态前流式 overlay 的等待断言，终态正文改为权威快照，保持 raw reasoning 隐藏、summary、Item identity/排序和监听清理断言。恢复/完成/reducer 3 文件 43 项通过，不改生产实现。
- 当前窄写集为两份测试和本计划/验证收据；后续并行 Browser 数据清理与模型输出配置不进入已冻结候选。共享 Rust target 曾受并行协议编译 metadata 污染，本地该次 worktree 回归编译失败不作候选缺陷或通过证据，最终以远端干净构建验证。
- 本地完整 typecheck/contracts 已在上一修复通过；本轮仅测试/证据迁移。继续本地续跑和最终远端完整矩阵，通过后创建 tag，再验证桌面、CLI/npm 与 updater 公开产物。


## 用户追加范围与最终候选 r8

- 用户明确要求“还有修改也合并到 v1.168.0 递交”，覆盖上一阶段暂缓后续并行改动的范围决定。以 41b03bbee 为基底，重新捕获并逐文件 SHA 校验全部 100 个当前产品、文档、协议、测试与新增源码文件，并补充中英文发布说明；不排除浏览数据清理或模型输出默认值。tsconfig.node.tsbuildinfo 继续按生成缓存排除。
- 新增浏览数据能力落在既有 BrowserTabHost/BrowserDataHost，history/downloads 委托原 owner，支持能力先整体校验，下载文件和 artifact 保留；五语、IPC/catalog、typed gateway、真实 Gate B fixture 与命令文档同步。未支持的原生时间范围/formData/siteSettings 明确拒绝，不把 fixture 定义当作真实验收。
- 输出默认值沿 core Config -> Thread 创建快照 -> settings/turn -> RuntimeCore/Agent policy，reasoning summary 按 canonical Thread settings 持久化；显式模型能力同步 registry、protocol/schema、client 和 frontend 类型。当前未新增 Configuration UI 控件，不声明整个设置路线图完成。serverRequest/resolved 通知同步消费与集成回归。
- 远端 39955087389/39958032534 的 Rust 原始 scheduled_task_crud_preview_run_and_history_use_public_jsonrpc 场景仍栈溢出。分发表改为同步构造 boxed future 后返回，释放构造临时值栈帧再轮询；四个借用 callback 的原分支留在 async 入口，避免扩大生命周期合同。两次中间编译失败已保留，当前修复尚待精确 Rust/最终远端验证，不计通过。root 确认 minor 架构影响，业务 owner、方法、参数及错误语义不变，architecture.md 与扫描守卫同步。
- 新候选完整 typecheck、完整 contracts、版本检查、44 个受管 TS/TSX/MJS 文件 ESLint、全部新增/修改 Rust 文件 rustfmt 均通过；16 文件 207 项定向测试与测试分层预算 38/38 通过。前端续跑 148 批状态完成，其中 116 passed/32 skipped；与 CI 按文件比对补验，不能把本地 skipped 宣称全部执行。最终远端仍必须全量通过。
- 远端 39958032534 的前端仅两处 metadata 旧预期失败，已补精确 canonical metadata 并包含在 207 项通过集合；GUI 因 Electron 二进制下载 fetch failed，属于获取依赖失败，最终候选重新跑真实 GUI。此前真实 GUI/Windows 通过作为历史证据，不替代本次候选门禁。
- 当前分类为 current 产品修复及 test-only 护栏迁移；不新增 compat/deprecated 或第二业务事实源。同步构造模块约 680 行，避免继续向巨大 async match 堆叠逻辑。以独立 Rust target 隔离并行 metadata，精确验证 scheduled_tasks/worktree/output_defaults 公共 JSON-RPC 后，由最终远端 Quality 覆盖全量与 GUI/Windows。
- 下一步：推送本候选，修复最终远端实际失败；Quality 全绿后创建 v1.168.0 标签，完成桌面、CLI/npm、updater 公开产物核验。未创建 tag，发布完成度不得记为 100%。


## r8 结果及模型策略唯一 owner 修复

- af6902eda 已推 main，提交前根工作树仅有生成缓存，用户追加范围完整纳入。随后新开始的 permissions 配置开发属于冻结之后的下一切片，仍由其原开发任务持有；不把正在形成的代码并入已验证候选，也不覆盖其工作树。
- 本任务独立 target 的原始 Cargo 精确回归退出0：output_defaults 2/2、scheduled_tasks 7/7、worktree_management 12/12，共21项，RUST_MIN_STACK 未设置。此前溢出场景通过；中间生命周期方案的两次编译失败已由最终修复结果取代。
- 39963848932 的 Integrity、Bridge/Contracts、真实 GUI smoke 已通过，Rust/Windows 仍运行；前端批次61暴露新输出能力在 registry capabilities 中手工映射，与既有策略唯一 owner 冲突。
- 当前窄写集：modelRegistry API/测试及两份 registry 类型、发布计划与验证收据。删除新加的 capabilities 重复字段，将 capabilitySnapshot 明确值传给 buildModelReasoningPolicy/buildModelReasoningOutputPolicy；无声明时默认 false/auto，支持和不支持模型都由原测试覆盖。不修改协议、Rust 或网络边界。既有 guard 保持原断言，迁移实现并同步输出策略回归。
- 后续按最终验证结果记录，不用前一候选通过代替最新前端全量；产品提交继续包含于 v1.168.0，发布标签尚未创建。

- r9 本地最终验证：完整 typecheck 退出0；模型目录/推理策略与全部相关模型边界守卫16文件74项通过；受管三文件 ESLint 通过。原治理守卫未放宽，模型显式支持/不支持行为与未声明时的安全默认均已断言。


## r10 Rust 输出能力 fixture 同步

- 39963848932 的 Rust Full 失败为 model_providers 的 typed capability 完整 JSON 断言未包含新增字段，同组2031项通过；不是栈溢出复发。生产转换已正确传递 supports_reasoning_summaries/support_verbosity，保留实现与完整对象断言。
- 窄写集仅原 model_providers 测试与发布证据。既有用例参数化缺省、显式false、显式true三种输入，同时检查所有既有 taxonomy/reasoning effort 字段，缺省严格false。文件785行，不再追加无关逻辑。rustfmt已通过，独立target定向App Server model_providers库测试运行中；完整typecheck沿用无TS变化的r9通过结果。
- 编辑测试时一次括号错误已在rustfmt阶段纠正，未进入候选；此前按旧源码启动的自有编译已明确终止并重新启动，不计验证通过。最终按退出码与实际测试结果记录。最新f27ff4054真实GUI smoke已通过，前端全量仍运行，Rust旧期望仍会由本修复取代。


## r11 user shell 输出完成竞态修复

- a6bb253d1 的远端39968794185：Frontend Full、真实GUI Smoke、Windows Shell Runtime、Integrity全部通过。Rust Full 的model capability fixture已通过，但 idle_shell_command_persists_a_standalone_turn_and_output 捕获事件只有turn.accepted/started、command.started/exited、turn.completed，缺command.output；同组2031通过。此前同一用例曾通过，不能以重跑消除竞态证据。
- 根因：poll_shell_process先排空output、再读取raw process terminal snapshot，异步collector此时可能尚未入库尾部stdout。现有ExecutionProcessServer::wait_for_exit已提供final_snapshot保证，因此只在runtime/session_shell复用该唯一owner：先读status，terminal时await collector完成，再按sequence排空所有有界batch，观察空批次后才发布command/Turn终态。无计时补丁、无放宽断言、无新完成状态副本。
- 窄写集为runtime/session_shell.rs及其独立tests.rs和发布证据，避让并行execution_process、permissions、protocol等热区。架构影响minor：既有UserShell -> ExecutionProcessServer -> tool-runtime监督链不变，仅纠正输出/终态顺序；责任root确认。模块约650行，不继续叠加其他业务。
- 新回归启动真实/bin/sh，经stdin精确释放子进程；在raw child已退出但collector尚未finish时断言poll仍Pending，再把真实stdout按129条合法sequence送入原store，finish后验证所有command.output和最终snapshot一致，覆盖128项分页边界。原3项真实Shell生命周期/持久化断言保持不变。完整App Server库定向扩大运行中，格式和diff检查已通过；最新TS沿用此前完整typecheck和远端Frontend Full通过结果。
- r10独立model_providers库16/16通过，默认RUST_MIN_STACK未设置。更新域名公开GET在本机连接超时，发布后需结合R2上传远端结果和可达环境补核验，不把上传成功冒充本机HTTP成功。


## r12 生命周期夹具前置条件与缓存丢失记录

- 本地r11库测试编译期间，整个.lime/release-v11680目录被移除，进程最终101，源码/target/日志均不再存在；该运行明确未完成，不能计通过。旧已通过结果有此前提交的收据，最终候选以干净GitHub runner为准；后续临时记录转移到仓库缓存目录外。未主动停止或清理其他任务。
- 39974008631 的Frontend Full、真实GUI Smoke、Integrity通过；Rust原有2032项全部通过，包括此前失败的idle Shell生命周期用例。新增受控回归在输出校验处被command_output_without_start拒绝：fixture缺少command.started。补齐既有turn.accepted/started与command.started helper载荷，保留Pending断言、129项分页与完整输出比较，生产修复不变。格式/diff检查通过，完整Rust验证继续由下一精确提交运行。
- 当前窄写集仅新增Shell回归文件与发布证据，冻结后的permissions/Browser引擎等下一切片继续留给其原开发任务。此前完整typecheck、最终前端/GUI/Windows结果按对应提交记录，不把本地丢失的未完成编译写成成功。
