# Skill Forge Pivot 与组织 Harness 拆解

> 状态：current research reference
> 更新时间：2026-05-06
> 目标：把 Founder Park 访谈里“产品 pivot 之前先组织 pivot”的部分拆成 Lime 可复用的组织与反馈闭环事实源，避免只把 Skill Forge 理解成 Tool-Maker Agent。

## 1. 一句话结论

Skill Forge 访谈里最值得补进 Lime 研究的，不只是 Coding Agent 会写工具，而是：

**当开发实现成本被 AI 压低后，公司的瓶颈从“工程排期”转移到“需求发现、方向判断、验证反馈和组织改造”。**

因此 Skill Forge 的 harness 至少有两层：

1. **产品运行 harness**：让 agent 在 sandbox、memory、schedule、permission、evidence 里稳定执行用户任务。
2. **组织开发 harness**：让 AI 扫描信号、提出需求、人类架构师判断、AI 实现、AB/log 反馈，再反哺下一轮改进。

现有 Lime 研究已经覆盖第一层的一部分；本文件补第二层。

## 2. 访谈口径中的 pivot 时间线

以下为访谈自述口径，未在本目录内做外部尽调核验：

1. **2025 年 1 月底**：公司成立，方向仍在探索。
2. **2025 年 6 月**：大部分团队到位，当时重点仍接近 Vibe Coding / 给人构建传统工具。
3. **2025 年 9 月**：第一版 Vibe Coding 平台上线。
4. **2026 年 1 月**：把产品方向转成 Super Agent。
5. **2026 年 2 月**：完成开发团队 AI-first 改造，一个月内重构新产品基础版本。
6. **2026 年 3 月 31 日**：Super Agent 版本正式上线。

固定判断：

**这不是“先有完美产品，再调整组织”；而是“组织生产方式先改造，产品形态才有足够速度 pivot”。**

## 3. Vibe Coding 失败信号

访谈中 Skill Forge 对上一版产品的反思可以抽象成四点：

1. **自己人用不起来**
   - 如果团队自己搭出来的应用都难以长期使用，说明产品价值不在“更快造传统 App”。

2. **构建成本大于使用收益**
   - 花在搭建、调优、修 bug 上的时间，超过了最终使用这个应用的时间。

3. **传统 UI 是给人工作的，不是给 AI 工作的**
   - 如果未来执行者是 AI，AI 不需要传统 SaaS 的完整按钮、表单、页面和交互流。

4. **原型难以对抗专业 SaaS**
   - 快速生成的 CRM / SaaS 原型很难比长期打磨的垂直 SaaS 更可靠。

对 Lime 的含义：

**Workspace UI 不应被设计成传统 app builder；它更应该是任务、阻塞、证据、产物、权限、rerun 和 agent 管理面。**

## 4. AI Native 开发闭环

访谈中的组织 harness 可以抽象为：

```text
外部信号 / 内部日志 / 用户反馈 / 竞品动态
  -> AI 生成候选需求
  -> 人类架构师做方向与主线判断
  -> AI 拆任务、实现、测试、部署
  -> AB testing / telemetry 验证效果
  -> 日志和结果回流为下一轮 context
```

这个闭环和传统流程的差异：

1. **需求发现更自动**
   - AI 可以持续看行业动态、GitHub、竞品、日志和用户行为，形成候选任务。

2. **人类判断更集中**
   - 人不是逐个写实现，而是判断哪些任务符合产品主线、商业目标和风险边界。

3. **实现成本更低**
   - 需求确认后，AI 快速实现并进入验证，而不是长期排期。

4. **上线不是终点**
   - AB test、日志、使用指标和复盘结果继续回流到 harness。

## 5. 人类角色变化

访谈把人类角色分成两类：

1. **架构师 / planning owner**
   - 不只是传统技术架构师，而是产品品味、商业判断、行业理解、技术能力的综合角色。
   - 负责判断 AI 生成的大量需求中哪些值得做、是否偏离主线、风险是否可控。

2. **任务接收者 / reviewer / operator**
   - 接收 AI 分配的 bug fix、UI 调整、验证、复盘等任务。
   - 重点是审核、补上下文、处理阻塞，而不是从零执行所有工作。

对 Lime 的含义：

**Task Center 和 Workspace 不只展示“agent 在跑什么”，还要展示“人在哪些关键节点需要判断什么”。**

## 6. 对 Lime 的映射

| Skill Forge 组织 harness | Lime 应收敛到的主链 | 不应新增的旁路 |
| --- | --- | --- |
| AI 扫描候选需求 | roadmap / exec-plan / telemetry 摘要 / task intake | 独立 AI 产品经理数据库 |
| 人类 planning 判断 | Workspace review / Task Center / explicit approval | 模型直接决定 roadmap |
| AI 实现与修复 | Skill Forge / Query Loop / subagent / automation job | 绕过 runtime 的代码执行器 |
| AB / log 反馈 | telemetry / artifact / evidence / outcome summary | 第二套实验事实源 |
| 组织记忆回流 | repo docs / memory compaction / workspace context | 只存在聊天里的决策 |

固定事实源声明：

**Lime 只把组织 harness 的启发折回现有 roadmap、exec-plan、Workspace、telemetry、artifact 和 evidence 主链；不新增平行的 AI PM / AB / scheduler 系统。**

## 7. 研究边界

本文件不把以下访谈内容写成 Lime 的立即产品承诺：

1. 每天上线 5-8 个功能。
2. 95% 工作都交给 AI。
3. revenue run rate 或 ARPU 增长。
4. 融资金额、团队规模、市场扩散。

这些可以作为外部案例背景，但 Lime roadmap 只吸收可工程化的组织闭环。

## 8. 一句话结论

**Skill Forge 的非共识不是“AI 写代码更快”，而是“公司流程先围绕 AI 的能力重构，产品才能在每个变化节点快速转身”。**
