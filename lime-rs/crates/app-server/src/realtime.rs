//! 实时语音会话 owner 边界。
//!
//! Codex 的 `thread/realtime/*` 不是普通请求/通知转发：它需要真实的实时音频
//! transport（WebRTC SDP 交换或双向 WebSocket 会话）、独立的输出音频与转录
//! 事件通道，以及 provider 账号边界内的实时语音 wire。
//!
//! Lime 现役 `model-provider` 没有任何实时语音适配器，App Server 也没有会话
//! owner，因此本模块只提供**能力判定**，不注册 `thread/realtime/*` 方法、不接收
//! renderer 音频、不产生伪 started/outputAudio/transcript 事件。任何新增的实时
//! 语音 transport 必须先在这里落地 owner，并通过能力请求暴露真实阻断原因。

use app_server_protocol::RealtimeVoiceBlocker;

/// 当前构建是否具备可承载实时语音会话的 App Server transport owner。
///
/// 这是编译期事实，而不是按 provider 品牌或配置推断的结果。真实 owner 落地时
/// 必须同时实现音频输入、输出音频、转录与关闭事件，再让本函数返回 `true`。
pub fn realtime_transport_available() -> bool {
    false
}

/// 计算当前路由端到端可用实时语音时仍缺失的环节。
///
/// `provider_realtime` 由 `model-provider` 的显式 wire 能力给出；transport 由
/// 本模块的 owner 状态给出。两者任一缺失都不得宣称可用。
pub(crate) fn realtime_blockers_for(
    provider_realtime: bool,
    transport_available: bool,
) -> Vec<RealtimeVoiceBlocker> {
    let mut blockers = Vec::new();
    if !provider_realtime {
        blockers.push(RealtimeVoiceBlocker::ProviderRealtimeUnsupported);
    }
    if !transport_available {
        blockers.push(RealtimeVoiceBlocker::RealtimeTransportUnimplemented);
    }
    blockers
}

/// 以当前构建的真实状态计算实时语音阻断原因。
pub fn realtime_blockers(provider_realtime: bool) -> Vec<RealtimeVoiceBlocker> {
    realtime_blockers_for(provider_realtime, realtime_transport_available())
}

/// 端到端实时语音是否可用。
pub fn realtime_available(provider_realtime: bool) -> bool {
    realtime_blockers(provider_realtime).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::app_server_method_catalog;

    #[test]
    fn shipping_build_has_no_realtime_transport_owner() {
        assert!(!realtime_transport_available());
        assert!(!realtime_available(false));
    }

    #[test]
    fn blockers_name_every_missing_contract() {
        assert_eq!(
            realtime_blockers_for(false, false),
            vec![
                RealtimeVoiceBlocker::ProviderRealtimeUnsupported,
                RealtimeVoiceBlocker::RealtimeTransportUnimplemented,
            ]
        );
        assert_eq!(
            realtime_blockers_for(true, false),
            vec![RealtimeVoiceBlocker::RealtimeTransportUnimplemented]
        );
        assert_eq!(
            realtime_blockers_for(false, true),
            vec![RealtimeVoiceBlocker::ProviderRealtimeUnsupported]
        );
        assert!(realtime_blockers_for(true, true).is_empty());
    }

    #[test]
    fn realtime_methods_stay_unregistered_until_the_owner_exists() {
        // 半实现（只注册方法、不发真实音频）比不可用更糟：这里锁住缺口。
        let realtime_methods: Vec<&str> = app_server_method_catalog()
            .into_iter()
            .map(|spec| spec.method)
            .filter(|method| method.starts_with("thread/realtime/"))
            .collect();
        if realtime_transport_available() {
            assert!(
                !realtime_methods.is_empty(),
                "realtime transport owner must register its methods"
            );
        } else {
            assert!(
                realtime_methods.is_empty(),
                "realtime methods must not be registered without a transport owner: {realtime_methods:?}"
            );
        }
    }
}
