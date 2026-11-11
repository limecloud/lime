use super::*;

#[test]
fn websocket_auth_flags_are_forwarded_without_putting_a_token_in_cli_args() {
    let config = parse_args_from(
        [
            "--listen",
            "ws://127.0.0.1:4500",
            "--ws-auth",
            "capability-token",
            "--ws-token-sha256",
            &"ab".repeat(32),
        ]
        .map(str::to_owned),
    )
    .unwrap();
    assert!(config.websocket_auth.config.is_some());
    assert_eq!(config.listen, "ws://127.0.0.1:4500");
}

#[test]
fn websocket_auth_rejects_missing_values_relative_secrets_and_non_websocket_listeners() {
    for args in [
        vec!["--ws-token-file"],
        vec![
            "--listen",
            "ws://127.0.0.1:4500",
            "--ws-auth",
            "capability-token",
            "--ws-token-file",
            "relative-token",
        ],
        vec![
            "--listen",
            "ws://127.0.0.1:4500",
            "--ws-auth",
            "signed-bearer-token",
            "--ws-shared-secret-file",
            "relative-secret",
        ],
        vec![
            "--stdio",
            "--ws-auth",
            "capability-token",
            "--ws-token-sha256",
            "abcd",
        ],
        vec!["--listen", "ws://127.0.0.1:4500", "--ws-auth", "unknown"],
    ] {
        let description = args.join(" ");
        assert!(
            parse_args_from(args.into_iter().map(str::to_owned)).is_err(),
            "{description}"
        );
    }
}
