# Skill Forge Agent 产品模型拆解

> 状态：current research reference
> 更新时间：2026-05-06
> 目标：把 Founder Park 访谈中 Agent / Skill / Memory / Widget / Schedule / Workspace 协作的产品模型拆清楚，避免把 Skill Forge 简化为 Skill Forge 或工具注册表。

## 1. 一句话结论

访谈里 Skill Forge 对 Agent 与 Skill 的区分很关键：

**Skill 更像 Agent 的 runbook；Agent 则是可复用工作单元，至少还包含 memory、widget、schedule、权限、运行历史和协作上下文。**

因此 Lime 的路线不能停在：

```text
verified skill -> 可调用工具
```

还要逐步走向：

```text
一次成功任务
  -> 主动建议固化
  -> Skill / runbook
  -> Agent envelope：memory + schedule + widget + permission + evidence
  -> 可 rerun / 可共享 / 可审计
```

## 2. 从任务到 Agent 的 aha moment

Skill Forge 访谈里真正的用户转化不是让用户先理解“什么是 Agent”，而是：

1. 用户先完成一个具体任务。
2. 系统发现任务结果稳定、方法可复用。
3. 系统主动建议“把这套方法转成以后可以复用的 Agent”。
4. 用户设置触发条件、输入、调度和权限。
5. 以后只看结果、处理阻塞、做决策。

固定判断：

**Proactive agentization 是产品层能力，不是 runtime 层能力。Runtime 负责能不能跑，产品面负责什么时候建议固化。**

## 3. Agent 与 Skill 的分层

| 层级 | 职责 | Lime 中的收敛方向 |
| --- | --- | --- |
| Skill / Runbook | 描述如何执行一类任务，包含步骤、脚本、示例、测试 | Agent Skill Bundle / Adapter Spec |
| Memory | 保存用户偏好、历史决策、方法论、上下文摘要 | memory compaction / state-history-telemetry |
| Widget | 展示输入、结果、状态、阻塞点、产物 | Workspace / Task Center / ServiceSkill 投影 |
| Schedule | 手动、定时、事件触发、rerun | automation job / Managed Objective |
| Permission | 控制外部读写、文件写入、发布、付款等 | tool_runtime / permission policy |
| Evidence | 证明生成、验证、注册、调用和结果 | artifact / timeline / evidence pack |

固定边界：

**Skill 不是完整 Agent；Agent 也不应成为绕过 Skill / tool_runtime / evidence 的新执行实体。**

## 4. 短高频重复任务优先

访谈里对“长时间任务”的判断有一个容易被误读的点：

1. 大多数商业化任务不是单个任务连续跑很久。
2. 更常见的是短暂、高频、重复、可拆分的知识工作。
3. 用户价值来自“每天 / 每周自动 rerun，并把人从重复整理中解放出来”。

因此本目录后续使用“长期运行”时，默认含义应是：

**可持久化、可调度、可恢复、可 rerun 的重复工作，而不是无限自主长跑。**

对 Lime 的含义：

1. P4 首期应优先支持 verified read-only skill 的手动运行、定时运行和失败阻塞。
2. 不应急着做无限链式自主任务。
3. completion audit 要证明每次 rerun 的产物和成功标准，而不是只证明模型“还在跑”。

## 5. Workspace 内共享，而不是公开 Marketplace 优先

访谈中 Skill Forge 区分了两种共享：

1. **公开 Marketplace / Skill Store**
   - 用 agent 换取经济回报。
   - 问题是每个 agent 高度依赖具体 workspace、context、sandbox 和账号环境。

2. **团队 Workspace 内共享**
   - 同一团队在同一上下文、权限和基础设施中共享 agent、skill、context。
   - 更贴近工作场景里的协作需求。

对 Lime 的固定判断：

**首期优先 workspace/team-scoped sharing，不优先公开交易市场。**

这意味着：

1. workspace-local skill 默认只在当前 workspace 可见。
2. team sharing 需要显式权限、来源、版本和 evidence。
3. Marketplace 只可作为后续启发入口，不应成为 P3/P4 主线。

## 6. 云端 sandbox 与本地 GUI 的张力

Skill Forge 访谈倾向云端，理由包括：

1. 每个请求独立 sandbox，环境隔离更稳定。
2. 平台修复一次基础设施问题，所有用户受益。
3. 人与 agent、agent 与 agent 的协作需要共享 context。
4. 云端可以更强控制数据库、文件系统、memory、connector 协议和性能。

Lime 是桌面 GUI 产品，不能直接照搬“完全云端”。应拆成两个问题：

1. **产品面**：Workspace、证据、任务、review 可以继续是 Lime 桌面 GUI 的强项。
2. **执行面**：高隔离、高复现、高风险外部操作，未来可接 remote runtime / sandbox profile。

固定边界：

**Lime 不因 Skill Forge 云端叙事放弃桌面主路径；但 P3E/P4 之后必须把 sandbox profile、session enable、tool_runtime 授权和 evidence 绑定起来。**

## 7. Memory 三层机制启发

访谈中的 memory 机制可抽象为三层：

1. **Thread 内压缩**
   - context 接近上限时压缩，把应记住的内容写入文件系统或等价持久层。

2. **跨 Thread 长期记忆**
   - 每次请求结束后判断是否有长期价值，抽取、去重并存储。

3. **新 Thread 相关记忆注入**
   - 新任务开始时检索最相关的历史 memory，并注入上下文。

对 Lime 的含义：

**generated skill / agent envelope 不能只保存脚本；还应能引用产生它的方法论、用户偏好、历史修正和运行反馈。**

## 8. 对 Lime 的禁止项

1. 不把 `Skill` 直接宣称为完整 `Agent`。
2. 不为 Agent envelope 新增平行 runtime。
3. 不把 public marketplace 放到 workspace-local skill 之前。
4. 不把“长时运行”误写成无限自主执行。
5. 不让 Widget / Schedule / Memory 绕过 Workspace、automation job、Managed Objective 和 evidence。

## 9. 一句话结论

**Skill Forge 给 Lime 的产品启发是：把一次成功任务主动固化为可 rerun、可共享、可审计的 Agent；Skill Forge 只是这条链的上游，不是完整产品终点。**
