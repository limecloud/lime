use crate::runtime::RuntimeCoreError;
use app_server_protocol::protocol::v2::{
    Account, CloudRequestMethod, CloudRequestParams, GetAccountParams,
};
use serde::de::DeserializeOwned;

pub(crate) mod bundle;
pub(crate) mod wire;

pub(crate) struct Context<'a> {
    manager: &'a crate::account::AccountManager,
    pub(crate) account: Account,
    pub(crate) language: String,
}

impl<'a> Context<'a> {
    pub(crate) fn current(
        manager: Option<&'a crate::account::AccountManager>,
        config_path: &std::path::Path,
    ) -> Result<Option<Self>, RuntimeCoreError> {
        let Some(manager) = manager else {
            return Ok(None);
        };
        let account = manager
            .read(GetAccountParams::default())
            .map_err(RuntimeCoreError::Backend)?
            .account;
        let language = lime_core::config::ConfigManager::load(config_path)
            .map_err(|_| RuntimeCoreError::Backend("plugin settings unavailable".into()))?
            .config()
            .language
            .clone();
        let language = if language == "auto" {
            std::env::var("LANG")
                .ok()
                .map(|v| v.split('.').next().unwrap_or("en-US").replace('_', "-"))
                .filter(|v| v.len() > 1)
                .unwrap_or_else(|| "en-US".into())
        } else {
            language
        };
        Ok(account.map(|account| Self {
            manager,
            account,
            language,
        }))
    }

    pub(crate) fn ensure_current(&self) -> Result<(), RuntimeCoreError> {
        let current = self
            .manager
            .read(Default::default())
            .map_err(RuntimeCoreError::Backend)?
            .account;
        let same = current.is_some_and(|current| {
            let Account::Cloud { generation: a, .. } = &current;
            let Account::Cloud { generation: b, .. } = &self.account;
            a == b
                && crate::account::AccountManager::plugin_identity_for(&current)
                    == crate::account::AccountManager::plugin_identity_for(&self.account)
        });
        if same {
            Ok(())
        } else {
            Err(RuntimeCoreError::InvalidRequest("account_changed".into()))
        }
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, RuntimeCoreError> {
        self.call(path, CloudRequestMethod::Get, None, None, None)
            .await
    }

    pub(crate) async fn command<T: DeserializeOwned>(
        &self,
        path: &str,
        input: serde_json::Value,
        key: &str,
        task: &str,
    ) -> Result<T, RuntimeCoreError> {
        let response = self
            .manager
            .request(CloudRequestParams {
                path: path.into(),
                method: CloudRequestMethod::Post,
                body: Some(input),
                language: self.language.clone(),
                operation_key: Some(key.into()),
                task_id: Some(task.into()),
            })
            .await
            .map_err(RuntimeCoreError::Backend)?;
        self.ensure_current()?;
        if (200..300).contains(&response.status) {
            return serde_json::from_value(response.body).map_err(|_| invalid());
        }
        let error = response.body.get("error").and_then(|v| v.as_str());
        if !matches!(
            error,
            Some("outcome_unknown" | "operation_already_dispatched")
        ) {
            return Err(RuntimeCoreError::Backend(format!(
                "shared market request failed (HTTP {})",
                response.status
            )));
        }
        if let Some(operation) = response.operation {
            // A prior dispatch is recovered with GET. It is never submitted again.
            let result: serde_json::Value = self.get(&operation.recovery_path).await?;
            return serde_json::from_value(result.get("result").cloned().ok_or_else(invalid)?)
                .map_err(|_| invalid());
        }
        Err(invalid())
    }

    async fn call<T: DeserializeOwned>(
        &self,
        path: &str,
        method: CloudRequestMethod,
        body: Option<serde_json::Value>,
        operation_key: Option<String>,
        task_id: Option<String>,
    ) -> Result<T, RuntimeCoreError> {
        self.ensure_current()?;
        let response = self
            .manager
            .request(CloudRequestParams {
                path: path.into(),
                method,
                body,
                language: self.language.clone(),
                operation_key,
                task_id,
            })
            .await
            .map_err(RuntimeCoreError::Backend)?;
        self.ensure_current()?;
        if !(200..300).contains(&response.status) {
            return Err(RuntimeCoreError::Backend(format!(
                "shared market request failed (HTTP {})",
                response.status
            )));
        }
        serde_json::from_value(response.body).map_err(|_| invalid())
    }
}
fn invalid() -> RuntimeCoreError {
    RuntimeCoreError::Backend("invalid shared market response".into())
}
