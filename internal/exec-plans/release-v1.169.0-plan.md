# v1.169.0 发布执行计划

状态：首候选CI失败已修复，全部增量准备追加main并执行同SHA远端门禁，目标标签尚未创建；负责人：root；日期：2026-10-24。

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
