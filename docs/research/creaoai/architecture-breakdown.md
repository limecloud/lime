# CreaoAI 三层架构拆解

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：把视频转述中的三层架构拆成稳定系统层次，避免误读成“电商自动化 demo”或“预设 API 编排器”。

## 1. 先给结论

视频里真正值得关注的不是某个电商流程，而是这条产品结构：

```text
用户讲清楚目标
  -> Coding Agent 把目标编码成工具和流程
  -> Autonomous Execution 让流程长期运行
  -> Workspace 沉淀记忆、产物、配置和证据
```

可以稳定拆成三层：

1. **Coding Agent / Agent Builder**
2. **Autonomous Execution / Runtime**
3. **Workspace / Agent App Surface**

这三层不是页面 IA，而是 agent 产品的系统骨架。

## 2. 第一层：Coding Agent / Agent Builder

这一层的职责不是普通聊天，而是：

**把自然语言业务目标编译成可执行能力。**

它需要完成的工作包括：

1. 理解用户目标和成功标准。
2. 拆解任务链路和触发条件。
3. 判断需要哪些外部能力。
4. 读取 API 文档、CLI help、网页流程或平台说明。
5. 生成 adapter、wrapper、script、workflow 和测试。
6. 输出可复用的能力包，而不是一次性回答。

示例：

```text
“每天监控竞品爆款，发现趋势后找货、生成素材、写文案、给出定价建议”
  -> 竞品数据抓取 adapter
  -> 1688 找货脚本
  -> 图片 / 视频 / 文案生成流程
  -> 定价规则模块
  -> 输出 schema 与权限声明
```

固定判断：

**这一层的核心是 tool-maker，不是 tool-user。**

## 3. 第二层：Autonomous Execution / Runtime

这一层负责让第一层生成的能力真正跑起来。

核心职责：

1. 定时、手动、webhook 或事件触发。
2. 任务排队、恢复、重试和降级。
3. 用户关掉浏览器或重启后继续执行。
4. 管理权限、预算、沙箱和人工确认。
5. 执行 CLI、API、浏览器、MCP、脚本和 workspace 工具。
6. 在失败时请求输入或进入阻塞态。
7. 把执行事实写入 timeline、artifact 和 evidence。

它不是简单 cron，因为 agent 任务经常需要：

1. 动态补上下文。
2. 根据中间结果调整后续步骤。
3. 在外部平台失败时重新规划。
4. 对高风险动作进行人工确认。

推荐状态模型：

```text
planned -> running -> verifying -> completed
                    -> needs_input
                    -> blocked
                    -> failed
```

固定判断：

**这一层的价值是把一次 agent turn 变成可持续推进的业务任务。**

### 3.1 Codex `/goal` 在这一层的位置

[Codex `/goal` 研究](../codex-goal/README.md) 单独说明了一个更小的 runtime pattern：

```text
persistent thread goal（同一会话线程上的持久目标状态）
  -> idle continuation turn
  -> completion audit
  -> budget / pause / resume / complete
```

它能解释“如何把一轮 agent turn 续成多轮目标推进”，但不能代表完整 CreoAI 三层架构：

1. 它不负责生成 Skill / Adapter / Contract / Test。
2. 它不负责 workspace-local skill catalog。
3. 它不负责业务 workflow DAG 或多平台自动化。
4. 它不导出 Lime 式 evidence pack。

固定边界：

**Codex `/goal` 是 Autonomous Execution 层的目标续跑参考，不是 Coding Agent / Skill Forge，也不是完整业务 workflow runtime。**

## 4. 第三层：Workspace / Agent App Surface

这一层是用户真正感知产品价值的地方。

核心职责：

1. 保存业务上下文、目标、约束和偏好。
2. 保存账号配置、API 连接、浏览器登录态和权限边界。
3. 保存 agent 生成的 adapter、skill、script、workflow、测试。
4. 展示任务中心、阻塞点、产物、执行历史。
5. 沉淀运行结果、反馈、记忆和复盘。
6. 暴露 evidence、review、replay 和人工确认入口。

没有 workspace，agent 每次都是临时工；有了 workspace，agent 才像一个持续工作的业务员工。

固定判断：

**Workspace 不是文件夹，而是 agent app 的运行与记忆容器。**

## 5. 三层合成链路

```text
用户目标
  -> Coding Agent 拆解并生成能力
  -> 生成 Skill / Adapter / Script / Contract / Test
  -> Runtime 验证、注册、调度、执行
  -> Workspace 保存配置、任务、产物、证据
  -> 用户复盘并调整目标
  -> Coding Agent 继续改进能力
```

这个闭环解释了为什么用户会感知到：

**“我关掉浏览器，它还在干活。”**

关键不是后台线程一直在跑，而是系统同时具备：

1. 可复用能力。
2. 长期执行纪律。
3. 可追踪证据。
4. 可持续改进的 workspace 记忆。

## 6. 对 Lime 的映射

| CreoAI 层级 | Lime 中应收敛到的主链 | 不应新增的旁路 |
| --- | --- | --- |
| Coding Agent / Agent Builder | Skill Forge、Agent Skill Bundle、Adapter Spec、ServiceSkill 投影 | 平行 generated tool 类型 |
| Autonomous Execution | Query Loop、runtime_queue、tool_runtime、automation job、subagent | 独立 scheduler / workflow runtime |
| Workspace / Agent App Surface | Workspace、Skill Catalog、Artifact、Task Center、Evidence Pack | 单场景自建状态与证据系统 |

一句话：

**Lime 不需要复制一个 CreoAI，而是把这三层折回现有 skills pipeline 与 Harness Engine。**

## 7. 关键风险

1. **无约束代码生成**
   - agent 写出的 adapter 如果直接执行，会放大安全和质量风险。

2. **双事实源**
   - 如果 generated capability 绕过 Skill / tool registry，会产生第二套权限、状态、证据。

3. **营销叙事过度**
   - “零门槛全自动”容易掩盖复杂业务仍需要架构师判断。

4. **垂类 demo 误导**
   - 电商案例不应决定 Lime 的产品边界；它只是一个验证三层架构的样例。
