#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PeerAddressScheme {
    Uds,
    Bridge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedPeerAddress {
    pub(crate) scheme: PeerAddressScheme,
    pub(crate) target: String,
}

pub(crate) const SEND_MESSAGE_TOOL_DESCRIPTION: &str =
    "Send a message to another agent. 优先复用已有 agent 的上下文继续推进任务，而不是重复创建新 agent；当前 Lime runtime 支持直接发送给 agent id、命名子 session、活跃 team 内按名字或 `*` 广播路由，并支持 synthetic `uds:<session-id>` 本机会话投递。`bridge:` 远端 peer address 仍只做显式识别并返回未实现失败，因为 Lime 还没有 remote peer host / session ingress。";

pub(crate) const SEND_MESSAGE_TO_FIELD_DESCRIPTION: &str =
    "目标 agent 标识。可传 agent id、命名子 session 名称；若当前 session 属于活跃 team，也可传 teammate 名称或 `*` 广播给所有其他 team 成员。本机会话 peer 请使用 ListPeers 返回的 `send_to`，形如 `uds:<session-id>`；`bridge:` 当前仍返回未实现失败，因为 Lime 还没有 remote peer host / session ingress。";

pub(crate) const LIST_PEERS_TOOL_DESCRIPTION: &str =
    "列出当前可通过 SendMessage 直接通信的 peers。当前 Lime runtime 会先返回活跃 team 内成员，并优先暴露同一 working_dir 下 live 的本机顶层 session；若 live peers 不足，再回退最近本机会话。本机会话请使用 `send_to` 里的 synthetic `uds:<session-id>` 地址发送，不要把 `agent_id` 当作 peer address。`bridge:` remote peer 仍未进入 current，因为 Lime 还没有 remote peer host / session ingress。";

pub(crate) const BRIDGE_PEER_UNSUPPORTED_MESSAGE: &str =
    "Known upstream peer address surface (`bridge:`), but the current Lime runtime does not expose cross-session remote peer messaging through SendMessage yet because Lime does not have a remote peer host / session ingress.";

pub(crate) fn parse_peer_address(target: &str) -> Option<ParsedPeerAddress> {
    if let Some(value) = target.strip_prefix("uds:") {
        return Some(ParsedPeerAddress {
            scheme: PeerAddressScheme::Uds,
            target: value.trim().to_string(),
        });
    }
    if let Some(value) = target.strip_prefix("bridge:") {
        return Some(ParsedPeerAddress {
            scheme: PeerAddressScheme::Bridge,
            target: value.trim().to_string(),
        });
    }

    None
}

pub(crate) fn is_cross_session_local_peer_address(address: &ParsedPeerAddress) -> bool {
    address.scheme == PeerAddressScheme::Uds
}

pub(crate) fn peer_address_scheme_key(scheme: PeerAddressScheme) -> &'static str {
    match scheme {
        PeerAddressScheme::Bridge => "bridge",
        PeerAddressScheme::Uds => "uds",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_peer_address_distinguishes_supported_schemes() {
        assert_eq!(
            parse_peer_address("uds:session-123"),
            Some(ParsedPeerAddress {
                scheme: PeerAddressScheme::Uds,
                target: "session-123".to_string(),
            })
        );
        assert_eq!(
            parse_peer_address("bridge:session-456"),
            Some(ParsedPeerAddress {
                scheme: PeerAddressScheme::Bridge,
                target: "session-456".to_string(),
            })
        );
        assert_eq!(parse_peer_address("researcher"), None);
    }

    #[test]
    fn peer_surface_contract_keeps_uds_current_and_bridge_unsupported() {
        let uds = parse_peer_address("uds:session-123").expect("uds should parse");
        let bridge = parse_peer_address("bridge:session-456").expect("bridge should parse");

        assert!(is_cross_session_local_peer_address(&uds));
        assert!(!is_cross_session_local_peer_address(&bridge));
        assert_eq!(peer_address_scheme_key(bridge.scheme), "bridge");
        assert!(BRIDGE_PEER_UNSUPPORTED_MESSAGE.contains("remote peer host / session ingress"));
    }
}
