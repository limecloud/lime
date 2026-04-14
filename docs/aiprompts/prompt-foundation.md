# 基础 Prompt 主链

## 这份文档回答什么

本文件只定义 Lime 当前真正入模的基础 Prompt 主链，回答四个问题：

1. 当前 provider 最终看到的 system prompt 是怎么拼出来的
2. `project / session / frontend / runtime AGENTS / prompt_context / augmentation` 分别处在什么位置
3. 哪些 prompt 文件和 builder 属于 `current`，哪些只是 `compat` / `deprecated`
4. `query-loop.md`、功能样板文档、历史工作台说明与基础 Prompt 主链的关系是什么

一句话事实源声明：

> 后续所有基础 Prompt、system prompt、subagent prompt、plan prompt、augmentation 顺序与 diagnostics 判断，统一向 `runtime_turn.rs -> prompt_context.rs / prompt services -> TurnInputEnvelope -> aster PromptManager / embedded prompts` 这一条 current 主链收敛。

## Current 主链总览

```text
runtime_turn.rs
  -> 选择 base session prompt 来源（project > session > frontend > none）
  -> merge_system_prompt_with_runtime_agents(...)
  -> build_full_runtime_system_prompt(...) / build_fast_chat_system_prompt(...)
  -> apply_service_skill_preload_prompt_stage(...)（仅 FullRuntime）
  -> TurnInputEnvelope 记录 base/final prompt 与 augmentation stages
  -> SessionConfig.system_prompt

aster Agent::prepare_tools_and_prompt(...)
  -> PromptManager.builder().with_session_prompt(session_prompt)
  -> Identity（identity.md 或 custom identity）
  -> Session Context（Lime 组装后的 session prompt）
  -> Capabilities（capabilities.md + extensions/frontend instructions）
  -> Additional Instructions / hints / mode guidance
  -> provider 实际收到的最终 system prompt
```

关键事实：

- `runtime_turn.rs` 里记录的 `base_system_prompt_len / final_system_prompt_len` 只覆盖 Lime 侧的 `session prompt` 片段，不等于 provider 侧最终收到的完整 system prompt 长度。
- provider 最终 prompt 还会再经过 Aster `PromptManager` 包一层 `Identity + Capabilities + hints`。
- 因此，排查“Prompt 为什么变长”“Prompt cache 为什么失效”时，不能只看 `prompt_context.rs`，还要一起看 Aster 的 `PromptManager` 和扩展工具面变化。

## 基础 Prompt 的 current 事实源

### 1. Base Session Prompt 入口

- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
- 优先级固定为：
  1. `project prompt`
  2. `session prompt`
  3. `request.system_prompt`（frontend）
  4. `None`

对应实现：

- `AsterAgentState::build_project_system_prompt(...)`
- `session_state_snapshot.system_prompt()`
- `request.system_prompt`
- `TurnInputEnvelopeBuilder::set_base_system_prompt(...)`

### 2. Lime 侧 augmentation 主链

- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
- `src-tauri/src/commands/aster_agent_cmd/prompt_context.rs`
- `src-tauri/src/services/memory_profile_prompt_service.rs`
- `src-tauri/src/services/artifact_prompt_service.rs`
- `src-tauri/src/services/web_search_prompt_service.rs`
- `src-tauri/crates/agent/src/request_tool_policy.rs`
- `src-tauri/crates/agent/src/prompt/runtime_agents.rs`
- `src-tauri/crates/agent/src/turn_input_envelope.rs`

FullRuntime 固定顺序：

1. `RuntimeAgents`
2. `ExplicitLocalPathFocus`
3. `Memory`
4. `WebSearch`
5. `RequestToolPolicy`
6. `Artifact`
7. `ImageSkillLaunch`
8. `CoverSkillLaunch`
9. `VideoSkillLaunch`
10. `BroadcastSkillLaunch`
11. `ResourceSearchSkillLaunch`
12. `ResearchSkillLaunch`
13. `ReportSkillLaunch`
14. `DeepSearchSkillLaunch`
15. `SiteSearchSkillLaunch`
16. `PdfReadSkillLaunch`
17. `PresentationSkillLaunch`
18. `FormSkillLaunch`
19. `SummarySkillLaunch`
20. `TranslationSkillLaunch`
21. `AnalysisSkillLaunch`
22. `TranscriptionSkillLaunch`
23. `UrlParseSkillLaunch`
24. `TypesettingSkillLaunch`
25. `WebpageSkillLaunch`
26. `ServiceSkillLaunch`
27. `Elicitation`
28. `TeamPreference`
29. `AutoContinue`
30. `ServiceSkillLaunchPreload`（在主组装后追加，只在 `FullRuntime` 生效）

FastChat 固定顺序：

1. `RuntimeAgents`
2. `ExplicitLocalPathFocus`
3. `RequestToolPolicy`

这里的“固定顺序”以 `runtime_turn.rs` 和 `TurnPromptAugmentationStageKind` 为准；文档、前端假设或样板说明不得自行重排。

### 3. Aster 侧最终包装

- `src-tauri/crates/aster-rust/crates/aster/src/agents/reply_parts.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/agents/prompt_manager.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompt_template.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/*.md`

当前 provider prompt 的最终结构不是“Lime 直接整段覆盖”，而是：

1. `identity.md` 或 `AgentIdentity.custom_prompt`
2. `Session Context`
   Lime 在 `runtime_turn.rs` 组好的 session prompt 会放在这里
3. `capabilities.md`
   由 extensions、frontend instructions、tool 数量、mode 等上下文渲染
4. 额外指令
   包括 final output tool prompt、hints、chat mode guidance 等

### 4. Embedded Prompt 文件的 current 用途

`src-tauri/crates/aster-rust/crates/aster/src/prompts` 是 Aster 的嵌入式模板目录，但不是所有文件都在 current 主链里。

当前有明确 runtime 调用点的模板：

- `identity.md`
- `capabilities.md`
- `subagent_system.md`
- `plan.md`
- `recipe.md`
- `summarize_oneshot.md`
- `permission_judge.md`

其中：

- `identity.md + capabilities.md` 是普通主对话最终 prompt 的基础层
- `subagent_system.md` 是 subagent current prompt
- `plan.md` 是 planning current prompt
- `recipe.md` 是 recipe 生成流的 current prompt
- `summarize_oneshot.md`、`permission_judge.md` 是特定侧链使用的 current 专用 prompt

## Current / Compat / Deprecated 边界

### Current

以下路径是当前唯一允许继续演进的基础 Prompt 事实源：

- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
- `src-tauri/src/commands/aster_agent_cmd/prompt_context.rs`
- `src-tauri/src/services/memory_profile_prompt_service.rs`
- `src-tauri/src/services/artifact_prompt_service.rs`
- `src-tauri/src/services/web_search_prompt_service.rs`
- `src-tauri/crates/agent/src/request_tool_policy.rs`
- `src-tauri/crates/agent/src/prompt/runtime_agents.rs`
- `src-tauri/crates/agent/src/turn_input_envelope.rs`
- `src-tauri/crates/agent/src/aster_state_support.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/agents/prompt_manager.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/agents/reply_parts.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompt_template.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/identity.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/capabilities.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/subagent_system.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/plan.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/recipe.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/summarize_oneshot.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/permission_judge.md`

### Compat

以下路径仍保留，但不属于当前基础 Prompt 主链，后续不要继续把新能力长进去：

- `src-tauri/crates/agent/src/prompt/builder.rs`
- `src-tauri/crates/agent/src/prompt/templates.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompt/builder.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/prompt/templates.rs`
- `docs/aiprompts/query-loop.md`
  这是 Query Loop current 文档，但不是基础 Prompt 逐层拼装的唯一事实源
- `docs/aiprompts/content-creator.md`
  这是归档工作台说明，不是基础 Prompt 主入口

这些 compat 路径可以继续被读取、测试或保留导出，但不能再被当成“当前 prompt 主链定义处”。

### Deprecated

以下 embedded prompt 文件当前在仓库内没有明确 runtime 调用点，不应再作为新实现参考：

- `src-tauri/crates/aster-rust/crates/aster/src/prompts/system.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/system_gpt_4.1.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/desktop_prompt.md`
- `src-tauri/crates/aster-rust/crates/aster/src/prompts/desktop_recipe_instruction.md`

### 特殊说明

- `src-tauri/crates/aster-rust/crates/aster/src/prompts/mock.md` 目前只看到 `prompt_template.rs` 内部测试覆盖，不属于基础 Prompt current 主链。
- `docs/prd/gongneng/**`、`docs/roadmap/**`、`x-article-export/**` 等功能样板或产品文档，只能消费主链事实，不能反向定义基础 Prompt 顺序。

## 谁可以定义基础 Prompt，谁只能消费

可以定义基础 Prompt 的边界：

- `runtime_turn.rs`
- `prompt_context.rs`
- 统一 prompt services
- `request_tool_policy.rs`
- `runtime_agents.rs`
- `turn_input_envelope.rs`
- Aster `PromptManager` 与有明确调用点的 embedded templates

只能消费、解释或验证基础 Prompt 的边界：

- 前端 Workspace / Chat UI
- `docs/aiprompts/query-loop.md`
- `docs/prd/**` / `docs/roadmap/**`
- 功能样板文档，例如 `x-article-export`
- 历史工作台归档文档，例如 `content-creator.md`

如果消费层文档与上述 current 事实源冲突，以 current 代码边界为准，并同步回写文档。

## 与 Query Loop 的关系

- `query-loop.md` 负责解释 submit turn、queue、tool runtime、context compaction、evidence 等主循环。
- 本文只负责解释“系统提示词是如何形成并进入 provider”的主链。
- 两者关系是并列 current 文档，但基础 Prompt 的更细粒度事实源以本文为准。

遇到以下改动时，先读本文，再回到 `query-loop.md` 看提交链：

- 改 `system prompt`
- 改 `subagent prompt`
- 改 `plan prompt`
- 改 `prompt_context.rs`
- 改 augmentation 顺序或 marker
- 改 `TurnInputEnvelope` diagnostics
- 排查 token、Prompt Cache、prompt 变长、无声注入等问题

## 对齐结论

本轮治理后的统一口径是：

- Lime 的基础 Prompt 主链不是某一份前端 `systemPrompt`、某一份 PRD，或某个样板包
- Lime 的基础 Prompt 主链也不是单独某个 builder 文件
- 真正的 current 主链是 “`runtime_turn` 先组 session prompt，再由 Aster `PromptManager` 包装成最终 provider prompt”
- 后续所有 Prompt 相关治理，必须围绕这条主链做减法和收口，而不是再新增平级 builder、平级模板或平级文档解释
