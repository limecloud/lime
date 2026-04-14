# LimeNext 推进日志

## 2026-04-15

### 已完成

- 新增基础设置包第一版代码骨架：
  - `src/lib/base-setup/types.ts`
  - `src/lib/base-setup/validator.ts`
  - `src/lib/base-setup/compiler.ts`
  - `src/lib/base-setup/rolloutGate.ts`
  - `src/lib/base-setup/compat/serviceSkillCatalogProjection.ts`
  - 固定第一版先把 `Base Setup Package` 编译成 compat `ServiceSkillCatalog`
  - 固定 runtime 侧暂不新增执行链，继续只吃 current `request_metadata`
- 新增基础设置包单测：
  - `src/lib/base-setup/validator.test.ts`
  - `src/lib/base-setup/compiler.test.ts`
  - `src/lib/base-setup/rolloutGate.test.ts`
  - 证明结构校验、引用校验、catalog projection 与 rollout gate 决策已跑通
- 新增基础设置包实现设计专题：
  - [base-setup-implementation.md](../roadmap/limenext/base-setup-implementation.md)
  - 固定第一版先以 `Base Setup Package -> compat ServiceSkillCatalog projection` 落地
  - 固定第一版不重写产品面 API，而是先改 `ServiceSkillCatalog` 背后的编译来源
  - 固定 validator / compiler / rollout gate 的建议模块拆分与接线顺序
- 新增基础设置包投影与发布生命周期专题：
  - [base-setup-projection-lifecycle.md](../roadmap/limenext/base-setup-projection-lifecycle.md)
  - 固定装配包从编写、校验、投影编译、灰度发布、bootstrap 拉取、seeded 兜底到回滚的完整链路
  - 固定最小 validator 分层：`L0 结构 / L1 装配 / L2 宿主边界`
  - 固定“只要 L2 不通过，就必须升级主 App”的门禁
- 新增基础设置包顶层 schema：
  - [base-setup-package-schema.md](../roadmap/limenext/base-setup-package-schema.md)
  - 固定 `Base Setup Package` 的 v1 顶层字段、目录投影、profile 结构与最小 validator 口径
  - 固定“改包、改投影、改宿主”的判断表
- 新增组合蓝图 schema 草案：
  - [composition-blueprint-schema.md](../roadmap/limenext/composition-blueprint-schema.md)
  - 固定 `composition blueprint` 的 v1 顶层字段、步骤字段、校验规则与 `project_pack` 最小合同
  - 固定 v1 只支持“有序步骤链”，不先做通用 DAG
- 继续收口 LimeNext 总纲，明确平台主张不仅是“场景工作台”，也是“快捷组合多模态能力的 SceneApp factory”
- 在以下文档中引入统一口径：
  - [README.md](../roadmap/limenext/README.md)
  - [prd.md](../roadmap/limenext/prd.md)
  - [architecture.md](../roadmap/limenext/architecture.md)
  - [sceneapp-capability-model.md](../roadmap/limenext/sceneapp-capability-model.md)
  - [sceneapp-blueprints.md](../roadmap/limenext/sceneapp-blueprints.md)
  - [flowcharts.md](../roadmap/limenext/flowcharts.md)
  - [sequences.md](../roadmap/limenext/sequences.md)
  - [artifact-evidence-scorecards.md](../roadmap/limenext/artifact-evidence-scorecards.md)
  - [metrics-and-selection.md](../roadmap/limenext/metrics-and-selection.md)
  - [execution-plan.md](../roadmap/limenext/execution-plan.md)
  - [base-setup-decoupling.md](../roadmap/limenext/base-setup-decoupling.md)
  - [agent-skills-profile.md](../roadmap/limenext/agent-skills-profile.md)
- 把 `composition blueprint` 固定为基础设置包中的通用装配对象：
  - `recipe` 只保留为别名
  - 不新增 runtime taxonomy
  - 不新增第六种 binding family
- 把第一条组合型样板正式收口为：
  - `文本 -> 线框图 -> 配乐 -> 剧本 -> 短视频草稿`
  - 归类为 `Hybrid / Multimodal Composition SceneApp`
  - 交付合同固定为 `project pack`
- 把 LimeNext 业务图和业务时序继续改成“非技术同学也能看懂”的版本：
  - 增加多模态组合业务流图
  - 增加基础设置包如何下发组合场景的技术图
  - 增加组合蓝图编排多模态结果链的业务 / 技术时序
- 更新执行计划与总实施计划：
  - [execution-plan.md](../roadmap/limenext/execution-plan.md)
  - [limenext-plan.md](./limenext-plan.md)
  - 明确多模态组合样板成为第五条默认样板链路
  - 明确下一刀是把 `composition blueprint` 继续收口到 schema 与目录投影

### 当前判断

- LimeNext 现在不该再被理解成“很多单点场景的目录”，而应被理解成“场景对象 + 组合蓝图 + 结果包”的装配平台
- `composition blueprint` 这层已经进入正式文档口径，后续可以继续下沉到 schema、投影和校验规则
- `composition blueprint` 现在已经不只是术语，而有了 v1 schema 草案和最小 validator 口径
- `Base Setup Package` 现在也不再只是概念层，而有了顶层对象、目录投影和兼容性校验口径
- 基础设置包现在不仅回答“长什么样”，也开始回答“怎么发布、怎么灰度、怎么回滚”
- 基础设置包这条线现在也开始回答“第一版先改什么代码、先不改什么代码”
- 基础设置包这条线现在已经不只是文档设计，而有了第一版代码骨架和最小单测闭环
- 当前四类样板已经覆盖：
  - 浏览器采集导出
  - 云端托管媒体生产
  - 本地持续跟踪
  - 多模态组合结果链
- 基础设置包现在已经不只是“目录下发”，还承担多步骤组合链的业务装配语义

### 风险

- 如果后续只把 `composition blueprint` 写成单一场景私有 workflow，通用装配层会再次失效
- 如果后续让 `catalog projection`、`binding profile`、`artifact profile` 分别在不同文档里各说各话，基础设置包会再次失去顶层约束
- 如果后续只写 schema，不把 validator / rollout / seeded fallback 做成真实门禁，团队还是会退回“改了文档等于完成”
- 如果后续跳过 compat projection，直接要求所有前台入口原生理解 `Base Setup Package`，改动面会过大，容易再次拖慢主线
- 如果后续长期只停在独立模块和单测，不接回 `serviceSkills.ts` 的真实 catalog 主链，这套骨架会再次漂浮
- 如果后续给组合型场景单独发明 viewer 或 binding，宿主边界会再次变模糊
- 如果后续只看最终视频草稿成败，不看 `project pack` 接受率与阶段返工率，组合场景很容易被误判

### 下一刀

- 把基础设置包 schema 继续下沉到 bootstrap / seeded catalog 可消费的目录投影与最小 validator
- 把 `base-setup-projection-lifecycle.md` 继续下沉为 validator / projection compiler / rollout gate 的代码级设计
- 基于 `base-setup-implementation.md` 决定第一版真实实现路线：客户端编译，还是服务端预编译 + 客户端 gate
- 把 `src/lib/base-setup/*` 正式接回 `src/lib/api/serviceSkills.ts` 的 seeded / bootstrap 主链
- 把多模态组合样板的 `project pack` 接到真实 artifact / viewer / scorecard 聚合入口
- 把 `SceneScorecard` 与周会模板、场景看板和任务中心口径继续打通

### 验证

- 已执行：
  - `npm run harness:doc-freshness`
  - 结果：`clean`
  - `npm test -- "src/lib/base-setup/validator.test.ts" "src/lib/base-setup/compiler.test.ts" "src/lib/base-setup/rolloutGate.test.ts"`
  - 结果：`3 files / 8 tests passed`
  - `npm run typecheck`
  - 结果：未通过，当前阻塞来自仓库其他已有类型错误；本轮新增 `src/lib/base-setup/*` 未再报新错

## 2026-04-14

### 已完成

- 建立 LimeNext 上位总纲专题包：
  - [README.md](../roadmap/limenext/README.md)
  - [prd.md](../roadmap/limenext/prd.md)
  - [architecture.md](../roadmap/limenext/architecture.md)
  - [flowcharts.md](../roadmap/limenext/flowcharts.md)
  - [sequences.md](../roadmap/limenext/sequences.md)
  - [code-structure.md](../roadmap/limenext/code-structure.md)
  - [roadmap.md](../roadmap/limenext/roadmap.md)
  - [execution-plan.md](../roadmap/limenext/execution-plan.md)
  - [metrics-and-selection.md](../roadmap/limenext/metrics-and-selection.md)
  - [migration-map.md](../roadmap/limenext/migration-map.md)
- 在 [docs/README.md](../README.md) 增加 LimeNext 总纲入口，确保文档中心可发现
- 完成一轮文档新鲜度校验：
  - `npm run harness:doc-freshness`
  - 结果：`clean`
- 根据反馈把 LimeNext 定义改成更容易传播的三层版本：
  - 给所有人看的白话版
  - 给产品团队看的版本
  - 给工程团队看的版本
- 新增本执行计划与进度日志：
  - [limenext-plan.md](./limenext-plan.md)
  - [limenext-progress.md](./limenext-progress.md)
- 补齐 SceneApp 能力模型总纲：
  - [sceneapp-capability-model.md](../roadmap/limenext/sceneapp-capability-model.md)
  - 固定五类 `SceneApp` 分类
  - 固定五种 `Skill / Scene` 编排模式
  - 固定九类底层能力模块范围
  - 明确 `server skill / CLI / browser / cron / db / markdown / json` 的适用边界
- 把 skill 设计模式正式写回基础标准与运行时标准：
  - [skill-standard.md](../aiprompts/skill-standard.md)
  - [command-runtime.md](../aiprompts/command-runtime.md)
  - 明确 `Skill Bundle` 不是产品对象
  - 明确新增样板至少要声明 `sceneapp_type + pattern_primary / pattern_stack + infra_profile`
- 在 `SceneApp` 总纲里增加常见组合原型，避免分类只停在抽象概念
- 新增 SceneApp 样板蓝图：
  - [sceneapp-blueprints.md](../roadmap/limenext/sceneapp-blueprints.md)
  - 用 `x-article-export`、`@配音`、`每日趋势摘要 / 账号增长跟踪` 三条样板补齐业务图、业务时序和经营指标
- 更新 LimeNext 总纲图示：
  - [flowcharts.md](../roadmap/limenext/flowcharts.md)
  - [sequences.md](../roadmap/limenext/sequences.md)
  - [architecture.md](../roadmap/limenext/architecture.md)
  - 补齐“业务图在前、技术图在后”的双层表达
- 选定 LimeNext 第一条 `Agent + ServiceSkill` 样板为 `@配音 / voice_runtime / cloud-video-dubbing`
- 重写 `docs/prd/gongneng/peiyin/` 六件套，形成完整实施级方案包：
  - [prd.md](../prd/gongneng/peiyin/prd.md)
  - [architecture.md](../prd/gongneng/peiyin/architecture.md)
  - [flowcharts.md](../prd/gongneng/peiyin/flowcharts.md)
  - [sequences.md](../prd/gongneng/peiyin/sequences.md)
  - [code-structure.md](../prd/gongneng/peiyin/code-structure.md)
  - [tasks.md](../prd/gongneng/peiyin/tasks.md)
- 新增 `docs/prd/gongneng/x-article-export/` 六件套，形成完整实施级方案包：
  - [prd.md](../prd/gongneng/x-article-export/prd.md)
  - [architecture.md](../prd/gongneng/x-article-export/architecture.md)
  - [flowcharts.md](../prd/gongneng/x-article-export/flowcharts.md)
  - [sequences.md](../prd/gongneng/x-article-export/sequences.md)
  - [code-structure.md](../prd/gongneng/x-article-export/code-structure.md)
  - [tasks.md](../prd/gongneng/x-article-export/tasks.md)
- 修正文档入口与引用，确保 `x-article-export` 作为 `Browser-grounded SceneApp` 样板可被发现：
  - [docs/README.md](../README.md)
  - [command-runtime/roadmap.md](../roadmap/gongneng/command-runtime/roadmap.md)
  - [limenext/README.md](../roadmap/limenext/README.md)
- 新增 `Artifact / Evidence / Scorecard` 业务样板文档，并把它回挂到 LimeNext 总纲：
  - [artifact-evidence-scorecards.md](../roadmap/limenext/artifact-evidence-scorecards.md)
  - [metrics-and-selection.md](../roadmap/limenext/metrics-and-selection.md)
  - [sceneapp-blueprints.md](../roadmap/limenext/sceneapp-blueprints.md)
  - [flowcharts.md](../roadmap/limenext/flowcharts.md)
  - [sequences.md](../roadmap/limenext/sequences.md)
- 把第三条 `Local Durable SceneApp` 样板固定到真实仓库锚点：
  - `daily-trend-briefing`
  - `account-performance-tracking`
  - `useWorkspaceServiceSkillEntryActions.ts`
  - `AutomationJobDialog.tsx`
  - `automation_service/mod.rs`
- 新增通用解耦专题，明确“主 App 宿主内核”与“基础设置包”的边界：
  - [base-setup-decoupling.md](../roadmap/limenext/base-setup-decoupling.md)
  - 固定“换装配优先不升级主 App，换内核才升级”
  - 固定基础设置包不是新 runtime，也不是新产品对象
- 把 `x-article-export` 的产品合同从“待澄清”收口为固定口径：
  - 先交付 `index.md + images/ + meta.json`
  - 若带 `target_language`，只在同一路径 Markdown 上继续后处理
  - 若未来要支持“纯原文模式”，必须显式分流入口
- 完成第二轮文档新鲜度校验：
  - `npm run harness:doc-freshness`
  - 结果：`clean`

### 当前判断

- LimeNext 作为上位总纲已经成立
- `SceneApp` 已不再只是一个抽象词，而有了统一能力模型
- `SceneApp` 现在同时有“运行形态 + 编排模式 + 基础设施画像”三轴分类
- `Skill` 设计模式已经不再只是经验说法，而进入了正式工程字段与设计卡
- LimeNext 图示已经不再只有技术分层图，开始具备业务、产品、运营可读的总图与时序
- LimeNext 现在不只有抽象分类，还有三条业务样板蓝图可以直接拿来对齐讨论
- 第一条 `Agent + ServiceSkill` 样板已经不再空缺，当前由 `@配音 / voice_runtime` 承担
- 第二条 `Agent + ServiceSkill` 样板也已不再空缺，当前由 `x-article-export` 承担
- 第三条 `Local Durable SceneApp` 样板也不再只是概念词，当前由 `每日趋势摘要 / 账号增长跟踪` 承担
- `Browser-grounded SceneApp` 已经不再停留在蓝图层，而有了完整实施级方案包
- 当前最重要的问题不再是“第二条样板怎么补”，而是“样板如何接到 `Artifact + Evidence + Scorecard`”
- `Artifact / Evidence / Scorecard` 三层现在已经不再只是抽象词，而有了业务样板和图示
- `x-article-export` 的产品合同也已不再摇摆，当前口径是“资料包优先 + 同一路径后处理”
- “尽量不升级主 App 也能使用基础设置” 这条原则也已不再只是口头要求，而被收口成通用分层规则
- 当前还需要继续明确：
  - `SceneScorecard` 后续具体落到哪些真实聚合对象与看板入口

### 风险

- 如果后续继续只写总纲与治理，而不落样板链路，LimeNext 很容易再次变成抽象平台叙事
- 如果后续只停在 `@配音` 一条云端样板，LimeNext 仍然会被误解成“只适合云端场景”
- 如果后续不把 `Local Durable` 的经营口径接进真实看板，团队还是容易把它误讲成“只是定时任务”
- 如果后续把“基础设置包”写成某个单场景私有配置，解耦层会再次失效
- 如果后续重新把 `Skill`、`ServiceSkill`、`Scene` 混成一个词，总纲会迅速失效

### 下一刀

- 把 `SceneScorecard` 聚合对象继续接到任务中心 / 场景看板 / 周会模板
- 把三条样板的经营信号进一步映射到真实数据源与产品入口
- 继续把结果卡文案从“技术摘要”升级成“业务可理解的交付说明”
- 把基础设置包收口成更明确的 schema 与校验规则
