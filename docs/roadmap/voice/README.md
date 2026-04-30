# Lime 离线语音模型路线图

> 状态：current planning source
> 更新时间：2026-04-30
> 目标：把截图参考里的“语音模型”能力收敛为 Lime 可实现的离线语音主线：limecore 下发 SenseVoice Small 下载地址、本地 ASR 转写、Fn 按住说话、测试转写与转写历史。

## 1. 本路线图回答什么

本目录统一回答下面几类问题：

1. Lime 如何接入 SenseVoice Small 离线 ASR，而不是继续只依赖云端 ASR 凭证。
2. 离线模型如何通过 limecore 模型清单与对象存储/CDN 按需下载，避免安装包内置大文件。
3. Fn 按住录音、松开转写的快捷键体验如何落到 macOS 桌面主链。
4. 语音设置页如何区分语音输入 ASR、语音润色 LLM 与配音/TTS 服务模型。
5. 新能力如何接回现有 `voice_command_service -> voice_asr_service -> voice-core` 主链，而不是新造第二套语音系统。

## 2. 固定结论

### 2.1 模型不内置进安装包

SenseVoice Small、Silero VAD、Whisper、GGUF 等大模型文件都不进入 App 初始安装包。

安装包只包含：

1. 模型清单读取
2. 下载与校验能力
3. 本地模型状态管理
4. 已安装模型的推理运行时
5. 缺模型时的明确引导

模型必须由用户显式触发下载。后台不能静默拉取几百 MB 的模型文件。

### 2.2 P0 只产品化 SenseVoice Small

P0 只把截图参考中的 `SenseVoice Small` 做成主路径：

1. 通过 `sherpa-onnx` 运行本地 ASR。
2. 通过 limecore `voice-model-catalog` 获取对象存储/CDN 下载地址。
3. 支持中、粤、英、日、韩自动识别。
4. 默认启用 ITN，把语音识别结果归一成更适合输入的文本。

已有 `WhisperLocal` 能力作为现有代码资产保留，但不作为 P0 的产品化下载模型。

### 2.3 Fn 是专门输入模式，不是普通快捷键字符串

现有 `tauri_plugin_global_shortcut` 适合 `CommandOrControl+Shift+V` 这类组合键。Fn 在 macOS 上属于特殊硬件/系统层按键，不能简单塞进现有 shortcut 字符串解析。

P0 固定为：

1. Apple 键盘上优先提供 Fn 按住说话体验。
2. 无法捕获 Fn 或权限不足时，降级到现有自定义快捷键。
3. 第三方键盘默认走自定义快捷键，不承诺 Fn。

## 3. 先读顺序

1. [sensevoice-small-integration.md](./sensevoice-small-integration.md)
2. [fn-dictation-shortcut.md](./fn-dictation-shortcut.md)

## 4. 当前 Lime 事实源

当前仓库已经有语音主链基础：

1. `src-tauri/crates/voice-core` 负责录音、转写核心类型、云端 ASR 客户端与可选 Whisper 本地识别。
2. `src-tauri/crates/services/src/voice_asr_service.rs` 统一管理 ASR 服务。
3. `src-tauri/crates/services/src/voice_command_service.rs` 封装转写、润色和输出流程。
4. `src-tauri/src/voice/shortcut.rs` 负责普通全局快捷键 press/release。
5. `src/components/settings-v2/agent/voice/index.tsx` 已有语音输入、语音处理、语音服务模型三段设置。
6. `src/components/agent/chat/components/Inputbar/hooks/useInputbarDictation.ts` 已把输入栏语音听写接到现有转写主链。

后续实现必须复用这些入口，不新增平行 ASR 流程。

## 5. 当前实现进度

2026-04-30 已推进到可验证主链：

1. `SenseVoice Small` 模型目录、安装状态、下载、删除、设为默认已接到设置页“语音模型”卡片。
2. 模型文件仍按需下载到用户数据目录，不进入 App 安装包；下载地址优先来自 limecore `GET /api/v1/public/tenants/:tenantId/client/voice-model-catalog`，对象存储/CDN 域名由 `server.voiceModelAssetBaseUrl` 管理。
3. `voice_asr_service` 已把 `SenseVoiceLocal` 接到 `voice_core::SenseVoiceTranscriber`，通过 `sherpa-onnx` 执行 non-streaming 本地转写。
4. macOS Fn 按住录音已落第一刀：原生监听 Fn press/release，失败时保留普通快捷键 fallback。
5. 已补“已安装模型后的 WAV 测试转写”入口：设置页可原生选择或手动输入本机 16-bit PCM WAV 路径后，通过 `voice_models_test_transcribe_file` 复用 `voice_asr_service` 真实本地推理链路。
6. 仍未做 P1 能力：视频抽音、实时录音测试、VAD 分段、转写历史、`trigger_mode` / `fn_shortcut_enabled` 配置分流。

## 6. 当前必须避免的误区

1. 把 SenseVoice Small 打进安装包，导致桌面包体积膨胀。
2. 把 Fn 当成普通 shortcut 字符串，导致配置看似成功但实际不可用。
3. 把语音输入 ASR 和配音/TTS 的“语音服务模型”混在同一个设置语义里。
4. 因为接入 `sherpa-onnx` 就绕过 `voice_asr_service` 主链。
5. 缺模型时自动下载，造成不可预期流量和等待。
6. 在 Tauri 客户端保存对象存储 Access Key 或让客户端生成签名 URL；签名或公开域名必须由 limecore 管理。

## 7. 这一步如何服务主线

这套文档的直接主线收益是：

**把 Lime 语音输入从“云端 ASR 凭证 + 普通快捷键”推进到“按需下载本地模型 + Fn 按住说话 + 可测试可删除”的 current 语音主链。**
