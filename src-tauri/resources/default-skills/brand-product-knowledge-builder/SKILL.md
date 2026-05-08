---
name: brand-product-knowledge-builder
description: 将品牌产品资料、规格参数、卖点证据、FAQ、价格权益、竞品区别和合规边界，整理成符合 Agent Knowledge v0.6 document-first 标准、可被 AI 安全调用的产品资料知识库。适用于用户要求“整理产品知识库”“沉淀产品 FAQ”“把品牌产品资料变成项目资料”“维护产品资料包”的场景。
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
  Lime_knowledge_pack_type: "brand-product"
  Lime_knowledge_template: "brand-product"
  Lime_knowledge_family: "data"
  Lime_agent_knowledge_profile: "document-first"
  Lime_agent_knowledge_runtime_mode: "data"
---

# 品牌产品知识库生成器

## 核心目标

把零散产品资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用已确认的产品事实、卖点证据、使用边界、FAQ、价格权益和合规禁区，而不是每次临时总结。

默认输出中文；除非用户明确要求其他语言。

## 与 Agent Knowledge 的分工

本 Skill 只负责“怎么生产和维护知识”：

- 读取来源资料、模板和质量检查表。
- 生成或更新 `brand-product` 主文档。
- 标记缺失事实、冲突事实、合规风险和待用户确认的信息。
- 返回整理记录、质量诊断和 provenance 建议。

Agent Knowledge 负责“知识产物长什么样、如何安全进入上下文”：

- `KNOWLEDGE.md` 保存 pack metadata、`profile: document-first`、`runtime.mode: data`。
- `documents/<pack-name>.md` 保存本 Skill 生成的主文档。
- `compiled/splits/` 保存运行时派生切片。
- 运行时 Resolver 只消费 KnowledgePack，不在回答用户问题时执行本 Skill。

## 工作流

1. 先盘点输入资料：产品手册、官网文案、价格表、FAQ、客服记录、竞品对比、资质证明、案例和合规说明。
2. 读取 `references/brand-product-template.md`，按固定章节生成知识库。
3. 缺少关键事实、资质、价格、权益或数据时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
4. 提炼产品定位、适用人群、事实清单、卖点证据、异议处理、渠道表达和禁止承诺。
5. 用 `references/brand-product-quality-checklist.md` 自检，必要时补一节“待补充信息清单”。
6. 返回符合 Lime Runtime Binding 契约的 JSON，供 `knowledge_compile_pack` 写回 KnowledgePack。

## Lime Runtime Binding 契约

### 输入

```text
packName: <当前知识包名>
packType: brand-product
profile: document-first
runtime.mode: data
sources[]: sources/ 下的来源文件摘要和相对路径
metadata.primaryDocument: documents/<packName>.md
```

### 输出

```text
primaryDocument:
  path: documents/<packName>.md
  content: <按 references/brand-product-template.md 生成的完整 Markdown>
status: draft | needs-review | ready | disputed
missingFacts[]: <待补充信息>
warnings[]: <质量、合规或冲突提醒>
provenance:
  kind: agent-skill
  name: brand-product-knowledge-builder
  version: 1.0.0
```

固定规则：

1. 不输出独立于 KnowledgePack 的新目录结构；`documents/<packName>.md` 是主文档唯一写回目标。
2. 不直接改写 `KNOWLEDGE.md`；由 Lime 写入 `metadata.producedBy`、`runtime.mode` 和状态。
3. 不把模板复制进 Lime 代码；模板和质量检查表继续留在本 Skill 的 `references/`。
4. 不在运行时回答阶段执行；仅在用户导入、重新整理或维护 pack 时调用。

## 适用场景

- 产品资料、品牌手册、FAQ、销售话术和客服知识库整理
- 让 Agent 写产品介绍、渠道话术、直播讲解、客服答复时提供事实约束
- 多渠道发布前统一价格、权益、禁区和人工确认边界

## 输出规则

- 区分事实、卖点、证据、建议、推断和待补充信息。
- 所有规格、价格、权益、功效、资质、对比和结果都必须来自来源资料；不确定就标注 `待补充`。
- 不替用户做法律、医疗、财务或平台规则的最终判断。
- 结尾必须包含：运行时使用说明、可引用素材、禁止表达、人工升级条件和待补充信息清单。

## 何时读取资源

- 需要章节骨架时，读取 `references/brand-product-template.md`。
- 输出前做质量检查时，读取 `references/brand-product-quality-checklist.md`。
