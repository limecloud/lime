---
name: personal-ip-knowledge-builder
description: 将访谈稿、聊天记录、简历、公开内容、业务资料、案例和既有 DOCX/Markdown 文档，提炼成可被 AI 长期调用的个人 IP 知识库。适用于用户要求“生成个人知识库”“整理成个人 IP 成品知识库”“为创始人/专家/讲师/主播/顾问建立AI知识库”“把资料变成个人IP底层提示词/写作风格库/故事素材库/话术库”的场景。
license: Apache-2.0
metadata:
  lime_version: 1.1.0
  lime_execution_mode: prompt
  lime_surface: workbench
  lime_category: knowledge
  Lime_skill_bundle_version: "1.1.0"
---

# 个人 IP 知识库生成器

## 核心目标

把零散资料编译成一份结构化 Markdown 知识库，让后续 AI 能稳定调用这个人的事实、故事、观点、风格和边界，而不是每次临时总结。

默认输出中文；除非用户明确要求其他语言。

## 执行与交付

本 Skill 由专家会话或用户选择技能后，在当前 Thread 中执行。读取用户提供的资料，按模板整理事实、来源、冲突和待确认信息，并交付普通 Markdown 文档。

来源路径由用户指定；文件相对路径以当前工作区为基准。默认在当前工作区保存个人 IP 文档，用户明确指定文件名或目录时使用该位置。修改已有文档前先读取内容，保留有效事实和来源；覆盖、删除或访问工作区外文件沿当前工具权限与审批执行。

## 工作流

1. 先盘点输入资料：访谈、简历、聊天记录、文章、案例、产品服务、历史文案、DOCX/Markdown。
2. 如果输入是 DOCX，优先使用 `scripts/docx_to_markdown.py` 转成 Markdown 草稿。
3. 读取 `references/personal-ip-template.md`，按固定章节生成知识库。
4. 读取 `references/interview-questions.md`，识别缺失的高价值信息。
5. 缺少关键事实时，先问用户补齐；如果用户要求先生成，则用 `待补充` 标注，不要编造。
6. 提炼事实、故事、案例、方法论、价值观、表达风格、金句、可引用素材和禁忌边界。
7. 生成完整 Markdown，结尾必须包含“智能体应用指南”。
8. 用 `references/quality-checklist.md` 自检，必要时补一节“待补充信息清单”。

## 输出规则

- 不写成简历，也不写成宣传软文；要写成 AI 可调用的底层知识库。
- 区分事实、观点、推断和待补充信息。
- 保留真实语气，不要把人物包装成虚假的“成功学大师”。
- 尽量使用具体案例、数据、原话、场景和转折点。
- 每个章节都要有清晰标题，适合长期维护。
- 结尾必须包含：使用说明、AI 写作风格指南、核心价值观关键词、可引用故事素材、禁忌与边界。

## 交付格式

默认交付一个 Markdown 文档，按模板组织章节，附来源引用、待补充事实和冲突说明。用户只要求在对话中查看时，直接返回 Markdown；需要保存时写到用户指定的工作区文件。

文档可在后续普通会话中作为文件上下文读取；本 Skill 不创建专用元数据目录、后台编译记录或额外上下文状态。

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
