---
name: brand-persona-knowledge-builder
description: 将品牌定位、价值观、受众画像、语气风格、内容样例、危机回应和表达禁区，整理成符合 Agent Knowledge v0.6 document-first 标准、可被 AI 安全调用的品牌人设知识库。适用于用户要求“整理品牌人设”“沉淀品牌口吻”“把品牌资料变成可复用语气库”“维护品牌 persona pack”的场景。
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
  Lime_knowledge_pack_type: "brand-persona"
  Lime_knowledge_template: "brand-persona"
  Lime_knowledge_family: "persona"
  Lime_agent_knowledge_profile: "document-first"
  Lime_agent_knowledge_runtime_mode: "persona"
---

# 品牌人设知识库生成器

## 核心目标

把零散品牌资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用品牌的价值观、表达方式、语气边界、标志性内容、危机回应和禁忌，而不是每次临时总结品牌口吻。

默认输出中文；除非用户明确要求其他语言。

## 与 Agent Knowledge 的分工

本 Skill 只负责“怎么生产和维护知识”：

- 读取来源资料、模板、访谈问题和质量检查表。
- 生成或更新 `brand-persona` 主文档。
- 标记缺失事实、冲突定位、语气漂移风险和待用户确认的信息。
- 返回整理记录、质量诊断和 provenance 建议。

Agent Knowledge 负责“知识产物长什么样、如何安全进入上下文”：

- `KNOWLEDGE.md` 保存 pack metadata、`profile: document-first`、`runtime.mode: persona`。
- `documents/<pack-name>.md` 保存本 Skill 生成的主文档。
- `compiled/splits/` 保存运行时派生切片。
- 运行时 Resolver 只消费 KnowledgePack，不在回答用户问题时执行本 Skill。

## 工作流

1. 先盘点输入资料：品牌手册、官网文案、历史内容、客服话术、创始人访谈、用户评价、危机案例和禁用词。
2. 读取 `references/brand-persona-template.md`，按固定章节生成知识库。
3. 读取 `references/interview-questions.md`，识别缺失的品牌定位、受众、语气和边界信息。
4. 缺少关键事实、品牌承诺、目标受众或表达边界时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
5. 提炼品牌内核、受众关系、声音语气、表达模式、标志性表达、内容样例、危机回应和禁止表达。
6. 用 `references/quality-checklist.md` 自检，必要时补一节“待补充信息清单”。
7. 返回符合 Lime Runtime Binding 契约的 JSON，供 `knowledge_compile_pack` 写回 KnowledgePack。

## Lime Runtime Binding 契约

### 输入

```text
packName: <当前知识包名>
packType: brand-persona
profile: document-first
runtime.mode: persona
sources[]: sources/ 下的来源文件摘要和相对路径
metadata.primaryDocument: documents/<packName>.md
```

### 输出

```text
primaryDocument:
  path: documents/<packName>.md
  content: <按 references/brand-persona-template.md 生成的完整 Markdown>
status: draft | needs-review | ready | disputed
missingFacts[]: <待补充信息>
warnings[]: <质量、定位或语气冲突提醒>
provenance:
  kind: agent-skill
  name: brand-persona-knowledge-builder
  version: 1.0.0
```

固定规则：

1. 不输出独立于 KnowledgePack 的新目录结构；`documents/<packName>.md` 是主文档唯一写回目标。
2. 不直接改写 `KNOWLEDGE.md`；由 Lime 写入 `metadata.producedBy`、`runtime.mode` 和状态。
3. 不把模板复制进 Lime 代码；模板、访谈问题和质量检查表继续留在本 Skill 的 `references/`。
4. 不在运行时回答阶段执行；仅在用户导入、重新整理或维护 pack 时调用。

## 适用场景

- 品牌故事、公众号 / 视频号内容、小红书 / 抖音短内容、客服话术和危机回应草稿
- 多成员共用一个品牌口吻，避免每个人写出来都像不同品牌
- 与 `brand-product` data pack 协同：brand-persona 决定“怎么说”，brand-product 决定“说什么事实”

## 输出规则

- 不写成品牌宣传软文；要写成 AI 可调用的品牌表达底层知识库。
- 区分事实、品牌主张、推断和待补充信息。
- 保留真实品牌调性，不要把品牌包装成无来源的“高端”“领先”“第一”。
- 所有口号、价值观、用户承诺、案例、危机回应原则都必须来自来源资料；不确定就标注 `待补充`。
- 结尾必须包含：运行时使用说明、AI 写作风格指南、品牌价值关键词、可引用表达素材、禁忌与边界。

## 何时读取资源

- 需要章节骨架时，读取 `references/brand-persona-template.md`。
- 资料不足或要做访谈表时，读取 `references/interview-questions.md`。
- 输出前做质量检查时，读取 `references/quality-checklist.md`。
