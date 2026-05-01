# Memory / 普通用户记忆研究总入口

> 状态：current research reference  
> 更新时间：2026-05-01  
> 目标：沉淀 Lime 面向普通创作者、会员用户和非研发用户的记忆与灵感库产品判断，避免把底层 Agent / runtime / memory 术语直接暴露成前台体验。

## 1. 目录定位

`docs/research/memory/` 只回答两类问题：

1. 普通用户真正需要看到什么产品对象。
2. 底层 Agent 能力应该如何翻译成用户可理解、可控制、可继续行动的前台体验。

这里是**普通用户产品研究目录**，不是 runtime 实现计划目录。

固定边界：

1. 这里可以分析会员体验、普通用户心智、竞品前台形态和 Lime 自己的产品口径。
2. 这里不直接替实现分配代码落点，也不替 `docs/aiprompts/` 定义底层工程主链。
3. 进入实现前，仍需回到对应 current 主链文档与 `docs/exec-plans/`。

## 2. 当前研究文档

1. [灵感库与记忆系统研究](./inspiration-library-memory-research.md)
   - 判断 Claude Code 记忆架构是否适合 Lime。
   - 结论：底层可学，前台不可照搬；普通用户应看到轻量灵感库，不应默认看到完整记忆工作台。

## 3. 固定产品判断

后续讨论普通用户体验时，默认遵守：

1. 前台说“灵感、参考、风格、成果、收藏、继续生成”，不默认说 `memory / prefetch / compaction / memdir`。
2. 底层事实源可以复杂，但普通用户必须能理解“它会如何影响下一轮生成”。
3. 自动沉淀必须配套查看、编辑、删除、禁用和纠偏能力。
4. 主动记忆、原始召回、命中诊断和自动整理实验默认关闭，只能通过开发者面板或高级设置显式开启。
5. 诊断层保留给高级入口，不作为普通用户默认导航。
6. Ribbi 是产品形态北极星：单主生成容器、少量创作入口、后台持续进化 taste / memory / feedback。
7. Lime 的长期资产不是一套记忆列表，而是能持续改善创作结果的 taste / reference / outcome 层。
8. Memory 不作为普通用户可关闭的整体能力；常开的是低成本 baseline，高成本 active recall、deep extraction、raw diagnostics、external provider 才进入高级开关。
9. 这条结论已按本地源码二次校准：Codex 把 `use_memories / generate_memories` 分开，Claude Code 对 session memory 做 gate 和阈值，Hermes 保留 always-on builtin memory，Warp 强调 usage / credits / model cost gate。
