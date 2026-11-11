use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    CloudRequestParams, CloudRequestResponse, GetAccountParams, GetAccountResponse,
    LoginAccountParams, LoginAccountResponse, LogoutAccountResponse,
};
use std::path::Path;
use std::sync::Arc;

impl RuntimeCore {
    pub async fn request_cloud_desktop(
        &self,
        params: app_server_protocol::protocol::v2::CloudDesktopParams,
    ) -> Result<app_server_protocol::protocol::v2::CloudDesktopResponse, RuntimeCoreError> {
        let roots = self.storage_roots.as_ref().ok_or_else(|| RuntimeCoreError::Backend("Cloud desktop storage is not configured".into()))?;
        lime_services::cloud_desktop_service::CloudDesktopService::new(roots.app_data_root.join("cloud-desktops"))
            .request(params).await.map_err(RuntimeCoreError::Backend)
    }

    pub fn with_account_store_root(mut self, app_data_root: impl AsRef<Path>) -> Self {
        self.account_manager = Some(Arc::new(crate::account::AccountManager::new(
            app_data_root.as_ref(),
        )));
        self
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

    pub fn read_account(
        &self,
        params: GetAccountParams,
    ) -> Result<GetAccountResponse, RuntimeCoreError> {
        self.account_manager()?
            .read(params)
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
