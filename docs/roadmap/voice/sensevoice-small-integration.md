# SenseVoice Small 离线 ASR 接入方案

> 状态：current planning source
> 更新时间：2026-05-01
> 目标：定义 SenseVoice Small 在 Lime 中的模型分发、配置、运行时接入、UI 状态和验证口径。

## 1. 固定目标

P0 交付一个可真实使用的本地语音输入模型：

1. 用户在设置页看到 `SenseVoice Small` 本地模型卡。
2. 未安装时，用户手动点击下载。
3. 下载完成后，模型状态变为已安装。
4. 用户可选择 WAV 文件或录音结束后的音频测试转写。
5. 语音输入主链可把录音交给 SenseVoice Small 本地转写。
6. 用户可以删除本地模型缓存。

非目标：

1. 不在 P0 同时产品化多个离线 ASR 模型。
2. 不把模型文件打包进 App。
3. 不重写现有语音润色、输出和输入栏听写链路。
4. 不在语音模块内实现独立 LLM 调用栈。

## 2. 技术选型

SenseVoice Small 通过 `sherpa-onnx` 接入。

调研结论：

1. `sherpa-onnx` 支持本地离线 ASR、VAD、TTS 等语音任务。
2. SenseVoice Small 有 ONNX INT8 模型包，适合桌面端按需下载。
3. 模型包主文件为 `model.int8.onnx` 与 `tokens.txt`。
4. 支持普通话、粤语、英语、日语、韩语。
5. `use_itn = true` 可做逆文本归一化，更适合输入场景。
6. `silero_vad.onnx` 可作为可选文件，用于长音频和实时录音分段。

参考源：

1. Context7: `/k2-fsa/sherpa-onnx`
2. `sherpa-onnx` Tauri 示例：`tauri-examples/non-streaming-speech-recognition-from-file`
3. `sherpa` SenseVoice 预训练模型文档
4. Context7: `/modelscope/modelscope`，用于确认 ModelScope `snapshot_download` / `modelscope download` 文件下载能力。
5. ModelScope: `https://modelscope.cn/models/iic/SenseVoiceSmall-onnx`，用于确认阿里系 SenseVoice Small ONNX 源。
6. 阿里云 OSS 文档：`https://help.aliyun.com/zh/oss/developer-reference/`，用于确认公开读对象和服务端签名 URL 的分发方式。
7. Context7: `/websites/rs_cpal_0_17_0_cpal` 与 docs.rs `cpal::BufferSize`，用于确认低延迟 buffer size 与 CPU 占用的权衡。
8. Context7: `/websites/rs_sherpa-onnx_sherpa_onnx` 与 docs.rs `OnlineRecognizer` / `OnlineStream`，用于确认 sherpa-onnx 真 streaming API 需要 online model，而当前 SenseVoice Small 归档走 offline recognizer。

## 3. 模型分发

### 3.1 limecore / 对象存储模型清单

limecore control-plane-svc 提供公开客户端接口：

```text
GET /api/v1/public/tenants/:tenantId/client/voice-model-catalog
```

固定结论：

1. 模型对象放在 `/Users/coso/Documents/dev/ai/limecloud/limecore` 对应后端管理范围内，由 control-plane-svc 下发目录。
2. 实际大文件放在对象存储或 CDN 公开域名后；P0 可用阿里云 OSS、Cloudflare R2 或等价静态文件服务，客户端只消费下发 URL。
3. 对象存储 Access Key、Secret、签名逻辑不得进入 Tauri 客户端。
4. 若需要私有桶，后续由 limecore 生成短期 presigned GET URL；P0 先支持公开域名 / 自定义域名。
5. Lime 客户端保留同一组 `model_id`、必需文件与安装目录，不再把 GitHub Release URL 作为产品事实源。

首个模型条目：

```json
{
  "version": 1,
  "assetBaseURL": "https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev",
  "items": [
    {
      "id": "sensevoice-small-int8-2024-07-17",
      "name": "SenseVoice Small INT8",
      "provider": "FunAudioLLM / sherpa-onnx",
      "description": "本地离线 ASR，支持中文、英文、日文、韩文和粤语；客户端按需下载到用户数据目录，不随安装包内置。",
      "version": "2024-07-17",
      "languages": ["zh", "en", "ja", "ko", "yue"],
      "runtime": "sherpa-onnx",
      "bundled": false,
      "sizeBytes": 163002883,
      "checksumSha256": "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
      "requiredFiles": ["model.int8.onnx", "tokens.txt", "silero_vad.onnx"],
      "download": {
        "archive": {
          "downloadPath": "voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
          "downloadUrl": "https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev/voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
          "sizeBytes": 163002883,
          "sha256": "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e"
        },
        "vad": {
          "modelId": "silero-vad-onnx",
          "downloadPath": "voice/silero-vad-onnx/silero_vad.onnx",
          "downloadUrl": "https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev/voice/silero-vad-onnx/silero_vad.onnx",
          "sha256": "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
        }
      }
    }
  ]
}
```

字段语义：

| 字段 | 含义 |
| --- | --- |
| `id` | 本地安装记录与配置引用的稳定 ID |
| `name` | UI 展示名 |
| `runtime` | 运行时类型，P0 为 `sherpa-onnx` |
| `download.archive.downloadUrl` | limecore 拼装后的模型归档下载地址 |
| `download.archive.sha256` | 可选压缩包校验值；存在时客户端必须校验 |
| `download.vad.downloadUrl` | Silero VAD 文件下载地址 |
| `bundled` | 是否内置到客户端；P0 固定为 `false` |
| `requiredFiles` | 解压后必须存在的文件 |

limecore 配置：

```yaml
server:
  voiceModelAssetBaseUrl: "https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev"
```

可用环境变量：

```bash
SERVER_VOICE_MODEL_ASSET_BASE_URL="https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev"
VOICE_MODEL_ASSET_BASE_URL="https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev"
```

客户端兜底：

1. 优先读取 limecore 下发的 `voice-model-catalog`。
2. 未配置后端目录或环境变量时，客户端使用上面的 R2 公开基址作为默认下载源；模型仍按需下载到用户数据目录，不进入安装包。
3. 后续切换阿里云 OSS / CDN 时，只需要改 limecore 目录或环境变量，不需要改安装包。

R2 验收记录（2026-04-30）：

1. 桶：`lime-releases`。
2. 公开域名：`https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev`。
3. 归档对象：`voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`，`Content-Length=163002883`，`sha256=7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e`。
4. VAD 对象：`voice/silero-vad-onnx/silero_vad.onnx`，`Content-Length=643854`，`sha256=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`。
5. 已通过公网 HEAD、归档完整分段下载 sha256 校验、VAD 完整下载 sha256 校验；R2 `r2.dev` 公网域名无自定义 CDN 域名，后续如需更快下载应绑定正式自定义域名。

limecore 下发验收记录（2026-05-01）：

1. 本地启动 `/Users/coso/Documents/dev/ai/limecloud/limecore/services/control-plane-svc`，使用 `SERVER_PORT=18080` 与 `SERVER_VOICE_MODEL_ASSET_BASE_URL=https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev`。
2. `GET http://127.0.0.1:18080/api/v1/public/tenants` 返回公开租户 `tenant-0001`。
3. `GET http://127.0.0.1:18080/api/v1/public/tenants/tenant-0001/client/voice-model-catalog` 返回 `assetBaseURL`、archive `downloadUrl`、VAD `downloadUrl` 与 archive sha256。
4. Lime Rust 定向测试 `voice_model_cmd::tests::voice_models_list_catalog_fetches_configured_limecore_url` 已验证客户端会优先读取配置的后端目录 URL，并把后端 `assetBaseURL + downloadPath` 映射为下载地址。
5. DevBridge 真实下载验收：从 limecore 响应构造 `catalogEntry` 传入 `voice_models_download`，模型安装成功，`installed=true`，`installed_bytes=240194146`。

阿里系来源调研结论：

1. ModelScope 上存在 `iic/SenseVoiceSmall-onnx`，属于阿里系官方模型源，可通过 `modelscope download`、`snapshot_download` 或 `https://modelscope.cn/api/v1/models/iic/SenseVoiceSmall-onnx/resolve/master/<file>` 下载文件。
2. 该源文件是 `model_quant.onnx`、`tokens.json`、`config.yaml`，不是 sherpa-onnx release 的 `model.int8.onnx`、`tokens.txt` 归档形态。
3. P0 为了不扩散安装器复杂度，推荐在 limecore 侧把可运行形态重新打包并托管到阿里云 OSS / CDN 或 R2；若要直连 ModelScope，需新增 direct-file 安装模式，并把 `tokens.json` 转换为 sherpa-onnx 可读的 `tokens.txt`。

### 3.2 本地存储

模型下载到 Lime 统一数据目录下：

```text
<lime-data-dir>/models/voice/sensevoice-small-int8-2024-07-17/
```

实现要求：

1. 目录必须通过统一目录封装获取，禁止硬编码 macOS 或 Windows 路径。
2. 下载临时文件放在同一数据目录的临时子目录，成功校验后原子移动。
3. 下载完成先校验压缩包 sha256，再校验解压后的必需文件。
4. 校验失败标记为 `corrupted`，不能标记为 `installed`。
5. 删除模型只删除本地模型目录和安装记录，不删除用户的语音配置。

### 3.3 安装状态

客户端至少维护下面状态：

| 状态 | 含义 | UI 行为 |
| --- | --- | --- |
| `not_installed` | 未下载 | 显示下载模型 |
| `downloading` | 下载中 | 显示进度，禁用测试 |
| `verifying` | 校验中 | 禁用删除与测试 |
| `installed` | 已安装 | 可设为默认、测试、删除 |
| `corrupted` | 文件缺失或校验失败 | 显示重新下载 |
| `failed` | 下载失败 | 显示重试 |

## 4. Rust 运行时接入

### 4.0 当前实现进度

2026-05-01 已落地到真实推理主链：

1. `voice-core` 新增 `SenseVoiceTranscriber`，通过 `sherpa-onnx` offline recognizer 加载 `model.int8.onnx` 和 `tokens.txt`。
2. `voice_asr_service` 的 `SenseVoiceLocal` 分支已从占位错误切换为本地转写，输入仍复用现有 `AudioData`。
3. 录音采样率不是 16kHz 时，会通过 sherpa-onnx `LinearResampler` 转为 16kHz mono float samples。
4. 模型文件仍只来自设置页显式下载目录，不进入应用安装包；运行时缺文件会提示回到“设置 -> 语音模型”下载。
5. `voice_models_test_transcribe_file` 已提供已安装模型后的 WAV 文件测试转写入口，读取本机 16-bit PCM WAV 后复用 `AsrService::transcribe`，不新造第二套推理路径。
6. `voice_models_download` 优先使用前端从 limecore `voice-model-catalog` 取得的对象存储/CDN 下载 URL；无前端目录时才读取 `LIME_VOICE_MODEL_CATALOG_URL` / `LIME_VOICE_MODEL_ASSET_BASE_URL` 这类运行时配置。
7. P0 仍是 non-streaming decode；VAD 文件随模型状态校验保留，但本轮推理路径未做分段 VAD。
8. 已验证录音主链：`start_recording` 能打开默认麦克风，`stop_recording` 返回 PCM 数据，`transcribe_audio` 使用默认 `SenseVoice Small 本地` 凭证完成本地转写。
9. 已验证开启语音输入后的快捷键状态：macOS `fn_supported=true`、`fn_registered=true`，普通 fallback 快捷键 `CommandOrControl+Shift+V` 已注册；物理 Fn 按下/松开仍需要人工 smoke 验证。
10. 输入栏与悬浮语音窗 UI 已收口为简短录音态：`录音中`、时长、音量条、红色停止按钮；录音中通过 `get_recording_segment -> transcribe_audio` 增量片段转写展示实时预览，停止后复用完整音频 non-streaming 转写并回填最终文本。
11. 默认 ASR 凭证为 `sensevoice_local` 时，输入栏与悬浮语音窗会在开始录音前检查 `voice_models_get_install_state`；模型未安装时只提示“先下载语音模型”并打开“语音模型”设置页，不自动下载。
12. `voice_asr_service` 已缓存 SenseVoice 本地识别器；实时预览不会在每个片段上重新加载 `model.int8.onnx` 与 `tokens.txt`。
13. 录音实时预览已增加性能护栏：前端每次只请求最多 `1.2s` 增量片段，后端 `get_recording_segment` 默认限制单片最大 `1.25s`、硬上限 `2s`，避免 UI 或 ASR 卡顿后一次性转写整段录音。
14. 录音线程已减少实时音频 callback 内分配：多声道转 mono 与 `i16` 转换直接写入预分配 sample buffer，不再为每个 callback 创建 `mono_data` / `i16_samples` 临时 `Vec`。
15. 单次录音内存已加硬上限：默认最多保留 `300s` mono PCM；停止或取消录音后释放大 buffer，避免长录音或异常未停止导致内存线性增长。
16. 实时预览已加入轻量 PCM16LE 能量门控：静音片段只推进 sample cursor，不触发 SenseVoice 转写，避免无声环境下 CPU 被 ASR 空跑消耗。

### 4.1 配置类型

配置层新增本地 ASR provider：

```rust
pub enum AsrProviderType {
    WhisperLocal,
    SenseVoiceLocal,
    Xunfei,
    Baidu,
    OpenAI,
}
```

新增 SenseVoice 配置：

```rust
pub struct SenseVoiceLocalConfig {
    pub model_id: String,
    pub model_dir: Option<String>,
    pub use_itn: bool,
    pub num_threads: u16,
    pub vad_model_id: Option<String>,
}
```

默认值：

1. `model_id = "sensevoice-small-int8-2024-07-17"`
2. 识别语言沿用 `AsrCredentialEntry.language`，设为默认模型时写入 `auto`
3. `use_itn = true`
4. `num_threads = 4`
5. `vad_model_id = "silero-vad-onnx"`

### 4.2 服务层

`voice_asr_service.rs` 增加 `SenseVoiceLocal` 分支：

```text
AsrService::transcribe
  -> credential.provider == SenseVoiceLocal
  -> transcribe_sensevoice_local(...)
  -> voice_core::SenseVoiceTranscriber
```

失败口径：

1. 未安装模型：返回“本地 SenseVoice Small 尚未安装，请先在设置 -> 语音模型中下载”。
2. 文件损坏：返回“模型文件校验失败，请重新下载”。
3. 运行时依赖不可用：返回可诊断错误，并提示使用自定义快捷键或云端 ASR 不是解决方向。

### 4.3 voice-core

`voice-core` 新增 `SenseVoiceTranscriber`：

1. 输入接收现有 `AudioData`。
2. 转换为 16kHz mono float samples。
3. 创建 sherpa-onnx offline recognizer。
4. `language = auto`。
5. `use_itn = true`。
6. 输出复用现有 `TranscribeResult`。

P0 推理仍是 non-streaming decode。实时录音体验通过“增量片段 + 节流转写”提供临时预览；后续如要做到字幕级连续结果，再接 sherpa-onnx streaming decoder 或 VAD 分段。

### 4.4 实时录音性能策略

调研结论：

1. CPAL `BufferSize::Default` 会交给系统/设备默认值，延迟可能偏大；`BufferSize::Fixed` 可请求更小 callback buffer，但会增加 CPU 占用和 drop-out 风险，所以 P0 不盲目改默认 buffer。
2. sherpa-onnx Rust `OnlineRecognizer` / `OnlineStream` 支持 `accept_waveform -> is_ready -> decode -> get_result` 的真 streaming 链路，但需要 online model config；当前 `SenseVoice Small INT8` 使用 `OfflineSenseVoiceModelConfig(model.int8.onnx + tokens.txt)`，不应伪装成真 streaming。
3. 当前 P0 最稳的性能收益是控制录音与伪流式预览的输入尺寸：callback 零临时 `Vec`、后端片段上限、前端片段上限、完整录音内存上限、识别器缓存。

已落地护栏：

1. `src-tauri/crates/voice-core/src/threaded_recorder.rs` 在开始录音后按采样率预分配 `30s` sample buffer，callback 内直接 downmix + PCM16 转换并写入同一 buffer。
2. callback 内不再为每个音频块创建中间 `Vec`；仅做 RMS、采样转换和一次短锁写入。
3. 单次录音最多保留 `300s` mono PCM，防止长期录音或异常状态导致内存无界增长。
4. `get_recording_segment` 不传 `max_duration_secs` 时默认只返回 `1.25s`，并把显式请求限制在 `2s` 内。
5. 输入栏与悬浮语音窗传入 `1.2s` 片段上限；若上次识别未结束，本轮定时器直接跳过，不并发启动多个本地 ASR。
6. `src/lib/voiceLivePreview.ts` 在进入 ASR 前计算 PCM16LE `rms / peak`；低于门限的静音片段不送入 `transcribe_audio`。

P1 候选：

1. 若用户对实时字幕速度要求继续提高，新增 online streaming 模型，不复用当前 offline SenseVoice 模型硬改。
2. 引入 Silero VAD 做端点检测与静音跳过，减少无声片段送入 ASR 的 CPU 消耗。
3. 在设备支持且实测稳定时，才按 `SupportedBufferSize` 请求更小固定 buffer；不把低 latency 参数硬编码为所有设备默认值。

### 4.5 sherpa-onnx 集成策略

优先顺序：

1. 优先验证 Rust crate / C API 直连方案。
2. 若动态库打包风险高，使用 sidecar 进程封装 sherpa-onnx 调用。
3. 不管采用哪种方式，对上都只暴露 `voice_core::SenseVoiceTranscriber`，避免 UI 或服务层感知运行时细节。

需要在实现前做最小 spike：

1. macOS aarch64 本地加载模型并转写 wav。
2. Windows x64 本地加载模型并转写 wav。
3. Tauri 打包后动态库可找到。
4. 无模型时错误稳定。

## 5. 前端设置页

设置页新增“语音模型”视图，参考截图组织：

1. 顶部：语音输入快捷键，显示 Fn 模式开关与说明。
2. 模型卡：`SenseVoice Small`、`本地`、简介、大小、安装状态。
3. 操作：下载模型、删除模型、设为默认。
4. 测试转写：P0 已提供原生选择或手动输入本机 WAV 路径，并验证输入栏录音结束后转写；视频文件抽音和边录边出字保留为 P1。
5. 历史：所有转写历史入口。

文案边界：

1. `语音模型` 指语音输入 ASR 模型。
2. `语音处理` 指转写后的 LLM 润色与翻译。
3. `语音服务模型` 指配音/TTS 生成模型。

这三个概念不能混用。

## 6. 命令与合同

若新增 Tauri command，必须同步四侧：

1. 前端 `safeInvoke(...)`
2. Rust `tauri::generate_handler!`
3. `agentCommandCatalog`
4. `mockPriorityCommands` / `defaultMocks`

建议命令：

| 命令 | 作用 |
| --- | --- |
| `voice_models_list_catalog` | 获取服务端模型清单 |
| `voice_models_get_install_state` | 获取本地安装状态 |
| `voice_models_download` | 下载并校验模型；可接收前端透传的后端目录项 |
| `voice_models_delete` | 删除本地模型 |
| `voice_models_test_transcribe_file` | 文件测试转写 |

下载与删除都必须返回结构化状态，不能只返回字符串。

## 7. 测试计划

Rust：

1. 模型清单解析与平台过滤。
2. 配置了后端目录 URL 时，客户端优先消费 limecore `voice-model-catalog`。
3. sha256 校验失败。
4. 必需文件缺失。
5. 未安装模型时转写失败。
6. 短音频沿用现有错误语义。
7. 已安装模型路径解析。

前端：

1. 模型卡显示未安装、下载中、已安装、损坏、失败。
2. 未安装时测试按钮禁用。
3. 已安装时选择或输入 WAV 路径并点击测试，会调用 `voice_models_test_transcribe_file` 并显示转写结果、采样率与时长。
4. 下载进度展示。
5. 删除模型需要确认。
6. 设为默认后保存 ASR 配置。

合同：

```bash
npm run test:contracts
```

GUI：

```bash
npm run verify:gui-smoke
```

2026-05-01 实时录音预览验证：

1. `DevBridge` 真实链路：`voice_models_get_install_state -> start_recording -> get_recording_segment -> stop_recording -> transcribe_audio` 通过；录音中返回增量 PCM，最终转写 provider 为 `SenseVoice Small 本地`。
2. 前端定向回归：`npm test -- src/lib/api/asrProvider.test.ts src/components/agent/chat/components/Inputbar/components/InputbarCore.test.tsx src/pages/smart-input.test.tsx src/lib/voiceModelSettingsNavigation.test.ts src/components/settings-v2/agent/voice/index.test.tsx` 通过。
3. 契约与 GUI 主路径：`npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke` 通过。

收口：

```bash
npm run verify:local
```

## 8. 验收标准

1. 新安装 App 不包含 SenseVoice 模型文件。
2. 用户能从设置页显式下载模型。
3. 断网但已安装模型时，语音转写可工作。
4. 删除模型后，转写不再假装可用，并提示重新下载。
5. 输入栏听写和悬浮语音窗消费同一条 ASR 主链。
6. 已安装模型后，可以用本机 16-bit PCM WAV 文件做测试转写，证明模型目录和本地推理链路可用。
7. 开启语音输入后，macOS Fn 监听进入 registered 状态；无法捕获时明确回退到普通语音快捷键。
8. 日志能区分下载失败、模型损坏、运行时加载失败和识别失败。

## 9. 这一步如何服务主线

SenseVoice Small 接入的主线收益是：

**让 Lime 的语音输入在无云端 ASR 凭证、无网络的情况下仍能完成转写，同时不牺牲安装包体积。**
