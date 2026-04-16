# docs

## 目录定位

`docs/` 是 Lime 文档中心，分为两类受众：

- 普通创作者：优先阅读 `content/` 下的入门与用户指南
- 开发者与维护者：阅读 `aiprompts/`、`develop/`、`tech/`、`tests/` 等工程文档

文档站基于 Nuxt Content 构建。

## 目录索引

- `content/`：对外文档站正文（产品介绍、用户指南、进阶能力）
- `aiprompts/`：模块级工程文档（前后端组件、服务、命令、数据层）
- `exec-plans/`：执行计划、进度日志、技术债追踪
- `tech/`：跨模块技术蓝图与专题工程文档（当前已包含 Harness Engineering 指导文档）
- `bussniss/`：商务合作与代理运营方案
- `develop/`：开发流程与协作规范
- `plugins/`：插件与扩展相关文档
- `tests/`：测试策略与用例文档
- `iteration-notes/`：迭代备忘与下版本建议（暂不进入当前发布范围的问题）
- `images/`：文档图片资源
- `TECH_SPEC.md`：技术规格文档
- `exec-plans/README.md`：执行计划目录说明
- `exec-plans/upstream-runtime-alignment-plan.md`：参考运行时主链对齐总计划与排期事实源
- `exec-plans/upstream-runtime-alignment-progress.md`：参考运行时主链对齐进度日志
- `exec-plans/tech-debt-tracker.md`：技术债持续追踪表
- `develop/execution-tracker-technical-plan.md`：统一执行追踪（Execution Tracker）专项技术规划
- `develop/execution-tracker-deprecation-plan.md`：统一执行追踪旧路径退场计划（P0 收口）
- `develop/execution-tracker-p0-acceptance-report.md`：统一执行追踪 P0 验收报告
- `develop/execution-tracker-p1-p2-roadmap.md`：统一执行追踪后续路线（P1/P2）
- `tech/harness/README.md`：Lime Harness Engineering 总入口
- `tech/harness/implementation-blueprint.md`：Lime Harness 分阶段实施蓝图
- `aiprompts/query-loop.md`：运行时 Query Loop current 主链与提交边界
- `aiprompts/prompt-foundation.md`：基础 Prompt current 主链、system prompt 组装顺序与 current/compat 边界
- `aiprompts/task-agent-taxonomy.md`：Task / Agent / Coordinator current taxonomy 与边界归属
- `aiprompts/remote-runtime.md`：Remote runtime current 主链、current/compat 分类与远程入口归属
- `aiprompts/memory-compaction.md`：Memory / Compaction current 主链、来源链/持久记忆/压缩边界与 current/compat 分类
- `aiprompts/persistence-map.md`：Runtime 文件快照持久化主链、FileArtifact/sidecar/version/checkpoint 边界
- `aiprompts/state-history-telemetry.md`：State / History / Telemetry current 主链、session/thread/request/evidence/history 边界与 current/compat 分类
- `develop/scheduler-task-governance-p1.md`：调度任务治理 P1（连续失败、自动停用、冷却恢复）
- `roadmap/lime-skills-standardization-roadmap.md`：Skills 标准化与产品化路线图
- `roadmap/limenext/README.md`：LimeNext 平台总纲入口，统一挂接 Workspace、Scene、Runtime、Remote、Governance 与选品系统，并提供业务优先阅读顺序
- `roadmap/limenext/sceneapp-capability-model.md`：SceneApp 底层能力模型，定义本地、浏览器、云端、混合场景需要的能力模块范围
- `roadmap/limenext/sceneapp-blueprints.md`：用 `x-article-export`、`@配音`、`每日趋势摘要 / 账号增长跟踪` 三条样板把 SceneApp 分类翻译成业务语言
- `roadmap/limenext/artifact-evidence-scorecards.md`：把样板场景继续翻译成“交付物、失败证据、经营评分”三层，方便业务与产品判断该继续做还是收缩
- `roadmap/limenext/base-setup-decoupling.md`：定义主 App 宿主能力与通用基础设置包的解耦边界，减少“每加一个场景就要升级客户端”的耦合
- `roadmap/limenext/base-setup-package-schema.md`：把基础设置包顶层对象、目录投影、profile、兼容性与校验规则写成统一 schema，方便判断“改包还是改宿主”
- `roadmap/limenext/base-setup-projection-lifecycle.md`：把基础设置包如何校验、投影、灰度、离线兜底与快速回滚讲成一条发布链
- `roadmap/limenext/base-setup-implementation.md`：把 validator、projection compiler、rollout gate 第一版如何挂到现有 `ServiceSkillCatalog` 与 launch/runtime 锚点上写成代码级设计
- `roadmap/limenext/composition-blueprint-schema.md`：把组合蓝图最小 schema、步骤类型和 `project pack` 交付合同写清楚
- `roadmap/limenext/agent-skills-profile.md`：LimeNext 对齐 Agent Skills 与 Google ADK 的技能包 / 运行时分层说明
- `roadmap/limenext/flowcharts.md`：LimeNext 的业务图与技术主链流程图合集
- `roadmap/limenext/sequences.md`：LimeNext 的业务时序与技术时序合集
- `prd/gongneng/x-article-export/prd.md`：`Browser-grounded SceneApp` 样板功能包，定义 `/x文章转存` 如何把真实网页沉淀成项目内 Markdown bundle
- `roadmap/lime-service-skill-cloud-config-prd.md`：服务型技能的端优先执行与云配置同步 PRD
- `roadmap/lime-browser-site-capability-prd.md`：站点能力按真实浏览器优先接入的产品需求文档
- `ops.md`：运维与发布说明
- `app.config.ts` / `nuxt.config.ts` / `package.json`：文档站配置

## 当前叙事基线

对外文档（`content/`）默认采用以下口径：

1. 主叙事是“创作类 AI Agent 平台”，不再以“代理服务”作为首页主线
2. 先讲创作流程与场景，再讲模型连接和 API 兼容
3. 首页与入门页优先覆盖核心工作区主题与资源沉淀能力

## 维护原则

1. 先读后写：更新章节前先核对真实功能实现
2. 用户优先：首屏文案避免工程术语堆叠
3. 分层清晰：用户文档与工程文档分开表达
4. 同步更新：功能改动后同步修正文档入口页与对应章节
