use super::AppServerSession;
use app_server_protocol::protocol::v2::{
    AccountAuthorizationStatus, AccountAuthorizeParams, AccountAuthorizeResponse,
    AuthorizationAction,
};
use app_server_protocol::RequestId;

impl AppServerSession {
    pub(crate) async fn respond_account_authorization(
        &self,
        id: RequestId,
        params: AccountAuthorizeParams,
        active_thread: bool,
    ) -> anyhow::Result<()> {
        let action = if !self.remote && active_thread && valid_authorization(&params) {
            let opened = tokio::task::spawn_blocking(move || {
                crate::runtime::actions::open_link(&params.auth_url)
            })
            .await;
            if matches!(opened, Ok(Ok(()))) {
                AuthorizationAction::Opened
            } else {
                AuthorizationAction::Unavailable
            }
        } else {
            AuthorizationAction::Unavailable
        };
        self.request_handle
            .respond(id, AccountAuthorizeResponse { action })
            .await?;
        Ok(())
    }
}

fn valid_authorization(params: &AccountAuthorizeParams) -> bool {
    use app_server_protocol::protocol::v2::CloudResource;
    if params.thread_id.trim().is_empty()
        || params.authorization.id.trim().is_empty()
        || params.authorization.status != AccountAuthorizationStatus::Pending
        || !chrono::DateTime::parse_from_rfc3339(&params.authorization.expires_at)
            .is_ok_and(|at| at.timestamp() > chrono::Utc::now().timestamp())
        || params.auth_url.len() > 16 * 1024
    {
        return false;
    }
    let Ok(url) = url::Url::parse(&params.auth_url) else {
        return false;
    };
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    let resource = match params.authorization.resource {
        CloudResource::Default => "default",
        CloudResource::Market => "market",
        CloudResource::Web => "web",
        CloudResource::Connections => "connections",
    };
    let query: Vec<_> = url.query_pairs().collect();
    (url.scheme() == "https" || url.scheme() == "http" && loopback)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() == "/api/v1/client/auth/authorize"
        && ["state", "nonce", "code_challenge", "redirect_uri"]
            .iter()
            .all(|name| {
                let values: Vec<_> = query
                    .iter()
                    .filter(|(key, _)| key.as_ref() == *name)
                    .collect();
                values.len() == 1 && !values[0].1.is_empty()
            })
        && query.iter().filter(|(key, _)| key == "resource").count() <= 1
        && query
            .iter()
            .find(|(key, _)| key == "resource")
            .map(|(_, value)| value.as_ref())
            .unwrap_or("default")
            == resource
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> AccountAuthorizeParams {
        serde_json::from_value(serde_json::json!({
            "threadId":"thread", "authorization":{
                "id":"original", "resource":"web", "status":"pending",
                "expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339()
            },
            "authUrl":"https://core.test/api/v1/client/auth/authorize?state=original&nonce=nonce&code_challenge=challenge&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Foauth%2Fcallback&resource=web"
        })).unwrap()
    }

    #[test]
    fn browser_handoff_rejects_expired_mismatched_duplicate_and_non_http_urls() {
        assert!(valid_authorization(&params()));
        for invalid in [
            "expired",
            "resource",
            "duplicate",
            "path",
            "file",
            "http",
            "credentials",
        ] {
            let mut value = params();
            match invalid {
                "expired" => value.authorization.expires_at = "2000-01-01T00:00:00Z".into(),
                "resource" => {
                    value.authorization.resource =
                        app_server_protocol::protocol::v2::CloudResource::Market
                }
                "duplicate" => value.auth_url.push_str("&state=another"),
                "path" => value.auth_url = value.auth_url.replace("/auth/authorize", "/other"),
                "file" => value.auth_url = "file:///etc/hosts".into(),
                "http" => value.auth_url = value.auth_url.replace("https:", "http:"),
                "credentials" => {
                    value.auth_url = value.auth_url.replace("core.test", "user:secret@core.test")
                }
                _ => unreachable!(),
            }
            assert!(!valid_authorization(&value), "{invalid}");
        }
    }
}
