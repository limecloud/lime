# CreoAI 研究总入口

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：把视频转述中的 CreoAI / Career AI / CreaoIO 案例拆成可持续对照的研究事实源，供 Lime 后续规划校准“Coding Agent 编码工具并长期运行业务”的产品范式。

## 1. 命名与来源边界

用户转述中出现了 `career AI`、`creaoio`、`creaoai` 等名称差异。本文档统一称为 **CreoAI**，只分析视频转述中体现的架构范式。

固定边界：

1. 本目录不把用户数、融资额、团队背景等转述内容写成已核验事实。
2. 本目录不评估 CreoAI 公司真实性、商业数据或投资信息。
3. 本目录只沉淀对 Lime 有用的产品与工程启发。

一句话：

**这里研究的是“Tool-Maker Agent / 长时自治工作流”这类范式，不是做外部公司尽调。**

## 2. 目录定位

`docs/research/creaoai/` 只回答两类问题：

1. 视频里的三层架构和工具编码编排到底是什么。
2. Lime 应该学它的哪一层，不应该照搬哪一层。

这里是**研究目录**，不是 Lime 的产品决策目录。

固定分工：

1. `docs/research/creaoai/` 负责外部案例拆解和风险识别。
2. `docs/roadmap/creaoai/` 负责 Lime 自己的开发计划。
3. [../codex-goal/README.md](../codex-goal/README.md) 单独研究 Codex `/goal` 这类 persistent objective / continuation loop，不再塞进 CreoAI 研究目录。
4. 代码实现仍必须回到 Lime 现有 current 主链：`skills pipeline / Query Loop / tool_runtime / Workspace / evidence pack`。

## 3. 为什么单独建立这一层

这个案例最容易被误读成：

1. 又一个工作流自动化工具。
2. 又一个电商运营垂类 agent。
3. 又一个“AI 会调用 API”的工具集合。

真正值得拆出来的是：

**Coding Agent 不只是调用工具，而是把 CLI、API、网页流程编码成新的可复用能力，再把这些能力纳入长期执行。**

这和 Lime 当前的 skills pipeline 高度相关。如果不单独建研究目录，后续容易出现两种跑偏：

1. 另造一套 `generated tools runtime`，和现有 Skill / tool registry / evidence 主链冲突。
2. 只把它理解成“多接几个 API / MCP”，错过“能力生成、验证、注册、复用”的关键闭环。

## 4. 固定研究结论

当前研究先固定以下结论：

1. **三层架构不是页面结构**
   - 它更像 `Coding Agent -> Autonomous Execution -> Workspace` 的系统分层。

2. **核心不是全自动电商运营**
   - 电商只是 demo。真正能力是把明确工作流编译成长期运行的 agent app。

3. **Coding Agent 是工具生产者**
   - 它要能读取 API / CLI / 文档 / 网页流程，生成 adapter、script、contract、test。

4. **执行必须有 harness**
   - 自动执行必须受权限、dry-run、测试、证据和人工确认约束。

5. **对 Lime 不应新增平行标准**
   - 动态生成能力必须编译进 Lime 现有 Skill Bundle / ServiceSkill / Adapter Spec / tool_runtime 主链。

## 5. 建议阅读顺序

1. [architecture-breakdown.md](./architecture-breakdown.md)
2. [tool-coding-orchestration.md](./tool-coding-orchestration.md)
3. [lime-gap-analysis.md](./lime-gap-analysis.md)
4. [../pi-mono-coding-agent/README.md](../pi-mono-coding-agent/README.md)
5. [../codex-goal/README.md](../codex-goal/README.md)
6. [../../roadmap/creaoai/README.md](../../roadmap/creaoai/README.md)
7. [../../roadmap/creaoai/implementation-plan.md](../../roadmap/creaoai/implementation-plan.md)
8. [../../roadmap/creaoai/diagrams.md](../../roadmap/creaoai/diagrams.md)

## 6. 固定不照搬的东西

以下内容默认不直接搬进 Lime：

1. 电商运营垂类定位。
2. “零门槛全自动”的营销叙事。
3. 不经权限审查的自动发布、自动下单、自动改价。
4. 平行的 workflow builder、scheduler、tool registry 或 evidence 系统。
5. 把 agent 生成代码直接当成用户不可见黑盒执行。

Lime 真正要学的是：

1. Coding Agent 生成可复用能力。
2. CLI / API / 网页流程被编译为标准 adapter。
3. 长时任务可以关窗继续跑。
4. Workspace 沉淀业务上下文、产物、记忆和证据。
5. 自动执行和治理 harness 必须同时存在。

补充参考：

1. [../pi-mono-coding-agent/README.md](../pi-mono-coding-agent/README.md) 不是 CreoAI 公司研究，而是本地开源 coding harness 对照。
2. 它用于回答“Lime 缺的 Coding Agent 层工程上怎么切”。
3. 当前结论是：参考 pi-mono 的 `AgentSession` 分层、工具 allowlist、可插拔工具后端、事件与测试 harness；不复制它的终端产品、JSONL session 事实源或全仓库 shell/write 权限。

## 7. 与 Lime 路线图的关系

后续所有实现建议默认遵守以下顺序：

1. 先读本目录，确认外部范式到底启发了什么。
2. 再读 [../../roadmap/creaoai/README.md](../../roadmap/creaoai/README.md)，确认 Lime 决定怎么做。
3. 涉及 skill / adapter / runtime binding 时，回看 [../../aiprompts/skill-standard.md](../../aiprompts/skill-standard.md) 与 [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)。

一句话：

**`research/creaoai` 负责防止误读外部案例，`roadmap/creaoai` 负责把启发收敛成 Lime current 主线。**
