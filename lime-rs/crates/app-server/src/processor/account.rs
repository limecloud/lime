use super::{
    dispatch_result, parse_params, to_jsonrpc_error, ConnectionRequestId, RequestProcessor,
    RpcDispatch,
};
use app_server_protocol::protocol::v2::{
    AccountUpdatedNotification, CloudRequestParams, GetAccountParams, LoginAccountParams,
    ServerNotification,
};
use app_server_protocol::JsonRpcError;

impl RequestProcessor {
    pub(crate) fn disable_cloud_desktop_local_control(&mut self, authenticated: bool) {
        self.cloud_desktop_local_control = false;
        self.cloud_archive_transfer_enabled = authenticated;
    }

    pub(super) async fn handle_cloud_desktop(
        &self,
        params: Option<serde_json::Value>,
        connection_request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        use app_server_protocol::protocol::v2::{CloudDesktopParams, CloudDesktopResponse};
        let params: CloudDesktopParams = parse_params(params)?;
        let archive_error =
            |message: String| to_jsonrpc_error(crate::RuntimeCoreError::Backend(message));
        let archive_owner = || {
            connection_request
                .as_ref()
                .map(|request| request.connection_id)
                .filter(|_| self.cloud_archive_transfer_enabled)
                .ok_or_else(|| {
                    JsonRpcError::new(
                        app_server_protocol::error_codes::INVALID_REQUEST,
                        "Archive transfer requires an authenticated remote App Server connection",
                    )
                })
        };
        let archive_id = |value: &str| {
            uuid::Uuid::parse_str(value).map_err(|_| {
                JsonRpcError::new(
                    app_server_protocol::error_codes::INVALID_PARAMS,
                    "Invalid cloud archive ID",
                )
            })
        };
        let data = match params {
            CloudDesktopParams::PrepareArchiveDownload {
                source_root,
                paths,
                recipient,
                include_credentials,
                work_saved,
            } => self
                .cloud_archive_downloads
                .prepare(
                    archive_owner()?,
                    super::cloud_archive_download::DownloadSelection {
                        source_root,
                        paths,
                        recipient,
                        include_credentials,
                        work_saved,
                    },
                )
                .await
                .map_err(archive_error)?,
            CloudDesktopParams::ReadArchiveDownload {
                archive_id: id,
                offset,
            } => self
                .cloud_archive_downloads
                .read(archive_owner()?, archive_id(&id)?, offset)
                .map_err(archive_error)?,
            CloudDesktopParams::CloseArchiveDownload { archive_id: id } => {
                serde_json::json!({"closed": self.cloud_archive_downloads.clear(archive_owner()?, Some(archive_id(&id)?))})
            }
            CloudDesktopParams::BeginArchiveRestore { folder_name } => self
                .cloud_archive_restores
                .begin(archive_owner()?, &folder_name)
                .map_err(archive_error)?,
            CloudDesktopParams::WriteArchiveRestore {
                archive_id: id,
                offset,
                data,
            } => self
                .cloud_archive_restores
                .write(archive_owner()?, archive_id(&id)?, offset, &data)
                .map_err(archive_error)?,
            CloudDesktopParams::FinishArchiveRestore {
                archive_id: id,
                sha256,
                bytes,
            } => self
                .cloud_archive_restores
                .finish(archive_owner()?, archive_id(&id)?, sha256, bytes)
                .await
                .map_err(archive_error)?,
            CloudDesktopParams::CancelArchiveRestore { archive_id: id } => {
                serde_json::json!({"closed": self.cloud_archive_restores.clear(archive_owner()?, Some(archive_id(&id)?))})
            }
            params => return self.handle_cloud_desktop_management(params).await,
        };
        dispatch_result(CloudDesktopResponse { data })
    }

    async fn handle_cloud_desktop_management(
        &self,
        params: app_server_protocol::protocol::v2::CloudDesktopParams,
    ) -> Result<RpcDispatch, JsonRpcError> {
        // Cloud account profiles, recovery identities and object-store credentials
        // remain on the local control machine. The remote archive transfer
        // actions above only accept public recipients and encrypted chunks.
        let model_transfer =
            self.cloud_archive_transfer_enabled
                && matches!(params,
            app_server_protocol::protocol::v2::CloudDesktopParams::PrepareModelConnection { .. }
            | app_server_protocol::protocol::v2::CloudDesktopParams::ReadModelConnection { .. }
            | app_server_protocol::protocol::v2::CloudDesktopParams::ApplyModelConnection { .. });
        if !self.cloud_desktop_local_control
            && !model_transfer
            && !matches!(
                params,
                app_server_protocol::protocol::v2::CloudDesktopParams::ExportArchive { .. }
            )
        {
            return Err(JsonRpcError::new(
                app_server_protocol::error_codes::INVALID_REQUEST,
                "Cloud management and archive recovery require a local App Server transport",
            ));
        }
        let applying = matches!(
            params,
            app_server_protocol::protocol::v2::CloudDesktopParams::ApplyModelConnection { .. }
                | app_server_protocol::protocol::v2::CloudDesktopParams::ReadModelConnection { .. }
        );
        let response = self
            .runtime
            .request_cloud_desktop(params)
            .await
            .map_err(to_jsonrpc_error)?;
        if applying && response.data["phase"] == "complete" {
            if let Some(provider_id) = response.data["providerId"].as_str() {
                if !self
                    .runtime
                    .has_model_provider_last_success(provider_id)
                    .await
                    .unwrap_or(false)
                {
                    self.refresh_model_catalog_after_credential_change(provider_id)
                        .await;
                } else {
                    self.publish_model_list_updated(Some(provider_id.to_owned()))
                        .await;
                }
            }
            self.runtime
                .schedule_pending_route_recovery(self.runtime_host_context());
        }
        dispatch_result(response)
    }

    pub(super) async fn handle_cloud_request(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: CloudRequestParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .request_cloud(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_account_login_start(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: LoginAccountParams = parse_params(params)?;
        let response = self
            .runtime
            .login_account(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_account_read(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: GetAccountParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .read_account(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_account_logout(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let _: Option<()> = parse_params(params.or(Some(serde_json::Value::Null)))?;
        let response = self.runtime.logout_account().map_err(to_jsonrpc_error)?;
        self.publish_server_notification(ServerNotification::AccountUpdated(
            AccountUpdatedNotification {
                auth_mode: None,
                plan_type: None,
            },
        ))
        .await;
        dispatch_result(response)
    }
}

#[cfg(test)]
mod cloud_desktop_tests {
    use super::*;
    use crate::{RuntimeCore, StorageRoots};
    use serde_json::json;

    async fn rpc(
        processor: &RequestProcessor,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let messages = processor
            .handle_request(app_server_protocol::JsonRpcRequest::new(
                app_server_protocol::RequestId::String("cloud-test-rpc".into()),
                method,
                Some(params),
            ))
            .await
            .unwrap();
        messages
            .into_iter()
            .map(|message| serde_json::to_value(message).unwrap())
            .find(|message| message["id"] == "cloud-test-rpc")
            .expect("public JSON-RPC response")
    }

    #[tokio::test]
    async fn remote_cloud_control_cannot_consume_local_profiles_or_recovery_keys() {
        let directory = tempfile::tempdir().unwrap();
        let roots = StorageRoots::initialize(directory.path(), directory.path().join("app-server"))
            .unwrap();
        let mut processor = RequestProcessor::new(RuntimeCore::default().with_storage_roots(roots));
        assert!(rpc(
            &processor,
            "initialize",
            json!({"clientInfo":{"name":"cloud-test","version":"1"}})
        )
        .await
        .get("result")
        .is_some());
        processor
            .handle_notification(serde_json::from_value(json!({"method":"initialized"})).unwrap());
        assert_eq!(
            rpc(
                &processor,
                "cloud/desktop",
                json!({"action":"listResources"})
            )
            .await["result"]["data"]["resources"],
            json!([])
        );
        let error = rpc(&processor, "cloud/desktop", json!({"action":"release","resource":{"provider":"wuying","regionId":"cn-test","resourceId":"ecd-test","profile":"private"},"operationId":"release-1","confirmation":"release:cn-test:ecd-test:discard-data","workSaved":true,"discardData":false})).await;
        assert!(error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("explicit disk data discard"));
        let ecs_spec = json!({"regionId":"cn-test","profile":"private","vSwitchId":"vsw-test",
            "securityGroupId":"sg-test","keyPairName":"key-test","instanceType":"ecs.test.large",
            "imageId":"ubuntu-test","systemDiskGib":80,"outboundMbps":5});
        let purchase = json!({"action":"purchaseEcs","spec":ecs_spec,"desktopName":"Lime-test",
            "operationId":"purchase-ecs","quoteId":"0".repeat(64),"confirmation":"not-confirmed"});
        let error = rpc(&processor, "cloud/desktop", purchase.clone()).await;
        assert!(error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Explicit purchase confirmation"));
        processor.disable_cloud_desktop_local_control(true);
        for request in [
            json!({"action":"scheduleEcsRelease","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"operationId":"schedule-remote","imageOperationId":"image-remote","releaseAt":"2099-01-01T00:00:00Z","confirmation":"not-confirmed","workSaved":true,"discardData":true}),
            json!({"action":"cancelEcsRelease","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"operationId":"cancel-remote","releaseAt":"2099-01-01T00:00:00Z","confirmation":"not-confirmed"}),
            json!({"action":"quoteEcs","spec":ecs_spec}),
            purchase,
            json!({"action":"listResources"}),
            json!({"action":"prepareEcsDesktop","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"operationId":"prepare-remote","confirmation":"prepareEcsDesktop:cn-test:i-test","installSystemPackages":true}),
            json!({"action":"openEcsTunnel","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"channel":"desktop"}),
            json!({"action":"readEcsTunnel","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"channel":"appServer"}),
            json!({"action":"closeEcsTunnel","resource":{"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"private"},"channel":"desktop"}),
            json!({"action":"bind","resource":{"provider":"wuying","regionId":"cn-test","resourceId":"ecd-test","profile":"private"}}),
            json!({"action":"createArchiveIdentity","identityFile":"/offline-key"}),
            json!({"action":"restoreArchive","archivePath":"/archive","identityFile":"/offline-key","destination":"/new","expectedSha256":"0".repeat(64),"maxBytes":1024}),
            json!({"action":"transferArchive","localPath":"/archive","remote":"private:bucket/key","upload":true,"expectedSha256":"0".repeat(64)}),
            json!({"action":"listOssBuckets","profile":"private","regionId":"cn-test"}),
            json!({"action":"prepareRuntimeDistribution","profile":"private","regionId":"cn-test","operationId":"runtime-private","version":"1.175.0","archiveBytes":1,"archiveSha256":"0".repeat(64)}),
            json!({"action":"readRuntimeDistribution","profile":"private","regionId":"cn-test","operationId":"runtime-private"}),
            json!({"action":"signRuntimeDistribution","profile":"private","regionId":"cn-test","operationId":"runtime-private"}),
            json!({"action":"cleanupRuntimeDistribution","profile":"private","regionId":"cn-test","operationId":"runtime-private"}),
            json!({"action":"listEcsImages","profile":"private","regionId":"cn-test"}),
            json!({"action":"createEcsImage","snapshotOperationId":"cold-snapshot","operationId":"image-remote","confirmation":"createEcsImage:cold-snapshot","includeCredentials":true}),
            json!({"action":"transferOssArchive","profile":"private","regionId":"cn-test","bucket":"bucket-test","objectKey":"archive.age","localPath":"/archive.age","upload":true,"expectedSha256":"0".repeat(64)}),
            json!({"action":"release","resource":{"provider":"wuying","regionId":"cn-test","resourceId":"ecd-test","profile":"private"},"operationId":"release-2","confirmation":"release:cn-test:ecd-test:discard-data","workSaved":true,"discardData":true}),
        ] {
            let response = rpc(&processor, "cloud/desktop", request).await;
            assert_eq!(
                response["error"]["code"],
                app_server_protocol::error_codes::INVALID_REQUEST
            );
            assert!(response["error"]["message"]
                .as_str()
                .unwrap()
                .contains("local App Server transport"));
        }
        // A public-recipient export reaches its existing archive validation.
        let response = rpc(&processor, "cloud/desktop", json!({"action":"exportArchive","sourceRoot":"/missing","paths":[],"outputPath":"/archive","recipient":"invalid","includeCredentials":false,"workSaved":true})).await;
        assert!(response.get("error").is_some());
        assert!(!response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("local App Server transport"));
        assert!(!directory.path().join("cloud-desktops").exists());
    }
}
