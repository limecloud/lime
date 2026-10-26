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

impl OfficeAdapter {
    pub fn new(paths: ComputerUsePaths) -> Self {
        Self {
            native: NativeAdapter::default(),
            excel: ExtensionAdapter::new(ComputerUseAdapterKind::Office, paths),
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
    let native_app = target.native_app.as_ref()?;
    let app_matches = match native_app {
        NativeAppIdentity::Macos { bundle_id } => app_id == bundle_id,
        NativeAppIdentity::Windows { binary_name, .. } => {
            app_id.starts_with("win32:\\\\?\\")
                && app_id.rsplit_once('\\').is_some_and(|(directory, name)| {
                    directory.len() > "win32:\\\\?\\".len()
                        && name.eq_ignore_ascii_case(binary_name)
                })
        }
    };
    if !native_app.is_wps()
        || !app_matches
        || session == 0
        || *pid == 0
        || window.trim().is_empty()
        || title.as_ref().is_none_or(|s| s.trim().is_empty())
    {
        return None;
    }
    let document = serde_json::to_vec(&(app_id, native_app, title)).ok()?;
    Some(ComputerUseTargetIdentity::Office {
        host: "WPS".into(),
        workbook_id: window.clone(),
        session_id: format!("wps:{session}:{pid}:{:x}", Sha256::digest(document)),
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

    fn finish_turn(&self, owner: &ComputerUseOwner) {
        self.native.finish_turn(owner);
        self.excel.finish_turn(owner);
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
            let result = self.native.setup_wps().await?;
            return Ok(ComputerUseSetupOutcome {
                generation: self.snapshot().await?.generation,
                ..result
            });
        };
        if !matches!(target, ComputerUseTargetIdentity::Office { host, .. } if host == "WPS") {
            let outcome = self.excel.setup(params).await?;
            return Ok(ComputerUseSetupOutcome {
                generation: self.snapshot().await?.generation,
                ..outcome
            });
        }
        let native = self.native_target(target).await?;
        let result = self
            .native
            .setup(&ComputerUseSetupParams {
                adapter: ComputerUseAdapterKind::Native,
                target: Some(native.clone()),
                grant_scope: params.grant_scope,
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
            approved_revision: result.approved_revision,
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
            .execute_target(&target, &lease.owner, lease.control_fence(), action, cancel)
            .await
    }
}

#[cfg(test)]
#[path = "office_tests.rs"]
mod tests;
