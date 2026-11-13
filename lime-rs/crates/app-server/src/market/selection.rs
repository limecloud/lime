use super::{wire, Context, RuntimeCoreError};
use app_server_protocol::protocol::v2::MarketReleaseReference;
use serde::{Deserialize, Serialize};

mod dependencies;
pub(crate) use dependencies::validate_dependencies;

/// Keep the visible item and selected artifact separate: a selection may be older.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    pub item: wire::Item,
    pub release: wire::Release,
}

impl Selection {
    pub(crate) fn validate(&self) -> Result<(), RuntimeCoreError> {
        self.item.validate()?;
        self.release.validate()?;
        if self.item.id != self.release.item_id || self.item.kind != self.release.manifest.kind {
            return Err(invalid());
        }
        Ok(())
    }

    pub(crate) fn validate_plugin(&self) -> Result<(), RuntimeCoreError> {
        self.validate()?;
        if self.release.manifest.kind != "plugin" {
            return Err(invalid());
        }
        Ok(())
    }

    pub(crate) fn compatible(&self) -> bool {
        self.release.compatible()
            && (self.release.id != self.item.release.id
                || self.item.compatibility.status == "supported")
    }
}

impl wire::Release {
    pub(crate) fn reference(&self) -> MarketReleaseReference {
        MarketReleaseReference {
            id: self.id.clone(),
            manifest_sha256: self.manifest_sha256.clone(),
            archive_sha256: self.archive_sha256.clone(),
        }
    }
}

impl Context<'_> {
    pub(crate) async fn select(
        &self,
        item_id: &str,
        marketplace: Option<&str>,
        reference: Option<&MarketReleaseReference>,
    ) -> Result<Selection, RuntimeCoreError> {
        let selection = self.select_item(item_id, reference).await?;
        if marketplace != Some(selection.item.marketplace().as_str()) {
            return Err(invalid());
        }
        Ok(selection)
    }

    pub(crate) async fn select_item(
        &self,
        item_id: &str,
        reference: Option<&MarketReleaseReference>,
    ) -> Result<Selection, RuntimeCoreError> {
        wire::validate_remote_id(item_id)?;
        if let Some(reference) = reference {
            if !wire::identifier(&reference.id)
                || !wire::digest(&reference.manifest_sha256)
                || !wire::digest(&reference.archive_sha256)
            {
                return Err(invalid());
            }
        }
        let item: wire::Item = self
            .get(&format!("/market/items/{item_id}?{}", wire::host_query()))
            .await?;
        item.validate()?;
        if item.id != item_id {
            return Err(invalid());
        }
        let release = match reference {
            Some(reference) if reference.id != item.release.id => {
                self.get(&format!("/market/releases/{}", reference.id))
                    .await?
            }
            _ => item.release.clone(),
        };
        let selection = Selection { item, release };
        selection.validate()?;
        let app_server_protocol::protocol::v2::Account::Cloud { environment, .. } = &self.account;
        if selection.item.environment != *environment {
            return Err(invalid());
        }
        if reference.is_some_and(|value| *value != selection.release.reference()) {
            return Err(invalid());
        }
        Ok(selection)
    }
}

fn invalid() -> RuntimeCoreError {
    RuntimeCoreError::Backend("shared plugin release mismatch".into())
}
