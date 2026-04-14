# LimeNext 总实施计划

> 状态：进行中  
> 更新时间：2026-04-15  
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
10. 把 `project pack` 的最小交付合同继续对齐 artifact profile 与 viewer 主链。
11. 把装配包的 validator / projection compiler / rollout gate 真正落成代码或脚本。
12. 决定第一版是“客户端内编译 package”还是“服务端下发预编译 projection，客户端只做 gate + fallback”。
13. 决定 `src/lib/base-setup/*` 何时正式接入 `src/lib/api/serviceSkills.ts`，替换当前手写 catalog 来源。

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
- 下一步不再只是写定义，而是要明确具体聚合对象、入口和周会使用方式

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

**把 `composition blueprint` 从文档对象继续收口到基础设置包 schema 与目录投影，再把 `SceneScorecard` 接到真实聚合来源、任务中心 / 场景看板入口与周会节奏；这样 LimeNext 才会从“样板闭环成立”继续推进到“经营面可执行”。**
