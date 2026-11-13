use super::{store, AccountManager};
use app_server_protocol::protocol::v2::{CloudRequestMethod, CloudRequestParams};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProductUser {
    id: String,
    status: String,
    revision: u64,
    created_at: String,
}

impl AccountManager {
    /// Product membership is owned by Core. Read it before the first product
    /// operation; an interrupted registration only resumes the saved command.
    pub(super) async fn ensure_product_user(
        &self,
        language: &str,
        epoch: &str,
    ) -> Result<(), String> {
        let params = |path: String, method, body, operation_key, task_id| CloudRequestParams {
            path,
            method,
            body,
            operation_key,
            task_id,
            language: language.into(),
        };
        let mut response = self
            .dispatch(
                params(
                    "/product-users/self".into(),
                    CloudRequestMethod::Get,
                    None,
                    None,
                    None,
                ),
                epoch,
            )
            .await?;
        if response.status == 404 && response.body["error"] == "product_user_not_found" {
            // Only the first registration needs serialization. Another process
            // may finish the same original command while this caller waits.
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
            let _lease = loop {
                if store::load(&self.path)?.epoch != epoch {
                    return Err("account_changed".into());
                }
                if let Some(lease) =
                    store::try_lock(&self.path.with_file_name("product-user.lock"))?
                {
                    break lease;
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err("product_user_unavailable".into());
                }
                super::continuation::wait(None, None).await?;
            };
            response = self
                .dispatch(
                    params(
                        "/product-users/self".into(),
                        CloudRequestMethod::Get,
                        None,
                        None,
                        None,
                    ),
                    epoch,
                )
                .await?;
            if response.status == 404 && response.body["error"] == "product_user_not_found" {
                let key = format!(
                    "product-user-{}",
                    Self::plugin_identity_for(&response.account)
                );
                response = self
                    .dispatch(
                        params(
                            "/product-users".into(),
                            CloudRequestMethod::Post,
                            Some(serde_json::json!({})),
                            Some(key),
                            Some("product-registration".into()),
                        ),
                        epoch,
                    )
                    .await?;
            }
        }
        if response.status != 200 {
            return Err(match response.body["error"].as_str() {
                Some("product_user_disabled") => "product_user_disabled",
                Some("outcome_unknown" | "operation_already_dispatched") => "outcome_unknown",
                _ => "product_user_unavailable",
            }
            .into());
        }
        let user: ProductUser =
            serde_json::from_value(response.body).map_err(|_| "product_user_invalid")?;
        if !super::cloud::identifier(&user.id)
            || user.status != "active"
            || user.revision == 0
            || chrono::DateTime::parse_from_rfc3339(&user.created_at).is_err()
        {
            return Err("product_user_invalid".into());
        }
        Ok(())
    }
}
