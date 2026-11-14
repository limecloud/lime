//! 实时语音能力与会话凭证 owner。
//!
//! Lime 的实时语音采用 OpenAI Realtime WebRTC 的浏览器路径：
//!
//! 1. Renderer 通过 `voiceRealtime/clientSecret/create` 向 App Server 请求短时
//!    client secret；标准 OpenAI API key 只存在于 App Server/Electron host。
//! 2. Renderer 使用 `RTCPeerConnection` 直接向官方 OpenAI SDP endpoint 交换
//!    offer/answer，并通过 `oai-events` data channel 接收转录/错误/关闭事件。
//!
//! 本模块只判定端到端可用性并汇总真实阻断原因；provider HTTP wire 归
//! `model-provider::realtime`，凭证读取归 `LocalAppDataSource`，renderer 音频
//! 与 data channel 归 Voice 设置会话 owner。不得注册 `thread/realtime/*`：
//! 该 Codex 方法族属于 thread 级 native 会话，不是本路径。

use app_server_protocol::RealtimeVoiceBlocker;
use model_provider::provider_capabilities::ProviderCapabilities;
use model_provider::realtime::{
    is_supported_realtime_model, is_supported_realtime_voice, SUPPORTED_REALTIME_MODELS,
    SUPPORTED_REALTIME_VOICES,
};

/// 当前构建是否具备 renderer WebRTC + 麦克风 + data channel 会话路径。
///
/// 这是 build-time 事实；Voice 设置只有在 endpoint 与 renderer 路径都存在时
/// 才允许开始会话。App Server 自身不采集或播放音频。
pub fn realtime_transport_available() -> bool {
    true
}

/// 解析后的实时语音 readiness 输入。
///
/// 不包含任何密钥；`provider_key_available` 只表达是否找到可解密使用的启用
/// API key。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RealtimeVoiceReadiness {
    pub provider_id: Option<String>,
    pub provider_wire_supported: bool,
    pub provider_key_available: bool,
    pub model: Option<String>,
    pub voice: Option<String>,
}

/// 一次能力读取的完整结果，供 JSON-RPC 投影。
#[derive(Debug, Clone)]
pub struct RealtimeVoiceCapability {
    pub readiness: RealtimeVoiceReadiness,
    pub blockers: Vec<RealtimeVoiceBlocker>,
}

impl RealtimeVoiceCapability {
    pub fn available(&self) -> bool {
        self.blockers.is_empty()
    }
}

/// 计算端到端可用实时语音时仍缺失的环节。
pub fn realtime_blockers(readiness: &RealtimeVoiceReadiness) -> Vec<RealtimeVoiceBlocker> {
    let mut blockers = Vec::new();
    if !readiness.provider_wire_supported {
        blockers.push(RealtimeVoiceBlocker::ProviderRealtimeUnsupported);
    } else if !readiness.provider_key_available {
        blockers.push(RealtimeVoiceBlocker::ProviderKeyMissing);
    }
    match readiness.model.as_deref().map(str::trim) {
        None | Some("") => blockers.push(RealtimeVoiceBlocker::RealtimeModelUnconfigured),
        Some(model) if !is_supported_realtime_model(model) => {
            blockers.push(RealtimeVoiceBlocker::RealtimeModelUnsupported)
        }
        Some(_) => {}
    }
    match readiness.voice.as_deref().map(str::trim) {
        None | Some("") => blockers.push(RealtimeVoiceBlocker::RealtimeVoiceUnconfigured),
        Some(voice) if !is_supported_realtime_voice(voice) => {
            blockers.push(RealtimeVoiceBlocker::RealtimeVoiceUnsupported)
        }
        Some(_) => {}
    }
    if !realtime_transport_available() {
        blockers.push(RealtimeVoiceBlocker::RealtimeTransportUnimplemented);
    }
    blockers
}

pub fn realtime_available(readiness: &RealtimeVoiceReadiness) -> bool {
    realtime_blockers(readiness).is_empty()
}

/// provider 路由是否真正承载官方 OpenAI Realtime wire。
///
/// 只看显式 provider type 与 host；不从品牌文案、chat 模型名或 Responses
/// 兼容性推断。Codex cloud auth、Azure、代理 host 都不算。
pub fn realtime_provider_wire_supported(provider_type: &str, api_host: &str) -> bool {
    ProviderCapabilities::from_provider_route(provider_type, Some(api_host))
        .is_some_and(|capabilities| capabilities.realtime)
}

/// provider 不可用时不得暴露模型/音色伪选项。
pub fn realtime_model_options(provider_wire_supported: bool) -> Vec<String> {
    if provider_wire_supported {
        SUPPORTED_REALTIME_MODELS
            .iter()
            .map(|model| (*model).to_string())
            .collect()
    } else {
        Vec::new()
    }
}

pub fn realtime_voice_options(provider_wire_supported: bool) -> Vec<String> {
    if provider_wire_supported {
        SUPPORTED_REALTIME_VOICES
            .iter()
            .map(|voice| (*voice).to_string())
            .collect()
    } else {
        Vec::new()
    }
}

/// 用于 JSON-RPC error 的稳定阻断名，便于 renderer 和日志对照。
pub fn realtime_blocker_name(blocker: RealtimeVoiceBlocker) -> &'static str {
    match blocker {
        RealtimeVoiceBlocker::ProviderRealtimeUnsupported => "providerRealtimeUnsupported",
        RealtimeVoiceBlocker::ProviderKeyMissing => "providerKeyMissing",
        RealtimeVoiceBlocker::RealtimeModelUnconfigured => "realtimeModelUnconfigured",
        RealtimeVoiceBlocker::RealtimeModelUnsupported => "realtimeModelUnsupported",
        RealtimeVoiceBlocker::RealtimeVoiceUnconfigured => "realtimeVoiceUnconfigured",
        RealtimeVoiceBlocker::RealtimeVoiceUnsupported => "realtimeVoiceUnsupported",
        RealtimeVoiceBlocker::RealtimeTransportUnimplemented => "realtimeTransportUnimplemented",
    }
}

pub fn realtime_blocker_names(blockers: &[RealtimeVoiceBlocker]) -> Vec<&'static str> {
    blockers
        .iter()
        .map(|blocker| realtime_blocker_name(*blocker))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::app_server_method_catalog;
    use app_server_protocol::METHOD_VOICE_REALTIME_CLIENT_SECRET_CREATE;

    fn ready() -> RealtimeVoiceReadiness {
        RealtimeVoiceReadiness {
            provider_id: Some("openai".to_string()),
            provider_wire_supported: true,
            provider_key_available: true,
            model: Some("gpt-realtime-2.1".to_string()),
            voice: Some("marin".to_string()),
        }
    }

    #[test]
    fn shipping_build_exposes_the_renderer_webrtc_transport() {
        assert!(realtime_transport_available());
        assert!(realtime_available(&ready()));
    }

    #[test]
    fn blockers_name_every_missing_contract() {
        let missing_provider = RealtimeVoiceReadiness {
            model: Some("gpt-realtime-2.1".to_string()),
            voice: Some("marin".to_string()),
            ..RealtimeVoiceReadiness::default()
        };
        assert_eq!(
            realtime_blockers(&missing_provider),
            vec![RealtimeVoiceBlocker::ProviderRealtimeUnsupported]
        );
        assert_eq!(
            realtime_blockers(&RealtimeVoiceReadiness {
                provider_wire_supported: true,
                model: Some("gpt-realtime-2.1".to_string()),
                voice: Some("marin".to_string()),
                ..RealtimeVoiceReadiness::default()
            }),
            vec![RealtimeVoiceBlocker::ProviderKeyMissing]
        );
        assert_eq!(
            realtime_blockers(&RealtimeVoiceReadiness {
                provider_wire_supported: true,
                provider_key_available: true,
                ..RealtimeVoiceReadiness::default()
            }),
            vec![
                RealtimeVoiceBlocker::RealtimeModelUnconfigured,
                RealtimeVoiceBlocker::RealtimeVoiceUnconfigured,
            ]
        );
        assert_eq!(
            realtime_blockers(&RealtimeVoiceReadiness {
                provider_wire_supported: true,
                provider_key_available: true,
                model: Some("gpt-4o-mini".to_string()),
                voice: Some("not-a-voice".to_string()),
                ..RealtimeVoiceReadiness::default()
            }),
            vec![
                RealtimeVoiceBlocker::RealtimeModelUnsupported,
                RealtimeVoiceBlocker::RealtimeVoiceUnsupported,
            ]
        );
        assert_eq!(
            realtime_blocker_names(&realtime_blockers(&RealtimeVoiceReadiness::default())),
            vec![
                "providerRealtimeUnsupported",
                "realtimeModelUnconfigured",
                "realtimeVoiceUnconfigured"
            ]
        );
    }

    #[test]
    fn only_official_openai_api_key_routes_support_the_wire() {
        assert!(realtime_provider_wire_supported(
            "openai-response",
            "https://api.openai.com"
        ));
        assert!(realtime_provider_wire_supported(
            "openai",
            "https://api.openai.com/v1"
        ));
        for (provider_type, host) in [
            ("codex", "https://api.openai.com"),
            ("openai", "https://gateway.example.com"),
            ("gateway", "https://api.openai.com"),
            ("azure-openai", "https://resource.openai.azure.com"),
            ("anthropic", "https://api.anthropic.com"),
        ] {
            assert!(
                !realtime_provider_wire_supported(provider_type, host),
                "provider_type={provider_type} host={host}"
            );
        }
    }

    #[test]
    fn options_are_empty_without_a_supported_provider() {
        assert!(realtime_model_options(false).is_empty());
        assert!(realtime_voice_options(false).is_empty());
        assert_eq!(
            realtime_model_options(true),
            SUPPORTED_REALTIME_MODELS
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn token_mint_method_is_registered_and_codex_thread_methods_are_not() {
        let catalog: Vec<&str> = app_server_method_catalog()
            .into_iter()
            .map(|spec| spec.method)
            .collect();
        assert!(catalog.contains(&METHOD_VOICE_REALTIME_CLIENT_SECRET_CREATE));
        assert!(
            catalog
                .iter()
                .all(|method| !method.starts_with("thread/realtime/")),
            "Lime owns a renderer WebRTC session, not Codex thread lifecycle methods"
        );
    }
}
