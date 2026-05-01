# 灵感库与记忆系统研究

> 状态：current research reference  
> 更新时间：2026-05-01  
> 研究样本：`/Users/coso/Documents/dev/rust/codex`、`/Users/coso/Documents/dev/js/claudecode`、`/Users/coso/Documents/dev/js/lobehub`、`/Users/coso/Documents/dev/rust/warp`、`/Users/coso/Documents/dev/js/openclaw`、`/Users/coso/Documents/dev/python/hermes-agent`、`docs/research/ribbi`  
> 目标：判断 Lime 是否应该继续参考 Claude Code 的记忆架构，以及普通创作者是否应该直接看到当前完整“灵感库 / 记忆工作台”。

## 1. 研究结论

Claude Code 是 Lime 记忆系统最值得参考的底层架构样本，但不应该成为 Lime 普通用户的前台产品形态。

固定判断：

1. **底层方向是对的**
   - Lime 应继续学习 Claude Code 的分层记忆、文件化事实源、会话记忆、自动抽取、压缩续接和显式管理入口。
   - 这些能力解决的是 Agent 产品的共同问题：跨会话连续性、上下文预算、用户偏好沉淀、旧信息可审计与可删除。

2. **前台形态不能照搬**
   - Claude Code 面向开发者，用户能理解 `CLAUDE.md`、rules、memory directory、session memory、tool history 和 compaction。
   - Lime 面向创作者与普通用户，前台应使用“灵感、参考、风格、成果、收藏、继续生成”这些行动语言，而不是 memory runtime 术语。

3. **普通用户应该看到轻量灵感库，不应该看到完整记忆工作台**
   - 可以开放：参考素材、风格线索、成果沉淀、偏好 / 禁忌、收藏备选、围绕某条灵感继续生成。
   - 默认隐藏：来源链、working memory、runtime prefetch、Team Memory、compaction summary、memdir、命中历史和诊断层。
   - 主动记忆、原始召回预览、自动整理实验和 raw hit layer 应进入开发者面板 / 高级设置，默认关闭。

4. **Ribbi 才是 Lime 的产品形态北极星**
   - Ribbi 的关键不是“给用户一个记忆页”，而是让主生成容器持续持有 taste / reference / memory / feedback。
   - Claude Code、OpenClaw、Hermes 更像底层工程参考；Ribbi 更像普通创作者能感知到的前台形态。
   - 因此 Lime 要把复杂记忆能力压到执行前编译层和后台进化层，而不是抬成普通导航。

5. **Lime 的机会不是“有记忆”，而是把记忆转成创作者资产**
   - Claude Code 记住的是“怎么帮你写代码”。
   - Lime 应记住的是“怎么帮你持续产出更像你的内容”。
   - 因此前台中心应继续叫 `灵感库`，底层可以继续叫 `memory / runtime memory / unified memory`。

6. **对“默认关闭”的批判性结论**
   - 你提出“开发者面板开关、默认关闭”是对的，但理由不是这些能力不重要。
   - 真正理由是：主动召回和诊断层会直接影响信任、隐私感、误召回体验和认知负担，必须等控制、解释、回滚和审计成熟后再逐步开放。
   - 反过来，如果因为默认关闭就不建设后台能力，Lime 会失去长期个性化飞轮；正确策略是后台继续建设，前台延迟暴露。

一句话：

**借 Claude Code 的骨架，换成创作者可理解的灵感库前台。**

### 1.1 本地源码二次校准：不能把“默认关闭”写成“不要记忆”

本轮只按本地源码重新核对 `/Users/coso/Documents/dev/rust/warp`、`/Users/coso/Documents/dev/rust/codex`、`/Users/coso/Documents/dev/js/claudecode`、`/Users/coso/Documents/dev/python/hermes-agent`，结论需要比上一版更精确：

1. **Codex 证明 read / write 可以拆开控制，不证明 Lime 应给普通用户一个总关闭开关**
   - `codex-rs/config/src/types.rs` 定义 `use_memories` 与 `generate_memories`，默认都为 `true`；`use_memories = false` 只是不注入 memory developer instructions，`generate_memories = false` 影响新线程是否生成记忆。
   - `codex-rs/core/src/session/mod.rs` 只有在 `Feature::MemoryTool`、`config.memories.use_memories` 和 `memory_summary.md` 存在时才注入 memory prompt。
   - `codex-rs/memories/write/src/start.rs` 的后台写入管线还会跳过 ephemeral、subagent、state DB 不可用和 rate limit 不足的场景。
   - 对 Lime 的含义：工程上要拆 baseline read、background write、diagnostics / enhancement；普通用户不应看到“关闭所有记忆导致产品失忆”的主开关。

2. **Claude Code 证明昂贵 session memory / relevant recall 必须 gate，不证明每轮全量记忆**
   - `src/memdir/findRelevantMemories.ts` 只让 Sonnet 从 manifest 里选最多 5 条相关 memory，失败时返回空，不阻塞主流程。
   - `src/services/SessionMemory/sessionMemoryUtils.ts` 默认阈值是初始化 10000 tokens、两次更新间隔 5000 tokens、3 次 tool calls。
   - `src/services/SessionMemory/sessionMemory.ts` 只在 main REPL thread、feature gate 开、auto compact 开、达到阈值后，用 forked subagent 后台更新。
   - 对 Lime 的含义：高成本抽取、会话总结、全库重排和 raw recall preview 应 gate；短摘要和已确认偏好应常开。

3. **Hermes 证明 built-in memory baseline 应常在，外部 provider 只能做 additive enhancement**
   - `agent/memory_provider.py` 明确 built-in memory always active，external providers additive，且最多一个 external provider。
   - `tools/memory_tool.py` 使用 `MEMORY.md / USER.md` frozen snapshot，默认字符预算 `2200 / 1375`，中途写盘不改变当前 system prompt。
   - `agent/memory_manager.py` 把 recalled context 包进 `<memory-context>`，说明它不是新用户输入。
   - 对 Lime 的含义：用户偏好、禁用列表、已确认 taste / voice summary 属于 baseline；外部 provider、active recall 和深度整理才是高级增强。

4. **Warp 不是长期 memory 样本，主要证明成本、限额和上下文附件必须前置 gate**
   - `app/src/ai/request_usage_model.rs` 缓存 request limit，计算 `has_requests_remaining / has_any_ai_remaining`，并包含 voice、codebase index、embedding batch 等限制。
   - `app/src/terminal/input.rs` 在发起 AI query 前检查配额，不足就 banner / refresh usage / return。
   - `app/src/terminal/profile_model_selector.rs` 在模型选择 UI 显示 Intelligence、Speed、Cost；BYOK 时显示 billed to API。
   - `app/src/ai/blocklist/context_model.rs` 管理 pending context，并把 block output summary 控制在有限摘要里。
   - 对 Lime 的含义：用户成本模式必须早于 brief 编译；memory enhancement 也要受 budget class、usage limit 和模型路由约束。

因此本文档后续所有“默认关闭”都只指高成本、高风险、诊断型能力；不指 `Memory baseline`。

## 2. 参考产品拆解

### 2.1 Codex：后台管线优先，不把记忆当普通前台页

本地样本：`/Users/coso/Documents/dev/rust/codex`，`main`，HEAD `8f3c06cc97`，最后提交时间 `2026-04-30 04:46:32 +0000`。

关键事实：

1. `codex-rs/memories/README.md` 把记忆拆成 `read` 与 `write` 两类 crate。
2. 记忆管线在 root session 启动时异步运行，并要求非 ephemeral、记忆功能启用、非 sub-agent、state DB 可用。
3. Phase 1 从近期可用 rollout 中抽取结构化记忆并写回 state DB。
4. Phase 2 串行合并 stage-1 输出到文件化记忆工作区，再让内部 consolidation agent 更新更高层记忆产物。
5. 记忆根目录带 git baseline，用 workspace diff 判断是否需要 consolidation agent 介入。
6. `codex-rs/config/src/types.rs` 把 `use_memories` 和 `generate_memories` 分开，默认值均为 `true`，说明读路径和写路径是不同开关。
7. `codex-rs/memories/read/src/prompts.rs` 只注入 `memory_summary.md`，并用 5000 token 上限截断，不把原始记忆全量塞入 prompt。
8. `codex-rs/memories/write/src/guard.rs` 在 rate limit 低于阈值时跳过 startup memory pipeline；`start.rs` 先做不耗 token 的 prune，再检查配额。

对 Lime 的启发：

- 记忆整理应尽量异步，不阻塞主生成链。
- 长期记忆需要可审计的中间工件，而不是只存在数据库黑盒里。
- 普通用户不需要看到 Phase 1 / Phase 2 管线；他们只需要看到整理后的可用资产。
- 读路径应该注入小而稳定的 summary / evidence id；写路径、整理路径和诊断路径可以被限流、延迟或跳过。
- Codex 有开发者可控的 read / write 开关，但这是编程工具心智；Lime 不应直接复制成普通用户“关闭所有记忆”的按钮。

### 2.2 Claude Code：最适合 Lime 学的底层记忆架构

本地样本：`/Users/coso/Documents/dev/js/claudecode`。

关键事实：

1. 官方 Claude Code 文档把 memory 分成企业、项目、用户、项目本地等层级，并用 `/memory` 查看或编辑当前加载的 memory 文件。
2. 本地 `src/memdir/memoryTypes.ts` 把 auto-memory 约束为 `user / feedback / project / reference` 四类。
3. 该类型定义明确禁止保存可由当前项目状态推导出的事实，例如代码结构、文件路径、git 历史和临时任务状态。
4. `src/memdir/findRelevantMemories.ts` 只从 header / description manifest 里选择最多 5 条高度相关记忆，排除已 surfaced 的路径，失败时返回空。
5. `src/services/SessionMemory/sessionMemoryUtils.ts` 的默认阈值是初始化 10000 tokens、两次更新间隔 5000 tokens、3 次 tool calls。
6. `src/services/SessionMemory/sessionMemory.ts` 只在 main REPL thread、feature gate 开、auto compact 开、达到阈值后运行，并用后台 forked subagent 更新当前会话 markdown 记忆文件。
7. `src/services/compact/autoCompact.ts` 使用 effective context window、buffer tokens、warning / error / blocking 阈值，并在连续失败 3 次后 circuit breaker，避免无限烧 API。
8. `src/services/extractMemories/prompts.ts` 要求抽取 agent 先看已有 memory manifest，再更新或去重，避免重复写入。
9. `src/skills/bundled/remember.ts` 的 `remember` skill 只提出整理建议，不直接改文件，体现了“先审阅、再确认”的高风险记忆治理边界。

对 Lime 的启发：

- Lime 底层应保留 `用户偏好 / 反馈 / 项目上下文 / 外部参考` 这类分层。
- 记忆写入要有“不要保存什么”的强约束，避免把流水账、临时状态和可重新读取的事实变成噪音。
- 记忆召回应按相关性选择，而不是全量拼接。
- 自动整理需要用户可审阅、可删除、可纠偏。
- session memory、自动压缩、相关记忆选择都必须有 gate、阈值、top-k 和失败降级；不能成为每轮必跑的高价路径。

不能照搬的地方：

- `CLAUDE.md`、`MEMORY.md`、rules、memory directory 是开发者可理解对象，不是创作者前台对象。
- `/memory` 是工程工具入口；Lime 普通用户需要的是“整理灵感 / 编辑风格 / 继续生成”的可视化入口。
- Claude Code 的记忆默认服务代码协作；Lime 的记忆应服务内容创作、审美连续性和结果复用。

### 2.3 LobeHub：更接近普通用户产品的记忆分类

本地样本：`/Users/coso/Documents/dev/js/lobehub`，`main`，HEAD `71cfba9906`，最后提交时间 `2026-04-29 14:09:35 +0000`。

关键事实：

1. `apps/cli/src/commands/memory.ts` 把用户记忆分为 `identity / activity / context / experience / preference`。
2. CLI 支持 list、create、edit、delete、persona、extract、extract-status。
3. `src/locales/default/memory.ts` 显示前台有 Home、Search、Identities、Activities、Contexts、Experiences、Preferences 等记忆页签。
4. `packages/context-engine/src/providers/UserMemoryInjector*` 负责把用户记忆注入 context engine。

对 Lime 的启发：

- 普通用户可以看到记忆，但必须被翻译成清晰分类和可管理对象。
- `experience / preference / context` 与 Lime 的 `成果 / 偏好 / 参考` 有天然映射。
- 消费级前台必须提供搜索、编辑、删除和抽取状态，而不是只让用户相信后台会自动做对。

不能照搬的地方：

- LobeHub 的 memory 仍偏通用 AI 助手；Lime 应更偏创作资产与下一轮生成入口。
- Lime 不应把所有记忆都做成平铺列表，而应优先展示“哪些会影响下一次生成”。

### 2.4 Warp：不是长期记忆样本，主要参考成本 / 配额 / 上下文 gate

本地样本：`/Users/coso/Documents/dev/rust/warp`，`master`，HEAD `4dddda6`，最后提交时间 `2026-04-29 22:02:31 -0700`。

关键事实：

1. `app/src/ai/request_usage_model.rs` 定义 `RequestLimitInfo`，包含 request limit、used、next refresh、voice limit、codebase index limit、max files per repo、embedding batch size 等配额字段。
2. `AIRequestUsageModel` 从服务端刷新 usage，并把 request limit info 缓存在本地 private user preferences。
3. `has_requests_remaining()` 与 `has_any_ai_remaining()` 在发起 AI 前判断 base plan、bonus credits、overage、enterprise PAYG、BYOK API key 等条件。
4. `app/src/terminal/input.rs` 在 submit AI query 前检查配额；如果不足，会启用 buy credits banner、发 telemetry、按 10 秒节流刷新 usage，并直接 return。
5. `app/src/terminal/profile_model_selector.rs` 在模型选择 UI 中展示 Intelligence、Speed、Cost；BYOK 时显示 `Billed to API`。
6. `app/src/ai/blocklist/context_model.rs` 定义 pending context 为“attach to the next AI query”，并对 terminal block 输出使用 `content_summary(5000, 5000, false)` 级别的摘要，而不是长期记忆库。

对 Lime 的启发：

- Warp 不能作为“普通用户应关闭 / 不关闭 memory”的直接证据，因为本地代码更偏 request usage、模型选择和下一次 query 的 pending context。
- 但 Warp 证明了成本和配额必须在发起 AI 前拦截，不能等 prompt 编译后才发现用户没额度。
- 模型选择 UI 应把 Cost / Speed / Quality 变成用户可理解的档位；Lime 可转译为“省钱 / 平衡 / 高质量”。
- 上下文附件应该是 bounded summary，不是把历史输出、参考素材或灵感原文全量塞入模型。

不能照搬的地方：

- Warp 是开发者终端产品，context chips、codebase index、AI request credits 都不是 Lime 普通创作者的前台语言。
- Lime 要学的是配额 / cost gate 和 bounded context，而不是把 Warp 的 pending context 当长期 memory 设计。

### 2.5 ChatGPT / Claude API：用户控制和客户端存储是底线

外部官方文档给出的稳定原则：

1. OpenAI Memory FAQ 把 memory 分成 saved memories 与 reference chat history，并强调用户可以查看、删除、关闭记忆。
2. OpenAI 的做法说明：显式保存的记忆与历史聊天引用应有不同控制语义。
3. Claude API Memory Tool 采用客户端实现：应用侧决定存储在哪里、如何执行 memory 命令。
4. Claude API 文档建议 memory 与 compaction 搭配使用，让长任务跨上下文边界保持连续。

对 Lime 的启发：

- 用户必须能知道“系统记住了什么”。
- 用户必须能删除、禁用或纠正影响生成的内容。
- 长会话续接与长期灵感资产应分层，不应混成同一个前台概念。
- 隐私敏感内容默认不要主动沉淀，除非用户明确保存。

### 2.6 OpenClaw：主动记忆与 Dreaming 都选择 opt-in

本地样本：`/Users/coso/Documents/dev/js/openclaw`，`main`，HEAD `323493fa1b`，最后提交时间 `2026-04-14 13:42:03 +0100`。

关键事实：

1. `docs/concepts/memory.md` 把普通长期记忆放在 Markdown 文件：`MEMORY.md`、`memory/YYYY-MM-DD.md`，实验性整理结果进入 `DREAMS.md`。
2. `memory_search` 与 `memory_get` 是按需工具，不把所有记忆默认塞进主上下文。
3. 内置 memory engine 使用 SQLite / FTS5 / vector / hybrid search，并支持 CJK、MMR、temporal decay 和多模态索引。
4. `docs/concepts/active-memory.md` 明确 Active Memory 是可选插件，且有双门禁：插件启用 + agent / session eligibility。
5. Active Memory 默认限定 direct session，可用 `/active-memory on/off/status` 做 session-scoped 控制，也可显式 global 控制。
6. 诊断只在 `/verbose`、`/trace`、`/trace raw` 下显示；正常客户端不暴露原始 `<active_memory_plugin>` prompt tags。
7. `docs/concepts/dreaming.md` 把 Dreaming 定义为实验性、默认关闭、定时、阈值化、可审阅的后台 consolidation。

对 Lime 的启发：

- 主动召回不应该默认进入普通创作链；应先进入开发者面板或高级设置，默认关闭。
- 诊断信息可以存在，但必须是 verbose / trace / dev panel，而不是普通灵感库首屏。
- 自动整理应采用“短期信号 -> 阈值 / 多样性 / 频率 -> 待审阅 -> 用户确认 -> 长期灵感”的门禁。
- 多模态 memory indexing 很适合作为未来参考素材摄入方向，但不应抢 P0。

不能照搬的地方：

- `MEMORY.md`、`DREAMS.md` 和 slash command 是开发者 / agent operator 语言，不是 Lime 创作者默认语言。
- OpenClaw 的 active memory 目标是让对话 agent 更自然；Lime 的目标是让创作结果更像用户，并且可解释、可控。

### 2.7 Hermes Agent：单外部 provider、fenced recall 与 prompt cache 稳定

本地样本：`/Users/coso/Documents/dev/python/hermes-agent`，`main`，HEAD `16f9d020`，最后提交时间 `2026-04-14 20:27:24 +1000`。

关键事实：

1. `agent/memory_provider.py` 明确 built-in memory always active，external providers additive，且最多一个 external provider，避免 tool schema 膨胀和多后端冲突。
2. `agent/memory_manager.py` 永远保留 built-in provider，同时最多只允许一个 external memory provider。
3. `agent/memory_provider.py` 给 provider 定义统一生命周期：`initialize`、`system_prompt_block`、`prefetch`、`sync_turn`、`queue_prefetch`、`on_session_end`、`on_pre_compress`、`on_memory_write`、`on_delegation`。
4. `build_memory_context_block(...)` 把 prefetched memory 包在 `<memory-context>` 中，并带系统说明：这是 recalled memory context，不是新用户输入。
5. `tools/memory_tool.py` 使用 `MEMORY.md / USER.md` 双文件，系统 prompt 使用 session-start frozen snapshot；会话中写盘但不改变系统 prompt，保护 prompt cache 与行为稳定。
6. `tools/memory_tool.py` 默认字符预算是 `memory_char_limit=2200`、`user_char_limit=1375`，因为字符数模型无关。
7. `tools/memory_tool.py` 对记忆写入做 prompt injection、隐藏 Unicode、读取 `.env` / credentials、curl / wget secret 外泄等扫描。
8. 记忆条目有字符预算、重复拒绝、replace / remove 用短唯一 substring，并使用 file lock / atomic rename，避免长期记忆失控。
9. `agent/context_compressor.py` 在 LLM 总结前先做 tool output pruning cheap pre-pass，并用 summary min / ratio / ceiling 控制压缩预算。
10. 插件包括 holographic、supermemory、mem0 等，但都被统一 manager 收口。

对 Lime 的启发：

- 外部记忆 provider 或高级实验同一时刻只允许一个 active，避免普通用户无法理解“到底哪套记忆影响了生成”。
- recalled context 必须 fenced / untrusted，不能当成用户新输入，更不能让 provider 绕过 `memory_runtime_*` 直接改 prompt。
- 会话中写入长期资产不应立刻改变当前系统 prompt；对 Lime 可转译为“已保存，但下一轮 / 下一次编译稳定生效”。
- 自动写入长期灵感前必须做 injection / secret scan；这是创作者产品的信任底线，不是工程洁癖。
- `on_pre_compress` 对 Lime 很有价值：压缩前提取必要洞察，但不等于自动进入长期灵感库。

不能照搬的地方：

- Hermes 是 agent runtime / CLI 工具，用户能接受 provider、prompt cache、tool schema 这类概念。
- Lime 的普通用户只应看到“这条灵感是否影响生成”，不应看到 external provider 生命周期。

### 2.8 Ribbi：产品形态更接近 Lime 的北极星

本地事实源：`docs/research/ribbi/README.md`、`docs/research/ribbi/architecture-breakdown.md`、`docs/research/ribbi/taste-memory-evolution.md`。

关键事实：

1. Ribbi 的本质是单一主 Agent + 后台异步进化系统，而不是多个平级工具页。
2. 它把 memory、taste、feedback 拆成不同对象：历史上下文、审美状态、结果反馈互相影响但不混为一谈。
3. 它用后台 async agents 做 taste 提炼、memory 压缩、feedback 回写和 skill 演化，主生成容器仍然接住当前创作任务。
4. Ribbi 的前台强调任务、参考、阶段结果和继续动作；底层 context compile / tool router / model router 不作为用户默认心智。

对 Lime 的启发：

- Lime 的 `灵感库` 应成为 taste / reference / memory / feedback 的统一前台投影。
- 普通用户默认体验应靠近 Ribbi：少量入口、单主生成容器、后台变聪明，而不是 Claude Code 式 `/memory` 工作台。
- 高级诊断即使建设，也应像 execution trace 一样留在开发者面板，不要争夺前台主心智。

不能照搬的地方：

- Lime 不应照搬 Ribbi 的收藏池命名、品牌人格或命令面板外观。
- Lime 应保留自己的 `灵感库` 语言，并把 Ribbi 当产品结构参考，而不是视觉或术语模板。

### 2.9 LangGraph：记忆类型、命名空间和写入时机是通用最佳实践

外部官方资料：LangGraph Memory Overview 与 Persistence / Memory Store。

关键事实：

1. LangGraph 把短期记忆定义为 thread-scoped state，把长期记忆定义为跨线程、按 namespace 组织的 store。
2. 长期记忆可分为 semantic、episodic、procedural：事实、经验、规则分别回答不同问题。
3. 长期记忆写入有 hot path 与 background 两种方式：前者透明但增加延迟与复杂度，后者更适合异步整理。
4. Memory Store 使用 namespace + key 组织记忆，并支持 semantic search / filtering。

对 Lime 的启发：

- `memory_runtime_*` 对应短期 / 当前回合 read model；`unified_memory_*` 对应长期创作者资产。
- Lime 的 `风格线索 / 参考素材 / 成果打法 / 偏好约束` 本质上混合了 semantic、episodic、procedural，需要在 projection 层翻译清楚。
- 自动整理更适合 background 路径；hot path 只适合用户显式保存或非常明确的“记住这个”。
- namespace 思路应映射到用户、项目、品牌或 workspace 边界，不能把所有创作者资产放进一个全局池。

## 3. Lime 当前状态

当前 Lime 的记忆 / 灵感主链已经具备较好的底层基础：

1. `docs/aiprompts/memory-compaction.md` 定义了 current 主链：
   - 记忆来源链解析
   - 单回合 memory prefetch
   - runtime turn prompt augmentation
   - session compaction
   - working / durable memory 沉淀
   - Memory 页面 / 设置页 / 线程面板稳定读模型

2. `src/components/memory/inspirationProjection.ts` 已经把 `unified_memory` 投影成创作者可理解的五类对象：
   - `identity -> 风格线索`
   - `context -> 参考素材`
   - `preference -> 偏好约束`
   - `experience -> 成果打法`
   - `activity -> 收藏备选`

3. `src/components/agent/chat/utils/saveSceneAppExecutionAsInspiration.ts` 已经让结果工作台可以沉淀到灵感库，并写入推荐信号。

4. `MemoryPage.tsx` 已经同时承担两类职责：
   - 前台灵感库：灵感对象、风格层、参考对象、下一轮推荐。
   - 底层诊断台：来源链、工作记忆、持久记忆、Team Memory、压缩摘要、命中历史。

当前主要问题不是“是否应该做灵感库”，而是：

**灵感库前台投影和底层记忆诊断被放在同一张普通用户页面里，产品语言容易从创作者资产退回工程记忆系统。**

补充判断：主动召回、raw hit layer、自动整理实验和外部记忆 provider 都应被视为后台能力，不应作为普通用户默认导航；如果需要暴露，应通过开发者面板或高级设置开关，且默认关闭。

## 4. 是否符合 Lime 产品定位

如果按“Claude Code 底层架构 + Lime 前台翻译”推进，方向符合 Lime。

如果按“Claude Code 记忆工作台 + 研发诊断页直接给普通用户”推进，方向不符合 Lime。

### 4.1 符合的部分

Lime 需要记住：

1. 用户长期偏好的表达方式。
2. 用户反复选择或收藏的视觉 / 语气 / 结构参考。
3. 每次生成后值得复用的结果打法。
4. 用户明确说过不要再犯的禁忌。
5. 当前任务跨多轮仍要延续的上下文。

这些都需要 Claude Code 式底层能力。

### 4.2 不符合的部分

Lime 普通用户不应该被要求理解：

1. 哪条内容来自 working memory。
2. 哪条内容来自 durable memory。
3. 这次 turn prompt 是否经过 prefetch。
4. 记忆来源链是否命中了 managed / user / project / local。
5. compaction summary 如何生成。
6. memdir 当前是否干净。

这些是系统健康和调试信息，不是创作入口。

## 5. 推荐产品分层

### 5.1 普通用户默认层：灵感库

默认只展示能直接帮助下一轮创作的对象：

1. **风格线索**
   - 用户喜欢的语气、审美、节奏、品牌感。
   - 典型动作：编辑、禁用、用于下一次生成。

2. **参考素材**
   - 图片、链接、文档、案例、外部资料。
   - 典型动作：作为参考生成、补充说明、移除。

3. **成果打法**
   - 已经跑通、下次可复用的结果结构或内容骨架。
   - 典型动作：围绕这条成果继续、复盘、改写、扩展成我的方法。

4. **偏好约束**
   - 明确的取舍、禁忌、偏好、不要做什么。
   - 典型动作：开关、编辑、解释为什么会影响生成。

5. **收藏备选**
   - 先存下但还没被整理进上述类型的内容。
   - 典型动作：整理成风格 / 参考 / 成果 / 偏好。

普通用户页面的核心问题应是：

**“这些灵感如何让下一次生成更像我？”**

### 5.2 进阶管理层：整理与控制

这层可以在普通灵感库内逐步开放，但不应使用底层 runtime 术语：

1. 哪些灵感会影响下一轮生成。
2. 最近自动整理了什么。
3. 哪些条目重复、过期或冲突。
4. 哪些内容被用户禁用。
5. 哪些结果可以沉淀成“我的方法”。

### 5.3 高级 / 诊断层：记忆工作台

这层应默认隐藏，仅面向开发者、内测用户、客服排障或高级开关：

1. 记忆来源链。
2. working memory。
3. durable recall。
4. Team Memory shadow。
5. compaction summary。
6. prefetch 命中历史。
7. memdir scaffold / cleanup。
8. source bucket / provider / memory type 等底层元数据。

这层的核心问题是：

**“为什么这次 Agent 命中了这些上下文？”**

它不应成为普通用户理解 Lime 的第一入口。

## 6. 后续建议

### 6.1 产品方向

1. 保留 `灵感库` 作为普通用户前台主词。
2. 避免把页面标题、导航、空态写成“记忆管理”。
3. 把底层诊断分区迁到开发者面板、高级模式、设置页诊断或研发内测入口，默认关闭。
4. 主动记忆、自动整理实验、raw source / hit layer 只通过高级开关开启。
5. 让每条灵感都能说明“会如何影响下一轮生成”。
6. 把“保存到灵感库”继续扩展为所有高价值结果的统一沉淀动作。
7. 不给普通用户一个会让产品失忆的 Memory 总开关；提供条目级禁用、项目级隔离、成本档位和高级增强开关。

### 6.2 架构方向

1. 继续把 `unified_memory_*` 作为长期灵感事实源。
2. 继续把 `memory_runtime_*` 作为当前回合上下文事实源。
3. 不新增另一套 `inspiration_*` 数据库主链，避免灵感库和记忆库双轨。
4. 在前端做 projection 和 wording，不在底层复制数据模型。
5. 长会话续接继续走 compaction / working memory，不要直接污染长期灵感库。
6. 外部 memory provider / active memory 实验必须走单一高级开关、fenced recall、secret / injection scan，不允许绕过 current 主链。

### 6.3 普通用户开放策略

建议默认开放：

1. 灵感总览。
2. 参考与风格条目。
3. 保存结果到灵感库。
4. 围绕灵感继续生成。
5. 编辑 / 删除 / 禁用影响生成的条目。

建议暂不默认开放：

1. 来源链。
2. 会话工作记忆。
3. Team Memory。
4. 压缩摘要。
5. prefetch 命中历史。
6. memdir 整理。
7. Active Memory / 自动召回预览。
8. raw source / hit layer / provider 诊断。
9. Dreaming / auto organization 实验。

固定判断：

**普通用户要的是“我的创作资产越来越懂我”，不是“我会管理一套 Agent 记忆系统”。**

## 7. 参考来源

本地源码与文档：

- `docs/aiprompts/memory-compaction.md`
- `src/components/memory/MemoryPage.tsx`
- `src/components/memory/inspirationProjection.ts`
- `src/components/agent/chat/utils/saveSceneAppExecutionAsInspiration.ts`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/memories/README.md`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/config/src/types.rs`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/core/src/session/mod.rs`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/memories/read/src/prompts.rs`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/memories/write/src/start.rs`
- `/Users/coso/Documents/dev/rust/codex/codex-rs/memories/write/src/guard.rs`
- `/Users/coso/Documents/dev/js/claudecode/src/memdir/memoryTypes.ts`
- `/Users/coso/Documents/dev/js/claudecode/src/memdir/findRelevantMemories.ts`
- `/Users/coso/Documents/dev/js/claudecode/src/services/SessionMemory/sessionMemory.ts`
- `/Users/coso/Documents/dev/js/claudecode/src/services/SessionMemory/sessionMemoryUtils.ts`
- `/Users/coso/Documents/dev/js/claudecode/src/services/compact/autoCompact.ts`
- `/Users/coso/Documents/dev/js/claudecode/src/services/extractMemories/prompts.ts`
- `/Users/coso/Documents/dev/js/lobehub/apps/cli/src/commands/memory.ts`
- `/Users/coso/Documents/dev/rust/warp/app/src/ai/request_usage_model.rs`
- `/Users/coso/Documents/dev/rust/warp/app/src/terminal/input.rs`
- `/Users/coso/Documents/dev/rust/warp/app/src/terminal/profile_model_selector.rs`
- `/Users/coso/Documents/dev/rust/warp/app/src/ai/blocklist/context_model.rs`
- `/Users/coso/Documents/dev/js/openclaw/docs/concepts/memory.md`
- `/Users/coso/Documents/dev/js/openclaw/docs/concepts/active-memory.md`
- `/Users/coso/Documents/dev/js/openclaw/docs/concepts/dreaming.md`
- `/Users/coso/Documents/dev/js/openclaw/docs/concepts/memory-search.md`
- `/Users/coso/Documents/dev/js/openclaw/docs/reference/memory-config.md`
- `/Users/coso/Documents/dev/python/hermes-agent/agent/memory_manager.py`
- `/Users/coso/Documents/dev/python/hermes-agent/agent/memory_provider.py`
- `/Users/coso/Documents/dev/python/hermes-agent/tools/memory_tool.py`
- `/Users/coso/Documents/dev/python/hermes-agent/agent/context_compressor.py`
- `/Users/coso/Documents/dev/python/hermes-agent/agent/prompt_builder.py`
- `docs/research/ribbi/architecture-breakdown.md`
- `docs/research/ribbi/taste-memory-evolution.md`

外部官方资料：

- OpenAI Memory FAQ：<https://help.openai.com/en/articles/8590148-memory-faq>
- Claude Code Memory：<https://docs.anthropic.com/en/docs/claude-code/memory>
- Claude API Memory Tool：<https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool>
- Warp Rules：<https://docs.warp.dev/agent-platform/capabilities/rules>
- Warp AI-Integrated Objects：<https://docs.warp.dev/knowledge-and-collaboration/warp-drive/ai-objects>
- LangGraph Memory Concepts：<https://docs.langchain.com/oss/python/concepts/memory>
- LangGraph Memory Store：<https://docs.langchain.com/oss/python/langgraph/persistence#memory-store>
