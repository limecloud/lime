# Lime AI Agent 开发指南

> 面向未来 AI Agent 功能开发的架构设计与最佳实践

## 一、愿景与定位

Lime 的未来方向是从 **API 代理工具** 演进为 **AI Agent 创作平台**。
核心目标是让用户能够：

1. **创建自定义 Agent** - 定义 Agent 的能力、工具、行为
2. **编排 Agent 工作流** - 多 Agent 协作、任务分解
3. **本地执行 Agent** - 利用本地资源执行工具调用

```
┌─────────────────────────────────────────────────────────────────┐
│                    Lime AI Agent 平台                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Agent 定义   │    │  工作流编排   │    │  工具执行     │       │
│  │              │    │              │    │              │       │
│  │ • 系统提示词  │    │ • 任务分解    │    │ • 文件操作    │       │
│  │ • 工具配置    │    │ • 条件分支    │    │ • Shell 命令  │       │
│  │ • 行为约束    │    │ • 循环控制    │    │ • API 调用    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│           ↓                  ↓                  ↓                │
│  ═══════════════════════════════════════════════════════════    │
│                     统一的 Agent 运行时                          │
│  ═══════════════════════════════════════════════════════════    │
│           ↓                  ↓                  ↓                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Kiro       │    │   Gemini     │    │   Qwen       │       │
│  │   Provider   │    │   Provider   │    │   Provider   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心架构设计

### 2.1 Agent 定义层

```rust
// src-tauri/src/agent/definition.rs

/// Agent 定义
pub struct AgentDefinition {
    /// 唯一标识
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 系统提示词
    pub system_prompt: String,
    /// 可用工具列表
    pub tools: Vec<ToolDefinition>,
    /// 行为约束
    pub constraints: AgentConstraints,
    /// 使用的 Provider
    pub provider: ProviderType,
}

/// 工具定义
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,  // JSON Schema
    pub handler: ToolHandler,
}

/// 行为约束
pub struct AgentConstraints {
    /// 最大工具调用次数
    pub max_tool_calls: u32,
    /// 最大对话轮数
    pub max_turns: u32,
    /// 超时时间（秒）
    pub timeout_seconds: u32,
    /// 是否允许并行工具调用
    pub allow_parallel_tools: bool,
}
```

### 2.2 工具执行层

```rust
// src-tauri/src/agent/tools/mod.rs

/// 工具执行器 trait
#[async_trait]
pub trait ToolExecutor: Send + Sync {
    /// 执行工具
    async fn execute(&self, input: ToolInput) -> Result<ToolOutput, ToolError>;

    /// 工具名称
    fn name(&self) -> &str;

    /// 工具描述
    fn description(&self) -> &str;

    /// 参数 Schema
    fn parameters_schema(&self) -> serde_json::Value;
}

/// 内置工具
pub mod builtin {
    pub struct ReadFileTool;
    pub struct WriteFileTool;
    pub struct ShellCommandTool;
    pub struct HttpRequestTool;
    pub struct SearchFilesTool;
}
```

### 2.3 Agent 运行时

```rust
// src-tauri/src/agent/runtime.rs

/// Agent 运行时
pub struct AgentRuntime {
    /// Agent 定义
    definition: AgentDefinition,
    /// Provider 客户端
    provider: Box<dyn ProviderClient>,
    /// 工具执行器
    tools: HashMap<String, Box<dyn ToolExecutor>>,
    /// 对话历史
    messages: Vec<Message>,
    /// 运行状态
    state: AgentState,
}

impl AgentRuntime {
    /// 执行 Agent 循环
    pub async fn run(&mut self, user_input: &str) -> Result<AgentResponse, AgentError> {
        self.messages.push(Message::user(user_input));

        loop {
            // 1. 调用 LLM
            let response = self.provider.chat(&self.messages).await?;

            // 2. 检查是否有工具调用
            if let Some(tool_calls) = response.tool_calls {
                // 3. 执行工具
                let results = self.execute_tools(tool_calls).await?;

                // 4. 将结果加入对话
                self.messages.extend(results);

                // 5. 检查约束
                if self.check_constraints().is_err() {
                    break;
                }
            } else {
                // 没有工具调用，返回最终响应
                return Ok(response);
            }
        }
    }
}
```

---

## 三、消息格式与协议转换

### 3.1 统一消息格式

```rust
// src-tauri/src/agent/messages.rs

/// 统一消息格式（内部使用）
pub enum Message {
    System { content: String },
    User { content: Vec<ContentBlock> },
    Assistant { content: Vec<ContentBlock>, tool_calls: Option<Vec<ToolCall>> },
    ToolResult { tool_use_id: String, content: String, is_error: bool },
}

/// 内容块
pub enum ContentBlock {
    Text { text: String },
    Image { source: ImageSource },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: String },
}

/// 工具调用
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}
```

### 3.2 协议转换器

```rust
// src-tauri/src/converter/mod.rs

/// 协议转换器 trait
pub trait ProtocolConverter {
    /// 转换为 Provider 格式
    fn to_provider(&self, messages: &[Message]) -> ProviderRequest;

    /// 从 Provider 格式转换
    fn from_provider(&self, response: ProviderResponse) -> Message;

    /// 转换工具定义
    fn convert_tools(&self, tools: &[ToolDefinition]) -> Vec<ProviderTool>;
}

/// OpenAI 格式转换器
pub struct OpenAIConverter;

/// Claude 格式转换器
pub struct ClaudeConverter;

/// Gemini 格式转换器
pub struct GeminiConverter;
```

### 3.3 流式响应处理

```rust
// src-tauri/src/agent/streaming.rs

/// 流式响应处理器
pub struct StreamProcessor {
    /// 当前状态
    state: StreamState,
    /// 缓冲区
    buffer: String,
    /// 工具调用缓冲
    tool_buffer: Option<PartialToolCall>,
}

impl StreamProcessor {
    /// 处理流式数据块
    pub fn process_chunk(&mut self, chunk: &str) -> Vec<StreamEvent> {
        let mut events = Vec::new();

        // 解析数据块
        // 处理文本、工具调用等
        // 生成事件

        events
    }
}

/// 流式事件
pub enum StreamEvent {
    TextDelta { text: String },
    ToolCallStart { id: String, name: String },
    ToolCallDelta { id: String, input_delta: String },
    ToolCallEnd { id: String },
    Done,
}
```

---

## 四、工具系统设计

### 4.1 内置工具

| 工具             | 描述            | 参数                               |
| ---------------- | --------------- | ---------------------------------- |
| `read_file`      | 读取文件内容    | `path: string`                     |
| `write_file`     | 写入文件        | `path: string, content: string`    |
| `list_directory` | 列出目录内容    | `path: string, pattern?: string`   |
| `search_files`   | 搜索文件内容    | `pattern: string, path?: string`   |
| `shell_command`  | 执行 Shell 命令 | `command: string, cwd?: string`    |
| `http_request`   | 发送 HTTP 请求  | `url: string, method: string, ...` |

### 4.2 工具注册机制

```rust
// src-tauri/src/agent/tools/registry.rs

/// 工具注册表
pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn ToolExecutor>>,
}

impl ToolRegistry {
    /// 注册内置工具
    pub fn register_builtin(&mut self) {
        self.register(Box::new(ReadFileTool::new()));
        self.register(Box::new(WriteFileTool::new()));
        self.register(Box::new(ShellCommandTool::new()));
        // ...
    }

    /// 注册自定义工具
    pub fn register(&mut self, tool: Box<dyn ToolExecutor>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    /// 获取工具
    pub fn get(&self, name: &str) -> Option<&dyn ToolExecutor> {
        self.tools.get(name).map(|t| t.as_ref())
    }
}
```

### 4.3 工具执行安全

```rust
// src-tauri/src/agent/tools/security.rs

/// 工具执行安全策略
pub struct SecurityPolicy {
    /// 允许的路径前缀
    pub allowed_paths: Vec<PathBuf>,
    /// 禁止的命令
    pub blocked_commands: Vec<String>,
    /// 允许的 HTTP 域名
    pub allowed_domains: Vec<String>,
    /// 最大文件大小
    pub max_file_size: u64,
}

impl SecurityPolicy {
    /// 检查文件路径是否允许
    pub fn check_path(&self, path: &Path) -> Result<(), SecurityError> {
        // 检查路径是否在允许范围内
        // 防止路径遍历攻击
    }

    /// 检查命令是否允许
    pub fn check_command(&self, command: &str) -> Result<(), SecurityError> {
        // 检查命令是否在黑名单中
        // 检查危险操作
    }
}
```

---

## 五、状态管理

### 5.1 Agent 状态

```rust
// src-tauri/src/agent/state.rs

/// Agent 运行状态
pub struct AgentState {
    /// 当前阶段
    pub phase: AgentPhase,
    /// 工具调用计数
    pub tool_call_count: u32,
    /// 对话轮数
    pub turn_count: u32,
    /// 开始时间
    pub started_at: Instant,
    /// Token 使用量
    pub token_usage: TokenUsage,
}

/// Agent 阶段
pub enum AgentPhase {
    Idle,
    Thinking,
    ToolExecution { tool_name: String },
    WaitingForUser,
    Completed,
    Error { message: String },
}

/// Token 使用量
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_write_tokens: u32,
}
```

### 5.2 前端状态同步

```typescript
// 当前仓库的事实源是 Hook + runtime adapter，而不是根 store barrel。
// 推荐边界：
// - 会话 / turn / action：`src/lib/api/agentRuntime.ts`
// - 流式协议：`src/lib/api/agentProtocol.ts`
// - 前端主链：`useAgentChatUnified -> useAsterAgentChat`
// - 已删除旧入口：`useAgentChat`、`useAgentStore`

const chat = useAsterAgentChat({
  workspaceId,
  systemPrompt,
});

await chat.sendMessage("请分析当前项目结构", []);

// 如需更低层的 API 边界，统一走 agent_runtime_*：
// - createAgentRuntimeSession()
// - submitAgentRuntimeTurn()
// - respondAgentRuntimeAction()
```

---

## 六、开发路线图

### Phase 1: 基础 Agent 框架（2-3 周）

- [ ] Agent 定义数据结构
- [ ] 基础工具执行器（read_file, write_file, shell_command）
- [ ] Agent 运行时循环
- [ ] 简单的 CLI 测试界面

### Phase 2: 工具系统完善（2-3 周）

- [ ] 工具注册机制
- [ ] 安全策略实现
- [ ] 更多内置工具（search_files, http_request）
- [ ] 工具执行日志

### Phase 3: 流式响应（1-2 周）

- [ ] 流式响应处理器
- [ ] 前端实时显示
- [ ] 工具调用进度展示

### Phase 4: Agent 管理 UI（2-3 周）

- [ ] Agent 创建/编辑界面
- [ ] 工具配置界面
- [ ] 对话历史查看
- [ ] 运行状态监控

### Phase 5: 高级功能（持续）

- [ ] 多 Agent 协作
- [ ] 工作流编排
- [ ] 自定义工具插件
- [ ] Agent 模板市场

---

## 七、设计原则

### 7.1 模块化

每个组件应该是独立的、可测试的：

```
agent/
├── definition.rs    # Agent 定义（纯数据结构）
├── runtime.rs       # 运行时（业务逻辑）
├── tools/           # 工具系统（可独立测试）
├── messages.rs      # 消息格式（纯数据结构）
└── state.rs         # 状态管理（纯数据结构）
```

### 7.2 可扩展性

- 工具系统使用 trait，支持自定义工具
- Provider 系统已经是可扩展的
- 消息格式统一，便于添加新协议

### 7.3 安全优先

- 所有工具执行都经过安全检查
- 路径访问限制在工作目录内
- 命令执行有黑名单机制
- 网络请求有域名白名单

### 7.4 用户体验

- 流式响应，实时反馈
- 清晰的状态展示
- 详细的错误信息
- 可中断的长时间操作

---

## 八、参考资源

- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI: Function calling](https://platform.openai.com/docs/guides/function-calling)
- [LangChain: Agent concepts](https://python.langchain.com/docs/concepts/agents/)
- [Claude Code: Agent architecture](https://github.com/anthropics/claude-code)

---

_本文档定义了 Lime AI Agent 功能的架构设计，随着开发进展会持续更新。_
