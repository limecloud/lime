# Lime 工具库存与分类

## 1. 静态 catalog 盘点

## 1.1 Core surface

### Aster built-ins（19）

- `read`
- `write`
- `edit`
- `glob`
- `grep`
- `bash`
- `lsp`
- `Skill`
- `Task`
- `TaskOutput`
- `KillShell`
- `TodoWrite`
- `NotebookEdit`
- `EnterPlanMode`
- `ExitPlanMode`
- `WebFetch`
- `WebSearch`
- `analyze_image`
- `ask`

### Lime injected（7）

- `tool_search`
- `spawn_agent`
- `send_input`
- `wait_agent`
- `resume_agent`
- `close_agent`
- `SubAgentTask`

### Core 总数

- **26 个 catalog entries**

---

## 1.2 Workbench surface 增量（8）

- `social_generate_cover_image`
- `lime_create_video_generation_task`
- `lime_create_broadcast_generation_task`
- `lime_create_cover_generation_task`
- `lime_create_modal_resource_search_task`
- `lime_create_image_generation_task`
- `lime_create_url_parse_task`
- `lime_create_typesetting_task`

### Workbench 总数

- **34 个 catalog entries**

---

## 1.3 Browser Assist

目录层只保留一个兼容前缀：

- `mcp__lime-browser__*`

它不是一个单独真实工具，而是一组 browser runtime tools 的聚合入口。  
参考 Aster `chrome_mcp/tools.rs`，当前浏览器工具定义为 **17 个**。

### Browser Assist 总数

- **27 个 catalog entries**

### Workbench + Browser Assist 总数

- **35 个 catalog entries**

---

## 2. 默认授权子集

Core surface 当前默认 allow 的工具为：

- `Skill`
- `TaskOutput`
- `KillShell`
- `TodoWrite`
- `EnterPlanMode`
- `ExitPlanMode`
- `WebSearch`
- `ask`
- `tool_search`
- `spawn_agent`
- `send_input`
- `wait_agent`
- `resume_agent`
- `close_agent`
- `SubAgentTask`

结论：

- 默认 allowlist 是 **15 个**
- 明确排除了 `read` / `write` / `edit` / `bash` / `WebFetch` / `analyze_image` 这类需要参数约束或更强执行控制的工具

这符合“常驻工具面小而稳”的原则。

---

## 3. 新增库存命令

## 3.1 后端命令

- `agent_runtime_get_tool_inventory`

实现路径：

- `src-tauri/src/commands/aster_agent_cmd.rs`
- `src-tauri/src/agent_tools/inventory.rs`

## 3.2 前端 helper

- `src/lib/api/agentRuntime.ts`
- `getAgentRuntimeToolInventory(...)`

### 调用示例

```ts
import { getAgentRuntimeToolInventory } from "@/lib/api/agentRuntime";

const snapshot = await getAgentRuntimeToolInventory({
  caller: "assistant",
  workbench: true,
  browserAssist: true,
  metadata: {
    harness: {
      executionPolicy: {
        toolOverrides: {
          bash: {
            warningPolicy: "none",
          },
        },
      },
    },
  },
});
```

## 3.3 返回内容

库存快照会同时返回：

- 请求 caller / surface
- 当前 agent 是否初始化
- warnings
- MCP servers
- 默认 allow 工具列表
- catalog tools
- runtime registry tools
- extension surfaces
- extension tools
- mcp tools
- catalog / registry 对应的 effective execution profile（warning / restriction / sandbox）
  - 默认策略：`execution.rs`
  - 持久化覆盖：`NativeAgentConfig.tool_execution`
  - 运行时覆盖：`request.metadata.harness.executionPolicy`
- catalog / registry 对应的 provenance 字段：
  - `execution_warning_policy_source`
  - `execution_restriction_profile_source`
  - `execution_sandbox_profile_source`
- counts

---

## 4. 这份库存解决了什么问题

过去你只能分别从这些地方猜测工具面：

- catalog
- registry
- mcp manager
- extension manager
- tool_search 输出

现在一条命令就能同时回答这些问题：

1. **静态目录里一共有多少工具？**
2. **当前 surface 下哪些是默认允许的？**
3. **Aster runtime registry 里实际注册了哪些工具？**
4. **哪些 runtime tools 没被 catalog 覆盖？**
5. **当前有哪些 extension surfaces？**
6. **哪些 extension tools 处于 deferred / loaded / visible？**
7. **MCP 真实运行了哪些 servers 和 tools？**

---

## 5. 分类建议

## 5.1 current

- `src-tauri/crates/core/src/tool_calling.rs`
- `src-tauri/src/agent_tools/catalog.rs`
- `src-tauri/src/agent_tools/execution.rs`
- `src-tauri/src/agent_tools/inventory.rs`
- `src-tauri/crates/mcp/src/manager.rs`
- `src-tauri/src/commands/aster_agent_cmd.rs`

## 5.2 compat

- `SubAgentTask`
- `workspace_allowed_tool_names(...)`

## 5.3 deprecated

当前目录层没有新增 deprecated 工具；建议不要提前扩充 deprecated 层。

## 5.4 dead-candidate

- `src-tauri/crates/agent/src/tool_permissions.rs`
- `src-tauri/crates/agent/src/shell_security.rs`

---

## 6. 建议的库存使用方式

### 6.1 PR / 回归检查

每次工具相关改动，至少回答：

- registry tools 是否出现 catalog 未覆盖项
- extension surface 是否混入不该存在的 caller
- MCP tools 是否无意中全部默认进入上下文

### 6.2 调试上下文爆炸

先看：

- `default_allowed_tools`
- `registry_visible_total`
- `extension_tool_visible_total`
- `mcp_tool_visible_total`

如果这些数字异常上升，说明“默认进入上下文”的面在膨胀。

### 6.3 调试权限错乱

先分清问题属于哪层：

- catalog 层：目录不全 / 生命周期错
- context 层：`deferred_loading` / `allowed_callers` 错
- execution 层：sandbox / approval / 参数限制错

此时优先看：

- `execution_warning_policy`
- `execution_restriction_profile`
- `execution_sandbox_profile`
- `execution_warning_policy_source`
- `execution_restriction_profile_source`
- `execution_sandbox_profile_source`
- `request.metadata` 是否传入了 runtime override

---

## 7. 结论

库存命令不是为了“多一个调试页面”，而是为了把工具系统从“猜”变成“看得见”。

只要 inventory 这层一直存在，后续无论工具从 20 个涨到 200 个，都还能保持：

- 工具目录可审计
- 上下文暴露可审计
- MCP 注入可审计
- 权限平面可审计
