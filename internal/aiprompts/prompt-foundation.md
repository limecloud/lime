# 基础指令主链

## 唯一 owner

基础指令由 App Server 组装，Desktop、CLI/TUI 消费同一 runtime：

```text
Product Surface -> App Server JSON-RPC
  -> runtime_backend/request_context/session_config.rs
  -> agent::build_agent_session_config
  -> agent-runtime::provider_turn
  -> model-provider::current_client
```

前端普通聊天不生成默认角色、回答风格、执行车道或创作模式提示词，不将结构化创作记忆追加为系统指令。
用户输入、显式专家上下文和工具生命周期继续走同一 Thread/Turn/Item；不建立第二套提示词 owner。

## 组装来源

`lime-rs/crates/app-server/src/runtime_backend/request_context/session_config.rs` 是现役组装入口。

- 模型基础指令来自 `services/model_registry_service/models.json` 的 `model_messages`。
- 缺少模型模板时使用同目录 `prompt.md`；显式空模板不被默认模板覆盖。
- 模板的 personality 变量按 `default / friendly / pragmatic / none` 渲染。
- 显式请求指令由 `RuntimeRequest.system_prompt` 提供；普通 GUI 不默认填入这一字段。
- 普通工具回合追加现役 AGENTS、Skills/Plugins 快照、Memory 和 request tool policy。内部 Agent 的隔离策略与轻量回合继续由原 App Server owner 控制。
- `model-provider` 仅按协议将同一份指令转换为 Responses、Chat Completions 或 Anthropic 的 wire 表达，不另造角色模板。

Memory、AGENTS、自定义指令与用户明确选择的专家上下文保留。Soul、风格包、全局创作声线及其配置、RPC、投影装饰均已删除。

## 源码与必要适配

上游：`/Users/coso/Documents/dev/rust/codex`，revision
`970111f6cb62cc02fe36a82ea7d71b37a2889c97`。
复制 `codex-rs/models-manager/models.json` 的模型运行描述与 `model_messages`，以及
`codex-rs/models-manager/prompt.md`；按 Lime 品牌、共享 Desktop/CLI/TUI 宿主做必要适配，
不接入上游账号、Cloud、遥测或托管服务。

哈希、许可证、消费者及删除项见
[复制账本](../exec-plans/browser-model-instructions-source-copy.json)。
基础指令来源与 personality 模板语义对照上游 `prompts/src/model_instructions.rs`。
公开仓库没有 Desktop React 工作台源码；删除旧前端默认提示词属于现役消费者收口，不能声称复制了上游 GUI。

## 验证边界

- `runtime_backend/tests/session_prompt_context.rs` 覆盖基础指令、模板缺失/显式空值、personality、AGENTS 与 Skills 上下文。
- 配置往返测试证明旧 Soul/profile 字段不会再写回；治理 catalog 禁止旧模块恢复。
- GUI/fixture 验证普通输入、工具状态与恢复；external backend 会绕过实际 provider 指令组装，不能替代 Rust 指令测试。
- Live 只记录真实模型返回的 reasoning Item；不得用状态文案或前端模板补出思考内容。
- 验证结果与已知阻塞记录在[浏览器执行计划](../exec-plans/browser-runtime-right-surface-plan.md)。
