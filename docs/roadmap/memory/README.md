# Lime 灵感库 / 记忆产品路线图

> 状态：current planning source  
> 更新时间：2026-05-01  
> 目标：把 Lime 的底层记忆能力收敛成面向创作者的 `灵感库` 产品，而不是把 Claude Code 式记忆工作台直接暴露给普通用户。

## 1. 本路线图回答什么

本目录统一回答下面几类问题：

1. Lime 为什么继续参考 Claude Code 的记忆架构，但不照搬它的前台形态。
2. 普通用户默认能看到哪些灵感对象，哪些底层记忆诊断必须隐藏到高级入口。
3. `unified_memory_*`、`memory_runtime_*`、`agent_runtime_compact_session` 与前台 `灵感库` 的边界如何划分。
4. 结果、参考、风格、偏好如何沉淀成可继续生成的创作者资产。
5. 主动记忆、自动整理实验、raw recall / hit layer 如何通过开发者面板开关，且默认关闭。
6. 后续如何分阶段把当前 MemoryPage 从“灵感库 + 记忆诊断混合页”收口成“普通用户灵感库 + 高级诊断工作台”。
7. 灵感、记忆、历史结果和反馈如何让下一次生成更像用户，而不是依赖单个 system prompt，也不是把个性化做成重服务端 AI Agent 或自有小模型训练。

## 2. 参考事实源

外部研究：

1. [../../research/memory/README.md](../../research/memory/README.md)
2. [../../research/memory/inspiration-library-memory-research.md](../../research/memory/inspiration-library-memory-research.md)
3. [../../research/ribbi/taste-memory-evolution.md](../../research/ribbi/taste-memory-evolution.md)
4. [../../research/warp/claudecode-compatibility.md](../../research/warp/claudecode-compatibility.md)
5. OpenClaw 本地调研：`/Users/coso/Documents/dev/js/openclaw/docs/concepts/memory.md`、`active-memory.md`、`dreaming.md`
6. Codex 本地调研：`/Users/coso/Documents/dev/rust/codex/codex-rs/config/src/types.rs`、`memories/read/src/prompts.rs`、`memories/write/src/start.rs`、`memories/write/src/guard.rs`
7. Claude Code 本地调研：`/Users/coso/Documents/dev/js/claudecode/src/memdir/findRelevantMemories.ts`、`services/SessionMemory/sessionMemory.ts`、`services/SessionMemory/sessionMemoryUtils.ts`、`services/compact/autoCompact.ts`
8. Hermes Agent 本地调研：`/Users/coso/Documents/dev/python/hermes-agent/agent/memory_manager.py`、`memory_provider.py`、`tools/memory_tool.py`、`agent/context_compressor.py`
9. Warp 本地调研：`/Users/coso/Documents/dev/rust/warp/app/src/ai/request_usage_model.rs`、`terminal/input.rs`、`terminal/profile_model_selector.rs`、`ai/blocklist/context_model.rs`
10. Ribbi 访谈外部线索：[智源社区转载](https://hub.baai.ac.cn/view/53981)、[知乎专栏](https://zhuanlan.zhihu.com/p/2027420996353761358)、[36Kr 访谈](https://eu.36kr.com/zh/p/3778121523025154)

Lime current 主链：

1. [../../aiprompts/memory-compaction.md](../../aiprompts/memory-compaction.md)
2. [../../aiprompts/governance.md](../../aiprompts/governance.md)
3. [../../aiprompts/commands.md](../../aiprompts/commands.md)
4. [../limenextv2/README.md](../limenextv2/README.md)
5. [../limenextv2/product-principles.md](../limenextv2/product-principles.md)

## 3. 固定结论

### 3.1 Claude Code 是架构参考，不是前台模板

Lime 继续学习 Claude Code 的：

1. 分层记忆来源。
2. 自动抽取与去重。
3. 会话记忆与长期记忆分离。
4. 相关性召回，而不是全量拼接。
5. 压缩续接。
6. 用户可审阅、可编辑、可删除。

Lime 不照搬 Claude Code 的：

1. `CLAUDE.md / MEMORY.md` 前台语言。
2. `/memory` 式工程命令入口。
3. 以文件和规则为中心的普通用户心智。
4. 把 runtime 诊断信息作为默认导航。

固定裁决：

**底层按 Claude Code 分层，前台按 Lime 创作者心智重写。**

### 3.2 灵感库不是另一套数据库

`灵感库` 是 `unified_memory` 的普通用户投影，不新增平行事实源。

固定映射：

| `unified_memory.category` | 灵感库前台对象 | 用户理解 |
| --- | --- | --- |
| `identity` | 风格线索 | 这像我的表达、审美或品牌感 |
| `context` | 参考素材 | 下次生成要带上的资料、案例或链接 |
| `preference` | 偏好约束 | 以后要遵守或避免的取舍 |
| `experience` | 成果打法 | 已经跑通、下次能复用的结构或结果 |
| `activity` | 收藏备选 | 暂存，等待整理成更稳定资产 |

### 3.3 普通用户默认只看前台价值

默认开放：

1. 灵感总览。
2. 风格 / 参考 / 成果 / 偏好 / 收藏。
3. 保存结果到灵感库。
4. 围绕灵感继续生成。
5. 编辑、删除、禁用、解释影响。
6. 自动整理建议。

默认隐藏：

1. 来源链。
2. working memory。
3. runtime prefetch。
4. Team Memory shadow。
5. compaction summary。
6. memdir scaffold / cleanup。
7. source bucket / provider / memory type。
8. active memory recall preview。
9. raw source / hit layer。
10. auto organization / dreaming 实验。

一句话：

**普通用户要的是“我的创作资产越来越懂我”，不是“我会管理一套 Agent 记忆系统”。**

### 3.4 Ribbi 是产品形态北极星

固定判断：

**Ribbi 是 Lime 的产品形态参考；Claude Code、OpenClaw、Hermes 是底层记忆架构参考。**

这意味着：

1. 普通前台继续压缩到 `生成` 主容器、`灵感库`、少量创作入口和继续动作。
2. taste / reference / memory / feedback 在后台持续进化，但不以底层术语争夺主导航。
3. 主动记忆、raw recall 预览、自动整理实验和外部 provider 进入开发者面板 / 高级设置，默认关闭。
4. 默认关闭不是放弃建设，而是把高风险能力留在可观察、可回滚、可审计的成熟路径里。

### 3.5 “更像我”靠个性化上下文编排，不靠顶层 Prompt Router

固定判断：

**Lime 的顶层能力叫 `Personalization Context Orchestration / 个性化上下文编排`；`Promptlet Router` 只是选择细粒度 promptlet 的子模块。**

这意味着：

1. `Prompt Router` 作为顶层名称会和现有 `model routing` 混淆，不作为路线图主术语。
2. 默认路线不训练自有小模型，也不把个性化做成重服务端 AI Agent；先用客户端优先的现有模型调用、缓存、相关性召回、promptlet 分层和 `Generation Brief` 编译实现个性化。
3. 灵感库影响下一次生成时，必须先变成可解释、可禁用、可回滚的创作简报，不把所有灵感全量拼进 prompt。
4. Claude Code 的多 prompt 边界值得学；Ribbi 的 taste layer 和 companion 产品表达值得学；两者都不应该变成普通用户可见的 prompt 管理器。
5. Buddy / Ribbi 青蛙类能力只作为 `Companion Overlay`，不写入创作事实源，不覆盖用户 / 品牌 / 任务约束。
6. Companion 采用 `bones + soul` 边界：外观、稀有度和基础属性 deterministic；`personality / soul` 可生成、可编辑、可持久化。
7. 服务端只做必要同步、授权、模型访问代理、配置下发和可选云能力；不承接长期个性化训练主链。
8. Memory 不能作为整体能力关闭；必须常开的只是低成本 baseline，高成本 active recall / deep extraction / raw diagnostics 才默认分层或关闭。
9. Codex 虽然有 `use_memories / generate_memories` 开关，但它面向开发者配置；对 Lime 的借鉴是拆 read / write / enhancement，而不是给普通用户一个总失忆开关。

## 4. 目录文档分工

1. [prd.md](./prd.md)
   - 产品背景、用户、目标、范围、需求、指标和验收。
2. [architecture.md](./architecture.md)
   - 前台投影、底层记忆主链、数据边界、current / compat / deprecated 分类。
3. [diagrams.md](./diagrams.md)
   - 架构图、时序图、流程图、状态图和分层图。
4. [rollout-plan.md](./rollout-plan.md)
   - 分阶段实施切片、风险、验证和迁移顺序。
5. [acceptance.md](./acceptance.md)
   - 普通用户、进阶用户、诊断用户和工程边界验收标准。
6. [make-next-generation-more-like-me.md](./make-next-generation-more-like-me.md)
   - 个性化上下文编排、promptlet 分层、`Generation Brief`、Buddy / Ribbi companion 边界和“客户端优先、不训练自有小模型”的论证。

## 5. 分阶段总览

| 阶段 | 目标 | 主产物 |
| --- | --- | --- |
| Phase 0 | 固定口径与事实源 | research + PRD + current/advanced 分层 |
| Phase 1 | 拆普通灵感库与高级诊断 | `MemoryPage` IA 分层，开发者面板开关默认关闭，不改底层事实源 |
| Phase 2 | 补用户控制 | 编辑、删除、禁用、影响解释、整理建议 |
| Phase 3 | 做自动整理队列 | 自动抽取 -> 待确认 -> 入库 / 忽略 / 合并 |
| Phase 4 | 强化生成闭环 | 保存结果 -> 推荐信号 -> 围绕灵感继续生成 |
| Phase 5 | 味觉层 / 方法层融合 | taste summary、`Generation Brief`、我的方法、结果复盘互相回流 |
| Phase 6 | 高级诊断收口 | runtime memory / compaction / Team Memory / active recall 仅开发者面板或高级入口 |

## 6. 当前必须避免的误区

1. 把“记忆能力”做成普通用户默认概念。
2. 新增 `inspiration_*` 数据库表，和 `unified_memory_*` 形成双事实源。
3. 把 session working memory 直接沉淀成长期灵感。
4. 为了看起来智能，把所有聊天历史都保存成灵感。
5. 没有编辑 / 删除 / 禁用能力就自动影响生成。
6. 把高级诊断页误当成主导航体验。
7. 因为默认关闭 active memory / diagnostics，就推迟建设底层审计、fenced recall 和用户控制。

## 7. 这一步如何服务主线

这套路线图的主线收益是：

**把 Lime 已经存在的 memory runtime、unified memory、结果沉淀和推荐信号收成一个面向创作者的灵感库产品闭环，同时保留 Claude Code 式底层治理能力。**
