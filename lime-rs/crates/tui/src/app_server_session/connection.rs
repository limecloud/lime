use super::AppServerSession;
use app_server_protocol::{
    protocol::v2::{AuthorizationAction, ConnectionAuthorizeParams, ConnectionAuthorizeResponse},
    RequestId,
};

impl AppServerSession {
    pub(crate) async fn respond_connection_authorization(
        &self,
        id: RequestId,
        params: ConnectionAuthorizeParams,
        active_thread: bool,
    ) -> anyhow::Result<()> {
        let action = if !self.remote && active_thread && valid_approval(&params) {
            let opened = tokio::task::spawn_blocking(move || {
                crate::runtime::actions::open_link(&params.approval_url)
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
            .respond(id, ConnectionAuthorizeResponse { action })
            .await?;
        Ok(())
    }
}

fn valid_approval(params: &ConnectionAuthorizeParams) -> bool {
    if params.thread_id.trim().is_empty()
        || params.request_id.is_empty()
        || params.request_id.len() > 40
        || !params
            .request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        || !matches!(params.environment.as_str(), "sandbox" | "production")
        || params.approval_url.len() > 4096
        || !chrono::DateTime::parse_from_rfc3339(&params.expires_at)
            .is_ok_and(|at| at.timestamp() > chrono::Utc::now().timestamp())
    {
        return false;
    }
    let Ok(url) = url::Url::parse(&params.approval_url) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() == format!("/connections/requests/{}", params.request_id)
        && url.query() == Some(format!("environment={}", params.environment).as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_approval_requires_the_exact_request_environment_and_deadline() {
        let mut params = ConnectionAuthorizeParams {
            thread_id: "thread".into(),
            request_id: "irq_original".into(),
            approval_url:
                "https://console.test/connections/requests/irq_original?environment=sandbox".into(),
            expires_at: (chrono::Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
            environment: "sandbox".into(),
        };
        assert!(valid_approval(&params));
        for url in ["http://localhost/connections/requests/irq_original?environment=sandbox","https://console.test/connections/requests/other?environment=sandbox","https://console.test/connections/requests/irq_original?environment=production","https://console.test/connections/requests/irq_original?environment=sandbox&return_url=https://else.test","https://console.test/connections/requests/irq_original?environment=sandbox#done","https://user:password@console.test/connections/requests/irq_original?environment=sandbox"] {
            params.approval_url=url.into();assert!(!valid_approval(&params),"{url}");
        }
    }
}
