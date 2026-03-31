# services

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

业务服务层，封装核心业务逻辑。
提供凭证池管理、Token 缓存、MCP 同步等功能。

## 文件索引

- `mod.rs` - 模块入口
- `site_adapter_import_service.rs` - 外部适配器来源导入与 Lime 标准编译层
- `provider_pool_service.rs` - Provider 凭证池服务（多凭证轮询）
- `token_cache_service.rs` - Token 缓存服务
- `mcp_service.rs` - MCP 服务器管理
- `mcp_sync.rs` - MCP 配置同步
- `prompt_service.rs` - Prompt 管理服务
- `prompt_sync.rs` - Prompt 同步
- `skill_service.rs` - 技能管理服务
- `usage_service.rs` - 使用量统计服务
- `backup_service.rs` - 备份服务
- `live_sync.rs` - 实时同步服务
- `switch.rs` - 开关服务
- `sysinfo_service.rs` - Tauri 命令桥接（纯逻辑已迁移到 `crates/services/src/sysinfo_service.rs`）
- `file_browser_service.rs` - Tauri 命令桥接（纯逻辑已迁移到 `crates/services/src/file_browser_service.rs`）
- `update_check_service.rs` - 兼容导出层（纯逻辑已迁移到 `crates/services/src/update_check_service.rs`）
- `update_window.rs` - 更新提醒独立窗口管理（底部居中 Toast 窗口定位）
- `browser_runtime_window.rs` - 浏览器运行时调试独立窗口管理
- `general_chat/` - 通用对话服务模块（会话管理、消息存储）
- `api_key_provider_service.rs` - API Key Provider 服务
- `kiro_event_service.rs` - Kiro 事件服务
- `machine_id_service.rs` - 机器 ID 服务
- `model_registry_service.rs` - 模型注册表服务
- `persona_service.rs` - 人设服务（创建、列表、更新、删除、设置默认、模板）
- `material_service.rs` - 素材服务（上传、存储、删除、内容读取）

## 已迁移补充

以下语音相关纯逻辑已迁移到 `crates/services/src/`：
- `voice_asr_service.rs` - ASR 识别与云端失败回退
- `voice_config_service.rs` - 语音配置、ASR 凭证与指令管理
- `voice_processor_service.rs` - 文本模板处理与 LLM 润色
- `voice_output_service.rs` - 文本输出模式与系统输出
- `voice_command_service.rs` - 转写/润色/输出业务流程
- `voice_recording_service.rs` - 录音状态封装与设备查询

以下截图相关纯逻辑已迁移到 `crates/services/src/`：
- `screenshot_capture_service.rs` - 跨平台截图与临时文件清理
- `screenshot_image_service.rs` - 图片读取与 Base64 编码

## Aster Agent 集成

Aster Agent 集成位于 `src-tauri/src/agent/` 目录：
- `aster_state.rs` - Agent 状态管理
- `aster_agent.rs` - Agent 包装器
- `event_converter.rs` - 事件转换器

详见 `docs/aiprompts/aster-integration.md`

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
