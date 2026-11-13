use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    CloudRequestParams, CloudRequestResponse, GetAccountParams, GetAccountResponse,
    LoginAccountParams, LoginAccountResponse, LogoutAccountResponse,
};
use std::path::Path;
use std::sync::Arc;

impl RuntimeCore {
    pub(crate) fn set_account_host(&self, host: crate::host_request::HostRequestRouter) {
        if let Some(manager) = &self.account_manager {
            manager.set_host_requests(host);
        }
    }
    pub async fn request_cloud_desktop(
        &self,
        params: app_server_protocol::protocol::v2::CloudDesktopParams,
    ) -> Result<app_server_protocol::protocol::v2::CloudDesktopResponse, RuntimeCoreError> {
        use app_server_protocol::protocol::v2::{CloudDesktopParams as P, CloudDesktopResponse};
        let data = match params {
            P::PrepareModelConnection { operation_id } => {
                self.app_data_source
                    .prepare_model_connection(&operation_id)
                    .await?
            }
            P::ReadModelConnection { operation_id } => {
                self.app_data_source
                    .read_model_connection(&operation_id)
                    .await?
            }
            P::SealModelConnection {
                operation_id,
                recipient,
                expires_at,
                provider_id,
                key_id,
            } => {
                self.app_data_source
                    .seal_model_connection(
                        &operation_id,
                        &recipient,
                        expires_at,
                        &provider_id,
                        &key_id,
                    )
                    .await?
            }
            P::ApplyModelConnection {
                operation_id,
                ciphertext,
            } => {
                self.app_data_source
                    .apply_model_connection(&operation_id, &ciphertext)
                    .await?
            }
            params => {
                let roots = self.storage_roots.as_ref().ok_or_else(|| {
                    RuntimeCoreError::Backend("Cloud desktop storage is not configured".into())
                })?;
                return lime_services::cloud_desktop_service::CloudDesktopService::new(
                    roots.app_data_root.join("cloud-desktops"),
                )
                .request(params)
                .await
                .map_err(RuntimeCoreError::Backend);
            }
        };
        Ok(CloudDesktopResponse { data })
    }

    pub fn with_account_store_root(mut self, app_data_root: impl AsRef<Path>) -> Self {
        let manager = Arc::new(crate::account::AccountManager::new(
            app_data_root.as_ref(),
            &self.app_config_path,
        ));
        self.backend
            .set_account_tools(manager.tool_registrations())
            .expect("native account tool configuration");
        self.account_manager = Some(manager);
        self
    }

    pub(super) fn set_account_config_path(&mut self) {
        if let Some(manager) = &mut self.account_manager {
            Arc::make_mut(manager).set_config_path(self.app_config_path.clone());
            self.backend
                .set_account_tools(manager.tool_registrations())
                .expect("native account tool configuration");
        }
    }

    fn account_manager(&self) -> Result<&crate::account::AccountManager, RuntimeCoreError> {
        self.account_manager.as_deref().ok_or_else(|| {
            RuntimeCoreError::Backend("account storage is not configured".to_string())
        })
    }

    pub async fn login_account(
        &self,
        params: LoginAccountParams,
    ) -> Result<LoginAccountResponse, RuntimeCoreError> {
        self.account_manager()?
            .login(params)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    pub async fn read_account(
        &self,
        params: GetAccountParams,
    ) -> Result<GetAccountResponse, RuntimeCoreError> {
        self.account_manager()?
            .read_verified(params)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    pub async fn request_cloud(
        &self,
        params: CloudRequestParams,
    ) -> Result<CloudRequestResponse, RuntimeCoreError> {
        self.account_manager()?
            .request(params)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    pub fn logout_account(&self) -> Result<LogoutAccountResponse, RuntimeCoreError> {
        self.account_manager()?
            .logout()
            .map_err(RuntimeCoreError::Backend)
    }
}
