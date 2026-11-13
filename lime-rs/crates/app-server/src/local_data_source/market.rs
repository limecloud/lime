use crate::account::AccountManager;
use crate::market::{self, selection::Selection, Context};
use app_server_protocol::protocol::v2::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

mod attempts;
mod components;
mod io;
mod lifecycle;
mod reconcile;

#[derive(Clone)]
pub(super) struct MarketStore {
    root: PathBuf,
    pub config_path: PathBuf,
    pub account: Option<Arc<AccountManager>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Installation {
    schema_version: u8,
    account_id: String,
    selection: Selection,
    acquisition_id: String,
    enabled: bool,
}

impl MarketStore {
    pub fn new(root: PathBuf, config_path: PathBuf, account: Option<Arc<AccountManager>>) -> Self {
        Self {
            root,
            config_path,
            account,
        }
    }

    fn context(&self) -> Result<Option<Context<'_>>, String> {
        Context::current(self.account.as_deref(), &self.config_path).map_err(|e| e.to_string())
    }

    fn account_root(&self, context: &Context<'_>) -> Result<PathBuf, String> {
        let root = self
            .root
            .join(AccountManager::plugin_identity_for(&context.account));
        io::directory(&self.root)?;
        io::directory(&root)?;
        Ok(root)
    }

    fn base(
        &self,
        context: &Context<'_>,
        kind: MarketResourceKind,
        item_id: &str,
    ) -> Result<PathBuf, String> {
        if !market::wire::identifier(item_id) {
            return Err("invalid_market_item".into());
        }
        let root = self.account_root(context)?.join(kind.as_str());
        io::directory(&root)?;
        Ok(root.join(item_id))
    }

    fn read(
        &self,
        context: &Context<'_>,
        kind: MarketResourceKind,
        item_id: &str,
    ) -> Result<Installation, String> {
        let base = self.base(context, kind, item_id)?;
        io::existing_directory(&base)?;
        let record: Installation = io::read_json(&base.join("installation.json"))?;
        record.selection.validate().map_err(|e| e.to_string())?;
        let Account::Cloud { environment, .. } = &context.account;
        if record.schema_version != 1
            || record.account_id != AccountManager::plugin_identity_for(&context.account)
            || record.selection.item.environment != *environment
            || record.selection.item.id != item_id
            || record.selection.release.manifest.kind != kind.as_str()
            || !market::wire::identifier(&record.acquisition_id)
        {
            return Err("invalid_market_installation".into());
        }
        market::archive::verify_directory(&base.join("package"), &record.selection.release)?;
        components::validate(&base.join("package"), &record.selection.release)?;
        Ok(record)
    }

    fn summary(
        &self,
        context: &Context<'_>,
        record: &Installation,
    ) -> Result<MarketResource, String> {
        let kind = components::kind(&record.selection)?;
        market::projection::resource(
            &record.selection,
            &context.language,
            Some(MarketInstallation {
                release: record.selection.release.reference(),
                version: record.selection.release.manifest.version.clone(),
                enabled: record.enabled,
                mcp_server_name: (kind == MarketResourceKind::Mcp)
                    .then(|| components::mcp_name(&record.account_id, &record.selection.release)),
            }),
        )
        .map_err(|e| e.to_string())
    }

    fn records(
        &self,
        context: &Context<'_>,
        filter: Option<MarketResourceKind>,
    ) -> Result<(Vec<Installation>, Vec<MarketResourceError>), String> {
        let mut records = Vec::new();
        let mut errors = Vec::new();
        for kind in [MarketResourceKind::Skill, MarketResourceKind::Mcp] {
            if filter.is_some_and(|v| v != kind) {
                continue;
            }
            let root = self.account_root(context)?.join(kind.as_str());
            if !root.exists() {
                continue;
            }
            io::existing_directory(&root)?;
            for entry in std::fs::read_dir(root).map_err(|_| "market_store_unavailable")? {
                let entry = entry.map_err(|_| "market_store_unavailable")?;
                let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if id.starts_with('.') {
                    continue;
                }
                match self.read(context, kind, &id) {
                    Ok(record) => records.push(record),
                    Err(_) => errors.push(MarketResourceError {
                        item_id: id,
                        kind,
                        error: "invalid_market_installation".into(),
                    }),
                }
            }
        }
        records.sort_by(|a, b| a.selection.item.id.cmp(&b.selection.item.id));
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok((records, errors))
    }

    pub fn installed(
        &self,
        params: MarketInstalledParams,
    ) -> Result<MarketInstalledResponse, String> {
        let Some(context) = self.context()? else {
            return Ok(MarketInstalledResponse {
                resources: Vec::new(),
                errors: Vec::new(),
            });
        };
        let (records, errors) = self.records(&context, params.kind)?;
        let resources = records
            .iter()
            .map(|r| self.summary(&context, r))
            .collect::<Result<_, _>>()?;
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(MarketInstalledResponse { resources, errors })
    }
}
