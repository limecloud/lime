use super::*;
use market::package::operation_key;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Attempt {
    pub id: String,
    pub selection: Selection,
}

impl MarketStore {
    pub(super) fn attempt_path(
        &self,
        context: &Context<'_>,
        kind: MarketResourceKind,
        item_id: &str,
    ) -> Result<PathBuf, String> {
        if !market::wire::identifier(item_id) {
            return Err("invalid_market_item".into());
        }
        let root = self.account_root(context)?.join("attempts");
        io::directory(&root)?;
        Ok(root.join(format!("{}-{item_id}.json", kind.as_str())))
    }

    fn read_attempt(
        &self,
        context: &Context<'_>,
        kind: MarketResourceKind,
        item_id: &str,
    ) -> Result<Attempt, String> {
        let attempt: Attempt = io::read_json(&self.attempt_path(context, kind, item_id)?)?;
        attempt.selection.validate().map_err(|e| e.to_string())?;
        let Account::Cloud { environment, .. } = &context.account;
        if !valid_attempt_id(&attempt.id)
            || attempt.selection.item.id != item_id
            || attempt.selection.item.environment != *environment
            || components::kind(&attempt.selection)? != kind
        {
            return Err("invalid_market_install_attempt".into());
        }
        Ok(attempt)
    }

    pub fn pending(&self, params: MarketPendingParams) -> Result<MarketPendingResponse, String> {
        let Some(context) = self.context()? else {
            return Ok(Default::default());
        };
        let mut response = MarketPendingResponse::default();
        let root = self.account_root(&context)?.join("attempts");
        match std::fs::symlink_metadata(&root) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(response),
            _ => io::existing_directory(&root)?,
        }
        for entry in std::fs::read_dir(root).map_err(|_| "market_store_unavailable")? {
            let entry = entry.map_err(|_| "market_store_unavailable")?;
            let name = entry.file_name();
            let Some((prefix, id)) = name
                .to_str()
                .and_then(|n| n.strip_suffix(".json"))
                .and_then(|n| n.split_once('-'))
            else {
                continue;
            };
            let kind = match prefix {
                "skill" => MarketResourceKind::Skill,
                "mcp" => MarketResourceKind::Mcp,
                _ => continue,
            };
            if params.kind.is_some_and(|filter| filter != kind) {
                continue;
            }
            let pending = self.read_attempt(&context, kind, id).and_then(|attempt| {
                Ok(MarketPendingInstall {
                    install_attempt_id: attempt.id,
                    resource: market::projection::resource(
                        &attempt.selection,
                        &context.language,
                        None,
                    )
                    .map_err(|e| e.to_string())?,
                })
            });
            match pending {
                Ok(attempt) => response.attempts.push(attempt),
                Err(_) => response.errors.push(MarketResourceError {
                    item_id: id.into(),
                    kind,
                    error: "invalid_market_install_attempt".into(),
                }),
            }
        }
        response
            .attempts
            .sort_by(|a, b| a.resource.item_id.cmp(&b.resource.item_id));
        response.errors.sort_by(|a, b| a.item_id.cmp(&b.item_id));
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(response)
    }

    pub async fn cancel_install(
        &self,
        params: MarketInstallCancelParams,
    ) -> Result<MarketInstallCancelResponse, String> {
        let context = self.context()?.ok_or("account_login_required")?;
        let _lock = io::lock(&self.account_root(&context)?)?;
        if !valid_attempt_id(&params.install_attempt_id) {
            return Err("invalid_market_install_attempt".into());
        }
        let path = self.attempt_path(&context, params.kind, &params.item_id)?;
        if matches!(std::fs::symlink_metadata(&path), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
        {
            context.ensure_current().map_err(|e| e.to_string())?;
            return Ok(MarketInstallCancelResponse {});
        }
        let attempt = self.read_attempt(&context, params.kind, &params.item_id)?;
        if attempt.id != params.install_attempt_id {
            return Err("market_install_attempt_changed".into());
        }
        let acquire = operation_key(&attempt.id, &params.item_id, "acquire");
        let download = operation_key(&attempt.id, &params.item_id, "download");
        let acquired = context.operation_dispatched(&acquire)?;
        let ticketed = context.operation_dispatched(&download)?;
        if ticketed && !acquired {
            return Err("invalid_market_install_attempt".into());
        }
        if acquired {
            let acquisition_result = receipt(
                &context,
                &acquire,
                "acquisition.create",
                &attempt.selection.release.id,
            )
            .await?;
            let acquisition: market::wire::Acquisition = serde_json::from_value(acquisition_result)
                .map_err(|_| "market_install_outcome_unknown")?;
            if !market::wire::identifier(&acquisition.id)
                || acquisition.release_id != attempt.selection.release.id
                || acquisition.revision == 0
                || !matches!(acquisition.status.as_str(), "active" | "revoked")
            {
                return Err("market_install_outcome_unknown".into());
            }
            if ticketed {
                let receipt =
                    receipt(&context, &download, "acquisition.download", &acquisition.id).await?;
                let ticket: market::wire::Ticket = serde_json::from_value(receipt)
                    .map_err(|_| "market_install_outcome_unknown")?;
                if ticket.sha256 != attempt.selection.release.archive_sha256
                    || ticket.size != attempt.selection.release.archive_size
                    || ticket.download.method != "GET"
                    || chrono::DateTime::parse_from_rfc3339(&ticket.download.expires_at).is_err()
                {
                    return Err("market_install_outcome_unknown".into());
                }
            }
        }
        context.ensure_current().map_err(|e| e.to_string())?;
        std::fs::remove_file(path).map_err(|_| "market_store_unavailable")?;
        Ok(MarketInstallCancelResponse {})
    }
}

async fn receipt(
    context: &Context<'_>,
    key: &str,
    command: &str,
    resource_id: &str,
) -> Result<serde_json::Value, String> {
    let result: serde_json::Value = context
        .get(&format!("/market/operations/{key}"))
        .await
        .map_err(|_| "market_install_outcome_unknown")?;
    if result["command"] != command
        || result["resourceId"] != resource_id
        || result["createdAt"]
            .as_str()
            .is_none_or(|v| chrono::DateTime::parse_from_rfc3339(v).is_err())
    {
        return Err("market_install_outcome_unknown".into());
    }
    result
        .get("result")
        .cloned()
        .ok_or_else(|| "market_install_outcome_unknown".into())
}

pub(super) fn valid_attempt_id(id: &str) -> bool {
    (16..=128).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}
