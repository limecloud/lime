//! Admission for the upstream application access configuration.
//! Native identity is supplied by a trusted adapter, never by model/RPC JSON.

use app_server_protocol::protocol::v2::ComputerUseGrantScope;
use lime_core::config::{ComputerUseConfigToml, ComputerUseRequirementsToml};
use lime_core::AllowDenyRequirementToml::{self, Allow, Deny};

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum NativeAppIdentity {
    Macos {
        bundle_id: String,
    },
    Windows {
        aumid: Option<String>,
        publisher_name: String,
        product_name: String,
        binary_name: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComputerUsePolicy {
    pub user: Option<ComputerUseConfigToml>,
    pub admin: Option<ComputerUseRequirementsToml>,
    pub allow_browser_and_computer_use: Option<bool>,
}

impl ComputerUsePolicy {
    pub(super) fn check(
        &self,
        identity: &NativeAppIdentity,
        locked: bool,
        scope: ComputerUseGrantScope,
        session_consent: bool,
    ) -> Result<(), &'static str> {
        let identity_verified = match identity {
            NativeAppIdentity::Macos { bundle_id } => !bundle_id.trim().is_empty(),
            NativeAppIdentity::Windows {
                aumid,
                publisher_name,
                product_name,
                binary_name,
            } => {
                aumid.as_ref().is_none_or(|id| !id.trim().is_empty())
                    && [publisher_name, product_name, binary_name]
                        .iter()
                        .all(|part| !part.trim().is_empty())
            }
        };
        if !identity_verified {
            return Err("Native application identity could not be verified");
        }
        if self.allow_browser_and_computer_use == Some(false) {
            return Err("Computer Use is disabled by administrator policy");
        }
        if locked
            && self
                .admin
                .as_ref()
                .and_then(|p| p.allow_locked_computer_use)
                != Some(true)
        {
            return Err("Computer Use is unavailable while the desktop is locked");
        }
        if scope == ComputerUseGrantScope::Persistent
            && self
                .admin
                .as_ref()
                .and_then(|p| p.allow_persistent_approval)
                == Some(false)
        {
            return Err("Persistent Computer Use approval is disabled by administrator policy");
        }
        if self.admin_access(identity) == Some(Deny) {
            return Err("Application access is denied by administrator policy");
        }
        match self.user_access(identity) {
            Some(Deny) => Err("Application access is denied by user policy"),
            Some(Allow) => Ok(()),
            None if session_consent && scope == ComputerUseGrantScope::Session => Ok(()),
            _ => Err("Application access requires explicit user approval"),
        }
    }

    fn user_access(&self, identity: &NativeAppIdentity) -> Option<AllowDenyRequirementToml> {
        let config = self.user.as_ref()?;
        let specific = match identity {
            NativeAppIdentity::Macos { bundle_id } => config
                .macos
                .as_ref()
                .and_then(|m| m.bundle_ids.as_ref())
                .and_then(|ids| ids.get(bundle_id))
                .copied(),
            NativeAppIdentity::Windows {
                aumid,
                publisher_name,
                product_name,
                binary_name,
            } => {
                let windows = config.windows.as_ref();
                let aumid_access = windows
                    .and_then(|w| w.aumids.as_ref())
                    .and_then(|ids| aumid.as_ref().and_then(|id| ids.get(id)))
                    .copied();
                let exe_access = combine(
                    windows
                        .and_then(|w| w.exes.as_ref())
                        .into_iter()
                        .flatten()
                        .filter(|rule| {
                            matches_exe(
                                publisher_name,
                                product_name,
                                binary_name,
                                &rule.publisher_name,
                                &rule.product_name,
                                rule.binary_name.as_deref(),
                            )
                        })
                        .map(|rule| rule.access),
                );
                combine(aumid_access.into_iter().chain(exe_access))
            }
        };
        specific.or(config.default_app_access)
    }

    fn admin_access(&self, identity: &NativeAppIdentity) -> Option<AllowDenyRequirementToml> {
        let config = self.admin.as_ref()?;
        let specific = match identity {
            NativeAppIdentity::Macos { bundle_id } => config
                .macos
                .as_ref()
                .and_then(|m| m.bundle_ids.as_ref())
                .and_then(|ids| ids.get(bundle_id))
                .copied(),
            NativeAppIdentity::Windows {
                aumid,
                publisher_name,
                product_name,
                binary_name,
            } => {
                let windows = config.windows.as_ref();
                let aumid_access = windows
                    .and_then(|w| w.aumids.as_ref())
                    .and_then(|ids| aumid.as_ref().and_then(|id| ids.get(id)))
                    .copied();
                let exe_access = combine(
                    windows
                        .and_then(|w| w.exes.as_ref())
                        .into_iter()
                        .flatten()
                        .filter(|rule| {
                            matches_exe(
                                publisher_name,
                                product_name,
                                binary_name,
                                &rule.publisher_name,
                                &rule.product_name,
                                rule.binary_name.as_deref(),
                            )
                        })
                        .map(|rule| rule.access),
                );
                combine(aumid_access.into_iter().chain(exe_access))
            }
        };
        specific.or(config.default_app_access)
    }
}

fn matches_exe(
    publisher: &str,
    product: &str,
    binary: &str,
    rule_publisher: &str,
    rule_product: &str,
    rule_binary: Option<&str>,
) -> bool {
    !publisher.is_empty()
        && !product.is_empty()
        && !binary.is_empty()
        && publisher == rule_publisher
        && product == rule_product
        && rule_binary.is_none_or(|rule| binary.eq_ignore_ascii_case(rule))
}

fn combine(
    values: impl IntoIterator<Item = AllowDenyRequirementToml>,
) -> Option<AllowDenyRequirementToml> {
    values
        .into_iter()
        .fold(None, |previous, next| match (previous, next) {
            (Some(Deny), _) | (_, Deny) => Some(Deny),
            _ => Some(Allow),
        })
}
