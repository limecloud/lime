# Warp 研究总入口

> 状态：current research reference  
> 更新时间：2026-04-29  
> 研究样本：`/Users/coso/Documents/dev/rust/warp`，`master` HEAD `c325d14`，提交时间 `2026-04-28 16:35:30 -0700`  
> 目标：把 Warp 开源客户端拆成可持续对照的研究事实源，说明 Lime 在多模态管理、Agent Harness、模型路由、任务与产物事实源上应该学什么、不该照搬什么。

## 1. 目录定位

`docs/research/warp/` 只回答两类问题：

1. Warp 的开源客户端到底暴露了哪些可学习的系统骨架。
2. Lime 在多模态管理与 LimeCore 云服务协同时，应该吸收哪些原则。

这里是**研究目录**，不是 Lime 的实现排期目录。

固定边界：

1. 这里可以拆解 Warp 的 Agent、Harness、Profile、Artifact、Attachment、Computer Use、Skill 与云/本地分层。
2. 这里不能直接替 Lime 做产品命名、页面结构和代码落点决策。
3. Lime 自己的开发计划统一写进 [../../roadmap/warp/README.md](../../roadmap/warp/README.md)。

一句话：

**`research/warp` 负责防止我们把多模态管理做成散乱能力列表；`roadmap/warp` 负责把可借鉴原则落成 Lime 的开发计划。**

## 2. 为什么要单独研究 Warp

Warp 开源后，最值得 Lime 研究的不是它的终端 UI，而是它对 Agentic Development Environment 的系统切分：

```text
用户输入
  -> Agent / Conversation / Run
  -> Harness / Skill / Tool / Attachment
  -> Task / Event / Artifact / Evidence
  -> GUI / CLI / Cloud / Local Runtime 多面消费
```

这和 Lime 当前 command runtime 主链天然对齐：

```text
命令触发
  -> Agent 分析
  -> skills / tools / workflow / task / ServiceSkill binding
  -> 聊天区轻量结果卡
  -> 右侧查看区
```

研究 Warp 的直接意义是：

1. 帮 Lime 先建立底层 typed modality runtime contract，再把 `@配图`、`@配音`、`@浏览器`、`@读PDF`、`@搜索` 这类入口绑定上来。
2. 帮 Lime 把模型选择从“聊天设置”提升为 `任务画像 -> 候选能力集 -> 路由决策 -> 成本/权限/降级解释`。
3. 帮 LimeCore 明确自己应负责目录、策略、模型 offer、Gateway 与审计，而不是抢走 Lime 本地执行主链。
4. 帮 Harness Engine 把多模态产物、截图、附件、任务、工具轨迹统一纳入 evidence，而不是让 viewer 反向成为事实源。

## 3. 与 ClaudeCode 主参考的关系

Lime 的 Agent Runtime 主参考仍然是 `/Users/coso/Documents/dev/js/claudecode`。

Warp 与 ClaudeCode 不冲突，但分工不同：

1. ClaudeCode 优先回答：Agent loop、tool use、permission、slash command、SkillTool、AgentTool、subagent task、session transcript 应该如何组织。
2. Warp 补充回答：多 executor、多 artifact、多运行地点、多模态权限和 cloud/local 分层应该如何治理。
3. Lime 自己裁决：GUI 工作台、viewer、LimeCore 云事实源、本地优先执行和领域化 artifact graph 如何落地。

固定关系：

**ClaudeCode 是主干参考，Warp 是运行治理补充；如果二者表面冲突，Agent/tool/permission 语义优先按 ClaudeCode，多模态 artifact/profile/harness/index 参考 Warp。**

详细边界见 [claudecode-compatibility.md](./claudecode-compatibility.md)。

## 4. Warp 的固定判断

基于本地源码与 README，Warp 当前可以稳定判断为：

1. **终端出生的 Agentic Development Environment**
   - README 明确它是 born out of the terminal 的 agentic development environment。
   - 用户可用内置 coding agent，也可接 Claude Code、Codex、Gemini CLI 等外部 CLI agent。

2. **Agent 是主线程，Harness 是执行适配器**
   - `Harness` 枚举把 `oz / claude / opencode / gemini` 收成统一入口。
   - 外部 CLI 通过 harness runner 接入，不让模型自由手写一堆 shell 作为首发路径。

3. **Profile 同时承载模型与权限**
   - `AIExecutionProfile` 不只选模型，还包含文件读、命令执行、PTY 写入、MCP、computer use、web search、allowlist / denylist。
   - 这比“单独模型选择器 + 一堆分散权限开关”更适合长任务。

4. **Attachment 是输入上下文，Artifact 是输出事实**
   - `SpawnAgentRequest.attachments`、`referenced_attachments` 和 `Artifact::Plan / PullRequest / Screenshot / File` 说明 Warp 把输入材料与输出产物分开建模。
   - 多模态不是“把图片/文件塞进聊天”，而是带身份、类型、生命周期和归属的上下文对象。

5. **Run / Task / Conversation 是关联键骨架**
   - `AIConversation` 里维护 conversation id、server conversation token、task/run id、parent agent、child agent、event sequence。
   - 这让任务、消息、产物、审计、恢复和 UI 能对同一条运行事实说话。

6. **Computer Use 是独立高风险能力面**
   - `computer_use` crate 把鼠标、键盘、滚动、输入、截图参数都做成 typed action。
   - 这说明浏览器/桌面操作不能被当成普通 web search 或普通 tool，它需要单独权限、观察和截图回流。

7. **Skill 是跨 agent 生态的说明书，不只是 Warp 私有按钮**
   - Skill provider precedence 覆盖 `.agents/skills`、`.warp/skills`、`.claude/skills`、`.codex/skills`、`.gemini/skills` 等目录。
   - 对 Lime 的启发是：能力目录应该是 typed descriptor + provider precedence，而不是前端静态常量无限复制。

## 5. Lime 真正要学什么

Lime 不应该学 Warp 的终端中心形态，而应该学下面这些系统原则：

1. **统一运行身份**
   - 每一次多模态调用都必须能落到 `session / thread / turn / task / artifact / evidence`。
   - 没有关联键的图片、音频、截图、PDF 解析和浏览器步骤，都不应算 current 事实。

2. **统一能力描述**
   - `@配图`、`@配音`、`@浏览器`、`@搜索`、`@PPT` 不应只是 parser 分支。
   - 它们应该绑定到底层同构 descriptor：modality、首刀 skill/tool、能力需求、权限需求、模型需求、truth source、viewer、evidence events。

3. **统一模型能力矩阵**
   - 多模态模型选择不能只看 provider name。
   - 必须看 `vision input / image output / audio input / browser control / tool use / cost / quota / latency / region / OEM policy`。

4. **统一权限 Profile**
   - 文件、命令、MCP、浏览器、媒体上传、云端 Gateway、ServiceSkill 都应进入同一组 profile / policy，而不是每个页面自己加开关。

5. **统一产物事实源**
   - 结果不是消息文本的一段补充。
   - 图片、音频、网页、PDF、报告、截图、任务文件都必须归入可恢复、可审计、可 viewer 消费的 artifact graph。

6. **统一 Harness 适配器边界**
   - 外部 CLI、本地工具、云端 API 都可以成为 executor。
   - 但谁能首发、谁只是 compat、谁负责写 truth source，必须由 binding / runtime 决定，不由模型自由猜。

## 6. 固定不照搬的东西

以下内容默认只作为背景，不直接搬进 Lime：

1. 终端作为绝对主舞台
2. Oz 云 Agent 的产品命名与商业架构
3. 开发者代码任务优先的 IA
4. 把 `PLAN / PR / SCREENSHOT / FILE` 当成 Lime 多模态产物的完整分类
5. 默认把第三方 CLI 当作正式产品运行时入口
6. 让 CLI harness 使用高权限跳过策略来换取体验速度
7. 以开源贡献流程作为 Lime 产品流程

Lime 的产品语境不同：

1. Lime 是内容创作与本地优先桌面客户端。
2. LimeCore 是云端控制面、模型 offer、目录与 Gateway，不是默认云端代跑所有能力。
3. Lime 的多模态结果需要图片工作台、音频、PDF、网页、文稿、浏览器会话等更细粒度 artifact，而不是只落成普通文件卡。

## 7. 建议阅读顺序

1. [architecture-breakdown.md](./architecture-breakdown.md)
2. [architecture-diagrams.md](./architecture-diagrams.md)
3. [sequences.md](./sequences.md)
4. [flowcharts.md](./flowcharts.md)
5. [agent-harness-and-multimodal-management.md](./agent-harness-and-multimodal-management.md)
6. [borrowable-patterns.md](./borrowable-patterns.md)
7. [lime-gap-analysis.md](./lime-gap-analysis.md)
8. [claudecode-compatibility.md](./claudecode-compatibility.md)
9. [../../roadmap/warp/README.md](../../roadmap/warp/README.md)

## 8. 与 Lime 路线图的关系

后续所有“参考 Warp”的实现建议，默认遵守以下顺序：

1. 先读本目录，确认 Warp 可借鉴的是哪一层。
2. 再读 [../../roadmap/warp/README.md](../../roadmap/warp/README.md)，确认 Lime 决定怎么做。
3. 涉及模型经济调度时，继续回挂 [../../roadmap/task/README.md](../../roadmap/task/README.md)。
4. 涉及命令与 skill 主链时，继续回挂 [../../aiprompts/command-runtime.md](../../aiprompts/command-runtime.md)。
5. 涉及 LimeCore 云事实源时，继续回挂 [../../aiprompts/limecore-collaboration-entry.md](../../aiprompts/limecore-collaboration-entry.md) 与 LimeCore 的 `docs/aiprompts/lime-limecore-collaboration.md`。

一句话：

**Warp 是外部系统参考，不是 Lime 的新北极星；Lime 要借它的运行时骨架，服务自己的多模态创作主链。**
