use super::{RuntimeCore, RuntimeCoreError};
use crate::market::{self, selection::Selection, wire, Context};
use app_server_protocol::protocol::v2::*;
use std::collections::BTreeSet;

impl RuntimeCore {
    pub async fn market_reconcile(
        &self,
        params: MarketReconcileParams,
    ) -> Result<MarketReconcileResponse, RuntimeCoreError> {
        self.app_data_source
            .reconcile_market_resources(params)
            .await
    }

    pub async fn market_install_cancel(
        &self,
        params: MarketInstallCancelParams,
    ) -> Result<MarketInstallCancelResponse, RuntimeCoreError> {
        self.app_data_source.cancel_market_install(params).await
    }

    pub async fn market_pending(
        &self,
        params: MarketPendingParams,
    ) -> Result<MarketPendingResponse, RuntimeCoreError> {
        self.app_data_source
            .list_pending_market_installs(params)
            .await
    }

    pub async fn market_list(
        &self,
        params: MarketListParams,
    ) -> Result<MarketListResponse, RuntimeCoreError> {
        let context = Context::current(self.account_manager.as_deref(), &self.app_config_path)?
            .ok_or_else(login_required)?;
        let limit = params.limit.unwrap_or(30);
        if !(1..=50).contains(&limit)
            || params
                .query
                .as_ref()
                .is_some_and(|v| v.len() > 1000 || v.chars().any(char::is_control))
            || params
                .cursor
                .as_ref()
                .is_some_and(|v| v.len() > 1024 || v.chars().any(char::is_control))
        {
            return Err(RuntimeCoreError::InvalidRequest(
                "invalid_market_query".into(),
            ));
        }
        let path = {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query
                .append_pair("kind", params.kind.as_str())
                .append_pair("limit", &limit.to_string())
                .append_pair("hostId", "lime")
                .append_pair("hostVersion", env!("CARGO_PKG_VERSION"));
            for capability in wire::CAPABILITIES {
                query.append_pair("capability", capability);
            }
            if let Some(value) = params.query {
                query.append_pair("query", &value);
            }
            if let Some(value) = params.cursor {
                query.append_pair("cursor", &value);
            }
            format!("/market/items?{}", query.finish())
        };
        let page: wire::Directory = context.get(&path).await?;
        if page.items.len() > limit as usize || page.next_cursor.len() > 1024 {
            return Err(invalid_response());
        }
        let installed = self
            .app_data_source
            .list_installed_market_resources(MarketInstalledParams {
                kind: Some(params.kind),
            })
            .await?;
        let mut ids = BTreeSet::new();
        let mut resources = Vec::new();
        let Account::Cloud { environment, .. } = &context.account;
        for item in page.items {
            if item.kind != params.kind.as_str()
                || item.environment != *environment
                || !ids.insert(item.id.clone())
            {
                return Err(invalid_response());
            }
            let installation = installed
                .resources
                .iter()
                .find(|r| r.item_id == item.id && r.kind == params.kind)
                .and_then(|r| r.installation.clone());
            resources.push(market::projection::resource(
                &Selection {
                    release: item.release.clone(),
                    item,
                },
                &context.language,
                installation,
            )?);
        }
        context.ensure_current()?;
        Ok(MarketListResponse {
            resources,
            next_cursor: (!page.next_cursor.is_empty()).then_some(page.next_cursor),
        })
    }

    pub async fn market_read(
        &self,
        params: MarketReadParams,
    ) -> Result<MarketReadResponse, RuntimeCoreError> {
        let context = Context::current(self.account_manager.as_deref(), &self.app_config_path)?
            .ok_or_else(login_required)?;
        let selection = context
            .select_item(&params.item_id, params.release.as_ref())
            .await?;
        if selection.item.kind != params.kind.as_str() {
            return Err(RuntimeCoreError::InvalidRequest(
                "market_resource_type_mismatch".into(),
            ));
        }
        let installed = self
            .app_data_source
            .list_installed_market_resources(MarketInstalledParams {
                kind: Some(params.kind),
            })
            .await?;
        let installation = installed
            .resources
            .into_iter()
            .find(|r| r.item_id == params.item_id)
            .and_then(|r| r.installation);
        context.ensure_current()?;
        Ok(MarketReadResponse {
            resource: market::projection::resource(&selection, &context.language, installation)?,
        })
    }

    pub async fn market_installed(
        &self,
        params: MarketInstalledParams,
    ) -> Result<MarketInstalledResponse, RuntimeCoreError> {
        self.app_data_source
            .list_installed_market_resources(params)
            .await
    }

    pub async fn market_install(
        &self,
        params: MarketInstallParams,
    ) -> Result<MarketInstallResponse, RuntimeCoreError> {
        self.backend.invalidate_mcp_runtimes().await;
        let result = self.app_data_source.install_market_resource(params).await;
        if result.is_ok() {
            self.backend.invalidate_mcp_runtimes().await;
            lime_skills::invalidate_agent_skill_snapshot_cache();
        }
        result
    }

    pub async fn market_enabled_set(
        &self,
        params: MarketEnabledSetParams,
    ) -> Result<MarketEnabledSetResponse, RuntimeCoreError> {
        self.backend.invalidate_mcp_runtimes().await;
        let result = self
            .app_data_source
            .set_market_resource_enabled(params)
            .await;
        if result.is_ok() {
            self.backend.invalidate_mcp_runtimes().await;
            lime_skills::invalidate_agent_skill_snapshot_cache();
        }
        result
    }

    pub async fn market_uninstall(
        &self,
        params: MarketUninstallParams,
    ) -> Result<MarketUninstallResponse, RuntimeCoreError> {
        self.backend.invalidate_mcp_runtimes().await;
        let result = self.app_data_source.uninstall_market_resource(params).await;
        if result.is_ok() {
            self.backend.invalidate_mcp_runtimes().await;
            lime_skills::invalidate_agent_skill_snapshot_cache();
        }
        result
    }
}

fn login_required() -> RuntimeCoreError {
    RuntimeCoreError::InvalidRequest("account_login_required".into())
}
fn invalid_response() -> RuntimeCoreError {
    RuntimeCoreError::Backend("invalid_market_response".into())
}
