# Skill Forge 启发下的 Skill Forge / Agent Envelope 产品原型图

> 状态：proposal  
> 更新时间：2026-05-06
> 目标：把 Skill Forge / generated capability / verification gate / workspace-local skill / Agent envelope 的用户可见面画成低保真原型，避免路线图只停留在架构文字。

依赖文档：

- [./README.md](./README.md)
- [./implementation-plan.md](./implementation-plan.md)
- [./diagrams.md](./diagrams.md)
- [../managed-objective/prototype.md](../managed-objective/prototype.md)
- [../../research/skill-forge/agent-product-model.md](../../research/skill-forge/agent-product-model.md)

## 1. 原型原则

Skill Forge 的产品面要回答五个问题：

1. agent 正在生成什么能力。
2. 这个能力来自哪个 CLI / API / docs / website。
3. 验证是否通过，权限是否安全。
4. 通过后如何进入 workspace-local skill，并被 Managed Objective 可调度运行。
5. 成功运行后如何建议“继续这套方法 / 转成 Agent”。

固定边界：

1. Draft 未验证前不能进入默认 tool surface。
2. UI 只能展示 draft / verification / registration 状态，不直接执行生成脚本。
3. 可调度运行入口必须跳到 automation job / Managed Objective，不在 Skill Forge 内自建 runner。
4. Agent envelope 只是 Workspace 产品面，不新增 runtime、scheduler 或 evidence。

## 2. Skill Forge 对话原型

```text
┌──────────────────────────────────────────────────────────────┐
│ Agent Chat · Skill Forge                                     │
├──────────────────────────────┬───────────────────────────────┤
│ 用户：把这个只读 CLI 包装成  │ Skill Forge Panel             │
│ 每天生成报告的技能           │                               │
│                              │ Source                        │
│ Agent：我会先读取 CLI help， │ - kind: cli                   │
│ 生成 wrapper、contract、测试 │ - command: trendctl report    │
│ 和权限声明。                 │ - risk: read-only             │
│                              │                               │
│ [继续生成草案]               │ Draft status                  │
│                              │ - SKILL.md: pending           │
│                              │ - wrapper: pending            │
│                              │ - contract: pending           │
│                              │ - tests: pending              │
└──────────────────────────────┴───────────────────────────────┘
```

## 3. Capability Draft Review 原型

```text
┌──────────────────────────────────────────────────────────────┐
│ Generated Capability Draft · trend-report                     │
├──────────────────────────────────────────────────────────────┤
│ 目标                                                         │
│ 每天生成 Markdown 趋势摘要                                   │
│                                                              │
│ 生成文件                                                     │
│ [✓] SKILL.md                                                 │
│ [✓] scripts/trend_report_wrapper.ts                          │
│ [✓] examples/input.sample.json                               │
│ [✓] tests/fixture.test.ts                                    │
│ [✓] contract/input.schema.json                               │
│ [✓] contract/output.schema.json                              │
│                                                              │
│ 权限摘要                                                     │
│ - read local config                                          │
│ - execute local CLI                                          │
│ - write workspace artifact                                   │
│ - no network write                                           │
│                                                              │
│ 状态：draft · 未验证，不可自动运行                            │
│ [查看 diff] [运行 verification gate] [丢弃草案]               │
└──────────────────────────────────────────────────────────────┘
```

## 4. Verification Gate 原型

```text
┌──────────────────────────────────────────────────────────────┐
│ Verification Gate · trend-report                             │
├──────────────────────────────────────────────────────────────┤
│ Package structure        ✓ 通过                              │
│ Input contract           ✓ 通过                              │
│ Output contract          ✓ 通过                              │
│ Permission declaration   ✓ 通过                              │
│ Dry-run fixture          ✕ 失败                              │
│                                                              │
│ 失败原因                                                     │
│ wrapper 没有处理 CLI exit code 2                              │
│                                                              │
│ 建议                                                         │
│ 让 agent 修复 wrapper，并补一个失败 fixture                   │
│                                                              │
│ [让 agent 修复] [查看日志] [保留 draft]                       │
└──────────────────────────────────────────────────────────────┘
```

验证通过后的状态：

```text
┌──────────────────────────────────────────────────────────────┐
│ Verification Gate · trend-report                             │
├──────────────────────────────────────────────────────────────┤
│ 全部检查通过                                                 │
│ 状态：verified_pending_registration                          │
│                                                              │
│ [注册到当前 Workspace] [查看验证证据]                         │
└──────────────────────────────────────────────────────────────┘
```

## 5. Workspace-local Skill Card 原型

```text
┌──────────────────────────────────────────────────────────────┐
│ Skill · trend-report                                         │
├──────────────────────────────────────────────────────────────┤
│ 来源：agent generated · current workspace                     │
│ 版本：v0.1.0                                                  │
│ 验证：verified                                                │
│ 权限：local read / cli execute / workspace write              │
│ Runtime binding：native_skill -> Query Loop tool_runtime      │
│                                                              │
│ 最近运行：2026-05-05 09:02 · success                         │
│ 产物：reports/2026-05-05.md                                  │
│                                                              │
│ [授权运行] [创建定时任务] [查看 evidence] [重新验证]          │
└──────────────────────────────────────────────────────────────┘
```

成功运行后的固化提示：

```text
┌──────────────────────────────────────────────────────────────┐
│ Run Result · trend-report                                     │
├──────────────────────────────────────────────────────────────┤
│ 状态：success                                                 │
│ 产物：reports/2026-05-05.md                                   │
│ 证据：verification + runtime invocation + artifact write       │
│                                                              │
│ 这次任务可以复用为 Agent：                                    │
│ - Skill: trend-report                                         │
│ - Memory: 用户偏好 / 失败处理 / 报告格式                       │
│ - Schedule: 每天 09:00                                        │
│ - Permission: local read / CLI execute / workspace write       │
│                                                              │
│ [继续这套方法] [转成 Agent 草案] [仅保留本次结果]              │
└──────────────────────────────────────────────────────────────┘
```

## 6. 创建 Managed Job / Agent Envelope 原型

```text
┌──────────────────────────────────────────────────────────────┐
│ Create Managed Job from Skill                                │
├──────────────────────────────────────────────────────────────┤
│ Skill                                                        │
│ trend-report · verified                                      │
│                                                              │
│ Schedule                                                     │
│ 每天 09:00                                                   │
│                                                              │
│ Managed Objective                                            │
│ [每天生成 Markdown 趋势摘要，连续 7 次成功后完成           ] │
│                                                              │
│ Stop conditions                                              │
│ [✓] 失败超过 2 次进入 blocked                                │
│ [✓] 缺配置进入 needs_input                                   │
│ [✓] 高风险动作需要确认                                      │
│                                                              │
│ [创建 job、objective 和 Agent 草案]                           │
└──────────────────────────────────────────────────────────────┘
```

固定判断：

1. Skill Forge 只负责把能力推进到 verified skill。
2. 可调度任务由 automation job 承载。
3. 是否继续由 Managed Objective 判断。
4. Agent envelope 只展示 skill、memory、widget、schedule、permission、evidence 的组合。
5. evidence pack 负责运行事实。

## 7. 端到端用户流原型

```text
┌────────────┐   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│ 对话生成    │ -> │ Draft Review │ -> │ Verification│ -> │ Skill Card    │
└────────────┘   └─────────────┘   └─────────────┘   └──────┬───────┘
                                                            │
                                                            v
┌────────────┐   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│ Evidence   │ <- │ Artifact    │ <- │ Query Loop  │ <- │ Managed Job  │
└────────────┘   └─────────────┘   └─────────────┘   └──────────────┘
```

这条用户流对应路线图主链：

```text
Skill Forge -> Draft -> Verification Gate -> Workspace-local Skill -> Automation Job -> Managed Objective -> Query Loop -> Artifact / Evidence -> Agent Envelope
```

## 8. 移动端压缩原型

```text
┌────────────────────────────┐
│ trend-report skill         │
├────────────────────────────┤
│ verified · read-only       │
│ last: success 09:02        │
│ artifact: 2026-05-05.md    │
│                            │
│ [授权] [定时] [证据] [Agent] │
└────────────────────────────┘
```

移动端不展示完整文件树，只保留验证状态、权限摘要、最近运行和核心操作。
