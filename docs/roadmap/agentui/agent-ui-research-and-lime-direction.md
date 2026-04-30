# AI Agent UI 调研与 Lime 对话体验路线图

> 状态：调研与路线图
> 更新时间：2026-04-30
> 目标：把“AI Agent 最佳 UI 是什么”从竞品印象、局部控件和聊天气泡，收敛成 Lime 可执行的对话体验路线图。
> 结论：Lime 不应做纯聊天界面，也不应复制 Claude Code 或 Warp；Lime 应走“对话 + 过程 + 任务 + 产物 + 证据”的可执行工作区 Agent UI。

## 1. 核心判断

当前 AI Agent UI 已经从“输入框 + 消息列表”演进成复合工作台。最好的产品不再只回答“模型说了什么”，而是同时回答：

1. 用户现在在做什么目标？
2. Agent 正在什么阶段？
3. 哪些工具、权限、成本、文件、网页和子代理被使用了？
4. 哪些内容是最终产物，哪些只是推理过程？
5. 结果是否可追溯、可重放、可继续编辑？

这和 Lime 的方向高度一致。Lime 已经有 workspace、artifact、timeline、task、runtime、browser、service skill、team/subagent、evidence pack 等底座。真正要补的不是一个更像 ChatGPT 的聊天页，而是把这些底座组织成清晰、低负担、可长时间使用的 Agent 工作台。

本文档的产品结论是：

- **Chat 负责意图、推理与协作。**
- **Capsule 负责执行状态、后台任务和多 Agent 队列。**
- **Timeline 负责过程证据。**
- **Artifact 负责最终交付。**
- **Evidence 负责复盘、验证和治理。**

一句话：Lime 应当让 Agent 像一个可观察、可控、可交付的工作系统，而不是一个不断吐字的文本框。

## 2. 调研范围

### 2.1 商业产品与官方资料

| 产品 / 资料 | 观察重点 | 对 Lime 的启发 |
| --- | --- | --- |
| OpenAI Agents / AgentKit / ChatKit | Agent 构建、工具、会话组件、任务链路 | Chat UI 应该消费结构化 agent event，而不是只消费文本流 |
| ChatGPT Canvas | 对话之外的编辑画布 | 产物应离开聊天正文，进入可编辑的 Artifact / Canvas |
| ChatGPT Projects / Tasks | 项目上下文、长期任务、跨会话组织 | Lime 的 workspace/session/tab 需要成为一等导航对象 |
| Claude Artifacts | 回复旁路展示代码、文档、图表等产物 | “正文解释 + 右侧产物”比把全部内容塞进消息更稳定 |
| Claude Extended Thinking | 思考内容可控展示 | thinking 应折叠、摘要化、可关闭，不能污染最终答案 |
| Claude Code | 胶囊式后台任务、工具结果压缩、计划审批 | Lime 可借鉴 pill / plan / tool rich output，但不复制终端 UI |
| Gemini Deep Research | 多步研究进度、来源、最终报告 | 研究型任务需要进度、来源和报告产物分离 |
| Gemini Canvas | 对话与创作空间组合 | 编辑型任务应进入持续画布，而不是每次生成一段 Markdown |
| Cursor / Windsurf | IDE 内 agent、工具调用、diff、上下文 | 代码任务 UI 的核心是可审查变更和可恢复控制 |
| Warp Agent Mode | 终端 block、AI block、上下文命令 | 命令和 AI 过程适合 block 化，而不是混成纯聊天流 |

### 2.2 Context7 开源与 SDK 资料

| 资料 | 关键模式 | 对 Lime 的取舍 |
| --- | --- | --- |
| `assistant-ui` | Thread、ThreadList、Composer、Message parts、ActionBar、branch、copy、reload、feedback、attachment、lazy list | 可参考 primitives 分层和 lazy list 思路，不直接引入整套视觉 |
| `Vercel AI SDK` | UIMessage parts、reasoning part、tool part、data part、custom stream、tool progress | Lime 应继续把 text / thinking / tool / status / artifact 映射为结构化 part |
| `CopilotKit` | CopilotChat、Generative UI、Human-in-the-loop、frontend action、shared agent state | Lime 的 action_required、权限确认、工作区状态更新应作为 HITL UI，而不是普通文本 |

### 2.3 本地参考项目

主要参考 `/Users/coso/Documents/dev/js/claudecode`，辅助参考 `/Users/coso/Documents/dev/rust/warp`、`/Users/coso/Documents/dev/rust/CodexMonitor` 与 `/Users/coso/Documents/dev/rust/codex`。

Claude Code 本地源码显示三类尤其值得借鉴：

1. `src/tasks/pillLabel.ts` 把后台任务压缩为短标签，例如 shell、monitor、team、local agent、cloud session、ultraplan、dreaming。只有 `needs_input` 和 `plan_ready` 这种注意力状态才提示 CTA。
2. `src/tools/MCPTool/UI.tsx` 对工具输入输出做分层：非 verbose 截断输入、progress bar、大输出 token warning、图片占位、空输出提示、小 JSON 扁平展示、dominant text payload 解包。
3. `src/tools/ExitPlanModeTool/UI.tsx` 把计划流做成明确状态：退出计划、提交审批、用户批准、保存路径、拒绝计划，而不是只渲染一段 Markdown。

Warp 本地源码与文档显示三类可借鉴方向：

1. Terminal block / AI block 把命令、输出、AI 解释组织为可选择、可复制、可恢复的块。
2. Markdown visuals、Mermaid、本地图片渲染说明 AI 输出不应只是纯文本。
3. Agent Mode 的价值在于贴近工作上下文，而不是开一个独立聊天网页。

CodexMonitor 更接近 Lime 当前桌面 GUI 形态，尤其值得补充：

1. 多 workspace / thread 管理：支持 recent agent activity、unread/running 状态、pin/rename/archive/copy、resume thread 和 remote backend。对 Lime 的启发是 session/tab 不只是列表，而是多工作区执行态索引。
2. Composer 控制层：支持 Queue vs Steer、模型选择、collaboration mode、reasoning effort、access mode、context usage ring、图片附件、dictation、skills / prompts / review / file path autocomplete。对 Lime 的启发是输入区应显式承载“执行意图 + 模型/权限/上下文预算”，不是只有 textarea。
3. 消息渲染层：reasoning、tool、diff、review、userInput、plan follow-up 分成不同 row，tool output 做窗口化末尾展示，图片用 lazy thumbnail + lightbox。对 Lime 的启发是 process item 必须分型渲染。
4. App-server event reference 把支持/缺失事件列成清单，并记录 `item/reasoning/*`、`item/commandExecution/*`、`turn/diff/updated`、`thread/status/changed` 等事件。对 Lime 的启发是 Agent UI 需要协议覆盖表，避免 UI 靠猜事件。

Codex TUI 则提供了更底层的交互与性能经验：

1. `docs/tui-chat-composer.md` 把 composer 当成状态机：popup、slash、file、skill、paste burst、history search、local/persistent history、image rows、draft recovery 分开处理。
2. `docs/tui-request-user-input.md` 把用户输入请求做成 overlay：一题一页、option + freeform notes、焦点路由、紧凑布局降级。对 Lime 的 `action_required` / elicitation UI 很直接。
3. `docs/tui-stream-chunking-*.md` 把流式展示拆成 Smooth / CatchUp 模式，并用 queue depth、oldest age、mode transition、rapid re-entry 等指标验证。对 Lime 的首字慢、流式卡顿、CPU 飙高有直接借鉴价值。
4. `status_indicator_widget.rs`、`unified_exec_footer.rs`、`pending_input_preview.rs` 展示了状态行、后台 terminal 摘要、pending steer / queued messages 预览的压缩方式。对 Lime 的 capsule / queue UI 有参考意义。

### 2.4 Lime 当前事实源

Lime 不是从零开始。当前仓库已有基础：

- `src/components/agent/chat/types.ts` 已有 `ContentPart`：`text`、`thinking`、`tool_use`、`action_required`。
- `src/components/agent/chat/components/StreamingRenderer.tsx` 已有 thinking block、content parts、runtime status、流式渲染与历史轻量渲染入口。
- `src/components/agent/chat/components/MessageList.tsx` 已有首 token placeholder、runtime status pill、timeline 分离、历史 timeline 延迟构建、长历史窗口。
- `docs/roadmap/task/event-chain.md` 已定义事件链方向：不要新造第二条事件系统，应在现有 `AgentEvent -> timeline -> thread_read -> evidence / RequestLog` 主链上补齐任务、路由、经济事件。
- `docs/roadmap/artifacts/roadmap.md` 已明确 Artifact 方向，并包含核心原则：`Chat for reasoning, Artifact for delivery`。
- `docs/roadmap/harness-engine/README.md` 已把 evidence pack、replay、analysis、review、UI 展示纳入同源治理。
- `docs/roadmap/warp/README.md` 已明确 Agent loop、tool protocol、permission、slash、SkillTool、subagent 参考 Claude Code。

这意味着 Agent UI 的下一步不是再加一个 parallel UI，而是把现有结构化事实源的展示层收束起来。

## 3. Agent UI 模式全景

### 3.1 输入区 Composer

| 模式 | 代表形态 | 适用场景 | Lime 建议 |
| --- | --- | --- | --- |
| 底部吸附输入框 | ChatGPT、Claude、assistant-ui | 长对话、持续问答 | 保留，作为默认主入口 |
| 浮动胶囊输入框 | 新建任务、命令模式、轻量 prompt | 首页、空态、新任务 | 适合 Lime 首页和新建对话，但不应覆盖工作区信息 |
| Slash command | Claude Code、Cursor、Warp | 精确触发模式、工具、模板 | 必须支持，且映射到 skill / command / task contract |
| Mention / context chip | Cursor、Windsurf、Copilot 类产品 | 引用文件、网页、任务、会话 | 适合 Lime workspace、artifact、browser、session 引用 |
| 附件托盘 | ChatGPT、Claude、Gemini | 多模态输入、文档、图片 | 应继续做成输入前结构化 context，不只显示文件名 |
| 模型 / Provider 选择 | 多模型产品 | 高级用户、成本控制 | 可以是紧凑 selector，不要干扰普通输入 |
| 权限 / 模式 chip | plan、act、safe、browser、write | 高风险执行前约束 | 应与 execution profile / permission policy 绑定 |
| Queue / Steer 切换 | CodexMonitor、Codex TUI | 当前 turn 运行中继续补充输入 | Lime 应明确区分“排队下一条”和“转向当前 turn” |
| Context usage ring | CodexMonitor | 长会话、上下文预算、压缩前提示 | Lime 应把上下文预算做成低调但常驻的预算信号 |
| History search / draft recovery | Codex TUI | 长期高频输入、误清空恢复 | Lime 可做 P1，避免新建/切换/取消时丢 draft |
| 语音 / 截图 / 拖拽 | 通用 AI 助手 | 快速输入、视觉任务 | 可作为 P2，不应阻塞主链 |

输入区最重要的不是“做成胶囊”本身，而是让用户在发出任务前就能看见：当前上下文、执行模式、目标 workspace、模型/成本策略和权限边界。

Codex TUI 的 composer 状态机对 Lime 很有价值：多行粘贴、IME、slash command、附件 placeholder、历史召回、外部编辑器回填都不应靠 textarea 事件临时判断。Lime 如果继续强化 composer，应把这些行为沉到可测试的状态机，而不是在组件里继续堆条件分支。

### 3.2 消息展示 Message

| 模式 | 优点 | 风险 | Lime 建议 |
| --- | --- | --- | --- |
| 用户气泡 + Assistant 正文 | 清晰区分双方 | 长输出易拥挤 | 默认采用 |
| 双侧气泡 | 聊天感强 | 对桌面工作台效率低 | 不作为主体验 |
| Assistant 无气泡正文 | 文档阅读舒服 | 状态和工具容易混入正文 | 适合最终回答 |
| 分段消息 parts | 可结构化渲染 text/tool/thinking/source | 需要事件协议稳定 | Lime 已有基础，应强化 |
| Branch / 版本切换 | 支持重试和多答案 | 增加复杂度 | 对关键回合 P1 引入 |
| Message action bar | copy/edit/retry/feedback | 操作过多会压视觉 | 保留低调操作栏 |
| Inline citation | 研究、网页、证据 | 无来源时容易假装严谨 | 只对真实 source/evidence 显示 |

Lime 的消息层应做到：最终答案干净、过程信息可见但不抢位、操作入口稳定、历史恢复轻量。

### 3.3 Thinking / Reasoning UI

| 模式 | 表现 | 优点 | 风险 | Lime 建议 |
| --- | --- | --- | --- | --- |
| 完全隐藏 | 只显示最终答复 | 简洁 | 用户不知道是否卡住 | 不作为唯一模式 |
| “正在思考”状态 | 文本或 spinner | 首字前有反馈 | 解释力弱 | 必须有，用于首 token 前 |
| 折叠 thinking block | 默认显示摘要/耗时，可展开 | 平衡透明与清爽 | 摘要质量要稳定 | P0 推荐 |
| 实时 reasoning step | 一步步显示 | 强透明 | 易泄漏、噪声大、卡顿 | 只对支持模型和调试模式 |
| 完成后摘要 | “思考了 N 秒 / 检查了 X 项” | 历史阅读友好 | 可能过度拟人化 | 适合默认态 |
| 原文可展开 | 展示模型 reasoning 内容 | 方便调试 | 不同模型政策不同 | 仅在 provider 明确支持且用户开启 |
| Sources-first reasoning | 先展示来源/证据，再展示结论 | 研究型任务可信 | 对普通任务太重 | 用于 research / browser / evidence 场景 |

Lime 的原则：thinking 是过程层，不是正文层。它可以解释“正在发生什么”，但不能与最终答案重复吐字，也不能把 `<think>`、`thinking_delta` 或工具日志混进 Markdown 正文。

### 3.4 Runtime Status UI

| 状态 | UI 表现 | 说明 |
| --- | --- | --- |
| submitted | 首 token placeholder | 明确“请求已提交，等待首个响应” |
| routing | 阶段 pill | 显示模型/路由/队列决策，不刷屏 |
| streaming | 轻量流式光标 | 不用大 spinner 打断阅读 |
| tool_running | 工具 pill + 可展开详情 | 正文不直接塞工具输出 |
| action_required | 高亮确认卡 | 必须有清晰 CTA |
| retrying | 小型重试状态 | 显示次数和原因 |
| failed | 可恢复错误卡 | retry / copy diagnostic / switch provider |
| cancelled | 安静的取消状态 | 不应显示成失败 |
| completed | 状态收起 | 保留摘要，避免历史噪声 |

首字慢的体感往往来自“用户完全看不到系统是否活着”。Runtime Status UI 的目标不是假装更快，而是在真实首 token 前给出低成本、可信的阶段反馈。

Codex TUI 的 `StatusIndicatorWidget` 说明状态行应把动画、耗时、interrupt hint 和短详情放在同一条稳定表面中，避免布局跳动。Lime 的 runtime status 可以吸收这个结构：一行显示阶段、耗时和可取消动作，详情最多 2 到 3 行，超出进入 timeline 或诊断抽屉。

### 3.5 Tool Call UI

| 模式 | 适用 | Lime 建议 |
| --- | --- | --- |
| 行内工具卡 | 单个小工具、读文件、短命令 | 用于当前 turn 的关键步骤 |
| 批量摘要 | 多个工具、重复搜索、长列表 | 默认压缩，避免刷屏 |
| 详情抽屉 | 大输出、调试、审计 | 与 timeline/evidence 连接 |
| 输入截断 | 参数很长 | 默认显示关键字段，提供展开 |
| 输出预览 | 小 JSON、短文本、图片 | rich output 解析后展示 |
| 大输出警告 | token 很大 | 借鉴 Claude Code，提示上下文影响 |
| 空输出提示 | 工具无内容 | 显示“无输出”，不要留白 |
| 可重跑 | 幂等工具、失败工具 | 高风险工具需要确认 |
| 来源链接 | browser/search/doc | 与 citation/evidence 同源 |

Claude Code 的 MCP UI 给 Lime 一个清晰信号：tool UI 的好坏不在于“展示全部原始数据”，而在于分层、截断、摘要、异常提示和可追溯。

### 3.6 Capsule / Pill UI

胶囊式 UI 是本次调研里最适合 Lime 形成特色的模式。它不应只是装饰，而应成为任务状态入口。

| 胶囊类型 | 示例 | Lime 映射 |
| --- | --- | --- |
| 本地命令 | `1 shell`、`1 monitor` | terminal / command runtime |
| 后台 terminal | `1 background terminal running` | command / terminal dock |
| 后台 workflow | `1 background workflow` | task runtime |
| 本地 Agent | `1 local agent` | local runtime / subagent |
| 云端 Agent | `◇ 1 cloud session` | remote runtime / cloud scene |
| Team | `1 team` | team/subagent orchestration |
| Plan ready | `◆ plan ready` | plan approval / ExitPlanMode |
| Needs input | `◇ needs your input` | action_required / elicitation |
| Dreaming / background idea | `dreaming` | 可选 P2，不作为主链 |

胶囊应该遵循三条规则：

1. **普通 running 只显示事实，不打扰。**
2. **needs input / plan ready / failed 才抢注意力。**
3. **点击胶囊展开任务中心或 timeline，不跳出当前上下文。**

这也能解决多 tab、多会话和后台 agent 带来的卡顿：用户看到的是压缩后的任务索引，而不是所有会话全量渲染。

CodexMonitor 与 Codex TUI 都支持“当前 turn 运行中继续输入”：一个偏 GUI 队列，一个偏 TUI pending input preview。Lime 可以把这类输入合并进胶囊/队列层：pending steer 显示为“将注入当前 turn”，queued follow-up 显示为“本轮后发送”，并允许编辑/删除。

### 3.7 Plan / Human-in-the-loop UI

AI Agent 越能执行，计划和审批 UI 越重要。最佳实践不是让模型说“我准备这么做”，而是把计划变成可批准、可拒绝、可编辑、可追踪的对象。

| 场景 | UI 形态 | Lime 建议 |
| --- | --- | --- |
| 普通计划 | Markdown plan + steps | 可读即可 |
| 高风险计划 | approval card | 必须有批准 / 拒绝 |
| 团队审批 | waiting for lead | 显示审批人/状态 |
| 计划被拒绝 | rejected plan message | 保留理由并可继续编辑 |
| 计划保存 | saved path / artifact | 不只留在聊天正文 |
| 权限升级 | danger confirmation | 与 command policy 统一 |
| 成本确认 | cost / model estimate | 与 task/model routing 统一 |

Lime 已有 `action_required` 和 timeline，可以把 HITL 从“文本解释”升级为“状态明确的交互卡”。

### 3.8 Artifact / Canvas UI

Agent UI 的关键分水岭是：最终产物是否离开聊天正文，进入可继续工作的表面。

| 模式 | 代表 | Lime 建议 |
| --- | --- | --- |
| Inline preview | ChatGPT 小预览、tool result preview | 适合短结果 |
| 右侧 Canvas | Claude Artifacts、ChatGPT Canvas、Gemini Canvas | Lime 应强化为主交付面 |
| 文件树 / 产物列表 | IDE agent、workspace 产品 | 适合多文件、多版本 |
| Diff view | Cursor、Windsurf | 代码/文档修改必须支持 |
| Version history | Artifacts / docs | Artifact Workbench P1/P2 |
| Source drawer | 研究报告、网页任务 | 与 timeline/evidence 同源 |
| Export / share | 文档、图片、报告 | 使用桌面保存与 artifact export 主链 |

Lime 的既有路线图已经说清楚：`Chat for reasoning, Artifact for delivery`。Agent UI 文档应把这条原则提升为所有交互设计的第一约束。

### 3.9 Timeline / Evidence UI

Timeline 和 Evidence 是 Lime 可以走出自己特色的地方。多数竞品只显示“看起来可信”的过程，Lime 可以显示真正可复查的运行事实。

| 层级 | 目的 | 展示方式 |
| --- | --- | --- |
| Inline process | 当前 turn 发生了什么 | 少量关键状态 |
| Turn timeline | 工具、thinking、artifact、action | 折叠时间线 |
| Session timeline | 多回合运行历史 | 默认懒加载 |
| Evidence pack | 可导出事实包 | Harness / review 面板 |
| Replay | 复现问题 | 调试/验证入口 |
| Request log | 模型、provider、路由、成本 | 诊断面 |

重要边界：不是所有事件都要直接展示给用户。事件可以进入事实源，UI 只投影必要摘要。否则 timeline 会变成另一种刷屏。

### 3.10 Multi-agent / Team UI

多 Agent UI 不应一开始做成复杂组织图。先从任务状态和责任边界做起。

| 模式 | 使用时机 | Lime 建议 |
| --- | --- | --- |
| 成员胶囊 | 多个子代理并行 | 顶部/底部状态压缩 |
| 子任务列表 | 可拆解任务 | 任务中心展示 |
| Handoff 卡 | 子代理交接结果 | 与 evidence / artifact 绑定 |
| Leader approval | 需要审批 | 计划 UI 的扩展 |
| Queue view | 多任务排队 | 避免全量 tab 同时渲染 |
| Per-agent trace | 调试失败 | 默认折叠 |

Lime 的 team/subagent 特色应该是“可观察、可交接、可验证”，而不是多几个头像。

### 3.11 Browser / Research UI

研究类 Agent 需要的 UI 与普通问答不同。

| 模式 | 目的 | Lime 建议 |
| --- | --- | --- |
| 查询计划 | 解释将查什么 | 可折叠 |
| 来源列表 | 可信度和复查 | 与 citation/evidence 同源 |
| 浏览器快照 | 证明页面状态 | browser runtime artifact |
| 进度步骤 | 多轮搜索 | capsule + timeline |
| 最终报告 | 交付物 | artifact document |
| 引用回跳 | 从报告到来源 | artifact source drawer |

Gemini Deep Research 的核心不是“搜得多”，而是把研究过程、来源和最终报告分层。Lime 如果结合 browser runtime 和 evidence pack，可以做得更扎实。

### 3.12 Tab / Session UI

用户已经多次反馈：多会话、多 tab 和旧会话恢复会导致卡顿。这里的 UI 不能只学聊天产品，要学习浏览器。

| 浏览器式概念 | Agent 会话映射 | 目的 |
| --- | --- | --- |
| Active tab | 当前可交互会话 | 全量渲染 |
| Recent tab | 最近使用会话 | 轻量快照 |
| Pinned tab | 固定重要任务 | 不被自动丢弃 |
| Suspended tab | 暂停渲染但保留状态 | 降低 CPU/内存 |
| Discarded tab | 释放重资源，保留恢复入口 | 控制长时间使用成本 |
| Restore | 重新加载窗口历史 | 渐进恢复 |
| Tab group | 项目/任务分组 | workspace 维度组织 |
| Remote backend thread | 远端机器上的 Codex session | 显示连接、运行、未读、恢复状态 |
| Worktree / clone agent | 隔离工作区任务 | 作为 session 派生关系，而不是普通平铺 tab |

Lime 的多会话体验应避免“打开一个历史对话就把所有东西恢复出来”。旧会话默认显示窗口化消息、轻量 timeline 摘要和 artifact 索引；只有用户展开时才加载完整历史和细节。

CodexMonitor 的 thread 管理提醒我们：session UI 还要表达 pin、archive、copy、resume、running、unread、remote backend 和 worktree 派生关系。Lime 不宜只做浏览器标签外观，而应把 tab 当成“可恢复执行单元”的索引。

### 3.13 Error / Recovery UI

Agent 产品一定会失败，好的 UI 不是隐藏失败，而是让失败可恢复。

| 错误类型 | UI 方式 |
| --- | --- |
| Provider credential | 指向设置页，保留当前输入 |
| Rate limit | 显示等待/换模型/重试 |
| Tool permission denied | 展示被拒绝动作和替代路径 |
| Tool timeout | 可重跑、可取消、可导出日志 |
| Empty output | 明确无输出，不留白 |
| Bad formatting | 提供重新渲染/原文查看 |
| Stream interrupted | 保留已生成内容，允许继续 |
| Old session corrupt | 轻量恢复 + 诊断导出 |

错误态必须和 runtime/evidence 绑定，不能只在 toast 里一闪而过。

### 3.14 Performance UI

性能不是纯工程问题，也是一种 UI 设计。

| 模式 | 解决问题 | Lime 建议 |
| --- | --- | --- |
| Skeleton | 首屏等待 | 打开旧会话先挂 UI |
| First token placeholder | 首字前无反馈 | 已有基础，继续强化 |
| Progressive hydration | 旧会话重 | 先文本，后 timeline/tool |
| Virtual list | 消息多 | 长历史必须使用窗口化 |
| Lazy timeline | threadItems 重 | 默认摘要，展开再构建 |
| Suspended tab | 多会话卡顿 | 浏览器式 session 管理 |
| Output cap | 工具输出巨大 | 预览 + warning + 详情 |
| Worker parsing | Markdown/timeline 重 | P2 可引入 |
| Adaptive stream chunking | 流式 backlog 和 UI 卡顿 | Smooth / CatchUp 策略，按队列压力切换 |
| Queue pressure metrics | 流式调优无证据 | 记录 queue depth、oldest age、mode transition、rapid re-entry |
| Stable status row | 运行态布局抖动 | 状态行固定高度，详情有最大行数 |

“看起来慢”经常来自三个源头：首 token 前无反馈、历史恢复同步计算、后台会话全量渲染。Agent UI 路线图必须把性能策略写进交互，而不是只靠后端优化。

Codex TUI 的流式分块文档给 Lime 一个可执行验证方向：不要只观察“首字时间”，还要记录 UI 消费流的 backlog。至少应能看到每次渲染提交的队列深度、最老未渲染 delta 年龄、是否进入 catch-up、是否频繁抖动切换。这样才能解释“模型已经吐了但 UI 还慢”。

## 4. Lime 应该形成的 UI 架构

### 4.1 五层模型

Lime Agent UI 建议按五层组织：

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| 对话层 | 用户意图、最终回答、少量协作文本 | 展示全部工具日志 |
| 过程层 | thinking、runtime status、tool summary、timeline 摘要 | 承载最终产物 |
| 任务层 | 胶囊、队列、后台任务、子代理、plan approval | 替代消息列表 |
| 产物层 | Artifact、Canvas、文件、diff、版本、导出 | 解释所有推理 |
| 证据层 | evidence、replay、request log、review、diagnostic | 日常默认展开 |

这五层对应 Lime 的现有能力，不需要新造第二套 runtime。关键是让 UI 只消费同一条事实链的不同投影。

### 4.2 信息优先级

默认屏幕优先级应为：

1. 当前用户目标和输入区。
2. 当前 active turn 的可读状态。
3. 最终回答或 artifact 交付物。
4. 需要用户介入的 action。
5. 后台任务胶囊。
6. 可展开过程和证据。

不应默认抢占注意力的内容：

- 全量 thinking。
- 全量 tool JSON。
- 完整 request log。
- 历史 turn 的所有 timeline 细节。
- 已完成后台任务的长日志。

### 4.3 Lime 视觉语言约束

根据 `docs/aiprompts/design-language.md`，Agent UI 应保持：

- 轻盈、清晰、专业，信息优先。
- 桌面应用感强，避免网页营销风格。
- 主表面使用实体底色，不依赖半透明和磨砂。
- 胶囊可以使用小圆角状态标签，但不要把所有内容都做成卡片。
- 状态色保持语义稳定：成功 emerald，提醒 amber，信息 sky/slate，错误 rose/red。
- 中文排版优先，不使用过大的英文 tracking 破坏阅读。

这意味着 Lime 可以使用胶囊式 UI，但胶囊必须是状态语义，不是视觉噱头。

## 5. 适合 Lime 的优先级

### P0：对话主链 UI 收敛

目标：解决旧会话卡顿、首字慢、重复吐字、排版污染这些用户已经感知到的问题。

建议动作：

1. `thinking`、`tool_use`、`action_required` 与最终正文严格分层。
2. 首 token 前始终显示可信 runtime status，不让用户面对空白等待。
3. tool 输出默认摘要化，正文只保留必要解释。
4. 历史消息默认轻量渲染：文本优先，timeline/tool 详情延后。
5. 长输出和大 JSON 必须有 preview、warning 和详情入口。

验收：

- DeepSeek / reasoning 模型不会把思考内容重复吐到正文。
- 打开旧会话不会触发长时间鼠标 loading 和明显 CPU 飙高。
- 用户能在 1 秒内看到“请求已提交/正在路由/正在等待模型”等阶段反馈。
- 工具执行不会把正文排版挤乱。

### P1：执行胶囊层

目标：让后台任务、多 Agent、计划审批和 needs input 有统一入口。

建议动作：

1. 引入任务胶囊状态模型：running、queued、needs_input、plan_ready、failed、completed。
2. 普通 running 低调显示；needs_input / plan_ready / failed 明确提示。
3. 胶囊点击展开任务中心或当前 session timeline。
4. 胶囊与 tab/session 管理联动，避免所有会话全量恢复。

验收：

- 多个后台任务不会刷屏。
- 用户能一眼知道哪个任务需要介入。
- 打开多个历史对话时，非 active 会话不持续吃 CPU。

### P1：Artifact-first 交付路径

目标：让最终产物离开聊天正文，进入可编辑、可版本化、可导出的工作台。

建议动作：

1. 对文档、代码、报告、图片、网页研究等结果默认创建 artifact。
2. 聊天正文只解释意图、摘要和下一步。
3. Artifact 与 timeline item 双向跳转。
4. 工具来源、引用和 evidence 能回挂到 artifact source drawer。

验收：

- 长报告不再只是一大段聊天 Markdown。
- 用户可从 artifact 找到生成它的 turn、tool、source。
- 修改、重写、导出走 Artifact Workbench，而不是重发一段聊天。

### P2：浏览器式 Session / Tab 管理

目标：解决多会话长期运行的性能和导航问题。

建议动作：

1. Session tab 引入 active、recent、pinned、suspended、discarded 状态。
2. 非 active 历史会话只保留标题、摘要、任务胶囊和 artifact 索引。
3. 恢复旧会话采用 progressive hydration。
4. pinned session 不被自动丢弃，普通 session 可按内存压力降级。

验收：

- 同时打开多个历史对话不会线性增加主线程压力。
- 切回旧会话先显示可读快照，再渐进恢复细节。
- 新建任务不会被旧会话恢复阻塞。

### P2：Team / Evidence 工作台

目标：让 Lime 的团队代理和证据链成为差异化能力。

建议动作：

1. Team/subagent 先以胶囊和任务列表呈现，不急于做复杂图谱。
2. Handoff 结果进入 timeline 和 artifact。
3. Evidence pack 和 replay 入口只在需要诊断、审核、验证时展开。
4. Harness 面板与对话工作台共享同一份 verification facts。

验收：

- 多 Agent 执行能看出责任边界。
- 失败时能导出证据，而不是让用户截图聊天。
- Review / replay / UI 不出现事实漂移。

## 6. 推荐路线图

### Phase 1：对话主链稳定化

交付内容：

- thinking / final text / tool / action_required 的展示边界收紧。
- 首 token placeholder 与 runtime status 统一。
- 历史恢复默认轻量渲染。
- tool rich output 支持截断、预览、大输出警告、空输出提示。
- 流式输出引入 UI backlog 指标，区分模型慢、invoke 慢和前端渲染慢。
- E2E 覆盖新建对话、旧会话、流式、thinking、tool 输出、错误恢复。

这是最先做的一刀，因为它直接对应当前用户痛点：旧会话慢、首字慢、重复吐字、排版不稳。

### Phase 2：胶囊任务层

交付内容：

- 任务胶囊状态模型。
- 胶囊栏或状态区。
- needs input / plan ready / failed 的 attention CTA。
- 胶囊点击进入任务中心或 timeline。
- 后台任务与 session/tab 状态关联。

这一刀会把 Claude Code 的 pill 思路转化为 Lime 自己的桌面工作台语言。

### Phase 3：Artifact 与 Timeline 双向增强

交付内容：

- artifact 默认承载长产物。
- timeline item 可打开 artifact 定位。
- artifact source drawer 可回跳 source / tool / evidence。
- report / code / image / browser snapshot 等 domain artifact 的 viewer 收敛。

这一刀让 Lime 从“聊天里有产物”变成“围绕产物协作”。

### Phase 4：浏览器式会话管理

交付内容：

- active / recent / pinned / suspended / discarded session 状态。
- 非 active session 的资源降级。
- 旧会话 progressive hydration。
- 多 tab 下的 CPU、内存、主线程指标回归。

这一刀专门解决“对话多了以后卡”的长期问题。

### Phase 5：Team / 多 Agent 工作台

交付内容：

- team/subagent 胶囊。
- 子任务列表和 handoff 卡。
- leader approval / plan approval。
- evidence / replay / verification 与 UI 联动。

这一刀把 Lime 的长期特色显性化：不是单个聊天助手，而是可治理的 Agent 工作系统。

## 7. 验收标准

### 7.1 用户体验验收

1. 新建对话可以快速打开，不被旧会话恢复阻塞。
2. 打开旧会话先出现可读内容，再渐进恢复细节。
3. 首 token 前有可信状态，不出现长时间空白。
4. thinking 不与最终答案重复。
5. tool 输出不会破坏正文排版。
6. action_required 有明确 CTA。
7. 后台任务有胶囊入口，且注意力状态清晰。
8. 长报告、代码、图片、研究结果进入 artifact。
9. artifact 能回跳来源、timeline 和 evidence。
10. 多个 tab/session 长时间存在时 CPU 和内存可控。

### 7.2 工程验收

1. 不新增第二套事件系统。
2. UI 消费 `AgentEvent -> timeline -> thread_read -> evidence` 主链投影。
3. `ContentPart` 继续作为消息结构化 part 的前端边界。
4. tool / thinking / action / artifact 的渲染有稳定测试。
5. GUI 主路径补 Playwright / smoke 验证。
6. 旧会话性能改动有 E2E 或性能日志证明。
7. 文档、代码和测试都不扩展 deprecated / compat 路径。

## 8. 明确不做

1. 不直接复制 Claude、ChatGPT、Gemini、Cursor、Warp 的视觉。
2. 不把所有 tool 输出塞进聊天正文。
3. 不把 thinking 当作最终答案的一部分。
4. 不新增与 timeline/evidence 平行的第二套事实系统。
5. 不为了“胶囊好看”把所有状态都做成 pill。
6. 不默认全量恢复每个历史会话。
7. 不为了展示透明度牺牲旧会话性能。
8. 不用营销式 hero 或大面积装饰背景包装 Agent 工作台。

## 9. 参考资料

### 9.1 官方与公开资料

- OpenAI Agents 指南：`https://platform.openai.com/docs/guides/agents`
- OpenAI Agent Builder：`https://platform.openai.com/docs/guides/agent-builder`
- OpenAI ChatKit：`https://platform.openai.com/docs/guides/chatkit`
- OpenAI Canvas 发布文：`https://openai.com/index/introducing-canvas/`
- ChatGPT Projects 帮助文档：`https://help.openai.com/en/articles/10169521-projects-in-chatgpt`
- Claude Artifacts 帮助文档：`https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them`
- Claude Extended Thinking 文档：`https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking`
- Anthropic Computer Use 发布文：`https://www.anthropic.com/news/3-5-models-and-computer-use`
- Gemini Canvas：`https://gemini.google/overview/canvas/`
- Gemini Deep Research 帮助文档：`https://support.google.com/gemini/answer/15719111`
- Warp Agent Mode 文档：`https://docs.warp.dev/agents/warp-ai/agent-mode`
- Cursor Docs：`https://docs.cursor.com/`
- Windsurf Docs：`https://docs.windsurf.com/`
- Microsoft Human-AI Interaction Guidelines：`https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/`
- Google People + AI Guidebook：`https://pair.withgoogle.com/guidebook/`

### 9.2 Context7 查询源

- `assistant-ui`：`/assistant-ui/assistant-ui`
- `Vercel AI SDK`：`/vercel/ai`
- `CopilotKit`：`/copilotkit/copilotkit`

### 9.3 本地参考源

- Claude Code pill：`/Users/coso/Documents/dev/js/claudecode/src/tasks/pillLabel.ts`
- Claude Code MCP tool UI：`/Users/coso/Documents/dev/js/claudecode/src/tools/MCPTool/UI.tsx`
- Claude Code plan UI：`/Users/coso/Documents/dev/js/claudecode/src/tools/ExitPlanModeTool/UI.tsx`
- Warp 项目说明：`/Users/coso/Documents/dev/rust/warp/WARP.md`
- Warp Agent Mode 测试：`/Users/coso/Documents/dev/rust/warp/crates/integration/src/test/agent_mode.rs`
- CodexMonitor README：`/Users/coso/Documents/dev/rust/CodexMonitor/README.md`
- CodexMonitor app-server event reference：`/Users/coso/Documents/dev/rust/CodexMonitor/docs/app-server-events.md`
- CodexMonitor composer：`/Users/coso/Documents/dev/rust/CodexMonitor/src/features/composer/components/Composer.tsx`
- CodexMonitor queue：`/Users/coso/Documents/dev/rust/CodexMonitor/src/features/composer/components/ComposerQueue.tsx`
- CodexMonitor messages：`/Users/coso/Documents/dev/rust/CodexMonitor/src/features/messages/components/Messages.tsx`
- Codex TUI composer state machine：`/Users/coso/Documents/dev/rust/codex/docs/tui-chat-composer.md`
- Codex TUI request-user-input overlay：`/Users/coso/Documents/dev/rust/codex/docs/tui-request-user-input.md`
- Codex TUI stream chunking：`/Users/coso/Documents/dev/rust/codex/docs/tui-stream-chunking-tuning.md`
- Codex TUI stream validation：`/Users/coso/Documents/dev/rust/codex/docs/tui-stream-chunking-validation.md`
- Codex TUI status / queue UI：`/Users/coso/Documents/dev/rust/codex/codex-rs/tui/src/status_indicator_widget.rs`、`/Users/coso/Documents/dev/rust/codex/codex-rs/tui/src/bottom_pane/pending_input_preview.rs`

### 9.4 Lime 事实源

- `src/components/agent/chat/types.ts`
- `src/components/agent/chat/components/StreamingRenderer.tsx`
- `src/components/agent/chat/components/MessageList.tsx`
- `docs/roadmap/task/event-chain.md`
- `docs/roadmap/artifacts/roadmap.md`
- `docs/roadmap/harness-engine/README.md`
- `docs/roadmap/warp/README.md`

## 10. 最终建议

Lime 的 Agent UI 不应把“胶囊式 UI”“思考 UI”“工具 UI”“Artifact UI”当作互相独立的组件库任务。它们应该围绕同一个问题收束：

> 用户如何在一个桌面工作区里，快速知道 Agent 正在做什么、什么时候需要自己介入、产物在哪里、过程是否可信、失败后如何恢复？

因此下一阶段最务实的顺序是：

1. 先修对话主链：thinking、tool、首 token、旧会话性能。
2. 再建胶囊任务层：后台任务、needs input、plan ready、多 session 压缩。
3. 然后强化 Artifact：最终产物离开正文，进入 Workbench。
4. 最后把 session/tab、team/subagent、evidence/replay 组织成 Lime 独有的 Agent 工作系统。

这条路既吸收了 Claude Code 的执行状态、Warp 的 block 化工作上下文、ChatGPT/Claude/Gemini 的 Canvas/Artifact 经验，也保留 Lime 自己最重要的差异化：可执行、可观察、可交付、可验证。
