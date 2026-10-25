//! WPS uses the trusted native driver; Excel keeps its connected Office.js session.
//! Both routes share admission, control fences and the canonical tool lifecycle.

use super::*;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct OfficeAdapter {
    native: NativeAdapter,
    excel: ExtensionAdapter,
    observed: Mutex<(Option<ComputerUseSnapshot>, u64)>,
}

impl Default for OfficeAdapter {
    fn default() -> Self {
        Self {
            native: NativeAdapter::default(),
            excel: ExtensionAdapter::new(ComputerUseAdapterKind::Office),
            observed: Mutex::new((None, 0)),
        }
    }
}

fn wps_identity(target: &ComputerUseTarget, session: u64) -> Option<ComputerUseTargetIdentity> {
    let ComputerUseTargetIdentity::Native {
        app_id,
        process_id: Some(pid),
        window_id: Some(window),
        title,
    } = &target.identity
    else {
        return None;
    };
    let verified = matches!(&target.native_app,
        Some(NativeAppIdentity::Macos { bundle_id })
            if bundle_id == "com.kingsoft.wpsoffice.mac" && app_id == bundle_id);
    if !verified || *pid == 0 || window.is_empty() || title.as_ref().is_none_or(|s| s.is_empty()) {
        return None;
    }
    Some(ComputerUseTargetIdentity::Office {
        host: "WPS".into(),
        workbook_id: window.clone(),
        session_id: format!(
            "wps:{session}:{pid}:{:x}",
            Sha256::digest(title.as_deref().unwrap_or_default().as_bytes())
        ),
        workbook_name: title.clone(),
    })
}

impl OfficeAdapter {
    async fn native_target(
        &self,
        requested: &ComputerUseTargetIdentity,
    ) -> ComputerUseResult<ComputerUseTargetIdentity> {
        let snapshot = self.native.snapshot().await?;
        let session = self.native.session_id()?;
        snapshot
            .targets
            .iter()
            .find(|target| {
                wps_identity(target, session)
                    .is_some_and(|identity| same_target(&identity, requested))
            })
            .map(|target| target.identity.clone())
            .ok_or_else(|| {
                denied("The approved WPS window or native helper session is no longer available")
            })
    }
}

#[async_trait]
impl ComputerUseAdapter for OfficeAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Office
    }

    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        let native = self.native.snapshot().await?;
        let excel = self.excel.snapshot().await?;
        let session = self.native.session_id()?;
        let mut targets: Vec<_> = native
            .targets
            .iter()
            .filter_map(|target| {
                let identity = wps_identity(target, session)?;
                Some(ComputerUseTarget {
                    identity,
                    ..target.clone()
                })
            })
            .collect();
        targets.extend(excel.targets);
        let connected = !targets.is_empty();
        let readiness = if connected {
            ComputerUseReadiness::Ready
        } else if native.readiness == ComputerUseReadiness::Ready {
            ComputerUseReadiness::Disconnected
        } else {
            native.readiness
        };
        let mut snapshot = ComputerUseSnapshot {
            generation: 1,
            readiness,
            targets,
            reason: if connected {
                None
            } else {
                native.reason.or(Some(
                    "Open a WPS document window or connect the Lime Excel add-in".into(),
                ))
            },
            setup_steps: if connected {
                vec![]
            } else {
                vec!["open_wps".into()]
            },
        };
        let mut previous = self
            .observed
            .lock()
            .map_err(|_| denied("Office adapter observation unavailable"))?;
        if let Some(last) = previous.0.as_ref() {
            snapshot.generation = last.generation;
            if snapshot != *last || previous.1 != excel.generation {
                snapshot.generation = last
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| denied("Office generation exhausted"))?;
            }
        }
        *previous = (Some(snapshot.clone()), excel.generation);
        Ok(snapshot)
    }

    async fn setup(
        &self,
        params: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        let Some(target) = params.target.as_ref() else {
            #[cfg(target_os = "macos")]
            {
                let status = std::process::Command::new("/usr/bin/open")
                    .args(["-b", "com.kingsoft.wpsoffice.mac"])
                    .status()
                    .map_err(|e| denied(e.to_string()))?;
                if !status.success() {
                    return Err(denied("WPS is not installed or could not be opened"));
                }
                let result = self
                    .native
                    .setup(&ComputerUseSetupParams {
                        adapter: ComputerUseAdapterKind::Native,
                        target: None,
                        grant_scope: ComputerUseGrantScope::Session,
                    })
                    .await?;
                return Ok(ComputerUseSetupOutcome {
                    generation: self.snapshot().await?.generation,
                    ..result
                });
            }
            #[cfg(not(target_os = "macos"))]
            return Err(denied(
                "WPS native control is not available on this platform",
            ));
        };
        if !matches!(target, ComputerUseTargetIdentity::Office { host, .. } if host == "WPS") {
            let outcome = self.excel.setup(params).await?;
            return Ok(ComputerUseSetupOutcome {
                generation: self.snapshot().await?.generation,
                ..outcome
            });
        }
        if params.grant_scope != ComputerUseGrantScope::Session {
            return Err(denied("WPS requires explicit session approval"));
        }
        let native = self.native_target(target).await?;
        let result = self
            .native
            .setup(&ComputerUseSetupParams {
                adapter: ComputerUseAdapterKind::Native,
                target: Some(native.clone()),
                grant_scope: ComputerUseGrantScope::Session,
            })
            .await?;
        let snapshot = self.snapshot().await?;
        let approved = result.accepted
            && result
                .approved_target
                .as_ref()
                .is_some_and(|value| same_target(value, &native));
        Ok(ComputerUseSetupOutcome {
            accepted: approved,
            approved_target: approved
                .then(|| {
                    snapshot
                        .targets
                        .iter()
                        .find(|entry| same_target(&entry.identity, target))
                        .map(|entry| entry.identity.clone())
                })
                .flatten(),
            generation: snapshot.generation,
        })
    }

    async fn execute(
        &self,
        lease: &ComputerUseLease,
        action: ComputerUseAction,
        cancel: CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        if !matches!(&lease.response.target, ComputerUseTargetIdentity::Office { host, .. } if host == "WPS")
        {
            return self.excel.execute(lease, action, cancel).await;
        }
        let target = self.native_target(&lease.response.target).await?;
        self.native
            .execute_target(&target, lease.control_fence(), action, cancel)
            .await
    }
}

#[cfg(test)]
#[path = "office_tests.rs"]
mod tests;
