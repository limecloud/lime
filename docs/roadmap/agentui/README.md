# Lime AgentUI 路线图文档

> 状态：路线图与架构设计
> 更新时间：2026-05-05
> 范围：Lime 对话工作区下一阶段 AgentUI，包括 UI 架构、代码层级、事件流程、时序图、后端协作与落地顺序。

## 目标

AgentUI 不是再做一个聊天页面，而是把 Lime 已有的 runtime、timeline、artifact、task、team、harness、evidence 能力收束成一个可观察、可控制、可交付的工作台。

本目录回答四类问题：

1. **产品结构**：Lime 的 AgentUI 应该由哪些层组成，哪些信息应该出现在首屏，哪些应该进入展开详情。
2. **代码结构**：现有前端、协议、Tauri command、Rust runtime、service、持久化层分别负责什么。
3. **运行流程**：发送消息、打开旧会话、排队输入、权限确认、产物生成、证据导出如何流动。
4. **落地顺序**：哪些改动先解决体感慢、卡顿、重复吐字和多任务管理，哪些进入中长期演进。

## 阅读顺序

| 文档 | 作用 |
| --- | --- |
| [agent-ui-research-and-lime-direction.md](agent-ui-research-and-lime-direction.md) | 竞品与本地参考调研，说明为什么 Lime 要走“对话 + 过程 + 任务 + 产物 + 证据”路线。 |
| [lime-agentui-target-architecture.md](lime-agentui-target-architecture.md) | 目标 UI 架构图与五层模型，是后续 UI 改造的总图。 |
| [lime-agentui-code-map.md](lime-agentui-code-map.md) | Lime 当前代码层级地图，标出前端、协议、后端、服务和测试入口。 |
| [lime-agentui-event-flow.md](lime-agentui-event-flow.md) | 关键流程图，包括发送消息、旧会话恢复、queue/steer、权限、artifact、evidence。 |
| [lime-agentui-sequence-diagrams.md](lime-agentui-sequence-diagrams.md) | 端到端时序图，适合实现和排查首字慢、恢复慢、流式错乱。 |
| [lime-agentui-backend-coordination.md](lime-agentui-backend-coordination.md) | 后端配合代码架构，定义 UI 需要后端继续补齐的投影、分页、指标与批量接口。 |
| [lime-agentui-implementation-roadmap.md](lime-agentui-implementation-roadmap.md) | P0/P1/P2/P3 落地顺序、验收标准和验证命令。 |
| [conversation-projection-architecture.md](conversation-projection-architecture.md) | Warp 对齐的对话投影架构，声明 AgentUI 只做 UI projection，不新增 runtime fact source。 |
| [conversation-projection-fact-map.md](conversation-projection-fact-map.md) | 对话状态事实源地图，标明 owner、writer、readers、persistence、runtime fact source 与 projection-only 边界。 |
| [conversation-projection-implementation-plan.md](conversation-projection-implementation-plan.md) | 对话主链瘦身的分阶段实施计划，顺序为事实源盘点、Projection Store、controller、selector、UI。 |
| [conversation-projection-acceptance.md](conversation-projection-acceptance.md) | 对话投影改造的固定验收场景、性能指标、Playwright 续测口径和完成判定。 |

## 当前结论

Lime AgentUI 的主线应保持一个事实源，不新增第二套事件系统：

```text
Agent runtime event
  -> session / timeline / thread_read / artifact / evidence projection
  -> frontend state
  -> Conversation / Process / Task / Artifact / Evidence UI
```

对话层结构瘦身进一步固定为 Warp 对齐的 projection 子计划：

```text
Warp runtime fact sources
  -> Conversation Projection Store
  -> controllers
  -> selectors
  -> UI
```

其中 Warp 继续拥有 `Agent runtime identity`、`ModalityRuntimeContract`、`Execution Profile`、`Artifact Graph`、`Evidence / Replay / Task Index` 等事实源；AgentUI 只消费这些事实源生成对话 UI 需要的轻量投影。

下一阶段 UI 的关键词不是“更像某个竞品”，而是：

- **首屏轻**：旧会话打开先展示 shell、缓存快照、最近消息，再渐进补 timeline / tool / artifact。
- **流式稳**：text、thinking、tool、artifact、runtime status 分型渲染，防止重复吐字和正文污染。
- **任务可压缩**：运行中、排队、needs input、plan ready、failed 统一进入 capsule / task strip。
- **产物离开正文**：最终交付进入 Artifact / Canvas / Workbench，聊天正文负责解释和协作。
- **证据可追溯**：harness、evidence、review、replay 消费同一条 runtime/timeline 事实链。

## 设计约束

1. 不复制 Claude Code、Warp、CodexMonitor 或 Codex TUI 的表面视觉，只借鉴结构模式。
2. 不把过程日志塞回最终回答正文。
3. 不让旧会话恢复阻塞 UI 挂载。
4. 不让 sidebar list、session detail、timeline build、artifact preview 在同一时刻抢主线程和 invoke 通道。
5. 不新增 parallel runtime/event 协议；新增 UI 只消费现有 AgentEvent、timeline、thread_read、artifact、evidence 投影。
