# converter

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

协议转换模块，实现 current LLM API 格式之间的转换。旧 CodeWhisperer / Kiro 转换面已退役。

## 文件索引

- `mod.rs` - 模块入口
- `anthropic_to_openai.rs` - Anthropic → OpenAI 转换
- `openai_to_antigravity.rs` - OpenAI → Antigravity (Gemini CLI) 转换
- `reasoning_handler.rs` - 推理内容处理器（DeepSeek/OpenAI o1 等）

## 工具类型支持

### 标准工具
- `function`: 标准函数调用工具

### 特殊工具
- `web_search`: 联网搜索工具（Codex/Kiro 格式）
- `web_search_20250305`: 联网搜索工具（Claude Code 格式）

## 推理内容处理

### 支持的模型

| 模型 | 字段名 | 多轮对话处理 |
|------|--------|--------------|
| DeepSeek R1/Reasoner | `reasoning_content` | 丢弃历史，只保留最后一条 |
| OpenAI o1/o3/o4 | `reasoning` | 通过 `previous_response_id` 引用 |

### 使用方式

```rust
use crate::converter::ReasoningHandler;

// 预处理消息，清理历史 reasoning_content
let processed = ReasoningHandler::preprocess_messages(messages, "deepseek-reasoner");

// 检查模型是否需要清理
if ReasoningHandler::needs_reasoning_cleanup(&model) {
    // 执行清理逻辑
}
```

## Antigravity 转换说明

参考 CLIProxyAPI 实现，主要特性：
- 请求结构：`{ project, request: { contents, systemInstruction, generationConfig, tools, safetySettings }, model }`
- 工具定义：`parameters` → `parametersJsonSchema`
- 安全设置：自动附加默认 safety settings
- 思维链：支持 `reasoning_effort` 配置
- Function Call：正确处理 `thoughtSignature` 和响应格式

## 更新日志

- 2026-02-01: 添加 reasoning_handler 模块，支持 DeepSeek/OpenAI 推理模型
- 2025-12-28: 修复 Antigravity 转换，对齐 CLIProxyAPI 实现
- 2025-12-27: 添加 web_search 工具支持，修复 Issue #49

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
