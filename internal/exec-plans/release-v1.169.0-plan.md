# v1.169.0 发布执行计划

状态：原 v1.169.0 标签发布成功；本轮修复与全部增量已通过最终本地门禁，交付方式为追加 main，不改写已发布标签；负责人：root；更新日期：2026-10-25。

## 目标与候选

- 用户要求发布 v1.169.0。基底为 main/v1.168.0：`c8364fd81cd3c4ad83a3644a24b47387bfac7022`；开始时远端 main 一致，目标标签本地与远端均不存在。
- 初始工作区 957 项：538 修改、261 删除、158 未跟踪路径。按发布规则全部作为候选，包括产品、测试、文档、脚本、schema、生成客户端、依赖锁及五语言资源；不默认丢弃既有修改。
- 本轮窄写集：package.json、packages/cli/package.json、lime-rs/Cargo.toml、lime-rs/Cargo.lock、RELEASE_NOTES.md、RELEASE_NOTES.en.md、本计划。其余候选先只读审阅及验证，必要修复另行记录。
- pnpm-lock.yaml 无应用显式版本，保留候选已有依赖变更；Forge 从 package.json 读取版本，App Server crate 使用 workspace 版本。不新增重复版本事实源。
- 完整候选文件清单和验证日志保存在 `.lime/release-v11690/`，提交前复核候选内容与远端引用。用户后续明确要求“完成发布,不要找我确认”，已授权本版必要修复、提交、标签和推送，不再重复请求确认。

## 范围、架构与分类

- current：浏览器设备/批注/历史/权限、配置层与受管约束、推理默认值、归档清理、工具运行环境与搜索访问策略。主链仍为 Desktop/CLI → App Server JSON-RPC → RuntimeCore → canonical Thread/Turn/Item。
- dead/deleted：独立知识库、资源管理窗口、旧统计/开发实验设置、创作上下文拼接等候选已删除入口及专用实现；不恢复兼容包装。compat/deprecated：本轮不新增。
- 架构确认：候选已有边界与 owner 变更见 internal/aiprompts/architecture.md 及浏览器领域计划中的责任开发者确认；本轮仅同步发布 metadata，不新增运行时、配置或协议 authority。
- KISS/DRY：复用既有版本事实源及发布链，不引入脚本、依赖升级、分支或第二套产品实现。发布成功不等于完整 Codex GUI/原生浏览器专项验收完成。

## 门禁与退出条件

- 必须：verify:app-version、完整 typecheck、test:contracts。
- 风险匹配：受影响 Rust owner 单元与公共 JSON-RPC 集成、Agent current fixture、真实 Electron GUI smoke；删除项补 legacy guard。
- 不默认启动裸 lint、裸 npm test 或全 workspace cargo test；按实际失败扩大验证。
- 提交前列明实际候选、排除项、验证与限制；按用户明确授权连续完成提交、标签、main/tag 推送并复核远端，不重复确认。
- 完成以远端 main/tag 和 Release 工作流/产物实际状态为准；未执行、失败或缺失证据必须明确记录。

## 验证结果

- verify:app-version exit0；完整 test:contracts exit0（含协议生成无漂移、命令/脚本/Forge/CLI/桌面边界与文档守卫）。legacy report exit0、边界违规0；仍有一个既有零引用分类候选，不属于违规。
- Agent current fixture 前四组 31+34+3+303 项通过；真实 Electron 子场景等待外部任务持有的 fixture build lock，尚未结算 Gate B。
- 48文件前端定向回归运行中；高内存压力下多项超过默认5秒，需要在负载收敛后逐项复核，不修改断言或放宽超时。
- 初轮 Rust 三owner单元入口正在编译时，本机内存压力导致多个前端超时；已仅停止本轮启动的 cargo 及其子进程（PID77792进程树），保留完整日志、不计通过，待降低并发重跑。不终止其他任务/用户进程。
- 完整 npm run typecheck exit0。首轮前端43文件693项通过，另5条超时、导航fixture缺字段6条失败，并误收集4份内部冻结源码。仅补导航fixture现行permissionContext，smoke配置排除同标准入口的internal/exec-plans/artifacts；复跑6文件164项通过，仅配置首场景再次超时，单独原时限复跑1项通过。没有放宽timeout或删减行为断言。
- 发布修复追加写集仅 scripts/lib/vitest-smoke-runner.mjs 与 BrowserSettingsNavigation.component.test.tsx。暂存候选978文件，38443插入/79530删除；排除本地生成缓存tsconfig.node.tsbuildinfo。
- 暂存后其他任务继续修改浏览器受管权限相关文件；它们保留在原工作树，属于冻结之后的未验收增量，当前提交只消费已冻结index，避免把进行中的修改直接带入标签。未覆盖或回滚这些修改。
- staged diff检查仅报告Electron原生候选patch的必需context空白及两份上游模块的EOF空行，保留原件；其余源文件无空白错误。原生patch未编译、未接入产品，不能算原生能力完成。
- 本地GUI/current fixture仍受构建锁与本机负载影响；协议Rust单并发入口等待其他任务的Cargo锁，尚未通过。硬门禁完成后先推main，使用同提交Quality完成远端矩阵，再创建唯一v1.169.0标签；不以本地历史binary替代候选证据。

## CI失败与继续授权

- 首候选8c206ff12已推main；Quality 40085305035：Integrity与Contracts通过；Frontend Full失败于mediaTargets测试4个unused；GUI Smoke失败于BrowserUseRequirements等生成客户端缺失；Rust Full在app-server 2032通过后因旧non-strict权限预期失败。v1.169.0标签未创建，未启动正式Release。
- 本地协议149项中146通过、3个schema导出测试失败，registry比类型清单多5项。正式GUI与Agent fixture均因构建期间并行源码变化而被输入摘要守卫拒绝，不算Gate B。
- 用户暂停后要求“修复并继续”；沿用此前完整发布授权，不重复请求提交/标签/推送确认。当前goal继续完成本版发布。
- 窄修复写集：mediaTargets.integration.test.tsx删除4个unused且保留focused断言；permission_profile.rs迁移旧测试到现行受限profile必须有sandbox backend合同；protocol/v2/schema_types.rs补齐5个已注册类型；本计划。并行浏览器受管配置与gallery退役增量先只读核对，不覆盖他人修改。
- 后续候选必须同时覆盖Rust类型/registry、导出schema、生成客户端和实际构建后的客户端类型。完整typecheck及Electron typecheck均对最终候选重新验证，不再以构建产物中残留的新类型证明已提交源码一致。
- 用户追加明确要求“全部修改的都要递交,追加到v1.169.0”；后继候选覆盖当前全部tracked/untracked修改（含浏览器受管配置、gallery退役、原生engine preflight及生成缓存），取代此前冻结后排除项。标签仍未创建，无需重打或改写远端引用。
- 共享生成物由本轮统一收口：在原仓库以current Rust exporter重新导出schema，保留浏览器新增合同并同时移除gallery已退役合同，再走唯一TS生成器及client build；不手工拼接生成物，不在验证副本开发或事后回写。
- mediaTargets定向ESLint exit0及完整52项交互回归exit0；两个Rust修复文件rustfmt check通过。完整lint运行约13分钟后仍无结果，本机进程持续处于换页U状态；只停止本轮full lint子进程PID15578以优先保留硬门禁typecheck和schema生成，未计作通过。完整lint后续由冻结提交的远端Frontend Full执行，不降低max-warnings或断言。
- 追加后完整npm run typecheck exit0；protocol单元149/149通过。首轮Rust exporter exit0但期间新增projectMaterial退役修改，TS生成器严格拒绝8条manifest/constant漂移；未绕过检查。以最新源重新导出exit0（48.94秒），115个协议源码输入无漂移，bundle中GalleryMaterial/ProjectMaterial均已移除；最终TS生成1066类型、失败0、exit0。permission_profile定向入口仍在运行，未计通过。
- 后继验证只消费完整暂存tree的只读快照，产品修改始终在原目录。本地生成后的包build/Electron类型/contracts对同一候选执行；远端最终同SHA Quality补完整lint、Rust、GUI和前端矩阵。
- 暂存tree `bc25361dda4ff6693c8b3302ad7f45bce775623b` 的只读验证快照：app-server-client build、typecheck:electron、完整test:contracts均exit0；日志在`.lime/release-v11690/frozen-*.log`。快照之后新增的browser-runtime-electron-gate-b-thread.mjs及其调用接线按用户全部递交要求纳入，两个脚本node --check通过；没有在验证目录开发或回写产品代码。
- 追加候选包含首轮CI三个失败修复、浏览器受管权限、图库与独立素材完整退役、同步schema/客户端、原生engine preflight及浏览器验收脚本。Rust权限测试本机仍等待编译，不以等待视为通过；最终提交由远端Quality补齐。
- 全部149文件追加为`69349ccad8d36465a1f62eeed4a13435ae0890be`并推main，提交后工作区干净。Quality 40089359988的Integrity、Bridge & Contracts、完整lint与typecheck通过；Frontend Full后续被分层预算39>38阻断，未进入全量Vitest。标签仍未创建。
- 修复分层：ThreadSummaryPanel的纯投影与布局断言迁到threadSummary.unit.test.ts，组件保留实际DOM/动作/多语言回归；公共测试过滤器排除internal/exec-plans/artifacts冻结副本，并补现役文件保留回归。预算上限未修改，现为38/38；六文件57项通过，定向ESLint exit0。Browser engine preflight以Vitest正确入口4/4通过，最初误用node --test的启动错误不计作产品失败。
- 本机Rust permission_profile定向最终exit0、14/14通过（编译34m28s）。其他任务追加的turn权限五语言文案、回合测试与Gate B identity修正一并纳入；对应浏览器权限测试包含在上述57项中。本轮继续以最终SHA远端矩阵收口。
- 第二轮修复`e77264aa4ac99405e40047541562134b6b1b61db`已推main；完整typecheck再次exit0。Quality 40090103916已通过lint/typecheck/分层预算并进入全量前端，Rust与GUI运行中；上一轮69349ccad的GUI Smoke通过。
- 等待期间新增项目persona/publish配置零消费者链删除（core DAO/model/error、services、schema与治理守卫），按用户全部递交要求继续纳入。只读核对删除模块无现役引用；治理228/228通过，协议生成无漂移；core schema定向测试及完整contracts运行中。发布说明中英同步说明新库停止建旧表、存量数据保留。
- 上述退役候选完整contracts exit0；core database::schema 6/6通过，涵盖新库不建旧表与存量行保留。聊天/浏览器夹具两文件201/201通过，完整typecheck exit0。Quality 40090103916的全量前端首批在useAgentChat出现11条turn identity旧夹具失败；与待提交acceptedTurn/completedTurn及显式pending submission修复完全对应，未放宽生产身份校验。
- 全部24文件提交`29962562d121d42e9bb57fd55d8c4e5c97724340`已推main；current-rules guard同步产品减负保留项并11/11通过。Quality 40090879485：Integrity、lint、typecheck、分层预算、GUI Smoke通过；Frontend Full在Linux因engine preflight路径拒绝测试使用不支持的默认target而失败，已改成显式有效target，4/4通过。
- 69349ccad的Windows Shell Runtime全部通过；Rust Full在lime-agent 310通过后因旧断言“审批时不强制沙箱”失败。仅迁移agent execution测试到现行审批与沙箱同时保留的合同，33/33执行/网络/沙箱定向回归exit0、rustfmt check通过，生产安全策略未修改。
- 本地全量前端复用已有前44批通过记录，复制独立续跑状态`.lime/release-v11690/vitest-smart-resume.json`，不覆盖其他进程状态。第45批设置Gate A清单漂移已由并行任务同步；第48批的registerHooks启动错误来自本机Node23.4，使用临时Node22.23.4后通过，不修改全局Node或测试断言。
- 后续集中修复：语言加载测试迁移已退役taskSync键到现役generated状态；Codex方法矩阵把真实configRequirements/read分类为implemented、同步统计及当前证据，去掉已删除实验设置证据；侧栏预期移除已退役项目资料；删除读取知识库dead文件的旧边界用例，保留现役session DTO守卫。
- 第78批发现真实预览文案回归：PreviewArtifactFallbackSurface仍消费已删除resourceManager键。迁到artifactRenderer.previewFallback current owner，五语迁移原翻译；新增可见DOM回归5/5通过，原3条ArtifactRenderer UI失败已在续跑中通过，定向lint exit0。初新增测试误用未安装testing-library，已改用仓库现役React createRoot挂载，不新增依赖。
- 浏览器权限select文字与原生箭头重叠修复及字体测量由并行任务补齐，设置偏好/企业权限定向通过、完整typecheck exit0。新增local-environments完整功能正在由并行任务接线，用户全部修改授权覆盖该增量；本轮只读核对，不夹写该功能。待其schema/client/GUI接线完成后对最终候选补contracts/typecheck/版本检查及同SHA远端矩阵。
- 当前本地续跑已通过第96批（总数随新增测试追加），未把未跑批次或旧SHA结果记为最终候选全绿；v1.169.0标签仍不存在，正式Release尚未启动。
- 继续续跑已通过125批；126批两个旧夹具失败：快捷键config/read缺唯一user层来源，浏览器导航hook缺isManaged。仅补现役合同，16文件208项全部通过；原审批、键位保存、焦点与导航阻断断言保留。
- 29962562d的Windows Shell Runtime最终success，Rust Full日志已核对仍为相同旧backend_enforced断言（310通过/1失败），对应本轮33/33修复。最新完整contracts、client build、Electron typecheck均exit0；local-environments/CDP五文件61项通过。
- 当前完整typecheck发现LocalEnvironmentEditor.tsx两处可选revision写入string|null状态（73/111行），登记为并行owner接线阻塞，尚未计通过。直接cargo命令未带仓库V8 artifact resolver而下载默认上游404，改用现役test:rust:integration wrapper重试，不修改V8依赖或沙箱配置。
- LocalEnvironmentEditor两处revision已由并行owner归一为null，完整typecheck重跑中。仓库integration wrapper的--tests会扩大编译全部集成目标，已只停止本轮cargo PID40792及其子进程，改为同一resolveRustyV8CargoEnv加精确--test入口；公共local-environments JSON-RPC 2/2通过，覆盖文件持久化、重启、冲突保稿、非法参数拒绝且配置读写不执行脚本。
- 最新GUI smoke在Renderer编译成功后被输入摘要变化守卫拒绝（并行接线期间），不计Gate B；最终冻结SHA以远端GUI/发布打包Gate B验证。44个受影响产品/脚本TS文件ESLint exit0；额外SDK lint命中既有class/interface declaration merging规则，不改变既有客户端结构或禁用规则，正式lint范围保持package.json的src。
- 本地独立续跑状态最终passed，152/152批全部通过（此前已通过批次按原状态保留，增量另有定向回归）；完整npm run typecheck第二轮exit0，分层预算38/38通过。CDP后续新增拒绝用例已由最后一批覆盖36+3项。继续纳入用户授权的全部131个tracked/untracked候选文件，最终同SHA远端Full矩阵仍是冻结发布依据。
- 全部131文件提交fceb379b17aad3412149344f26392a8491f95205并推main，Quality 40093701124启动。其tree 6c55d7bfe946的只读快照client build/Electron types/完整contracts均exit0。远端完整lint成功，但typecheck被并行新增LocalEnvironmentDetails中SettingsValueMenu缺必填disabled阻断；本地typecheck开始时间早于该文件进入暂存，不能证明冻结后的完整输入。源码已由owner补disabled=false，新增详情/编辑/i18n四文件28项通过；下一轮冻结后必须再跑完整typecheck。
- 提交后平台能力dead模块删除及Local Environment执行/Worktree lifecycle接线继续新增；用户全部递交授权覆盖增量，继续等schema、消费者及定向验证收口后纳入同版，标签仍不存在。
- fceb379b1远端GUI Smoke最终success；本地新增环境边界守卫1/1、详情/编辑/i18n28/28、定向lint通过。当前下一候选同步LocalEnvironmentScriptResult/Status与Worktree配置选择schema/client，以及request cancellation和生命周期接线；冻结后完整typecheck/contracts为提交硬门禁，执行行为继续由定向Rust与最终同SHAFull验证。
- tree 5f49f164d556与后继1bd0fd2c8fc3均完成冻结后的完整typecheck、Electron types、client build及完整contracts，全部exit0，协议1083类型生成无漂移。后继候选补环境文件重名处理，4文件27项通过；配置/Worktree公共回归2+12项通过。新增命令取消响应的json宏缺导入编译错误已由owner修复，command_exec与环境脚本公开回归继续运行，不计等待为通过。
- fceb379b1的Windows Shell Runtime最终success；Rust Full仍在运行。冻结后追加仅Rust配置保存修复、CDP fixture终态断言与发布记录，不涉及已验证TS输入；继续递交所有后续候选，不提前创建标签。
- 后继52文件已提交eef36b82629580d5e1fafc6b819629e99eebc76f并推main，Quality 40095080616启动。提交后本地生命周期测试又有新增fixture修改，当前编译报common_config未定义（local_environment_lifecycle_jsonrpc.rs:166）；该断言属于提交后的未暂存增量，不能算eef36b826本身的编译结果。本轮继续避让该活跃文件，待fixture修正和同目标实际通过后收口全部后续改动。
- fceb379b1的Rust Full最终success；eef36b826已通过远端lint/typecheck/38预算并进入全量Vitest。新增common_config基线变量及Git工作树配置夹具已由owner修正；command/exec取消循环保留同一个pending next_event，避免轮询丢失退出事件。实际真实stdio/PTY命令2/2、环境脚本生命周期5/5全部exit0，涵盖平台setup、失败恢复、明确none、权限拒绝、setup/cleanup取消与重试；没有修改断言或放宽沙箱。
- Browser CDP专项冻结产品实测Gate B 72/72通过（五个GUI turn、20个runtime/provider请求，mock/console/page error均0），主页面执行切片成立；不扩大为完整CDP/WebMCP、live provider或跨平台打包证据。最后候选仅收上述窄修复、Rust格式与实际证据记录，TS输入与已完整验证的1bd0fd2c8fc3保持一致。
- 最终增量完整contracts exit0、版本一致性1.169.0、四个Rust改动文件rustfmt check exit0；相对1bd0fd2c8fc3的TS/TSX/package/tsconfig差异为空，沿用该冻结输入的完整typecheck与Electron类型通过结果。eef36b826的GUI Smoke最终success。将全部十文件窄修复及文档记录追加递交，随后以最终SHA Quality和Release产物验收收口。
- 十文件已提交cb7555162bcfeecf86f65fe5a9f06c5c5428c114并推main，Quality 40096112486启动；commit首试遇到其它Git进程的短暂index.lock，锁自行释放后正常提交，未删锁或终止他人进程。eef36b826的Windows失败已读取原始日志：windows_timeout_returns_canonical_exit_code得到-1而非124，对应本轮已修复的pending next_event取消安全问题；cb7555162由Windows矩阵复核，本地追加command_exec单元回归。
- 后续仅新增Local Environments真实fixture失败截图采集，不改变产品或场景断言，node --check通过；按全部修改授权一并追加。生产TS输入仍与完整验证的冻结tree一致，保持最终提交远端门禁和发布产物验证。

## 已推标签后的错误修复与全部递交

- 用户此前改为“推送之前的就可以了”，已将远端 `v1.169.0` 固定于 `8e7f654f48049c703b514ca02a9f8aa4679f6148`。最新“有报错,修复并递交所有”授权修复并递交全部当前候选；尚未改写已推送标签。
- Release `40098068034`：arm64 macOS、Windows 构建成功；x64 macOS 三次失败均为 Apple notary 提交后的状态查询 `NSURLErrorDomain Code=-1001` 超时。已启动原失败任务重试；draft Release 尚无 assets，不记为发布成功。
- Quality `40096607479`：完整前端、GUI smoke 成功；Rust 38/39 的 standalone fork Gemini 用例在删除源临时目录时出现 DirectoryNotEmpty。前一产品 SHA `cb7555162` 的 Quality `40096112486` 全部成功，命令取消修复已获 Windows/Rust 证明。
- 本轮窄写集：macos-notarization 实现/回归、thread_fork_jsonrpc/standalone.rs 的停机边界、本计划和发布说明。Browser CDP/session 与 workspace 环境选择及 watcher 启动修复的并行写集先只读验收，不覆盖已有实现。所有修改最终统一暂存，冻结后重跑完整 typecheck/Electron types/contracts，追加受影响单测、Rust standalone 与 GUI smoke；等待不计通过。
- 修复原则：复用当前 transport 的真实 shutdown，保证复制前 flush、源目录彻底删除，保留“无源 DB/EventLog/sidecar/session”断言；Apple 超时恢复只允许继续同一 submission，保留 Accepted、staple 与 validate 门禁，不扩大失败容忍。
- 首个冻结 tree `0ea5730ec4bf9283232f52e6c75d17ec0fcc81ac` 的 client build、完整 typecheck、Electron types、完整 contracts 全部 exit0。当前改动 22 个测试文件 269 项通过；standalone fork 公开集成 39/39 通过，源文件复制前走真实 transport shutdown 并保留完整删除断言。版本一致性与 Rust 格式通过。
- 原目录 GUI smoke exit0，摘要 `.lime/qc/project-gates/standalone-shell-01-20261024144658-66256/shell-01-electron-smoke/summary.json`：真实启动/重载、preload/IPC、App Server、三尺寸与设置路由通过，mock 为零；不扩展为 provider/live/打包证明。
- 追加修复侧栏新增测试缺失 MouseEvent 类型导入；后续 CDP 测试使用超出 ES2022 的 Promise.withResolvers 导致真实配置 fixture 在编译阶段失败，已改普通 Promise 的窄辅助函数，未更改目标 lib 或断言。新增/更新 CDP 两文件 62/62 通过；fixture 将重跑。后继 Browser frame/session 及失败清理补丁继续按“全部递交”纳入最终冻结与类型检查，不以首快照代替增量验收。
- 第二冻结 tree `0d90af923939fb75536513e4c524af94b1193d41` 的 client build、完整 typecheck、Electron types、完整 contracts 均 exit0；当前改动22文件286项回归全部通过，范围ESLint/max-warnings0通过，watcher 13/13通过。后继新增仅docs与测试驱动，生产TS输入保持该冻结集合。
- 本地环境真实 Electron config r2 exit0、21/21：GUI保存后Host选择、冷恢复、版本冲突保稿、正常Main退出、两尺寸布局与真实IPC通过，mock/console/page错误0；摘要 `.lime/qc/project-gates/standalone-settings-appearance-20261024T145133491Z-75123/settings-appearance-persistence/summary.json`。
- 工作树Gate B逐层暴露旧驱动：installed_skill独立发送路由已退役，迁移为精确canonical name/path/label/mention，保留所有草稿/图片/隐藏paste/marks身份校验；三个证据回归81/81通过。演示文稿两个夹具同步同一Skill语义，正确Vitest入口14/14通过；初误用node --test的TS模块加载失败不计产品失败。并行owner已完成这组脚本迁移，本轮只读验收。
- 工作树下一失败为驱动把 Thread.projectId 当作 Workspace ID；现役 projectId是project目录分组，thread/start以canonical cwd创建。窄修复复用workspace/byPath/read按线程cwd解析Workspace，仍校验公开创建顺序、真实Git、GUI Workspace/cwd、Thread/Turn/provider身份及冷恢复，且要求本夹具未主动分配项目目录（projectId=null）。不为旧夹具把Workspace ID写入另一领域。该驱动及其证据单测纳入本轮写集，真实Gate B待终态。
- 第三冻结 tree `312cc727c72d8662d2f39ad33a8633e277297577` 的 client build、完整 typecheck、Electron types、contracts 全部 exit0；随后新增导航与并行工具展示改动，须对最终输入继续冻结复验。
- 工作树 Gate B 揭示两处 current GUI 接线缺陷：暂存源混用 execution workspace 与源目录；接受回执后仅排队切换草稿，而草稿 promotion 推进 epoch 后队列失效，新聊天页状态未退出。分别改为可见源工作区/目录成对使用，以及复用现役 TaskCenter draft-state owner 提交接受终态；不放宽 receipt、workspace ABA 或取消校验。对应回归先红，修复后三文件28/28通过；目标surface恰好epoch+1的精确接受回归同组保留。
- 原目录 GUI smoke 再次 exit0，24项通过，证据 `.lime/qc/project-gates/standalone-shell-01-20261024152934-57252/shell-01-electron-smoke/summary.json`。Agent current fixture 的 unknown Item恢复、首页首发与短问候通过；编码工作台全部业务断言通过，但同期构建产物变化触发 `artifactInputsStable=false`，聚合 exit1，不能计为完整通过，待构建稳定后续验。
- 原标签 Release `40098068034` 的 macOS x64重试成功，三桌面构建、GitHub桌面产物发布与Cloudflare R2更新源均success；GitHub Release已公开且有9项assets，CLI四平台与root npm仍待终态。该发布仍固定旧SHA `8e7f654f4`，不包含本轮未提交增量。
- tree `9311885719bd63264b3e4820e378512c8b977233` 冻结后的 client build、完整 typecheck、Electron types、完整 contracts 全部 exit0；新增导航/工具展示/关于页19文件209项回归通过，全暂存TS/脚本范围ESLint exit0。后续仅导航结算两个TS文件与夹具脚本/记录增量，另冻结复验。
- 工作树r8继续证明：提前defer到目标工作区会在root Composer完成promotion前触发新Home绑定，导致后续接受处理因epoch变化失效。最终将实际工作区导航归到现役root `handleComposerDraftAccepted` 的promotion完成之后，检查同一capture generation、精确目标workspace/session与epoch+1；不再强制重新hydration已经接受的会话。对新草稿的迟到接受不切页、不覆盖输入，新增回归通过。此前仅清理Home状态的中间修复未关闭实测，不计成功证据。

- 后继冻结 `c3f92af691be` 的完整 typecheck 发现 root 接受回执包含 queue/runtime 两类以及 nullable target；已在现役 wrapper 增加 runtime-accepted 与 target 存在的类型/语义收窄，未放宽导航身份检查。Worktree 三文件29/29通过，Renderer 构建通过；最终输入冻结 `e6b6649d7e2a786122ddb94ef822e61f1127cc7d` 再跑硬门禁。
- Agent 聚合第二轮已通过首页、编码、图片、取消继续、审批、富草稿恢复、steer 与 Plan 场景，但 Skills 场景真实失败：空根按需 watcher 配合 session_skill_roots 的旧 Project-only 过滤遗漏用户目录。新增公开 thread/resume 监听范围回归先红，现改为注册已加载线程的完整有效根；保留懒启动，不恢复全局扫描，不另造 catalog 监听 owner。完整 watcher 与真实 Skills fixture 待终态。
- 旧标签 Release `40098068034` 已全部 success，包括三桌面平台、GitHub九项assets、R2 updater、CLI四平台与root npm发布。发布仍指向 `8e7f654f4`；本轮修复只追加 main，不重写远端标签，不宣称已随旧tag发布。
- 冻结 `e6b6649d7e2a` 的 client build、完整 typecheck、Electron types、contracts 均 exit0；新增浏览器展示6文件85/85回归、全候选范围ESLint通过；watcher完整13/13通过。最终GUI smoke exit0，目录 `.lime/qc/project-gates/standalone-shell-01-20261024155937-25685`。
- 后继并行新增Git status工作树配置作用域与会话环境Actions/终端接线，按全部递交授权继续纳入。macOS真实构建检测到 `LocalConversationActions.tsx` 与 `localConversationActions.ts` 的大小写模块解析冲突；仅将纯工具函数改名 `localConversationActionHelpers.ts` 并同步五处消费者/测试，避免同基名不同扩展名的case冲突。终端与Actions三个文件38/38通过，后继协议生成与真实场景待收口。
- 最终Skills真实Electron r3通过：skills/changed到GUI catalog自动刷新（用户交互0）、自然语言/显式Skill/面板启用三入口、同一canonical thread读回、正常Main退出均通过，mock/page/console错误为0。证据 `.lime/qc/gui-evidence/claw-chat-current-fixture/release-v11690-skills-watcher-repair-r3-summary.json`。Git status工作树作用域2/2、动作接线30/30、event-bus/command/CDP三文件41/41通过。
- Worktree r11/r12仍失败，继续真实定位而未放宽断言：promotion发生version_conflict；r14只读诊断证明发送后EditorView的迟到事务仅修改selectionStart/End，却推进了已捕获版本。新增真实EditorView禁用后迟到选区回归先红（revision2变3），修复在ComposerEditor的dispatchTransaction入口拒绝disabled时的View事务；Controller显式更新仍允许，存储CAS与新编辑保护不变。编辑器、代码块、草稿、停止恢复、导航五文件86/86通过；临时诊断日志已全部移除，真实Gate B待重跑。
- 冻结 `60798ce717ff` 的client build、完整typecheck、Electron types、完整contracts均exit0，五语言资源检查通过。后继新TS/SDK与编辑器修复将再次冻结验证；MCP structuredContent与media-reference真实场景通过，后继专家入口构建被同期输入变化守卫拒绝，将从未通过场景续验。
- 后继冻结 `ea54ba8249097700374af222ab1bd925f4da2fc4`（r8）及最终产品输入冻结 `903a573dd82ae79d56d7735efb74d0168452eb67`（r9）的 client build、完整 typecheck、Electron types、完整 contracts 均 exit0；r9 日志为 `.lime/release-v11690/repair-frozen-r9-{client,typecheck,electron,contracts}.log`。125 个候选 TS/TSX/MJS 文件范围 ESLint/max-warnings0 通过，版本一致性为 1.169.0。
- Agent 从失败点续验：专家广场 Skills、专家面板 Skills、typed-error 重试成功/失败、文章工作区五场景全部 exit0，加上前序 MCP structuredContent、media-reference 与已通过的首页/编码/图片/取消/审批/恢复/steer/Plan 场景，已列场景全部完成。记录 `.lime/release-v11690/repair-agent-remaining-scenarios-r2.log`；没有宣称单次聚合入口全绿，也不扩大为 live provider 或跨平台打包证明。
- 工作树 r15 已证明 accepted session、唯一用户消息与输入恢复；旧驱动只从 Home 工具条读工作区，导致进入会话后的观测为空。现将会话工具条的真实 workspaceId/root props 暴露为 DOM 投影，场景要求唯一可见工具条并精确核对身份；工具条/场景组件 27/27 通过。r16 已通过同 capture accepted-target promotion 与 source 消费，后续发现 Git 驱动仍用 `git config --worktree` 读取未启用 shared extension 的配置；改成与 current Rust owner 相同的 `git rev-parse --git-path config.worktree` 加 `git config --file`，真实临时 detached worktree 回归 7/7 通过。完整工作树 Gate B 仍须新 run-id 重跑，不以中间阶段替代终态。
- 最后 GUI 源码构建曾受到并行旧冻结树共用 Cargo target 的 metadata 影响，报 ProjectGitStatus 两字段缺失；原目录 current struct 与 projection 均已具备字段且 Git status 2/2 通过。只触碰 current services 源文件时间以重新编译，未更改内容、清理 target 或删除构建锁；最终 GUI 重验正在运行，等待不计通过。
- 上述最终原目录 `npm run verify:gui-smoke` 重验 exit0、24/24：`.lime/qc/project-gates/standalone-shell-01-20261024164909-40534/shell-01-electron-smoke/summary.json`。真实 Electron 启动/重载、preload/IPC/current App Server、设置与三尺寸布局均通过，mock/console/page/IPC 错误为零；未冒称 live provider 或当前候选跨平台包已验。
- 工作树 r17 的首发、一次 create/thread/start/turn/start（双击 Send）、真实 setup/config.worktree、完整富输入/媒体字节、source consume、新草稿编辑及第一次正常退出均通过；冷恢复被共享旧驱动阻断：`openSessionFromSidebar` 忽略已传入的 sessionId，仅按 title 文本寻找按钮，而首次发送没有 fixture 人造标题。改为唯一精确 `data-session-id` 的侧栏行，保留 canonical Thread/read 与可见同会话编辑器检查，删除标题/通用按钮启发式。JSDOM 回归先红后绿，覆盖缺标题、标题变化及同名外来会话；证据回归 8/8 与两文件范围 lint 通过。新 r18 正在完整复验，不将 r17 中间阶段计作最终 Gate B。
- r9 冻结后第一轮核对的增量仅执行记录与测试驱动/证据测试；随后新增 AppSidebar 两份测试/fixture 的现役环境选择合同迁移，全部纳入后继冻结并再次验证。产品 owner 未在验证副本开发或回写。
- 工作树 r18 完整 exit0，摘要 `.lime/release-v11690/worktree-gate-b/release-v11690-worktree-repair-20261025-r18/composer-worktree-first-send-gui.json`：真实 Electron/preload/IPC/current JSON-RPC、双击只建一份工作树与 canonical Thread/Turn、setup/config.worktree、完整富输入和媒体字节、接受导航/source consume、新编辑保存、真实 interrupted terminal、冷恢复不重建/不重发，以及两次正常 Main quit 全部通过。源/产物稳定性与精确身份检查保留；受控 provider 证据不冒称 live provider、OS 剪贴板/拖放或跨平台包验收。
- 最终完整候选冻结 tree `4714f580050cbd1222202834055868282cef2fb7`（160 文件）完成 client build、完整 typecheck、Electron types、完整 contracts，全部 exit0，日志 `repair-frozen-r10-{client,typecheck,electron,contracts}.log`。侧栏环境选择合同增量 48/48 通过，新增三文件范围 ESLint/max-warnings0 通过，staged/unstaged diff 空白检查通过。此后仅更新本执行记录，未变更已验证产品或测试输入。
- 全部候选按用户授权提交至 main，保留全部 tracked/untracked 产品、协议/schema/生成客户端、脚本、五语言、测试、架构与执行记录，无主动排除项。中英发布说明保留 1.169.0 单页，版本事实源未再次变化；原标签仍为 `8e7f654f48049c703b514ca02a9f8aa4679f6148`，本次修复不宣称已进入旧标签产物。当前分类为既有 owner 内修复/接线，测试驱动与证据为 test-only，本轮不新增 compat/deprecated 或恢复 dead 路径。
- 本轮修复、对应本地验证与全部候选整理完成度 100%；新 SHA 的远端 Quality 与当前增量跨平台打包结果须按实际运行状态另报，不借旧标签发布成功替代。
