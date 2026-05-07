# `docs/exec-plans`

本目录存放会影响开发执行的 versioned artifact：执行计划、进度日志、阻塞记录、迁移清单、技术债追踪。

## 放什么

- 多轮实现、迁移、治理任务的执行计划
- 与计划绑定的阶段进度、阻塞项、决策记录
- 需要持续小额偿还的技术债与退出条件

## 命名约定

- 专项计划：`<topic>-plan.md`
- 进度日志：`<topic>-progress.md`
- 常驻追踪：使用固定文件名，例如 `tech-debt-tracker.md`

## 使用规则

1. 计划不是一次性文档，推进状态变化时要同步更新
2. 会改变实现顺序、范围或回滚策略的决策，必须记录在这里或链接到这里
3. 清理类工作如果不能直接回挂路线图，应登记到 `tech-debt-tracker.md`
4. 被替代的计划不要悬空，保留跳转说明或归档指针

## 关联入口

- 路线图主线：`docs/roadmap/`
- 参考运行时主链总计划：`docs/exec-plans/upstream-runtime-alignment-plan.md`
- 参考运行时主链进度日志：`docs/exec-plans/upstream-runtime-alignment-progress.md`
- Provider 模型能力 taxonomy 进度日志：`docs/exec-plans/provider-model-taxonomy-progress.md`
- Lime 多模态运行合同实施计划：`docs/exec-plans/multimodal-runtime-contract-plan.md`
- 云端套餐与支付边界收口计划：`docs/exec-plans/cloud-commerce-user-center-boundary.md`
- `@` 命令本地执行纠偏计划：`docs/exec-plans/at-command-local-execution-alignment-plan.md`
- AI 图层化设计实现计划：`docs/exec-plans/ai-layered-design-implementation-plan.md`
- Skill Forge P1A Capability Authoring 执行计划：`docs/exec-plans/skill-forge-capability-authoring-p1a-plan.md`
- Skill Forge P1B Capability Verification 执行计划：`docs/exec-plans/skill-forge-capability-verification-p1b-plan.md`
- Skill Forge P3 Capability Registration 执行计划：`docs/exec-plans/skill-forge-capability-registration-p3-plan.md`
- Skill Forge P3B Capability Discovery 执行计划：`docs/exec-plans/skill-forge-capability-discovery-p3b-plan.md`
- Skill Forge P3C Runtime Binding 执行计划：`docs/exec-plans/skill-forge-runtime-binding-p3c-plan.md`
- Skill Forge P3D Query Loop Metadata 执行计划：`docs/exec-plans/skill-forge-query-loop-metadata-p3d-plan.md`
- Skill Forge P3E Tool Runtime Authorization 执行计划：`docs/exec-plans/skill-forge-tool-runtime-authorization-p3e-plan.md`
- Skill Forge P4 Managed Execution / Agent Envelope 执行计划：`docs/exec-plans/skill-forge-managed-agent-envelope-p4-plan.md`
- Skill Forge P0-P4 完成审计：`docs/exec-plans/skill-forge-completion-audit.md`
- Skill Forge Prompt-to-Artifact P5 执行计划：`docs/exec-plans/skill-forge-prompt-to-artifact-p5-plan.md`
- Skill Forge Prompt-to-Artifact P5 样例审计：`docs/exec-plans/skill-forge-prompt-to-artifact-p5-audit.md`
- Skill Forge P6 Read-Only HTTP API 执行计划：`docs/exec-plans/skill-forge-readonly-http-api-p6-plan.md`
- Skill Forge P6 Read-Only HTTP API 完成审计：`docs/exec-plans/skill-forge-readonly-http-api-p6-audit.md`
- Skill Forge P7 Read-Only HTTP API 执行授权计划：`docs/exec-plans/skill-forge-readonly-http-api-p7-plan.md`
- Skill Forge P8 Read-Only HTTP API 注册 provenance 计划：`docs/exec-plans/skill-forge-readonly-http-api-p8-plan.md`
- Skill Forge P9 Read-Only HTTP API 授权 artifact 消费门禁计划：`docs/exec-plans/skill-forge-readonly-http-api-p9-plan.md`
- Skill Forge P10 Read-Only HTTP API completion audit 消费计划：`docs/exec-plans/skill-forge-readonly-http-api-p10-plan.md`
- LimeNext 总实施计划（`legacy current reference`，当前主规划已切到 `docs/roadmap/limenextv2/README.md`）：`docs/exec-plans/limenext-plan.md`
- LimeNext 推进日志：`docs/exec-plans/limenext-progress.md`
- 技术债追踪：`docs/exec-plans/tech-debt-tracker.md`
- 模块级实施细节：`docs/aiprompts/README.md`
