---
name: growth-strategy-knowledge-builder
description: 将增长目标、指标体系、渠道策略、实验计划、复盘结论、资源约束和停止条件，整理成符合 Agent Knowledge v0.6 document-first 标准、可被 AI 安全调用的增长策略知识库。适用于用户要求“整理增长知识库”“沉淀增长策略”“把增长计划变成项目资料”“维护增长实验资料包”的场景。
license: Apache-2.0
allowed-tools: list_directory, read_file
compatibility:
  agentKnowledge: ">=0.6.0"
metadata:
  lime_version: 1.0.0
  lime_execution_mode: prompt
  lime_surface: workbench
  lime_category: knowledge
  Lime_skill_bundle_version: "1.0.0"
  Lime_knowledge_builder: "true"
  Lime_knowledge_pack_type: "growth-strategy"
  Lime_knowledge_template: "growth-strategy"
  Lime_knowledge_family: "data"
  Lime_agent_knowledge_profile: "document-first"
  Lime_agent_knowledge_runtime_mode: "data"
---

# 增长策略知识库生成器

## 核心目标

把零散增长资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用已确认的目标、约束、指标口径、渠道洞察、实验计划、复盘结论和停止条件，而不是每次临时总结。

默认输出中文；除非用户明确要求其他语言。

## 与 Agent Knowledge 的分工

本 Skill 只负责“怎么生产和维护知识”：

- 读取来源资料、模板和质量检查表。
- 生成或更新 `growth-strategy` 主文档。
- 标记缺失事实、冲突假设、指标风险和待用户确认的信息。
- 返回整理记录、质量诊断和 provenance 建议。

Agent Knowledge 负责“知识产物长什么样、如何安全进入上下文”：

- `KNOWLEDGE.md` 保存 pack metadata、`profile: document-first`、`runtime.mode: data`。
- `documents/<pack-name>.md` 保存本 Skill 生成的主文档。
- `compiled/splits/` 保存运行时派生切片。
- 运行时 Resolver 只消费 KnowledgePack，不在回答用户问题时执行本 Skill。

## 工作流

1. 先盘点输入资料：增长计划、指标看板、渠道复盘、用户研究、实验记录、商业计划、预算、人力和风险说明。
2. 读取 `references/growth-strategy-template.md`，按固定章节生成知识库。
3. 缺少目标、指标口径、预算、人群、渠道资源、实验约束或停止条件时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
4. 提炼增长目标、洞察、策略假设、实验计划、复盘口径、资源配置、风险和停止条件。
5. 用 `references/growth-strategy-quality-checklist.md` 自检，必要时补一节“待补充信息清单”。
6. 返回符合 Lime Runtime Binding 契约的 JSON，供 `knowledge_compile_pack` 写回 KnowledgePack。

## Lime Runtime Binding 契约

### 输入

```text
packName: <当前知识包名>
packType: growth-strategy
profile: document-first
runtime.mode: data
sources[]: sources/ 下的来源文件摘要和相对路径
metadata.primaryDocument: documents/<packName>.md
```

### 输出

```text
primaryDocument:
  path: documents/<packName>.md
  content: <按 references/growth-strategy-template.md 生成的完整 Markdown>
status: draft | needs-review | ready | disputed
missingFacts[]: <待补充信息>
warnings[]: <质量、指标或冲突提醒>
provenance:
  kind: agent-skill
  name: growth-strategy-knowledge-builder
  version: 1.0.0
```

固定规则：

1. 不输出独立于 KnowledgePack 的新目录结构；`documents/<packName>.md` 是主文档唯一写回目标。
2. 不直接改写 `KNOWLEDGE.md`；由 Lime 写入 `metadata.producedBy`、`runtime.mode` 和状态。
3. 不把模板复制进 Lime 代码；模板和质量检查表继续留在本 Skill 的 `references/`。
4. 不在运行时回答阶段执行；仅在用户导入、重新整理或维护 pack 时调用。

## 适用场景

- 增长计划、渠道策略、实验复盘和商业计划整理
- 让 Agent 写增长方案、实验设计、复盘报告、资源测算时提供事实约束
- 多渠道增长协同、指标口径统一和停止条件确认

## 输出规则

- 区分事实、假设、策略、建议、推断和待补充信息。
- 所有目标、指标、转化率、预算、资源、结论和预测都必须来自来源资料；不确定就标注 `待补充`。
- 不替用户做投资、财务、法律或经营决策的最终判断。
- 结尾必须包含：运行时使用说明、可引用策略素材、禁止表达、人工升级条件和待补充信息清单。

## 何时读取资源

- 需要章节骨架时，读取 `references/growth-strategy-template.md`。
- 输出前做质量检查时，读取 `references/growth-strategy-quality-checklist.md`。
