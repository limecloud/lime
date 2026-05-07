# Skill Forge 的工具编码编排

> 状态：current research reference  
> 更新时间：2026-05-06
> 目标：拆清楚“Coding Agent 将 CLI / API / tools 编码编排”这件事，明确它对 Lime skills pipeline 的真正启发。

## 1. 先修正一个误区

最容易的误读是：

**Agent 会调用更多 API，所以它更强。**

更准确的理解是：

**Agent 会把外部 API、CLI、网页流程和已有 tools 编码成新的业务专用能力，然后再编排这些能力进入可持久、可调度、可 rerun 的运行闭环。**

这不是工具调用能力的线性增强，而是角色变化：

```text
Tool User Agent
  -> 调用已经注册好的工具

Tool Maker Agent
  -> 发现外部能力
  -> 编写 adapter / script / wrapper
  -> 定义 contract / test / permission
  -> 注册为可复用工具
  -> 编排成长期任务
```

固定判断：

**核心非共识是 agent 从“使用工具的人”变成“制造工具的人”。**

## 2. Tool-user 路线与 Tool-maker 路线

### 2.1 Tool-user 路线

```text
用户目标
  -> LLM 判断需要哪一个预设工具
  -> 调用 tool / MCP / API
  -> 返回结果
```

优点：

1. 安全边界清晰。
2. 可控性高。
3. 工程实现简单。

缺点：

1. 只能做预先接好的能力。
2. 新平台、新流程、新业务规则需要人工开发。
3. 很容易变成“工具市场 + 聊天壳”。

### 2.2 Tool-maker 路线

```text
用户目标
  -> Coding Agent 分析能力缺口
  -> 读取 API / CLI / docs / website
  -> 生成 adapter / glue code / workflow code
  -> dry-run / test / sandbox call
  -> 注册为 workspace-local capability
  -> 编排进长期 job
  -> evidence 记录每次执行
```

优点：

1. 能覆盖长尾业务流程。
2. 能把一次对话沉淀成可复用能力。
3. 能快速适配用户自己的平台、账号和流程。

风险：

1. 生成代码可能不安全。
2. 外部 API 和网页结构可能变化。
3. 高风险动作需要权限和人工确认。
4. 如果缺少标准化，会形成一堆不可治理脚本。

## 3. 能力生成链路

Skill Forge 式工具编码编排可以抽象成下面这条链：

```text
Capability Source
  -> Adapter Code
  -> Tool Contract
  -> Verification
  -> Registry
  -> Workflow Job
  -> Evidence
```

### 3.1 Capability Source

来源包括：

1. API 文档。
2. OpenAPI schema。
3. CLI help 输出。
4. SDK 示例。
5. MCP server 能力。
6. 网页操作流程。
7. 用户提供的平台说明。

### 3.2 Adapter Code

agent 生成的小型连接层，例如：

1. `fetchCompetitorSales()`
2. `searchSupplierCandidates()`
3. `createListingDraft()`
4. `exportDailyTrendReport()`

固定规则：

**adapter 只应该承担连接和转换职责，不应该把完整产品状态机写进脚本里。**

### 3.3 Tool Contract

每个生成能力至少要声明：

1. 输入 schema。
2. 输出 schema。
3. 权限类型。
4. 是否联网。
5. 是否写文件。
6. 是否会发布、付款、删除或修改外部状态。
7. 失败码和错误分类。

没有 contract 的代码不应进入长期 runtime。

### 3.4 Verification

进入注册前至少需要：

1. 静态校验。
2. dry-run。
3. fixture test。
4. mock 或 sandbox 调用。
5. 对高风险 API 的人工确认。

固定规则：

**验证通过前只能是 draft capability，不能是 current tool。**

### 3.5 Registry

通过验证后才允许进入统一能力注册表。

对 Lime 来说，这一步不应创建新注册表，而应投影为：

1. Agent Skill Bundle。
2. ServiceSkill / SkillCatalog entry。
3. SiteAdapterSpec。
4. tool_runtime 可裁剪的工具面。

### 3.6 Workflow Job

多个能力可以被编排成：

1. 一次性 agent turn。
2. scheduled job。
3. managed task。
4. subagent team run。
5. remote channel trigger。

但执行仍必须回到 Lime 当前 runtime，不允许每个生成能力自带 scheduler。

### 3.7 Evidence

每次执行都必须写入：

1. 输入摘要。
2. 输出摘要。
3. 调用过的外部能力。
4. 权限与确认记录。
5. 失败、重试和降级。
6. artifact 与最终产物。

固定规则：

**自动化越强，evidence 越不能是可选项。**


## 4. Skill 与 Agent 的边界

访谈里 Peter 对 Skill 的定义更接近 Agent 的 runbook：Skill 让 Agent 知道如何执行，但 Agent 还需要 Memory、Widget、Schedule 等产品和运行层能力。

因此 Tool-maker 链路只能产出 Agent 的一部分：

```text
Tool-maker Agent
  -> 生成 Skill / Adapter / Contract / Test
  -> 注册为 workspace-local capability
  -> 再被 Agent envelope 绑定 memory / widget / schedule / permission / evidence
```

对 Lime 的固定边界：

1. `Skill Forge` 负责生成与验证 runbook / adapter。
2. `Agent envelope` 负责把成功任务变成可 rerun、可展示、可调度的工作单元。
3. 两者都不能绕过 Query Loop、tool_runtime、automation job 和 evidence。

## 5. 这和 MCP 的区别

MCP 解决的是：

**工具如何被模型发现和调用。**

Tool-maker agent 解决的是：

**工具如何根据用户业务目标被生成、验证、注册和复用。**

两者关系：

1. MCP 可以是 Capability Source。
2. MCP server 可以由生成能力包装或调用。
3. 但 MCP 不是 Lime 的 generated capability 标准。
4. Lime 仍需自己的 Skill / Adapter / Runtime Binding 边界。

一句话：

**MCP 是工具协议，Tool-maker 是工具生产系统。**

## 6. 对 Lime skills pipeline 的启发

Skill Forge 的关键启发不是替代 skills pipeline，而是给它补上游：

```text
用户目标
  -> Coding Agent 生成 capability draft
  -> 编译成 Skill Bundle / Adapter Spec
  -> 校验 contract / permission / test
  -> 注册到 workspace-local skill catalog
  -> Query Loop 与 tool_runtime 统一执行
  -> evidence pack 统一导出
```

正确关系：

1. **Skill pipeline 是标准化管道。**
2. **Coding Agent 是上游自动生产者。**
3. **tool_runtime 是执行和权限边界。**
4. **Harness Engine 是审计和回放边界。**

补充边界：

[Codex `/goal`](../codex-goal/README.md) 研究的是“目标如何跨多轮 turn 被 runtime 持续推进”，不是“工具如何被生成”。因此：

1. `Skill Forge` 产出可复用能力。
2. `Managed Objective` 消费这些能力并决定是否继续下一轮。
3. 两者都必须回到 Query Loop、tool_runtime、automation job 和 evidence pack。
4. 不允许把 goal loop 写成 generated capability 的执行 runtime，也不允许把 Skill Forge 写成目标状态机。

## 7. 对 Lime 的禁止项

以下做法会和现有路线冲突：

1. 新增 `GeneratedTool` 作为长期主类型。
2. 让 agent 生成脚本后绕过 Skill Bundle 直接执行。
3. 在 Query Loop 外另建 generated tool registry。
4. 为 generated workflow 另建 queue / scheduler / evidence。
5. 把 adapter 提升成前台产品入口，绕过 ServiceSkill。
6. 把来源 API / CLI 的原始协议直接当作 Lime 标准。
7. 把 persistent goal / Managed Objective 当成 generated tool registry 的替代品。
8. 把 verified skill 直接宣称为完整 Agent，而不补 memory、widget、schedule、permission 和 evidence。

## 8. 推荐产品命名

研究层建议把这类能力暂称为：

**Skill Forge / Capability Forge**

含义：

1. 它是生成和编译阶段。
2. 它不是执行 runtime。
3. 它产出标准 Skill Bundle / Adapter Spec。
4. 它服从现有 Query Loop 和 tool_runtime。

一句话：

**生成可以动态，标准必须统一；执行可以自动，治理必须收口。**
