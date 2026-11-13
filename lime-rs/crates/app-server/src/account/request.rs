use super::{
    billing, cloud, credentials::ensure_credential, oauth::validate_language,
    operations::Operation, recovery, store, AccountManager,
};
use app_server_protocol::protocol::v2::{
    Account, CloudOperationReference, CloudRequestMethod, CloudRequestParams, CloudRequestResponse,
    CloudResource,
};

impl AccountManager {
    pub(crate) async fn request(
        &self,
        params: CloudRequestParams,
    ) -> Result<CloudRequestResponse, String> {
        let epoch = store::load(&self.path)?.epoch;
        self.request_for_generation(params, &epoch).await
    }

    /// A host task keeps the account generation captured before its first read.
    /// Credential resolution still performs the final fence before dispatch.
    pub(crate) async fn request_for_generation(
        &self,
        params: CloudRequestParams,
        epoch: &str,
    ) -> Result<CloudRequestResponse, String> {
        validate_language(&params.language)?;
        if store::load(&self.path)?.epoch != epoch {
            return Err("account_changed".into());
        }
        if !params.path.starts_with("/operations/") {
            route(&params.path, params.method)?;
            if params.path.starts_with("/catalog/")
                || params.path.starts_with("/market/")
                || params.path.starts_with("/web/")
                || params.path.starts_with("/connections/")
                || params.path.starts_with("/connection-")
            {
                self.ensure_product_user(&params.language, epoch).await?;
            }
        }
        self.dispatch(params, epoch).await
    }

    pub(super) async fn dispatch(
        &self,
        params: CloudRequestParams,
        expected_epoch: &str,
    ) -> Result<CloudRequestResponse, String> {
        self.dispatch_with_cancel(params, expected_epoch, None)
            .await
    }

    pub(super) async fn dispatch_with_cancel(
        &self,
        params: CloudRequestParams,
        expected_epoch: &str,
        cancel: Option<&tokio_util::sync::CancellationToken>,
    ) -> Result<CloudRequestResponse, String> {
        validate_language(&params.language)?;
        // Native operation reads restore the original task and input; they never
        // dispatch a Cloud request or import a caller-supplied credential.
        if let Some(key) = params.path.strip_prefix("/operations/") {
            if params.method != CloudRequestMethod::Get
                || params.body.is_some()
                || params.operation_key.is_some()
                || params.task_id.is_some()
            {
                return Err("cloud_request_invalid".into());
            }
            return store::with_lock(&self.path, || {
                let account = self
                    .read(Default::default())?
                    .account
                    .ok_or("account_login_required")?;
                let value = self.operation(&account, key)?;
                Ok(CloudRequestResponse {
                    account,
                    status: if value.is_some() { 200 } else { 404 },
                    body: serde_json::to_value(value).map_err(|_| "operation_store_invalid")?,
                    operation: None,
                })
            });
        }
        let (resource, recovery_prefix) = route(&params.path, params.method)?;
        let post = params.method == CloudRequestMethod::Post;
        if post != params.body.is_some()
            || !post && (params.operation_key.is_some() || params.task_id.is_some())
        {
            return Err("cloud_request_invalid".into());
        }
        // Resolve the private original before credential refresh or any network access.
        let summary_original = if params.path.starts_with("/recovery/") {
            Some(self.recovery_operation(&params.path)?)
        } else {
            None
        };
        let operation = if post {
            let key = params
                .operation_key
                .as_deref()
                .ok_or("operation_key_required")?;
            let task_id = params.task_id.as_deref().ok_or("task_id_required")?;
            if task_id.is_empty() || task_id.len() > 256 || task_id.chars().any(char::is_control) {
                return Err("task_id_invalid".into());
            }
            let input = params.body.clone().ok_or("cloud_request_invalid")?;
            if !input.is_object()
                || serde_json::to_vec(&input)
                    .map_err(|_| "cloud_request_invalid")?
                    .len()
                    > 128 * 1024
            {
                return Err("cloud_request_invalid".into());
            }
            let recovery_path = if recovery_prefix == "/product-users/self" {
                recovery_prefix.into()
            } else {
                format!("{recovery_prefix}{key}")
            };
            Some(Operation {
                key: key.into(),
                task_id: task_id.into(),
                path: params.path.clone(),
                input,
                language: params.language.clone(),
                recovery_path,
                status: "outcome_unknown".into(),
                rejection_code: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            })
        } else {
            None
        };
        if let Some(value) = &operation {
            // A saved dispatch is recovered locally even when the resource
            // token expired or its rotating refresh result is unknown.
            let previous = store::with_lock(&self.path, || {
                let metadata = self
                    .read(Default::default())?
                    .account
                    .ok_or("account_login_required")?;
                let Some(original) = self.operation(&metadata, &value.key)? else {
                    return Ok(None);
                };
                if original.task_id != value.task_id
                    || original.path != value.path
                    || original.input != value.input
                {
                    return Err("operation_key_conflict".into());
                }
                Ok(Some(duplicate(metadata, &original)))
            })?;
            if let Some(previous) = previous {
                return Ok(previous);
            }
        }
        let (epoch, account, credential) = self.credential(resource, &params.language).await?;
        if epoch != expected_epoch {
            return Err("account_changed".into());
        }
        let Account::Cloud { base_url, .. } = &account;
        if cancel.is_some_and(|token| token.is_cancelled()) {
            return Err("cloud_tool_cancelled".into());
        }
        if let Some(operation) = &operation {
            if !self.begin_operation(&account, &epoch, operation)? {
                let original = self
                    .operation(&account, &operation.key)?
                    .ok_or("operation_store_invalid")?;
                let metadata = self
                    .read(Default::default())?
                    .account
                    .ok_or("account_changed")?;
                return Ok(duplicate(metadata, &original));
            }
        }
        let method = if post {
            reqwest::Method::POST
        } else {
            reqwest::Method::GET
        };
        let mut request = self
            .http(base_url)?
            .request(
                method,
                format!("{base_url}{}{}", cloud::PREFIX, params.path),
            )
            .header("Accept", "application/json")
            .header("Accept-Language", &params.language)
            .bearer_auth(&credential.tokens.access_token);
        if let Some(value) = &operation {
            request = request
                .header("Idempotency-Key", &value.key)
                .json(&value.input);
        }
        let result = async {
            let response = request.send().await.map_err(|_| "cloud_unavailable")?;
            if response.status().is_redirection() {
                return Err("cloud_response_invalid");
            }
            let status = response.status().as_u16();
            let bytes = cloud::response_bytes(response)
                .await
                .map_err(|_| "cloud_unavailable")?;
            let body: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "cloud_response_invalid")?;
            let state = store::load(&self.path).map_err(|_| "account_store_unavailable")?;
            for token in state
                .credentials
                .values()
                .flat_map(|c| {
                    [
                        Some(c.tokens.access_token.as_str()),
                        c.tokens.refresh_token.as_deref(),
                        c.tokens.id_token.as_deref(),
                    ]
                })
                .flatten()
            {
                if contains_credential(&body, token) {
                    return Err("cloud_response_invalid");
                }
            }
            Ok((status, body))
        }
        .await;
        let (status, body) = match result {
            Ok(value) => value,
            Err(error) if !post => return Err(error.into()),
            Err(_) => (502, serde_json::json!({"error":"outcome_unknown"})),
        };
        if status == 200 {
            if let Some(original) = &summary_original {
                recovery::validate_summary(original, &body)?;
            }
        }
        // Publication and journal updates share the same short local lock.
        // Logout or refresh cannot replace identity between the final fence and
        // the metadata projection. No network request is made under this lock.
        store::with_lock(&self.path, || {
            ensure_credential(
                &store::load(&self.path)?,
                &epoch,
                resource,
                &credential.tokens.access_token,
            )?;
            let mut operation = operation;
            if !post && status == 200 && summary_original.is_none() {
                if let Some(key) = params
                    .path
                    .rsplit('/')
                    .next()
                    .filter(|key| operation_key(key))
                {
                    if let Some(mut saved) = self.operation(&account, key)? {
                        if saved.recovery_path == params.path {
                            if saved.status != "resolved" {
                                saved.status = result_status(&body).into();
                            }
                            self.save_operation(&account, &saved)?;
                            operation = Some(saved);
                        }
                    }
                }
            }
            if post {
                if let Some(value) = &mut operation {
                    value.rejection_code =
                        billing::rejection(&value.path, status, &body).map(str::to_owned);
                    value.status = if value.rejection_code.is_some() {
                        "rejected"
                    } else if (200..300).contains(&status) {
                        result_status(&body)
                    } else {
                        "outcome_unknown"
                    }
                    .into();
                    self.save_operation(&account, value)?;
                }
            }
            let metadata = self
                .read(Default::default())?
                .account
                .ok_or("account_changed")?;
            Ok(CloudRequestResponse {
                account: metadata,
                status,
                body,
                operation: operation.as_ref().map(reference),
            })
        })
    }
}

fn duplicate(account: Account, value: &Operation) -> CloudRequestResponse {
    if let Some(code) = value
        .rejection_code
        .as_deref()
        .filter(|code| value.status == "rejected" && billing::budget_error(code))
    {
        return CloudRequestResponse {
            account,
            status: 409,
            body: serde_json::json!({"error":code}),
            operation: Some(reference(value)),
        };
    }
    let resolved = value.status == "resolved";
    CloudRequestResponse {
        account,
        status: if resolved { 409 } else { 502 },
        body: serde_json::json!({"error": if resolved { "operation_already_dispatched" } else { "outcome_unknown" }}),
        operation: Some(reference(value)),
    }
}

fn result_status(body: &serde_json::Value) -> &'static str {
    if body
        .get("status")
        .and_then(|v| v.as_str())
        .is_some_and(|s| matches!(s, "running" | "outcome_unknown"))
    {
        "outcome_unknown"
    } else {
        "resolved"
    }
}

fn reference(value: &Operation) -> CloudOperationReference {
    CloudOperationReference {
        key: value.key.clone(),
        task_id: value.task_id.clone(),
        recovery_path: value.recovery_path.clone(),
        status: value.status.clone(),
    }
}

fn route(path: &str, method: CloudRequestMethod) -> Result<(CloudResource, &'static str), String> {
    if path.len() > 8192
        || !path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['\\', '#'])
        || path.chars().any(char::is_control)
    {
        return Err("cloud_request_invalid".into());
    }
    let (pathname, query) = path.split_once('?').unwrap_or((path, ""));
    if pathname.starts_with("/recovery/") && path.contains('?') {
        return Err("cloud_request_invalid".into());
    }
    if pathname.contains('%') {
        return Err("cloud_request_invalid".into());
    }
    let parts: Vec<_> = pathname.trim_start_matches('/').split('/').collect();
    if !query.is_empty() {
        let catalog_release = matches!(parts.as_slice(), ["catalog", "skills" | "experts", _])
            && query.strip_prefix("releaseId=").is_some_and(|id| {
                id.len() == 64
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            });
        let market_item = matches!(parts.as_slice(), ["market", "items", id] if cloud::identifier(id))
            && url::form_urlencoded::parse(query.as_bytes())
                .all(|(name, _)| matches!(name.as_ref(), "hostId" | "hostVersion" | "capability"));
        if method != CloudRequestMethod::Get
            || !(pathname == "/market/items" || catalog_release || market_item)
        {
            return Err("cloud_request_invalid".into());
        }
    }
    use CloudRequestMethod::{Get, Post};
    use CloudResource::{Connections, Default, Market, Web};
    let selected = match (method, parts.as_slice()) {
        (
            Get,
            ["account"]
            | ["product-users", "self"]
            | ["catalog", "skills"]
            | ["catalog", "experts"],
        ) => (Default, ""),
        (Get, ["catalog", "skills" | "experts", id])
            if (1..=80).contains(&id.len())
                && id.as_bytes()[0].is_ascii_alphanumeric()
                && id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') =>
        {
            (Default, "")
        }
        (Post, ["product-users"]) => (Default, "/product-users/self"),
        (Get, ["market", "items"] | ["market", "featured"]) => (Market, ""),
        (Get, ["market", "items" | "releases" | "acquisitions", id]) if cloud::identifier(id) => {
            (Market, "")
        }
        (Get, ["market", "operations", key]) if operation_key(key) => (Market, ""),
        (Get, ["recovery", "market", "operations", key]) if operation_key(key) => (Market, ""),
        (Get, ["recovery", "web", "operations", key]) if operation_key(key) => (Web, ""),
        (
            Get,
            ["recovery", "connection-requests" | "connection-file-operations", "operations", key],
        ) if operation_key(key) => (Connections, ""),
        (Post, ["market", "acquisitions"]) => (Market, "/market/operations/"),
        (Post, ["market", "acquisitions", id, "download-tickets" | "revocations"])
            if cloud::identifier(id) =>
        {
            (Market, "/market/operations/")
        }
        (Post, ["web", "searches" | "pages"]) => (Web, "/web/operations/"),
        (Get, ["web", "prices"]) => (Web, ""),
        (Get, ["web", "operations", key]) if operation_key(key) => (Web, ""),
        (Post, ["connection-requests"]) => (Connections, "/connection-requests/operations/"),
        (Get, ["connection-file-prices"]) => (Connections, ""),
        (Get, ["connection-requests" | "connection-file-operations", id])
            if cloud::identifier(id) =>
        {
            (Connections, "")
        }
        (Get, ["connection-requests" | "connection-file-operations", "operations", key])
            if operation_key(key) =>
        {
            (Connections, "")
        }
        (Post, ["connections", id, "file-reads"]) if cloud::identifier(id) => {
            (Connections, "/connection-file-operations/operations/")
        }
        _ => return Err("cloud_route_unavailable".into()),
    };
    Ok(selected)
}

fn operation_key(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn contains_credential(value: &serde_json::Value, token: &str) -> bool {
    match value {
        serde_json::Value::String(text) => text.contains(token),
        serde_json::Value::Array(values) => values.iter().any(|v| contains_credential(v, token)),
        serde_json::Value::Object(values) => values
            .iter()
            .any(|(k, v)| k.contains(token) || contains_credential(v, token)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_item_queries_only_accept_host_metadata_on_read() {
        let path = "/market/items/item_research?hostId=lime&hostVersion=1.0.0&capability=plugins&capability=skills";
        assert_eq!(
            route(path, CloudRequestMethod::Get).unwrap(),
            (CloudResource::Market, "")
        );
        assert!(route(path, CloudRequestMethod::Post).is_err());
        for path in [
            "/market/items/item_research?url=https://untrusted.test",
            "/market/items/item_research?releaseId=another",
            "/market/releases/rel_research?hostId=lime",
            "/market/featured?hostId=lime",
        ] {
            assert!(route(path, CloudRequestMethod::Get).is_err(), "{path}");
        }
    }

    #[test]
    fn product_catalog_routes_use_full_slug_and_only_exact_release_query() {
        let key = format!("a{}", "b".repeat(79));
        let release = "a".repeat(64);
        assert!(route(
            &format!("/catalog/experts/{key}?releaseId={release}"),
            CloudRequestMethod::Get
        )
        .is_ok());
        for path in [
            format!("/catalog/experts/{key}b"),
            "/catalog/experts/Upper".into(),
            "/catalog/skills/../experts".into(),
            format!("/catalog/experts/research?releaseId={release}&other=1"),
            "/catalog/experts/research?releaseId=invalid".into(),
            "/catalog/experts/research?url=https://untrusted.test".into(),
        ] {
            assert!(route(&path, CloudRequestMethod::Get).is_err(), "{path}");
        }
    }
}
