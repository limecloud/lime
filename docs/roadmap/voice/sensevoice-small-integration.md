# SenseVoice Small 离线 ASR 接入方案

> 状态：current planning source
> 更新时间：2026-04-30
> 目标：定义 SenseVoice Small 在 Lime 中的模型分发、配置、运行时接入、UI 状态和验证口径。

## 1. 固定目标

P0 交付一个可真实使用的本地语音输入模型：

1. 用户在设置页看到 `SenseVoice Small` 本地模型卡。
2. 未安装时，用户手动点击下载。
3. 下载完成后，模型状态变为已安装。
4. 用户可选择音频文件、视频文件或实时录音测试转写。
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
  "assetBaseURL": "https://models.example.com",
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
      "sizeBytes": 262144000,
      "requiredFiles": ["model.int8.onnx", "tokens.txt", "silero_vad.onnx"],
      "download": {
        "archive": {
          "downloadPath": "voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
          "downloadUrl": "https://models.example.com/voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
          "sha256": "<server-provided-sha256>"
        },
        "vad": {
          "modelId": "silero-vad-onnx",
          "downloadPath": "voice/silero-vad-onnx/silero_vad.onnx",
          "downloadUrl": "https://models.example.com/voice/silero-vad-onnx/silero_vad.onnx"
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
  voiceModelAssetBaseUrl: "https://models.example.com"
```

可用环境变量：

```bash
SERVER_VOICE_MODEL_ASSET_BASE_URL="https://models.example.com"
VOICE_MODEL_ASSET_BASE_URL="https://models.example.com"
```

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

2026-04-30 已落地到真实推理主链：

1. `voice-core` 新增 `SenseVoiceTranscriber`，通过 `sherpa-onnx` offline recognizer 加载 `model.int8.onnx` 和 `tokens.txt`。
2. `voice_asr_service` 的 `SenseVoiceLocal` 分支已从占位错误切换为本地转写，输入仍复用现有 `AudioData`。
3. 录音采样率不是 16kHz 时，会通过 sherpa-onnx `LinearResampler` 转为 16kHz mono float samples。
4. 模型文件仍只来自设置页显式下载目录，不进入应用安装包；运行时缺文件会提示回到“设置 -> 语音模型”下载。
5. `voice_models_test_transcribe_file` 已提供已安装模型后的 WAV 文件测试转写入口，读取本机 16-bit PCM WAV 后复用 `AsrService::transcribe`，不新造第二套推理路径。
6. `voice_models_download` 优先使用前端从 limecore `voice-model-catalog` 取得的对象存储/CDN 下载 URL；无前端目录时才读取 `LIME_VOICE_MODEL_CATALOG_URL` / `LIME_VOICE_MODEL_ASSET_BASE_URL` 这类运行时配置。
7. P0 仍是 non-streaming decode；VAD 文件随模型状态校验保留，但本轮推理路径未做分段 VAD。

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

P0 只做 non-streaming decode。实时录音体验仍按当前录音完成后转写，不做流式字幕。

### 4.4 sherpa-onnx 集成策略

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
4. 测试转写：P0 已提供原生选择或手动输入本机 WAV 路径；视频文件抽音和实时录音测试保留为 P1。
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
2. sha256 校验失败。
3. 必需文件缺失。
4. 未安装模型时转写失败。
5. 短音频沿用现有错误语义。
6. 已安装模型路径解析。

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
7. 日志能区分下载失败、模型损坏、运行时加载失败和识别失败。

## 9. 这一步如何服务主线

SenseVoice Small 接入的主线收益是：

**让 Lime 的语音输入在无云端 ASR 凭证、无网络的情况下仍能完成转写，同时不牺牲安装包体积。**
