# Provider 模型能力 taxonomy 进度

## 2026-04-22

### 目标

- 把本地模式、用户自管云端 Provider、OEM 云端目录的模型能力语义收成一套轻量 taxonomy
- 明确区分 `对话 / 视觉理解 / 图片生成 / 音频 / Embedding`，避免继续把 `llm / vlm / multimodal` 混成一类
- 支持 OpenAI relay / OEM 映射模型，例如 `gpt-images-2`
- 保持设置页与 Provider 目录页轻量，不走复杂“模型广场”路线

### 已完成

- Rust 模型注册表与请求解析链已补齐统一字段：
  - `task_families`
  - `input_modalities`
  - `output_modalities`
  - `runtime_features`
  - `deployment_source`
  - `management_plane`
  - `canonical_model_id`
  - `provider_model_id`
  - `alias_source`
- 前端能力推断已统一到 `inferModelCapabilities.ts`：
  - `gpt-images-2` 被识别为 `image_generation`
  - `vision_understanding` 与 `image_generation` 明确分离
  - 旧 `capabilities` 只作为 compat fallback
- Provider 模型目录 UI 已改成轻量能力筛选：
  - 保留按能力筛选，不引入复杂模型广场
  - 已区分 `本地 / 云端 / OEM 云端`
  - 只有 `relay / oem` 别名才展示“实际映射”
- 图片生成选择链已切到统一 taxonomy：
  - 图片 Provider 只会保留真正支持 `image_generation` 的模型
  - 避免把视觉理解模型混进生图候选
- 媒体服务设置页已收口到统一“服务模型”骨架：
  - 设置导航与首页快捷入口已从“媒体服务”统一改名为“服务模型”
  - 服务模型页已对齐参考产品的总页结构，不再只保留图片 / 视频 / 语音三块
  - 新增通用助理模型设置：
    - 话题自动命名
    - AI 图片话题命名
    - 消息内容翻译
    - 会话历史压缩
    - 助理信息生成
    - 输入自动补全
    - 提示词重写
    - 资源库提词重写
  - 新增统一设置区块：
    - 语音识别服务
    - 自动结束语音识别
    - OpenAI 语音合成模型
    - OpenAI 语音识别模型
    - AI 图片默认数量
  - 图片 / 视频 / 语音统一为 `默认 Provider + 默认模型 + 自动回退`
  - 图片默认数量已改为更接近参考页的 `滑杆 + 可直接输入数字` 简化交互
  - 旧图片出图参数面与旧语音调参面已从 current 设置主路径删除
  - 旧实验室 `VoiceSettings` 入口已清退，不再保留双轨 UI
- OEM 云端模型目录已收口到统一 schema：
  - `oemCloudControlPlane.ts` 允许服务端直接下发 taxonomy 字段
  - `oemCloudModelMetadata.ts` 负责把 OEM 模型目录归一为 metadata-like 结构
  - OEM 设置页优先消费 taxonomy，`abilities` 只做兜底
- OEM fallback 能力别名已统一：
  - `llm -> chat`
  - `vlm / multimodal / omni -> vision_understanding`
  - `image_generation / text_to_image -> image_generation`
- 已补回归并通过：
  - OEM 模型协议解析
  - OEM taxonomy helper
  - Provider 模型目录别名展示
  - OEM 设置页 taxonomy 优先级
  - 图片生成筛选链
  - 媒体服务设置页定向回归：
    - `src/lib/imageGeneration.test.ts`
    - `src/lib/serviceModels.test.ts`
    - `src/lib/api/appConfig.test.ts`
    - `src/components/settings-v2/agent/media-services/index.test.tsx`
    - `src/components/settings-v2/agent/image-gen/index.test.tsx`
    - `src/components/settings-v2/agent/video-gen/index.test.tsx`
    - `src/components/settings-v2/agent/voice/index.test.tsx`
    - `src/components/settings-v2/system/experimental/index.test.tsx`
    - 服务模型总页新增断言覆盖：
      - 输入自动补全开关持久化
      - 自动结束语音识别持久化
      - 资源库自定义提示词持久化
      - 默认图片数量持久化
  - Rust 配置 roundtrip：
    - `cargo test -p lime-core test_workspace_preferences_supports_service_models_roundtrip`
  - GUI 冒烟：
    - `npm run verify:gui-smoke`
  - `npm run governance:legacy-report`
- 已额外确认：
  - `isImageProvider("lime-hub", "openai", ["gpt-images-2"]) === true`
- 当前未完成的环境校验：
  - `npm run verify:local` 当前被仓库中其他改动阻塞：
    - `src/lib/sceneapp/product.ts:2070`
    - `src/lib/sceneapp/product.ts:2101`
    - 错误为 `SceneAppScorecardViewModel.aggregate` 缺失
    - 属于当前脏工作区里的 sceneapp 主线类型问题，不是本次服务模型页改动引入

### 当前边界

- `current`
  - 本地 / 云端 / OEM 模型目录共享同一套轻量 taxonomy 语义
  - OEM 云端目录支持直接下发 taxonomy，也支持旧 `abilities` 兼容
  - UI 只做轻量筛选和标签展示，不做复杂模型广场
  - 媒体服务设置只保留服务模型级默认项，不再继续扩展旧细项调参面
- `compat`
  - OEM `abilities: string[]`
  - OEM `upstreamMapping`
  - 旧 `capabilities` 布尔字段
- `dead`
  - `src/components/voice/VoiceSettings.tsx`
  - 实验室里的旧语音输入设置面
- `not in scope`
  - 把 OEM 云端目录完全同步进本地自定义模型持久化
  - 引入独立模型 marketplace / 多维排序 / 高复杂过滤器

### 下一刀

1. 推动 OEM 服务端稳定下发 taxonomy 字段，逐步减少前端对 `abilities` 的兼容推断依赖。
2. 评估是否需要把 OEM 模型目录同步到 `useOemLimeHubProviderSync.ts` 的本地缓存面；若做，优先保持单一事实源，不新增第二套目录结构。
3. 若后续把 OEM 云端服务模型接入媒体服务设置，优先复用当前服务模型骨架，只扩展选项数据源与来源标签，不新增第二套设置页。
4. 若后续出现视频、文档理解、实时语音等新能力，再在现有 taxonomy 上小步扩展，不回退到“模糊模型类型”。

## 2026-04-23

### 继续收口

- 桌宠能力偏好页已统一回共享模型选择链：
  - `MediaPreferenceSection -> SettingModelSelectorField -> ModelSelector`
  - 不再继续保留旧 `providerLabel/providerValue/modelLabel/modelValue` 参数面
- 桌宠通用模型区块已显式走 `general` 主题筛选，避免把明显非对话模型混进 quick action 候选
- 桌宠通用 / TTS 区块都已按当前 consumer 能力做 Provider 过滤：
  - 只展示当前桌宠 quick action / TTS 能真正消费的 Provider
  - 继续兼容后续本地、自管云与 OEM taxonomy 扩展
- `@配音` 的定向回归已补：
  - 显式 mock 全局 `media_defaults.voice`
  - 断言 `service_scene_run` 中携带
    - `preferred_provider_id`
    - `preferred_model_id`
    - `allow_fallback`
  - 当 `preferred_provider_id + preferred_model_id` 同时存在时，当前发送链会把它们转成真实 `providerOverride / modelOverride`
  - 当只声明 `preferred_provider_id`、未显式选模型时，不会误把当前会话模型硬塞给新 Provider
- 桌宠设置相关回归已补：
  - `CompanionCapabilityPreferencesCard.test.tsx`
  - `providers/index.test.tsx`
  - 两处都断言当前页复用了统一 `ModelSelector` 组件，而不是另一套独立选择器

### 本轮校验事实

- 已通过：
  - `npx vitest run "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"`
  - 结果：`90` 个测试通过
- 已通过：
  - `npx vitest run "src/components/settings-v2/agent/providers/CompanionCapabilityPreferencesCard.test.tsx" "src/components/settings-v2/agent/providers/index.test.tsx"`
  - 结果：`15` 个测试通过
- 已通过：
  - `cargo test -p lime-core test_workspace_preferences_supports_companion_defaults_roundtrip`
  - `cargo test -p lime-core test_workspace_preferences_supports_service_models_roundtrip`
- 未完成：
  - `cargo test -p lime ...` 在编译 `lime` 主 crate 链接阶段被环境阻塞
  - 具体错误：`No space left on device`
  - 当前磁盘余量：`1.4Gi`

### 2026-04-23 继续收口（第二刀）

- Rust `request_model_resolution` 已开始真正消费 `service_scene_launch` 里的首选服务偏好：
  - 当前若回合 metadata 同时声明 `preferred_provider_id + preferred_model_id`
  - 且前端本轮没有显式 `provider_preference / model_preference`
  - 后端会直接基于该 scene launch 偏好解析 `provider_config`
- `service_scene_launch.allow_fallback` 已接入后端解析策略：
  - `false`：首选 provider/model 不可解析时直接报错，不再静默回退会话默认
  - `true`：首选 provider/model 失效时，允许继续回退到会话当前 provider/model
- 当前只声明 `preferred_provider_id`、未声明 `preferred_model_id` 时：
  - 后端不会把它误当成完整首选模型偏好
  - 仍沿用现有显式请求 / 会话恢复链，避免跨 Provider 误绑模型
- “服务模型”页已进一步简化：
  - `输入自动补全助理` 当前已收口为只展示启停开关
  - 不再暴露尚未接入 current 执行面的模型选择 UI
  - 这样继续保持“能用的配置必须真生效；没接上的不假装可配”

### 2026-04-23 继续收口（第三刀）

- 桌宠设置页已删除未接入 current 执行面的 `桌宠语音播报` 偏好区块：
  - 当前 Rust `companion_service` 只真实消费 `companion_defaults.general`
  - `companion_defaults.tts` 之前只有设置页写入，没有 quick action / voice chat / 播报执行链 consumer
  - 因此 current UI 只保留 `桌宠通用模型`，继续复用共享 `ModelSelector`
- 桌宠偏好保存逻辑同步收口：
  - 保存 `桌宠通用模型` 时不再继续保留旧的 `companion_defaults.tts` 假设置
  - 让桌宠页和实际执行面重新回到单一事实源

### 2026-04-23 继续收口（第四刀）

- `VoiceSettings` 已从“只配语音生成任务模型”补齐为当前真实语音主链设置页：
  - 语音输入启停
  - 主快捷键
  - 翻译模式快捷键
  - 麦克风设备
  - 交互音效
  - AI 润色开关
  - 润色 / 翻译共用模型选择
  - 默认润色指令
  - 翻译模式指令
  - 指令管理
  - 配音 / TTS 任务默认模型
- 新语音设置页继续复用统一模型选择链：
  - `SettingModelSelectorField -> ModelSelector`
  - 不再继续使用旧 `PolishModelSelector` 作为另一套模型入口
- 新增语音设置都已接到 current consumer：
  - `processor.polish_provider / polish_model` 已真实透传到本地网关请求头 `X-Provider-Id`
  - `translate_instruction_id` 与指令删除后的回退逻辑已收口，避免保存失效指令引用
  - `selected_device_id / sound_enabled / enabled / shortcut / translate_shortcut` 继续直连当前语音输入链
- dead `Config.voice` 已彻底删除：
  - 前端 `appConfigTypes` 不再暴露旧 `voice` 面
  - Rust `Config` 不再保留旧 `voice` 字段与导出
  - 相关旧测试 mock 与假配置项已同步清理

### 本轮新增校验

- 已通过：
  - `npx vitest run "src/components/settings-v2/agent/media-services/index.test.tsx"`
  - 结果：`5` 个测试通过
- 已通过：
  - `npx vitest run "src/components/settings-v2/agent/voice/index.test.tsx" "src/components/settings-v2/agent/media-services/index.test.tsx" "src/lib/api/appConfig.test.ts"`
  - 结果：`18` 个测试通过
- 已通过：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" service_scene_model_preference`
  - 结果：新增 `2` 个 Rust 定向测试通过
- 已通过：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-core test_voice_input_config_default`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-services --lib`
  - 结果：`lime-core` 定向测试通过，`lime-services` `174` 个测试通过
- 已通过：
  - `npx vitest run "src/components/settings-v2/agent/providers/CompanionCapabilityPreferencesCard.test.tsx" "src/components/settings-v2/agent/providers/index.test.tsx"`
  - 结果：`15` 个测试通过
- 当前环境事实：
  - 磁盘余量已恢复到约 `76GiB`
  - 默认 `target` 目录偶发被并行 `cargo run` 占锁；不是本轮代码错误

### 下一刀

1. 先清出足够磁盘空间，再补 `lime` 主 crate 的 Rust 定向测试，确认 `runtime_turn / service_scene_launch / prompt_context` 全链编译通过。
2. 若桌宠语音播报进入 current 执行链，优先复用这次已经统一好的 `companion_defaults.tts`，不要再新增第二套语音偏好入口。
