---
name: personal-ip-knowledge-builder
description: 将访谈稿、聊天记录、简历、公开内容、业务资料、案例和既有 DOCX/Markdown 文档，提炼成可被 AI 长期调用的个人 IP 知识库。适用于用户要求“生成个人知识库”“整理成个人 IP 成品知识库”“为创始人/专家/讲师/主播/顾问建立AI知识库”“把资料变成个人IP底层提示词/写作风格库/故事素材库/话术库”的场景。
license: Apache-2.0
compatibility:
  agentKnowledge: ">=0.6.0"
metadata:
  Lime_skill_bundle_version: "1.0.0"
  Lime_knowledge_builder: "true"
  Lime_knowledge_pack_type: "personal-profile"
  Lime_knowledge_template: "personal-ip"
  Lime_knowledge_family: "persona"
  Lime_agent_knowledge_profile: "document-first"
  Lime_agent_knowledge_runtime_mode: "persona"
---

# 个人 IP 知识库生成器

## 核心目标

把零散资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用这个人的事实、故事、观点、风格和边界，而不是每次临时总结。

默认输出中文；除非用户明确要求其他语言。

## 与 Agent Knowledge 的分工

本 Skill 只负责“怎么生产和维护知识”：

- 读取来源资料、模板、访谈问题和质量检查表。
- 生成或更新个人 IP 成品文档。
- 标记缺失事实、冲突事实和待用户确认的信息。
- 返回整理记录、质量诊断和 provenance 建议。

Agent Knowledge 负责“知识产物长什么样、如何安全进入上下文”：

- `KNOWLEDGE.md` 保存 pack metadata、`profile: document-first`、`runtime.mode: persona`。
- `documents/<pack-name>.md` 保存本 Skill 生成的主文档。
- `runs/compile-*.json` 记录本次 Builder Skill 输入、输出、版本和诊断。
- 运行时 Resolver 只消费 KnowledgePack，不在回答用户问题时执行本 Skill。

## 工作流

1. 先盘点输入资料：访谈、简历、聊天记录、文章、案例、产品服务、历史文案、DOCX/Markdown。
2. 如果输入是 DOCX，优先使用 `scripts/docx_to_markdown.py` 转成 Markdown 草稿。
3. 读取 `references/personal-ip-template.md`，按固定章节生成知识库。
4. 读取 `references/interview-questions.md`，识别缺失的高价值信息。
5. 缺少关键事实时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
6. 提炼事实、故事、案例、方法论、价值观、表达风格、金句、可引用素材和禁忌边界。
7. 生成完整 Markdown，结尾必须包含“智能体应用指南”。
8. 用 `references/quality-checklist.md` 自检，必要时补一节“待补充信息清单”。

## Lime Runtime Binding 契约

当 Lime 通过 `knowledge_compile_pack` 调用本 Skill 时，输入输出必须保持下面的最小契约。

### 输入

```text
packName: <当前知识包名>
packType: personal-profile
profile: document-first
runtime.mode: persona
sources[]: sources/ 下的来源文件摘要和相对路径
metadata.primaryDocument: documents/<packName>.md
```

### 输出

```text
primaryDocument:
  path: documents/<packName>.md
  content: <按 references/personal-ip-template.md 生成的完整 Markdown>
status: draft | needs-review | ready | disputed
missingFacts[]: <待补充信息>
warnings[]: <质量或冲突提醒>
provenance:
  kind: agent-skill
  name: personal-ip-knowledge-builder
  version: 1.0.0
```

固定规则：

1. 不输出独立于 KnowledgePack 的新目录结构；`documents/<packName>.md` 是主文档唯一写回目标。
2. 不直接改写 `KNOWLEDGE.md`；由 Lime 写入 `metadata.producedBy`、`runtime.mode` 和状态。
3. 不把模板复制进 Lime 代码；模板、访谈问题和质量检查表继续留在本 Skill 的 `references/`。
4. 不在运行时回答阶段执行；仅在用户导入、重新整理或维护 pack 时调用。

## 输出规则

- 不写成简历，也不写成宣传软文；要写成 AI 可调用的底层知识库。
- 区分事实、观点、推断和待补充信息。
- 保留真实语气，不要把人物包装成虚假的“成功学大师”。
- 尽量使用具体案例、数据、原话、场景和转折点。
- 每个章节都要有清晰标题，适合长期维护。
- 结尾必须包含：使用说明、AI 写作风格指南、核心价值观关键词、可引用故事素材、禁忌与边界。

## 推荐产物结构

在 Agent Knowledge v0.6.0 / Lime 中，优先写回：

```text
<pack-name>/
  KNOWLEDGE.md                 # 由 Lime 维护 metadata
  documents/<pack-name>.md     # 本 Skill 生成的主文档
  runs/compile-*.json          # 由 Lime 记录本次整理 provenance
```

如果用户在普通对话中只要求一份独立文档，也可以输出单一 Markdown 作为临时交付；进入 Lime KnowledgePack 时必须回到上述 `document-first` 结构。

不再默认拆成：

```text
[person-id]-personal-ip/
  knowledge.md
  facts.md
  voice.md
  stories.md
  boundaries.md
```

## 何时读取资源

- 需要章节骨架时，读取 `references/personal-ip-template.md`。
- 资料不足或要做访谈表时，读取 `references/interview-questions.md`。
- 输出前做质量检查时，读取 `references/quality-checklist.md`。
- 用户只要空白模板时，可复制 `assets/personal-ip-knowledge-skeleton.md`。

## DOCX 转 Markdown

如果需要先转换 DOCX：

```bash
python3 scripts/docx_to_markdown.py 输入.docx 输出.md
```

转换后再进行知识提炼。脚本只负责格式转换，不负责事实提炼。
