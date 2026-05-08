---
name: organization-knowhow-knowledge-builder
description: 将团队 SOP、交付流程、角色职责、项目复盘、FAQ、决策边界和升级机制，整理成符合 Agent Knowledge v0.6 document-first 标准、可被 AI 安全调用的组织经验知识库。适用于用户要求“整理组织知识库”“沉淀团队 SOP”“把交付经验变成项目资料”“维护组织 know-how”的场景。
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
  Lime_knowledge_pack_type: "organization-knowhow"
  Lime_knowledge_template: "organization-knowhow"
  Lime_knowledge_family: "data"
  Lime_agent_knowledge_profile: "document-first"
  Lime_agent_knowledge_runtime_mode: "data"
---

# 组织经验知识库生成器

## 核心目标

把零散组织资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用已确认的 SOP、角色职责、决策边界、交付标准、升级机制和复盘经验，而不是每次临时总结。

默认输出中文；除非用户明确要求其他语言。

## 与 Agent Knowledge 的分工

本 Skill 只负责“怎么生产和维护知识”：

- 读取来源资料、模板和质量检查表。
- 生成或更新 `organization-knowhow` 主文档。
- 标记缺失事实、冲突事实、责任不清和待用户确认的信息。
- 返回整理记录、质量诊断和 provenance 建议。

Agent Knowledge 负责“知识产物长什么样、如何安全进入上下文”：

- `KNOWLEDGE.md` 保存 pack metadata、`profile: document-first`、`runtime.mode: data`。
- `documents/<pack-name>.md` 保存本 Skill 生成的主文档。
- `compiled/splits/` 保存运行时派生切片。
- 运行时 Resolver 只消费 KnowledgePack，不在回答用户问题时执行本 Skill。

## 工作流

1. 先盘点输入资料：SOP、项目手册、交付模板、会议纪要、复盘、FAQ、组织架构、权限边界和风险说明。
2. 读取 `references/organization-knowhow-template.md`，按固定章节生成知识库。
3. 缺少责任人、决策规则、升级路径、质量标准或验收口径时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
4. 提炼适用场景、角色职责、标准流程、检查点、风险预案、FAQ 和持续改进口径。
5. 用 `references/organization-knowhow-quality-checklist.md` 自检，必要时补一节“待补充信息清单”。
6. 返回符合 Lime Runtime Binding 契约的 JSON，供 `knowledge_compile_pack` 写回 KnowledgePack。

## Lime Runtime Binding 契约

### 输入

```text
packName: <当前知识包名>
packType: organization-knowhow
profile: document-first
runtime.mode: data
sources[]: sources/ 下的来源文件摘要和相对路径
metadata.primaryDocument: documents/<packName>.md
```

### 输出

```text
primaryDocument:
  path: documents/<packName>.md
  content: <按 references/organization-knowhow-template.md 生成的完整 Markdown>
status: draft | needs-review | ready | disputed
missingFacts[]: <待补充信息>
warnings[]: <质量、责任或冲突提醒>
provenance:
  kind: agent-skill
  name: organization-knowhow-knowledge-builder
  version: 1.0.0
```

固定规则：

1. 不输出独立于 KnowledgePack 的新目录结构；`documents/<packName>.md` 是主文档唯一写回目标。
2. 不直接改写 `KNOWLEDGE.md`；由 Lime 写入 `metadata.producedBy`、`runtime.mode` 和状态。
3. 不把模板复制进 Lime 代码；模板和质量检查表继续留在本 Skill 的 `references/`。
4. 不在运行时回答阶段执行；仅在用户导入、重新整理或维护 pack 时调用。

## 适用场景

- 团队 SOP、交付流程、项目复盘和 FAQ 整理
- 让 Agent 写执行清单、交付 brief、项目提醒、复盘报告时提供组织约束
- 新成员 onboarding、跨团队协作和异常升级场景

## 输出规则

- 区分事实、SOP、建议、推断和待补充信息。
- 所有职责、流程、权限、验收标准和风险处置都必须来自来源资料；不确定就标注 `待补充`。
- 不替代管理层、法务、财务或安全负责人做最终判断。
- 结尾必须包含：运行时使用说明、可引用 SOP、禁止越权事项、人工升级条件和待补充信息清单。

## 何时读取资源

- 需要章节骨架时，读取 `references/organization-knowhow-template.md`。
- 输出前做质量检查时，读取 `references/organization-knowhow-quality-checklist.md`。
