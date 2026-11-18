# Codex method drift：69231e119b

日期：2026-11-17
上游：`/Users/coso/Documents/dev/rust/codex` HEAD `69231e119b`
基线：`99660ab3c7b861c916e467581fa9b8723504d66b`（245 方向化 identity）

## 静态提取

按 `app-server-protocol/src/protocol/common.rs` 的 `=> "method"` 与 Lime
`app-server-protocol` 常量做集合差：

- 上游 method/notification：276
- Lime method/notification：417（包含 v0/legacy）
- 上游新增：99
- 仅 Lime：240

这是静态 method 名称差，不等于协议字段、GUI 消费或运行时行为完成度。

## 上游新增分类

### 产品范围排除

- `account/*`：登录、限流、credits、workspace messages、bedrock/gcp、gatewayOAuth
- `accountSession/*`、`remoteControl/*`
- `app/*`、`plugin/share/*`
- `feedback/*`
- `externalAgentConfig/*`
- `attestation/generate`、`account/securitySetup/read`
- `openai/form`、`openai/userVerification`
- `thread/realtime/*`
- `mock/experimentalMethod`（测试）

### 需要产品裁决

| method | 说明 | 建议 |
| --- | --- | --- |
| `config/mcpServer/reload` | 热重载 MCP 配置 | P1，若现役 MCP 支持 reload 则接 |
| `fuzzyFileSearch/session*` | 会话式模糊文件搜索 | P1，先核对 Lime 搜索 owner |
| `thread/items/read` | 按 item id 读取持久化 item | P1，可复用 items/list 存储 |
| `thread/memory/read` | 读取 thread memory | P1，核对 Lime memory owner |
| `thread/readState/update` / `changed` | thread 已读状态 | P2，GUI/本地状态已有 |
| `thread/attachment/*` / `thread/attachmentOwner/list` | 附件持久化 API | P1，核对现有附件存储 |
| `thread/prepareApprovedPlan` | 已批准计划准备 | P2，依赖 plan/approval 产品裁决 |
| `thread/prediction/*` | 预测输入 | P2，非主链 |
| `item/fileChange/outputDelta` | 文件变更流式输出 | P1，核对 diff 流 |
| `modelProvider/authRecoveryStarted/Completed` | provider 认证恢复通知 | P1，多模型 owner 可接 |
| `modelProvider/config/write` | provider 配置写入 | P1，必须走 Lime provider 控制面 |
| `server/diagnostics` | 服务端诊断 | P2 |
| `rawResponse/completed`、`rawResponseItem/completed` | 原始响应通知 | P2，确认是否内部 |
| `thread/compacted` | 已 deprecated，建议不迁 | P3 |
| `thread/guardianReview` | Guardian 产品面 | 产品裁决 |

## 仅 Lime 的 240 项

主要是：

- `agentSession/*` 旧链
- `artifact/*`、`capability/*`
- `cloud/*`、`computerUse/*`、`connect*/*`
- `diagnostics/*`
- `dictationHistory/*`
- Lime 自己的 provider/model/tool surface

不能按“上游没有”直接删除；必须按 Lime 产品边界逐项裁决。

## 结论

- 当前不能宣称 method 对齐已覆盖 `69231e119b`。
- 245 分母只代表旧基线，不是当前 HEAD。
- 下一步先做 P1 的 `config/mcpServer/reload`、`thread/items/read`、
  `modelProvider/authRecovery*`、`item/fileChange/outputDelta` 的产品裁决和 owner 映射。
