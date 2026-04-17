# LimeNext 总实施计划

> 状态：进行中  
> 更新时间：2026-04-18  
> 上位总纲：`docs/roadmap/limenext/`  
> 目标：把 LimeNext 从“上位平台定义”推进到“可持续实施的主线计划”，统一产品对象、运行时骨架、远程入口、长时执行、证据治理与场景选品的推进顺序。

## 1. 先给结论

LimeNext 当前不是缺一篇愿景文档，而是缺一条能持续推进的平台主线。

本计划固定一个判断：

**后续提到“推进 LimeNext”，默认不是泛泛优化平台，而是沿着 `产品对象 -> 业务装配 -> 运行时骨架 -> 长时执行与远程 -> 证据治理 -> 场景选品` 这条主线推进。**

## 2. 当前基线

已经完成：

1. `docs/roadmap/limenext/` 专题包已建立。
2. Lime 的 current 平台事实源已经分别收口到：
   - `overview.md`
   - `query-loop.md`
   - `command-runtime.md`
   - `task-agent-taxonomy.md`
   - `remote-runtime.md`
   - `state-history-telemetry.md`
   - `skill-standard.md`
3. `ribbi/`、`command-runtime/`、`harness-engine/`、`product convergence`、`service skill cloud config` 等子专题已被回挂到 LimeNext 总图。
4. `sceneapp-capability-model.md` 已补齐，固定了五类 `SceneApp`、五种 skill / scene 设计模式与九类底层能力模块的判断标准。
5. `base-setup-decoupling.md` 已把“基础设置包”和宿主内核边界单独收口。
6. 多模态组合型样板已进入 LimeNext 总纲，开始用 `composition blueprint` 统一表达组合蓝图。
7. `composition-blueprint-schema.md` 已补出文档级 schema 草案，后续可以继续下沉到 validator 与目录投影。
8. `base-setup-package-schema.md` 已把基础设置包补成顶层装配对象，开始明确“改包、改投影、改宿主”的判断线。
9. `base-setup-projection-lifecycle.md` 已把装配包发布、灰度、seeded 兜底与回滚链收口成可讨论的事实源。
10. `base-setup-implementation.md` 已把 validator / compiler / rollout gate 的第一版代码落点收口到现有 `ServiceSkillCatalog` 与 launch/runtime 锚点。
11. `src/lib/base-setup/*` 已新增第一版代码骨架，开始把基础设置包下沉到实际 TypeScript 模块与单测。
12. `src/lib/base-setup/storage.ts`、`bootstrap.ts` 已落地，把基础设置包快照、bootstrap 提取与 compat 编译链收口成独立模块。
13. `src/lib/api/serviceSkills.ts`、`src/lib/serviceSkillCatalogBootstrap.ts` 已正式接入 `Base Setup Package` 主链，远端刷新与 bootstrap 同步都能直接消费装配包并落基础设置快照。
14. 默认云端 seeded 目录已从手写 `ServiceSkillCatalog` 迁到手写 `Base Setup Package` + compat 编译产物，开始把装配层推进为真正的内置事实源。
15. seeded 本地 `local_custom` 项也已迁到手写 `Base Setup Package` + compat 编译产物，`x-article-export` 不再依赖手写 `ServiceSkillItem` 补丁。
16. `SceneApp` 的 `project pack` 合同已经从基础设置编译层正式接到产品读模型、目录详情页和经营评分页：
   - 统一暴露 `deliveryProfile / compositionProfile / scorecardProfile`
   - 目录页已经能说明最终交付部件、组合步骤和经营关注点
   - mock 与 Tauri seeded DTO 已同步对齐，避免只在前端测试里存在结构字段
17. `project pack` 已继续接到真实 `run summary / scorecard` 聚合：
   - `artifactCount` 不再是唯一运行结果语义
   - 运行详情已经能解释“交齐几项、还缺什么、卡在哪个失败信号”
   - `project pack` 经营评分已改成 `complete_pack_rate / review_pass_rate / publish_conversion_rate`
   - `observedFailureSignals / topFailureSignal` 已从真实运行样本回流到产品面
18. `project pack` 第二阶段已开始接到 `session / evidence` 主链：
   - `SceneApp run summary` 在拿到 `sessionId` 时会优先读取真实 `SessionDetail + FileArtifact`
   - runtime verification failure 已开始回挂到 `review_blocked`
   - 只有缺少 session evidence 时才回退 `AgentRun.metadata.artifact_paths`
19. `project pack` 已开始补齐结构化结果入口，而不是只在运行详情里展示 viewer 文案：
   - `SceneAppRunSummary` 已新增稳定 `deliveryArtifactRefs`
   - 结果入口会优先从 runtime evidence 解析真实会话产物，并在缺失 session evidence 时回退 metadata artifact path
   - 前端已改为复用现有 Agent 文件预览入口打开主稿 / 结果文件，不新增新的 viewer 协议
20. `project pack` 已把治理入口接到 SceneApp 运行详情，而不再只展示“已接入会话证据”的文字判断：
   - `SceneAppRunSummary` 已新增稳定 `governanceArtifactRefs`
   - Rust 会按 `sessionId` 组装 `evidence/summary.md` 与 `review/review-decision.*` 的稳定引用
   - 前端继续复用现有 Agent 文件预览入口打开证据摘要、人工复核记录与复核 JSON，不新增新的 SceneApp viewer 协议
21. `project pack` 已开始把治理入口从“可打开”推进到“缺失时自动补生成”：
   - 新增 `sceneapp_prepare_run_governance_artifact` 当前命令
   - SceneApp 页面点击治理入口时会先按制品类型触发 evidence / review 导出，再继续打开对应文件
   - 页面仍只消费 `src/lib/api/sceneapp.ts` 网关，不直接耦合 `agent_runtime_export_*` 命令名
22. `project pack` 已继续把治理入口从“单文件打开”推进到“业务动作”：
   - 运行详情已新增 `治理动作` 区块，而不只是列出治理文件
   - 当前已支持：
     - `准备周会复盘包`
     - `准备结构化治理包`
   - 两类动作都会先经由 `src/lib/api/sceneapp.ts` 批量补齐 evidence / review 制品，再打开对应主治理文件
   - SceneApp 页面仍不直接理解底层 runtime export 命令，也不自己拼接治理路径
23. `project pack` 已开始把治理能力从“单次运行详情”推进到“页面级治理看板”：
   - `SceneAppsPage` 已新增独立 `治理看板`
   - 当前会把 `run + scorecard + evidence / review` 翻译成业务向状态，而不是只展示底层技术字段
   - 目录主视图已经能判断这条场景当前更适合：
     - 周会复盘
     - 生成 / 看板消费
     - 自动化任务跟进
     - 结果编辑 / 发布
   - 页面级治理动作继续复用 `src/lib/api/sceneapp.ts` 与既有文件打开链，不新增平行协议
24. `SceneAppsPage` 已开始从“单页堆叠工作台”收口到“分页式信息架构”：
   - 当前固定拆成 `场景目录 / 场景详情 / 治理复盘` 三个分页
   - `catalog` 只负责选品与筛选，不再同时承载详情和治理解释
   - 目录卡片点击后会直接进入对应 `detail` 分页，而不是只停留在选中态
   - 顶部继续保留“当前场景”摘要，确保分页切换时不丢业务上下文
   - `detail / governance` 已补齐分页级空态与回退动作，不再让用户停在无下一步的空白页
   - 顶部已新增业务向工作流导轨，明确表达 `选场景 -> 补启动 -> 看治理` 的跨页顺序
   - 这条规则已经同步写回 `docs/aiprompts/design-language.md`，作为后续复杂工作台默认设计约束
25. `创作场景执行摘要` 已从启动瞬间静态摘要继续推进到生成页运行态回流：
   - `AgentChatWorkspace` 当前会按 `sessionId -> sceneapp run` 回查最近运行
   - 生成页顶部摘要卡已开始展示 `delivery completion / runtime evidence / governance artifact / observed failure signal`
   - `AppPageContent` 已修正 `sceneapps` keep-alive 树位，`创作场景 -> 持续流程 -> 创作场景` 往返不会再触发目录页重挂载
26. `创作场景 -> 持续流程 / 自动化` 的事实源已经开始统一，而不是继续各讲各的：
   - `AutomationJobDetailsDialog` 当前会识别 `sceneapp` 派生任务的 metadata，并回查同一条 `descriptor / project pack plan / run summary / scorecard`
   - 自动化详情里已新增 `创作场景闭环` 摘要块，可直接回到 `创作场景` 准备页或治理复盘页
   - 自动化详情里的结果文件、治理文件与治理动作，当前已复用 `SceneAppRunDetailViewModel + prepare_run_governance_artifact` 主链，不再额外发明 automation 专用 pack/gov 协议
27. `创作场景 -> 场景目录` 当前也已开始接到同一份经营事实源，而不是继续停留在静态标题目录：
   - `SceneAppsCatalogPanel` 目录卡片已开始同时展示 `delivery contract / latest run / scorecard action / top failure signal / operating summary`
   - `useSceneAppsPageRuntime` 会按全量 descriptor 聚合最近运行与 scorecard，并把它们回流到同一份目录读模型
   - 目录卡片、生成页顶部执行摘要与自动化详情当前共享同一组 `descriptor + latest run + scorecard` 语义，不再各自发明一套“当前状态”解释
28. `project pack` 已开始从治理复盘单点入口继续扩到 `生成准备 / 经营评分` 的结果消费入口：
   - `SceneAppDetailPanel` 与 `SceneAppScorecardPanel` 当前都会展示最近可消费的 `Project Pack` 结果入口，而不再只停留在 `viewerLabel`
   - 当最新运行仍在执行或尚未带回结果文件时，页面会自动回退到最近一轮已交付样本，而不是让准备页与评分页只剩规划文案
   - 结果入口仍继续复用现有 Agent 文件预览打开链，不新增新的 `Project Pack viewer` 协议
29. `project pack` 已继续扩到 `生成主执行面` 的直接结果消费入口：
   - `useSceneAppExecutionSummaryRuntime` 当前不再只回流 `runtimeBackflow` 摘要，还会同步回流最近可消费的 `Project Pack` 结果样本
   - `SceneAppExecutionSummaryCard` 已新增 `最近可消费结果` 区块，生成页可以直接打开结果文件，不再只停留在顶部摘要和 `viewerLabel`
   - `生成主执行面` 与 `创作场景` 页面当前共享同一条 `findLatestSceneAppPackResultRun + deliveryArtifactEntries + Agent 文件预览打开链` current 主链，不再各自维护一套结果入口逻辑
30. `生成主执行面` 已开始补齐回闭环动作，而不再让用户自己在左侧重新找入口：
   - 执行摘要卡当前已新增 `回生成准备 / 去治理复盘` 深链动作
   - `去治理复盘` 会优先带到最近可消费样本对应的 run，而不是只回当前可能仍在执行中的 run
   - 执行摘要卡当前还可直接触发 `填写人工复核 / 可继续复用 / 继续观察 / 补证据 / 先别继续`
   - 这些动作继续复用 `review decision` 主链与 `RuntimeReviewDecisionDialog`，生成页不再复制平行治理协议
31. `生成主执行面` 已开始补齐第一批 `生成后动作编排`，而不再只是“看结果 + 跳页面”：
   - 执行摘要卡当前会直接展示 `周会复盘 / 生成 / 看板 / 持续流程 / 自动化 / 结果编辑 / 发布` 的推荐去向
   - 生成页当前可直接执行 `准备周会复盘包 / 准备结构化治理包 / 打开基础治理材料 / 恢复底层运行入口`
   - 生成页当前还可在同一会话里直接触发 `补齐缺失部件 / 发布前检查 / 进入发布整理 / 生成渠道预览稿 / 整理上传稿`，继续复用 `@发布合规 / @发布 / @渠道预览 / @上传` 与当前 turn 提交主链，而不新增新的发布协议
   - `AgentChatWorkspace` 与 `SceneAppsPage` 当前共享 `resolveSceneAppRunEntryNavigationTarget + prepareSceneAppRunGovernanceArtifact(s)` current 主链，不再各自维护一份 run entry 恢复逻辑
   - 这一步把 `生成` 从“结果页旁边的跳转入口”推进成了第一批真正的统一编排面

尚未完成：

1. 把 `ServiceSkill` 在产品面、目录面、运行时面和自动化面真正打通成同一个对象。
2. 让所有样板场景都按统一 `SceneApp` 类型与能力模块声明接入。
3. 把 `SceneScorecard` 与现有 evidence / tracker / artifact 数据链打通。
4. 在 `docs/exec-plans/` 里建立 LimeNext 的持续推进日志与阶段风险管理。
5. 把已完成的样板进一步接到 `Artifact + Evidence + Scorecard`。
6. 把 `SceneScorecard` 从概念字段推进到可被聚合和查看的产品对象。
7. 把“主 App 宿主内核”与“基础设置包”分层固定下来，减少场景扩张对客户端发版的依赖。
8. 让基础设置包的 schema 继续下沉到 bootstrap / seeded catalog 可消费的目录投影。
9. 把 `composition blueprint` 从文档口径继续收口到可校验、可投影的装配对象。
10. 继续把 `project pack` 的结构化读模型从当前已接通的 `session / evidence + deliveryArtifactRefs` 优先聚合，扩展到更完整的 `artifact validator / request telemetry / evidence summary` 主链。
11. 把 `project pack` 的治理闭环从当前已接通的“生成主执行面 + 场景目录 + 生成准备 + 治理复盘深链 + 经营评分 + 页面级治理看板 + 自动化详情 + 周会复盘包 / 结构化治理包 + 同聊补件 / 发布前检查 / 进入发布整理 / 渠道预览稿 / 上传稿”继续扩展到更完整的正式投放动作与更强的 evidence/review 闭环。
12. 把装配包从已接通的 `service_skill_catalog + scene_catalog` 继续扩到 `command_catalog` 投影代码。
13. 决定第一版是“客户端内编译 package”还是“服务端下发预编译 projection，客户端只做 gate + fallback”。
14. 把剩余 seeded 来源继续收口，重点转到 `command` 与 automation 相关入口，不再保留新的手写 `local_custom` 补丁。
15. 把分页式 `SceneAppsPage` 继续补成真正的多页面工作台；当前跨页入口、分页级空态和工作流导轨已补齐，剩余重点转到 GUI smoke 交付证明与更强的子页级信息头部。

## 3. 总目标

LimeNext 的实施总目标固定为：

`目标输入 -> Scene / ServiceSkill -> Agent / Binding 执行 -> Artifact 交付 -> Evidence / Review 治理 -> Scorecard 评估 -> Keep / Incubate / Retire`

## 4. 实施阶段

### P0：总纲固化

目标：

- 让 LimeNext 平台定义稳定，不再来回摇摆。
- 固定 `SceneApp` 的能力分类，不再只停留在“场景工作台”的口号层。

已完成：

- `docs/roadmap/limenext/` 专题包

退出条件：

- 后续讨论新专题时，能先声明它属于 LimeNext 哪一层。
- 新样板进入实施前，能先写出 `sceneapp_type`、`pattern_primary / pattern_stack`、`infra_profile` 与 `composition_blueprint`。

### P1：产品对象收口

目标：

- 统一 `ServiceSkill / Scene` 的产品对象语义
- 把首页卡、技能页、slash scene、推荐方案挂到同一对象

依赖：

- `docs/roadmap/ribbi/*`
- `docs/roadmap/lime-product-convergence-plan.md`
- `docs/roadmap/lime-service-skill-cloud-config-prd.md`

退出条件：

- 前台不再把 `skill bundle` 和 `ServiceSkill` 混成一个词
- 首页与输入栏围绕同一场景对象表达

### P1.5：业务装配收口

目标：

- 固定基础设置包与 `composition blueprint` 的角色边界
- 让多模态组合场景能优先通过装配层下发，而不是频繁改主 App

退出条件：

- 团队能明确回答“什么改动只改基础设置包，什么改动必须升级宿主”
- 第一条组合型样板能被写成标准设计卡，而不是口头 workflow

### P2：运行时骨架收口

目标：

- 让 `Scene / ServiceSkill` 真正走统一运行时主链

依赖：

- `docs/roadmap/gongneng/command-runtime/*`
- `docs/aiprompts/query-loop.md`
- `docs/aiprompts/command-runtime.md`

退出条件：

- 至少一条 `Agent + ServiceSkill` 样板链路与一条 `Agent + Task` 样板链路稳定成立

当前状态：

- `@配音 / voice_runtime / cloud-video-dubbing` 已被选定并沉淀为第一条 `Agent + ServiceSkill` current 样板方案包
- `x-article-export` 已被沉淀为第二条 `Agent + ServiceSkill` current 样板方案包，并覆盖 `site_adapter / browser_assist` 分支

### P3：长时执行与远程收口

目标：

- 把 `subagent turn / automation job / channels runtime / browser connector` 纳入统一平台解释与实施顺序

依赖：

- `docs/aiprompts/task-agent-taxonomy.md`
- `docs/aiprompts/remote-runtime.md`

退出条件：

- 团队不再把 OpenClaw compat shell 或 scheduler tick 当成长期主线

### P4：证据与治理闭环

目标：

- 让 evidence / replay / review / dashboard 成为平台默认治理面

依赖：

- `docs/aiprompts/state-history-telemetry.md`
- `docs/roadmap/harness-engine/*`

退出条件：

- 失败场景可以稳定回挂到 evidence -> analysis/review -> fix -> regress 主链

### P5：场景工厂

目标：

- 建立 `SceneScorecard`
- 固定 launch / keep / incubate / retire 规则

依赖：

- `docs/roadmap/limenext/metrics-and-selection.md`

退出条件：

- 平台能够系统性淘汰低价值场景，而不是只增不减

当前补充：

- `Artifact / Evidence / Scorecard` 的业务样板与图示已经建立
- `Local Durable SceneApp` 当前样板已固定为 `每日趋势摘要 / 账号增长跟踪`
- `x-article-export` 的当前产品合同已固定为“资料包优先 + 同一路径后处理”
- `Base Setup` 解耦规则已单独成文，开始固定“什么该下发，什么必须跟宿主升级”
- `project pack` 已不再只是 schema 词汇，而是已经进入 SceneApp 目录和经营评分读模型
- `project pack` 已进一步接到真实 `run summary / scorecard` 聚合对象
- `project pack` 已开始改成 `session / evidence` 优先聚合，而不是只看 tracker metadata
- `project pack` 已开始把真实结果文件入口接到 SceneApp 运行详情，不再只展示 viewer kind 文案
- `project pack` 已开始把证据摘要 / 人工复核记录 / 复核 JSON 接到同一条运行详情治理面
- `project pack` 已开始在治理入口点击时自动补生成 evidence / review 文件，而不是让用户先回到 Agent 手动导出
- `project pack` 已开始把治理面升级成业务动作，当前可直接准备周会复盘包与结构化治理包
- `project pack` 已开始把治理面抬到 SceneApp 页面级看板，而不再只停留在单次运行详情里
- `project pack` 已开始把最近可消费结果入口接到 `生成主执行面`，不再只停留在 `创作场景` 子页消费
- 下一步不再只是补页面，而是要把这套治理看板继续接到更完整的发布/复盘动作、选品口径和后续自动治理主链

## 5. 默认样板链路

后续实施默认至少推进五条样板：

1. `Agent + ServiceSkill`
   - 第一条 current 样板：`@配音 / voice_runtime`
   - 第二条 current 样板：`x-article-export`
2. `Agent + Task`
   - `@配图`
3. `Prompt 型`
   - `@总结` 或 `@分析`
4. `automation job`
   - `每日趋势摘要`
   - `账号增长跟踪`
5. `Multimodal Composition`
   - `文本 -> 线框图 -> 配乐 -> 剧本 -> 短视频草稿`

固定补充规则：

- 每条样板都必须显式声明：
  - `sceneapp_type`
  - `pattern_primary`
  - `pattern_stack`
  - `infra_profile`
  - `composition_blueprint`
  - `execution_entity`
  - `runtime_binding`
  - `storage_strategy`
  - `delivery_contract`

推荐先从三句最短版开始写：

- 这是什么类型的 `SceneApp`
- 它内部主要按什么模式组织
- 它到底调用了哪些基础设施

## 6. 当前优先顺序

当前建议优先顺序固定为：

1. 先按 `SceneApp` 能力模型收口样板声明标准
2. 继续收口 `ServiceSkill` 作为产品对象
3. 以 `@配音 / voice_runtime` 作为第一条 `Cloud-managed SceneApp` 样板进入实施
4. 以 `x-article-export` 作为第一条 `Browser-grounded SceneApp` 样板进入实施
5. 以 `每日趋势摘要 / 账号增长跟踪` 作为第一条 `Local Durable SceneApp` 样板进入实施
6. 以多模态组合短视频草稿作为第一条 `Hybrid SceneApp` 样板进入实施
7. 把五条样板链路接到 `Artifact + Evidence + Scorecard`

当前不建议优先做：

1. 扩目录数量
2. 新增更多 compat 入口
3. 新造一层平行 runtime

## 7. 风险

### 风险 1：继续把 Lime 误讲成 `skills runtime`

处理：

- 所有执行文档都保持 `Skill / ServiceSkill / Scene / Artifact / Evidence / Scorecard` 分层

### 风险 2：把设计模式误当成产品对象

处理：

- 文档中固定区分 `ServiceSkill / Scene` 与 `pattern_primary / pattern_stack`
- 不再出现“这是个 Pipeline 产品”这类混层说法

### 风险 3：只做总纲，不接实施

处理：

- 本计划与进度日志持续更新
- 每进入实现阶段，回挂具体子专题与验证命令

### 风险 4：只做治理减法，不回主线交付

处理：

- 连续两轮主要在做治理后，下一轮必须回到样板场景交付

## 8. 当前下一刀

当前下一刀建议固定为：

**把 LimeNext 从“durable automation 已回到装配主链”推进到“gate 定版与组合交付主链收口”。**

当前已经成立的恢复协议：

1. `automation -> automation job`
2. `chat / skill -> agent session`
3. `browser_assist -> browser runtime`
4. `cloud_scene -> structured cloud scene resume`
5. `native_skill -> structured service skill resume`

当前已经补齐的装配收口：

1. 保持 `SceneAppRunSummary` 继续只暴露稳定恢复引用，而不是让 UI 直接理解底层 metadata：
   - `sourceRef`
   - `sessionId`
   - `browserRuntimeRef`
   - `cloudSceneRuntimeRef`
   - `nativeSkillRuntimeRef`
   - `deliveryArtifactRefs`
2. durable 场景的 automation projection / fallback 已继续收回同一装配主链：
   - `Base Setup Package` 已支持 `automationProfiles[]`
   - `catalogProjection.automationProfileRef` 已进入 validator / parser / projection metadata / snapshot index
   - durable seeded 样板已显式声明 automation profile
   - `service-skills/automationDraft.ts` 现已优先消费装配层 schedule / delivery / retry / enabled 预设
3. `browser-runtime` GUI smoke 与 `verify:local` 当前已重新通过，GUI 交付门槛不再被此前的 CDP 环境问题卡住

当前下一步转为：

1. 决定客户端编译 vs 服务端预编译 gate 的最终定版位置
2. `创作场景 -> 生成` 的执行摘要、`自动化详情`、`场景目录`、`生成准备` 和 `经营评分` 都已经接通运行态回流；下一步把同一份 `Project Pack + governance` 基线继续扩到生成主执行面的直接结果消费与更完整的治理消费入口
3. 把 `SceneScorecard` 与周会模板、页面级治理看板和生成口径继续打通
4. 继续让 automation detail / SceneApp run / scorecard 聚合消费同一组 base-setup refs，而不是回退到运行时猜测

这样 LimeNext 才会从“目录、启动、复盘、恢复、durable 装配都闭环”继续推进到“装配 gate 定版、组合交付与经营聚合也闭环”。
