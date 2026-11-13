//! Desktop、CLI 和 TUI 共用的云服务用户配置。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CloudConfig {
    #[serde(
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_base_url"
    )]
    pub base_url: Option<String>,
}

impl CloudConfig {
    pub fn is_default(&self) -> bool {
        self.base_url.is_none()
    }
}

/// 只允许精确 HTTPS origin，回环开发地址可以使用 HTTP。
pub fn validated_cloud_origin(value: &str) -> Result<(url::Url, bool), String> {
    let base = url::Url::parse(value).map_err(|_| "account_origin_invalid")?;
    let loopback = base.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if !(base.scheme() == "https" || base.scheme() == "http" && loopback)
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || base.path() != "/"
        || base.cannot_be_a_base()
        || base.origin().ascii_serialization() != value.trim_end_matches('/')
    {
        return Err("account_origin_invalid".into());
    }
    Ok((base, loopback))
}

fn deserialize_base_url<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)?
        .map(|value| {
            validated_cloud_origin(&value)
                .map(|(url, _)| url.origin().ascii_serialization())
                .map_err(serde::de::Error::custom)
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_exact_origins_and_normalizes_only_trailing_slashes() {
        for (origin, local) in [
            ("https://core.example.test", false),
            ("https://core.example.test/", false),
            ("http://127.0.0.1:4321", true),
            ("http://127.0.0.2:4321", true),
            ("http://[::1]:4321", true),
            ("http://localhost:4321", true),
        ] {
            let config: CloudConfig = serde_json::from_value(json!({"base_url":origin})).unwrap();
            assert_eq!(validated_cloud_origin(origin).unwrap().1, local);
            assert_eq!(
                config.base_url.as_deref(),
                Some(origin.trim_end_matches('/'))
            );
        }
        assert!(serde_json::from_value::<CloudConfig>(json!({}))
            .unwrap()
            .is_default());
        assert!(
            serde_json::from_value::<CloudConfig>(json!({"base_url":null}))
                .unwrap()
                .is_default()
        );
    }

    #[test]
    fn rejects_remote_http_paths_credentials_and_ambiguous_origins() {
        for origin in [
            "",
            " https://core.example.test",
            "https://core.example.test ",
            "http://core.example.test",
            "https://user:secret@core.example.test",
            "https://core.example.test/api",
            "https://core.example.test?x=1",
            "https://core.example.test#login",
            "https://CORE.example.test",
            "http://127.0.0.1.example.test",
            "https://core.example.test:443",
            "file:///tmp/core",
            "javascript:alert(1)",
        ] {
            assert!(
                serde_json::from_value::<CloudConfig>(json!({"base_url":origin})).is_err(),
                "{origin}"
            );
        }
        assert!(serde_json::from_value::<CloudConfig>(
            json!({"baseUrl":"https://core.example.test"})
        )
        .is_err());
    }

    #[test]
    fn project_defaults_cannot_override_user_cloud_service() {
        let mut user = json!({"cloud":{"base_url":"https://core.example.test"}});
        super::super::layers::merge_defaults(
            &mut user,
            &json!({
                "cloud":{"base_url":"https://replacement.example.test"}
            }),
        )
        .unwrap();
        assert_eq!(user["cloud"]["base_url"], "https://core.example.test");
    }
}
