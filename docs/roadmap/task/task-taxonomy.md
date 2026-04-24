# Lime 任务画像与任务 taxonomy

> 状态：提案
> 更新时间：2026-04-23
> 作用：定义 `TaskProfile`、任务分类、能力需求、预算档和与 `service_models` 的关系。
> 依赖文档：
> - `./overview.md`
> - `./model-routing.md`
> - `docs/aiprompts/task-agent-taxonomy.md`

## 1. 固定目标

本文件只回答两件事：

1. Lime 当前和未来有哪些任务类型。
2. 每类任务需要向模型层声明什么，而不是让模型层反过来猜任务。

## 2. `TaskProfile` 固定字段

后续统一按下面这份结构理解：

| 字段 | 含义 |
| --- | --- |
| `task_kind` | 任务类型 |
| `user_visibility` | `foreground / background / internal` |
| `latency_target` | `interactive / standard / batch` |
| `budget_class` | `minimize_cost / balanced / maximize_quality` |
| `required_capabilities` | 任务硬需求能力 |
| `optional_capabilities` | 可选增强能力 |
| `settings_source` | 命中了哪个设置来源 |
| `fallback_policy` | 是否允许回退、是否允许降级、是否允许跨 provider |
| `continuity_preference` | 是否优先保持会话连续性 |

## 3. 任务类型总表

| `task_kind` | 说明 | 默认可见性 | 默认预算档 | 典型设置来源 |
| --- | --- | --- | --- | --- |
| `main_chat` | 普通主对话 turn | `foreground` | `balanced` | 会话模型、显式 override |
| `coding_edit` | 中等复杂度代码修改 | `foreground` | `balanced` | 会话模型 |
| `coding_deep` | 深度编码、复杂推理、架构分析 | `foreground` | `maximize_quality` | 会话模型、团队配置 |
| `research_web` | 需要联网检索和综合 | `foreground` | `balanced` | 会话模型、任务偏好 |
| `translation` | 翻译消息或工作台翻译 | `foreground` 或 `internal` | `minimize_cost` | `service_models.translation` |
| `summarize` | 总结、提炼、摘要 | `foreground` 或 `internal` | `minimize_cost` | 任务偏好 |
| `title_generation` | 会话命名、标题生成 | `internal` | `minimize_cost` | `service_models.topic` |
| `generation_topic` | 图片或生成任务自动命名 | `internal` | `balanced` | `service_models.generation_topic` |
| `history_compress` | 上下文压缩与摘要保真 | `internal` | `balanced` | `service_models.history_compress` |
| `agent_meta` | 助理名称、简介、标签生成 | `internal` | `minimize_cost` | `service_models.agent_meta` |
| `prompt_rewrite` | 提示词重写与润色 | `foreground` 或 `internal` | `balanced` | `service_models.prompt_rewrite` |
| `resource_prompt_rewrite` | 带资料上下文的提词重写 | `internal` | `balanced` | `service_models.resource_prompt_rewrite` |
| `hook_eval` | hooks / prompt hook / agent hook 判断 | `internal` | `minimize_cost` | hook 配置 |
| `tool_summary` | 工具执行摘要、批处理说明 | `internal` | `minimize_cost` | runtime 内部 |
| `verification` | 回归验证、交付确认 | `foreground` 或 `background` | `maximize_quality` | 工作流 / review |
| `service_scene` | 由 `service_scene_launch` 触发的结构化服务任务 | `foreground` | `balanced` | scene metadata |
| `subagent_research` | 子代理探索与并行调研 | `background` | `balanced` | team runtime |

## 4. 能力需求矩阵

| `task_kind` | 硬需求能力 | 可选增强能力 | 单模型不足时的默认动作 |
| --- | --- | --- | --- |
| `main_chat` | `chat` | `reasoning`, `tools` | 允许继续执行，但需显式记录能力差距 |
| `coding_edit` | `chat`, `tools` | `reasoning`, `long_context` | 不支持 tools 时必须降级或阻断 |
| `coding_deep` | `chat`, `reasoning`, `tools` | `long_context`, `vision` | 优先回退到更强候选，否则明确降级 |
| `research_web` | `chat`, `tools` | `reasoning` | 无 tools 时不可伪装成功 |
| `translation` | `chat` | `reasoning` | 可继续执行 |
| `summarize` | `chat` | `reasoning`, `long_context` | 可继续执行 |
| `title_generation` | `chat` | 无 | 可继续执行 |
| `generation_topic` | `chat` | `vision` | 无 vision 时允许回退到普通命名 |
| `history_compress` | `chat` | `long_context`, `reasoning` | 必须显式标注压缩保真风险 |
| `agent_meta` | `chat` | `reasoning` | 可继续执行 |
| `prompt_rewrite` | `chat` | `reasoning` | 可继续执行 |
| `resource_prompt_rewrite` | `chat` | `reasoning`, `long_context` | 可继续执行，但需标注上下文质量风险 |
| `hook_eval` | `chat` | `reasoning` | 可继续执行 |
| `tool_summary` | `chat` | 无 | 可继续执行 |
| `verification` | `chat`, `tools` | `reasoning`, `vision` | 不支持 tools 时必须阻断或回退 |
| `service_scene` | 视场景声明 | 视场景声明 | 由 `fallback_policy` 决定 |
| `subagent_research` | `chat`, `tools` | `reasoning` | 按子任务类型降级 |

## 5. `service_models` 与任务 taxonomy 的关系

`workspace_preferences.service_models` 已经是现有 Lime 的任务级模型设置入口，因此后续必须明确映射：

| `service_models` 槽位 | 对应 `task_kind` |
| --- | --- |
| `topic` | `title_generation` |
| `generation_topic` | `generation_topic` |
| `translation` | `translation` |
| `history_compress` | `history_compress` |
| `agent_meta` | `agent_meta` |
| `prompt_rewrite` | `prompt_rewrite` |
| `resource_prompt_rewrite` | `resource_prompt_rewrite` |
| `input_completion` | 当前主链仅消费启停，不直接参与模型路由 |

固定规则：

1. `service_models` 是任务级偏好输入源。
2. 它优先于普通会话默认模型。
3. 它不优先于显式 per-turn 锁定。
4. 它不能继续通过旁路直接决定最终 provider/model。

## 6. 单模型与多模型下的任务语义

### 6.1 单模型

任务层仍然完整产出 `TaskProfile`。

区别只是：

- 模型层无法做真正多候选优选
- 任务层声明的能力需求会用于能力校验和降级解释

### 6.2 多模型

任务层提供：

- 优先能力
- 预算档
- 连续性偏好

模型层再做候选优选。

## 7. 任务画像的来源顺序

统一按下面顺序确定任务画像来源：

1. 显式工作台命令 / `service_scene_launch`
2. 内部服务任务调用点
3. `service_models` 槽位映射
4. 当前主对话上下文
5. 后端兜底推断

## 8. 当前必须避免的误区

1. 让 `service_models` 直接越过任务画像层。
2. 让模型层继续通过模型名关键词反推任务。
3. 把内部服务任务和主对话任务混成一套默认预算档。
4. 只有一个模型时不再记录任务类型。

## 9. 这一步如何服务主线

本文件的主线收益是：

**把 Lime 已经零散存在的服务模型设置、内部辅助任务和主对话任务，收敛成一份统一 `TaskProfile` 语言。**
