# Lime AgentUI 时序图

> 状态：时序设计
> 更新时间：2026-04-30
> 目标：为实现、E2E、性能日志和故障排查提供端到端时序基线。

## 1. 新建会话并发送消息

```mermaid
sequenceDiagram
  participant U as User
  participant Home as HomeStartSurface / EmptyState
  participant Shell as AgentChatWorkspace
  participant Hook as useAgentSession
  participant Bind as AgentEvent Binding
  participant API as threadClient
  participant Cmd as agent_runtime_submit_turn
  participant Queue as runtime_queue
  participant RT as Aster Runtime
  participant State as Frontend State
  participant UI as MessageList / StreamingRenderer

  U->>Home: 新建对话并输入 prompt
  Home->>Shell: create topic/session
  Shell->>Hook: handleSend(prompt)
  Hook->>State: append user message + assistant placeholder
  Hook->>Bind: registerAgentStreamTurnEventBinding(eventName)
  Hook->>API: submitAgentRuntimeTurn(request)
  API->>Cmd: invoke agent_runtime_submit_turn
  Cmd->>Queue: submit_runtime_turn
  Queue-->>Cmd: accepted / enqueued
  Cmd-->>State: early runtime_status
  Queue->>RT: start turn
  RT-->>Bind: turn_started
  Bind->>State: currentTurnId / threadTurns
  RT-->>Bind: thinking_delta
  Bind->>State: contentParts.thinking
  RT-->>Bind: text_delta
  Bind->>State: buffered text flush
  State->>UI: render first text
  RT-->>Bind: tool_start / tool_end
  Bind->>State: threadItems + tool parts
  RT-->>Bind: artifact_snapshot
  Bind->>State: artifact signal
  RT-->>Bind: done / final_done
  Bind->>State: reconcileFinalContentParts
  State->>UI: completed message
```

验收点：

- `registerAgentStreamTurnEventBinding` 早于 submit invoke。
- 首个 `runtime_status` 能在首个 `text_delta` 前显示。
- `final_done` 不导致完整答案重复追加。

## 2. 打开旧会话渐进恢复

```mermaid
sequenceDiagram
  participant U as User
  participant Tabs as TopicTabs / Sidebar
  participant Hook as useAgentSession
  participant Cache as Session Snapshot Cache
  participant API as sessionClient
  participant Cmd as agent_runtime_get_session
  participant Store as SessionStore
  participant Projection as ThreadRead Projection
  participant ML as MessageList
  participant Timeline as AgentThreadTimeline

  U->>Tabs: click old session
  Tabs->>Hook: switchTopic(sessionId)
  Hook->>Cache: read cached snapshot
  alt snapshot exists
    Cache-->>Hook: title + last messages + status
    Hook->>ML: render cached shell/light messages
  else no snapshot
    Hook->>ML: render shell + skeleton
  end
  Hook->>API: getSession(sessionId, historyLimit=40)
  API->>Cmd: agent_runtime_get_session
  Cmd->>Store: get_runtime_session_detail_with_history_page
  Store-->>Cmd: messages tail + turns + items
  Cmd->>Projection: build thread_read + queue snapshots + cursor
  Projection-->>Cmd: session detail
  Cmd-->>API: AsterSessionDetail
  API-->>Hook: normalized detail
  Hook->>ML: hydrate messages first
  ML-->>U: stable recent history visible
  Hook->>Timeline: defer historical timeline to idle
  Timeline-->>U: process detail becomes available
```

验收点：

- `switchTopic` 后 shell 立即出现。
- `historyLimit=40` 是默认恢复路径。
- timeline 的历史构建不阻塞最近消息可读。
- 非活跃 tab 不触发完整 timeline 渲染。

## 3. 运行中 Queue 后续输入

```mermaid
sequenceDiagram
  participant U as User
  participant Input as Inputbar
  participant Hook as useAgentSession
  participant API as threadClient
  participant Cmd as agent_runtime_submit_turn
  participant Queue as runtime_queue
  participant State as Frontend State
  participant Task as Task Capsule / QueuedTurnsPanel

  U->>Input: 当前 turn 运行中输入 follow-up
  Input->>Hook: send mode = queue
  Hook->>API: submitAgentRuntimeTurn(queueIfBusy=true)
  API->>Cmd: agent_runtime_submit_turn
  Cmd->>Queue: enqueue turn
  Queue-->>State: queue_added
  State->>Task: show queued count + preview
  U->>Task: promote/remove queued turn
  Task->>API: promoteQueuedTurn / removeQueuedTurn
  API->>Cmd: queue mutation command
  Cmd->>Queue: mutate queue
  Queue-->>State: queue_removed / queue_started
  State->>Task: update capsule
```

验收点：

- queue 不创建假消息正文。
- queue 操作不会触发旧会话全量恢复。
- 运行中任务和排队任务视觉不同。

## 4. 运行中 Steer 当前任务

```mermaid
sequenceDiagram
  participant U as User
  participant Input as Inputbar
  participant Hook as useAgentSession
  participant API as threadClient
  participant Cmd as agent_runtime_submit_turn
  participant RT as Aster Runtime
  participant State as Frontend State
  participant UI as Process / Capsule

  U->>Input: 当前 turn 运行中输入修正
  Input->>Hook: send mode = steer
  Hook->>State: show pending steer preview
  Hook->>API: submitAgentRuntimeTurn(steer intent)
  API->>Cmd: agent_runtime_submit_turn
  Cmd->>RT: deliver steer to running turn
  RT-->>State: runtime_status steer_received
  State->>UI: update current task status
  RT-->>State: subsequent text/tool/action events
```

验收点：

- steer 文案明确“影响当前任务”。
- pending steer 可取消或至少可见。
- steer 后状态进入当前 turn，而不是排队 turn。

## 5. Action Required / 权限确认

```mermaid
sequenceDiagram
  participant RT as Aster Runtime
  participant Bind as AgentEvent Binding
  participant State as Frontend State
  participant UI as Action Card / Input A2UI
  participant User as User
  participant API as threadClient
  participant Cmd as agent_runtime_respond_action

  RT-->>Bind: action_required(requestId, actionType, scope, data)
  Bind->>State: pendingActions + threadItems.approval_request
  State->>UI: show needs input / approval CTA
  User->>UI: approve / reject / fill form
  UI->>API: respondAgentRuntimeAction
  API->>Cmd: agent_runtime_respond_action
  Cmd-->>RT: resolve request
  RT-->>Bind: runtime_status / text_delta / tool / done
  Bind->>State: mark action resolved
  State->>UI: collapse card to summary
```

验收点：

- `needs_input` 在 task capsule 中可见。
- action 完成后不能继续以 pending 状态吸顶。
- 高风险动作必须保留审批结果摘要。

## 6. Artifact Snapshot 到 Workbench

```mermaid
sequenceDiagram
  participant RT as Aster Runtime / Tool
  participant Bind as AgentEvent Binding
  participant Timeline as AgentTimelineRecorder
  participant ArtifactSvc as Artifact Services
  participant State as Frontend State
  participant Msg as Message Preview
  participant Workbench as Artifact Workbench

  RT-->>Bind: artifact_snapshot(artifactId, path, metadata)
  RT-->>Timeline: record file_artifact item
  RT-->>ArtifactSvc: persist document / snapshot
  ArtifactSvc-->>State: artifact metadata available
  Bind->>State: add artifact signal to current turn
  State->>Msg: render compact artifact card
  State->>Workbench: select or suggest artifact
  Workbench->>ArtifactSvc: read preview / version / diff
```

验收点：

- 聊天正文只显示 artifact 摘要卡。
- Workbench 是 artifact 主编辑面。
- timeline 和 evidence 能追到同一个 artifact id/path。

## 7. Evidence Pack 与 Review Decision

```mermaid
sequenceDiagram
  participant User as User
  participant Harness as HarnessStatusPanel
  participant API as export client
  participant Cmd as agent_runtime_export_evidence_pack
  participant Store as SessionStore
  participant Timeline as Timeline DB
  participant Evidence as runtime_evidence_pack_service
  participant Review as runtime_review_decision_service
  participant Files as .lime/harness

  User->>Harness: export evidence
  Harness->>API: exportEvidencePack(sessionId)
  API->>Cmd: agent_runtime_export_evidence_pack
  Cmd->>Store: load session detail
  Cmd->>Timeline: load turns/items
  Cmd->>Evidence: build summary/runtime/timeline/artifacts
  Evidence->>Files: write evidence pack
  Files-->>Harness: show evidence files
  User->>Harness: export review decision
  Harness->>Review: build template from evidence/replay/handoff
  Review->>Files: write review decision
```

验收点：

- evidence 导出不阻塞当前流式 turn。
- review decision 只保存人工审核，不自动批准或自动应用修复。
- UI 展示的证据路径来自后端返回值。

## 8. 多 Tab / 多历史会话

```mermaid
sequenceDiagram
  participant U as User
  participant Tabs as Tab Manager
  participant Snapshot as Tab Snapshot Store
  participant Hook as useAgentSession
  participant API as sessionClient
  participant UI as Active Workspace

  U->>Tabs: open session A
  Tabs->>Hook: activate A
  Hook->>API: getSession(A, historyLimit=40)
  API-->>Hook: detail A
  Hook->>Snapshot: save A lightweight snapshot
  U->>Tabs: open session B
  Tabs->>Hook: freeze A render state
  Hook->>Snapshot: keep A summary only
  Tabs->>Hook: activate B
  Hook->>API: getSession(B, historyLimit=40)
  API-->>Hook: detail B
  U->>Tabs: switch back A
  Tabs->>Snapshot: restore A snapshot immediately
  Snapshot-->>UI: show A shell
  Hook->>API: optional refresh A detail in background
```

验收点：

- 打开第二个历史会话不会让第一个历史会话继续全量渲染。
- tab 切换先恢复 snapshot，再后台刷新。
- 关闭 tab 释放 MessageList/timeline 重对象。
