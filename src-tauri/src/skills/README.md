# Skills 集成模块

本模块实现 aster-rust Skills 系统与 Lime 的集成。

## 模块结构

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `catalog.rs` | skill catalog 枚举、详情 DTO 与标准合规校验边界 |
| `execution.rs` | Skill prompt/workflow 的 Tauri emitter、execution_mode 路由、按 skill_name 执行主链与错误码适配壳（纯执行主链位于 `crates/agent/src/skill_execution.rs`） |
| `llm_provider.rs` | 桥接层（纯逻辑已迁移到 `crates/skills/src/lime_llm_provider.rs`） |
| `execution_callback.rs` | TauriExecutionCallback 实现（保留在主 crate） |
| `runtime.rs` | skill 执行前置准备、provider fallback、run metadata 投影边界 |
| `social_post.rs` | `content_post_with_cover` 的后处理与产物事件投影 |

## Skills 集成架构

### AI 自动调用 Skills（标准化后）

Lime 通过以下机制让 AI 能够自动发现和调用 Skills：

1. **Agent 初始化时加载 Skills**
   - `AsterAgentState::init_agent_with_db()` 调用 `load_lime_skills()`
   - 技能包以 Agent Skills 标准 `SKILL.md` 为主格式
   - 默认从应用级 Skills 目录加载，并支持项目级 `./.agents/skills`
   - 注册到 aster-rust 的 `global_registry`

2. **SkillTool 自动注册**
   - aster-rust 的 `register_default_tools()` 自动注册 `SkillTool`
   - `SkillTool` 从 `global_registry` 读取可用 Skills
   - AI 可以通过 `Skill` 工具调用任意已注册的 Skill

3. **动态刷新**
   - 安装/卸载 Skills 后调用 `AsterAgentState::reload_lime_skills()`
   - 自动更新 `global_registry`，无需重启应用

### 数据流

```
用户安装 Skill
    ↓
skill_cmd.rs::install_skill_for_app()
    ↓
AsterAgentState::reload_lime_skills()
    ↓
aster::skills::global_registry 更新
    ↓
AI 通过 SkillTool 发现新 Skill
    ↓
用户对话时 AI 自动调用相关 Skill
```

## 核心组件

### LimeLlmProvider

使用 API Key Provider 选择凭证并调用 LLM API。

**功能**：
- 通过 API Key Provider 选择可用凭证
- 支持指定 provider 类型和 model 参数
- 不再读取旧凭证池、OAuth token 文件或本地 CLI 凭证目录

### TauriExecutionCallback

通过 Tauri 事件系统向前端发送 Skill 执行进度更新。

**事件类型**：
- `skill:step_start`: 步骤开始
- `skill:step_complete`: 步骤完成
- `skill:step_error`: 步骤错误
- `skill:complete`: 执行完成

## 依赖关系

```
agent/aster_state.rs
├── load_lime_skills()
│   ├── aster::skills::load_skills_from_directory()
│   └── aster::skills::global_registry()
└── reload_lime_skills()

skills/
├── catalog.rs
│   ├── 可执行 skill 列表枚举
│   ├── skill 详情 DTO 投影
│   └── 标准合规校验错误归一
├── execution.rs (Tauri 适配壳)
│   ├── execute_named_skill 统一技能执行入口
│   └── crates/agent/src/skill_execution.rs
│       ├── prompt/workflow 执行主链
│       ├── Aster reply 流桥接
│       └── SkillExecutionResult / StepResult
├── runtime.rs
│   ├── agent/tool 初始化准备
│   ├── provider fallback 与统一 memory prompt
│   └── skill run start/finish metadata 投影
├── social_post.rs
│   ├── content_post_with_cover 结果标准化
│   └── 社媒产物 Tool/Artifact 事件补投影
├── llm_provider.rs (桥接)
│   └── crates/skills/src/lime_llm_provider.rs
│       └── ApiKeyProviderService (API Key 服务)
└── execution_callback.rs
    └── tauri::AppHandle (事件发送)

commands/skill_cmd.rs
├── install_skill_for_app()
│   └── AsterAgentState::reload_lime_skills()
└── uninstall_skill_for_app()
    └── AsterAgentState::reload_lime_skills()
```

## 相关文档

- 设计文档: `.kiro/specs/skills-integration/design.md`
- 需求文档: `.kiro/specs/skills-integration/requirements.md`
- 路线图: `docs/roadmap/lime-skills-standardization-roadmap.md`

## 当前标准约定

- Agent Skills 是唯一标准格式
- Lime 私有能力统一写入 `metadata.lime_*`
- Workflow 不再推荐使用 `steps-json` 内联，优先通过 `metadata.lime_workflow_ref` 指向 `references/` 下文件
- skill catalog 的枚举、详情 DTO 与标准合规校验统一收口到 `skills/catalog.rs`
- execution_mode -> prompt/workflow 的路由统一收口到 `skills/execution.rs`
- 按 `skill_name` 执行、execution tracker 包装与场景命令复用统一收口到 `skills/execution.rs`
- prompt/workflow 的执行、session 构建、流事件桥接统一收口到 `lime-agent::skill_execution`
- skill 执行前的 agent/tool 初始化、provider fallback 与 execution tracker metadata 统一收口到 `skills/runtime.rs`
- `content_post_with_cover` 的结果标准化与补充 Artifact 事件统一收口到 `skills/social_post.rs`
- 服务层和执行层共用 `SkillService::inspect_*` inspection 结果作为标准合规事实源，并向前端暴露标准合规状态与资源摘要
- 无效 Skill 仍可在管理页中看到检查结果，但不会进入运行时自动加载和可执行列表
- 管理链路支持创建最小标准 Skill 脚手架，新建结果会立即经过统一 inspection 校验
