# docs

## 目录定位

`docs/` 是 Lime 文档中心，分为两类受众：

- 普通创作者：优先阅读 `content/` 下的入门与用户指南
- 开发者与维护者：阅读 `aiprompts/`、`develop/`、`tech/`、`tests/` 等工程文档

文档站基于 Nuxt Content 构建。

## 目录索引

- `content/`：对外文档站正文（产品介绍、用户指南、进阶能力）
- `aiprompts/`：模块级工程文档（前后端组件、服务、命令、数据层）
- `tech/`：跨模块技术蓝图与专题工程文档（当前已包含 Harness Engineering 指导文档）
- `bussniss/`：商务合作与代理运营方案
- `develop/`：开发流程与协作规范
- `plugins/`：插件与扩展相关文档
- `tests/`：测试策略与用例文档
- `iteration-notes/`：迭代备忘与下版本建议（暂不进入当前发布范围的问题）
- `images/`：文档图片资源
- `TECH_SPEC.md`：技术规格文档
- `develop/execution-tracker-technical-plan.md`：统一执行追踪（Execution Tracker）专项技术规划
- `develop/execution-tracker-deprecation-plan.md`：统一执行追踪旧路径退场计划（P0 收口）
- `develop/execution-tracker-p0-acceptance-report.md`：统一执行追踪 P0 验收报告
- `develop/execution-tracker-p1-p2-roadmap.md`：统一执行追踪后续路线（P1/P2）
- `tech/harness/README.md`：Lime Harness Engineering 总入口
- `tech/harness/implementation-blueprint.md`：Lime Harness 分阶段实施蓝图
- `develop/scheduler-task-governance-p1.md`：调度任务治理 P1（连续失败、自动停用、冷却恢复）
- `roadmap/lime-skills-standardization-roadmap.md`：Skills 标准化与产品化路线图
- `roadmap/lime-service-skill-cloud-config-prd.md`：服务型技能的端优先执行与云配置同步 PRD
- `roadmap/lime-browser-site-capability-prd.md`：站点能力按真实浏览器优先接入的产品需求文档
- `ops.md`：运维与发布说明
- `app.config.ts` / `nuxt.config.ts` / `package.json`：文档站配置

## 当前叙事基线

对外文档（`content/`）默认采用以下口径：

1. 主叙事是“创作类 AI Agent 平台”，不再以“代理服务”作为首页主线
2. 先讲创作流程与场景，再讲模型连接和 API 兼容
3. 首页与入门页优先覆盖九大创作主题与资源沉淀能力

## 维护原则

1. 先读后写：更新章节前先核对真实功能实现
2. 用户优先：首屏文案避免工程术语堆叠
3. 分层清晰：用户文档与工程文档分开表达
4. 同步更新：功能改动后同步修正文档入口页与对应章节
