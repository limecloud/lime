use super::*;
use crate::{dispatch::inherit_root_options, MultitoolCli, Subcommand};
use clap::Parser;

#[test]
fn market_login_and_status_keep_the_requested_resource() {
    for args in [
        vec!["lime", "login", "--resource", "market", "--no-browser"],
        vec!["lime", "login", "status", "--resource", "market", "--json"],
    ] {
        let cli = MultitoolCli::try_parse_from(args).unwrap();
        let Some(Subcommand::Login(login)) = cli.subcommand else {
            panic!("expected login command");
        };
        assert_eq!(CloudResource::from(login.resource), CloudResource::Market);
    }
    let cli = MultitoolCli::try_parse_from(["lime", "login"]).unwrap();
    let Some(Subcommand::Login(login)) = cli.subcommand else {
        panic!("expected login command");
    };
    assert_eq!(CloudResource::from(login.resource), CloudResource::Default);
}

#[test]
fn market_readiness_requires_its_own_connected_credential() {
    let mut account: GetAccountResponse = serde_json::from_value(serde_json::json!({
        "serviceUrl": "http://127.0.0.1:1",
        "serviceError": null,
        "account": {
            "type": "cloud", "baseUrl": "http://127.0.0.1:1",
            "issuer": "http://127.0.0.1:1", "applicationId": "lime",
            "clientId": "lime-native", "environment": "sandbox", "userId": "person-a",
            "email": "a@fixture.invalid", "displayName": "A", "generation": "generation-a",
            "resources": []
        },
        "authorizations": []
    }))
    .unwrap();
    assert!(resource_ready(&account, CloudResource::Default));
    assert!(!resource_ready(&account, CloudResource::Market));
    let Some(Account::Cloud { resources, .. }) = &mut account.account else {
        panic!("expected cloud account");
    };
    resources.push(app_server_protocol::protocol::v2::CloudResourceCredential {
        resource: CloudResource::Web,
        audience: "web".into(),
        scope: "web:read".into(),
        expires_at: "2099-01-01T00:00:00Z".into(),
        status: CloudCredentialStatus::Connected,
    });
    assert!(!resource_ready(&account, CloudResource::Market));
    for status in [
        CloudCredentialStatus::Expired,
        CloudCredentialStatus::Refreshing,
        CloudCredentialStatus::VerificationRequired,
        CloudCredentialStatus::OutcomeUnknown,
        CloudCredentialStatus::Connected,
    ] {
        let Some(Account::Cloud { resources, .. }) = &mut account.account else {
            panic!("expected cloud account");
        };
        resources[0].resource = CloudResource::Market;
        resources[0].status = status;
        assert_eq!(
            resource_ready(&account, CloudResource::Market),
            status == CloudCredentialStatus::Connected
        );
    }
    account.account = None;
    assert!(!resource_ready(&account, CloudResource::Default));
    assert!(!resource_ready(&account, CloudResource::Market));
}

#[test]
fn account_commands_preserve_explicit_host_and_locale_and_reject_token_imports() {
    for tail in [
        vec!["login", "--no-browser"],
        vec!["login", "status", "--json"],
        vec!["logout"],
    ] {
        let mut args = vec![
            "lime",
            "--app-server",
            "/fixture/app-server",
            "--locale",
            "zh-TW",
        ];
        args.extend(tail);
        let mut cli = MultitoolCli::try_parse_from(args).unwrap();
        inherit_root_options(&mut cli);
        match cli.subcommand.unwrap() {
            Subcommand::Login(args) => {
                assert_eq!(
                    args.connection.app_server.unwrap().to_str(),
                    Some("/fixture/app-server")
                );
                assert_eq!(args.locale.as_deref(), Some("zh-TW"));
            }
            Subcommand::Logout(args) => {
                assert_eq!(
                    args.connection.app_server.unwrap().to_str(),
                    Some("/fixture/app-server")
                );
                assert_eq!(args.locale.as_deref(), Some("zh-TW"));
            }
            _ => panic!("expected account command"),
        }
    }
    for forbidden in [
        "--base-url",
        "--with-api-key",
        "--with-access-token",
        "--device-auth",
    ] {
        let error = MultitoolCli::try_parse_from(["lime", "login", forbidden, "forbidden-value"])
            .unwrap_err();
        assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    }
}

#[test]
fn remote_account_commands_fail_before_starting_a_local_fallback() {
    let mut connection = ConnectionArgs::default();
    connection.remote.remote = Some("ws://127.0.0.1:43210".into());
    assert_eq!(
        ensure_local(&connection).unwrap_err().to_string(),
        "account_local_host_required"
    );
    connection.remote.remote = None;
    connection.remote.remote_auth_token_env = Some("TEST_HOST_TOKEN".into());
    assert!(ensure_local(&connection).is_err());
}

#[test]
fn original_login_feedback_covers_every_product_locale() {
    for (locale, tag) in [
        (Locale::ZhCn, "zh-CN"),
        (Locale::ZhTw, "zh-TW"),
        (Locale::EnUs, "en-US"),
        (Locale::JaJp, "ja-JP"),
        (Locale::KoKr, "ko-KR"),
    ] {
        assert_eq!(locale.tag(), tag);
        assert!(locale.label(Label::LoginInterrupted).contains("lime login"));
        assert!(locale
            .label(Label::LoginInterrupted)
            .contains("lime logout"));
        assert!(locale
            .label(Label::LoginUnknown)
            .contains("lime login status"));
        assert!(
            login_label(locale, CloudResource::Market, Label::LoginUnknown)
                .contains("lime login status --resource market")
        );
        let interrupted = login_label(locale, CloudResource::Market, Label::LoginInterrupted);
        assert!(interrupted.contains("lime login --resource market"));
        assert!(interrupted.contains("lime logout"));
        for label in [
            Label::LoginOpen,
            Label::LoginPending,
            Label::LoggedIn,
            Label::LoggedOut,
        ] {
            assert!(!locale.label(label).is_empty());
        }
    }
}
