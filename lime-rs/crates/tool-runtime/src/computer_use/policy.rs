//! Admission for the upstream application access configuration.
//! Native identity is supplied by a trusted adapter, never by model/RPC JSON.

use app_server_protocol::protocol::v2::ComputerUseGrantScope;
use lime_core::config::{ComputerUseConfigToml, ComputerUseRequirementsToml};
use lime_core::AllowDenyRequirementToml::{self, Allow, Deny};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

impl NativeAppIdentity {
    pub(super) fn is_wps(&self) -> bool {
        match self {
            Self::Macos { bundle_id } => bundle_id == "com.kingsoft.wpsoffice.mac",
            Self::Windows {
                aumid,
                publisher_name,
                product_name,
                binary_name,
            } => {
                !publisher_name.trim().is_empty()
                    && aumid.as_ref().is_none_or(|id| !id.trim().is_empty())
                    && product_name.eq_ignore_ascii_case("WPS Office")
                    && ["et.exe", "wps.exe", "wpp.exe"]
                        .iter()
                        .any(|binary| binary_name.eq_ignore_ascii_case(binary))
            }
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComputerUsePolicy {
    pub native_enabled: Option<bool>,
    pub chrome_enabled: Option<bool>,
    pub office_enabled: Option<bool>,
    pub browser: Option<lime_core::config::BrowserUseConfigToml>,
    pub browser_admin: Option<lime_core::config::BrowserUseRequirementsToml>,
    pub user: Option<ComputerUseConfigToml>,
    pub admin: Option<ComputerUseRequirementsToml>,
    pub allow_browser_and_computer_use: Option<bool>,
}

impl ComputerUsePolicy {
    pub(super) fn check_office_native(
        &self,
        target: &super::ComputerUseTarget,
        scope: ComputerUseGrantScope,
        consent: bool,
    ) -> Result<(), &'static str> {
        if !matches!(&target.identity, super::ComputerUseTargetIdentity::Office { host, .. } if host == "WPS")
        {
            return Err("Invalid native Office target");
        }
        let identity = target
            .native_app
            .as_ref()
            .ok_or("Verified WPS identity is required")?;
        if !identity.is_wps() {
            return Err("Verified WPS identity is required");
        }
        let mut policy = self.clone();
        policy.native_enabled = self.office_enabled;
        policy.check(identity, target.locked, scope, consent)
    }

    /// Build the exact application rule only after the service verifies fresh consent.
    /// Rechecking this against freshly loaded configuration prevents overwriting a denial.
    pub fn with_persistent_approval(
        &self,
        adapter: super::ComputerUseAdapterKind,
        target: &super::ComputerUseTarget,
    ) -> Result<Self, &'static str> {
        let identity = target
            .native_app
            .as_ref()
            .ok_or("Verified application identity is required")?;
        let mut policy = self.clone();
        match adapter {
            super::ComputerUseAdapterKind::Native
                if matches!(
                    target.identity,
                    super::ComputerUseTargetIdentity::Native { .. }
                ) => {}
            super::ComputerUseAdapterKind::Office => {
                policy.check_office_native(target, ComputerUseGrantScope::Session, true)?;
                policy.native_enabled = policy.office_enabled;
            }
            _ => return Err("This target requires session approval"),
        }
        policy.check(
            identity,
            target.locked,
            ComputerUseGrantScope::Session,
            true,
        )?;
        if policy
            .admin
            .as_ref()
            .and_then(|p| p.allow_persistent_approval)
            == Some(false)
        {
            return Err("Persistent Computer Use approval is disabled by administrator policy");
        }
        let user = policy.user.get_or_insert_with(Default::default);
        match identity {
            NativeAppIdentity::Macos { bundle_id } => {
                user.macos
                    .get_or_insert_with(Default::default)
                    .bundle_ids
                    .get_or_insert_with(Default::default)
                    .insert(bundle_id.clone(), Allow);
            }
            NativeAppIdentity::Windows {
                aumid: Some(aumid), ..
            } => {
                user.windows
                    .get_or_insert_with(Default::default)
                    .aumids
                    .get_or_insert_with(Default::default)
                    .insert(aumid.clone(), Allow);
            }
            NativeAppIdentity::Windows {
                publisher_name,
                product_name,
                binary_name,
                ..
            } => {
                let rules = user
                    .windows
                    .get_or_insert_with(Default::default)
                    .exes
                    .get_or_insert_with(Default::default);
                if !rules.iter().any(|rule| {
                    matches_exe(
                        publisher_name,
                        product_name,
                        binary_name,
                        &rule.publisher_name,
                        &rule.product_name,
                        rule.binary_name.as_deref(),
                    )
                }) {
                    rules.push(lime_core::config::ComputerUseWindowsExeConfigToml {
                        publisher_name: publisher_name.clone(),
                        product_name: product_name.clone(),
                        binary_name: Some(binary_name.clone()),
                        access: Allow,
                    });
                }
            }
        }
        policy.check(
            identity,
            target.locked,
            ComputerUseGrantScope::Persistent,
            false,
        )?;
        policy.native_enabled = self.native_enabled;
        Ok(policy)
    }

    pub(super) fn enabled(&self, kind: super::ComputerUseAdapterKind) -> bool {
        (match kind {
            super::ComputerUseAdapterKind::Native => self.native_enabled,
            super::ComputerUseAdapterKind::Chrome => self.chrome_enabled,
            super::ComputerUseAdapterKind::Office => self.office_enabled,
        }) != Some(false)
    }

    pub(super) fn check_extension(
        &self,
        target: &super::ComputerUseTargetIdentity,
        scope: ComputerUseGrantScope,
        consent: bool,
    ) -> Result<(), &'static str> {
        if self.allow_browser_and_computer_use == Some(false) {
            return Err("Computer Use is disabled by administrator policy");
        }
        if scope != ComputerUseGrantScope::Session || !consent {
            return Err("Connected targets require explicit session approval");
        }
        match target {
            super::ComputerUseTargetIdentity::Chrome { origin, .. } => {
                if !self.enabled(super::ComputerUseAdapterKind::Chrome) {
                    return Err("Chrome control is disabled in settings");
                }
                let url = url::Url::parse(origin).map_err(|_| "Invalid browser origin")?;
                if !["http", "https"].contains(&url.scheme())
                    || url.origin().ascii_serialization() != *origin
                {
                    return Err("Invalid browser origin");
                }
                let denied_user = self.browser.as_ref().is_some_and(|b| {
                    origin_access(
                        &url,
                        b.default_origin_policy.as_ref().and_then(|p| p.access),
                        b.origins
                            .iter()
                            .flat_map(|m| m.iter())
                            .map(|(key, p)| (key.as_str(), p.access)),
                    ) == Some(Deny)
                });
                let denied_admin = self.browser_admin.as_ref().is_some_and(|b| {
                    origin_access(
                        &url,
                        b.default_origin_policy.as_ref().and_then(|p| p.access),
                        b.origins
                            .iter()
                            .flat_map(|m| m.iter())
                            .map(|(key, p)| (key.as_str(), p.access)),
                    ) == Some(Deny)
                });
                if denied_user || denied_admin {
                    return Err("Browser origin access is denied by policy");
                }
            }
            super::ComputerUseTargetIdentity::Office { host, .. } => {
                if !self.enabled(super::ComputerUseAdapterKind::Office) || host != "Excel" {
                    return Err("Excel control is disabled or unsupported");
                }
                if self.user.as_ref().and_then(|p| p.default_app_access) == Some(Deny)
                    || self.admin.as_ref().and_then(|p| p.default_app_access) == Some(Deny)
                {
                    return Err("Application access is denied by policy");
                }
            }
            _ => return Err("Invalid connected target"),
        }
        Ok(())
    }

    pub(super) fn check(
        &self,
        identity: &NativeAppIdentity,
        locked: bool,
        scope: ComputerUseGrantScope,
        session_consent: bool,
    ) -> Result<(), &'static str> {
        if self.native_enabled == Some(false) {
            return Err("Computer Use is disabled in settings");
        }
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

fn origin_access<'a>(
    origin: &url::Url,
    default: Option<AllowDenyRequirementToml>,
    patterns: impl Iterator<Item = (&'a str, Option<AllowDenyRequirementToml>)>,
) -> Option<AllowDenyRequirementToml> {
    combine(
        patterns
            .filter(|(pattern, _)| origin_matches(origin, pattern))
            .filter_map(|(_, access)| access),
    )
    .or(default)
}

fn origin_matches(origin: &url::Url, pattern: &str) -> bool {
    let normalized = pattern.trim().to_lowercase();
    let normalized = normalized.trim_end_matches("/*").trim_end_matches('/');
    let scheme = normalized.contains("://");
    let authority = normalized
        .split_once("://")
        .map_or(normalized, |(_, authority)| authority);
    let wildcard = authority.starts_with("*.");
    let explicit_port = authority
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok());
    let probe = normalized.replacen("*.", "wildcard.", 1);
    let Ok(parsed) = url::Url::parse(&if scheme {
        probe
    } else {
        format!("https://{probe}")
    }) else {
        return false;
    };
    if scheme && parsed.scheme() != origin.scheme() {
        return false;
    }
    if (scheme || explicit_port.is_some())
        && parsed.port_or_known_default() != origin.port_or_known_default()
    {
        return false;
    }
    match (origin.host_str(), parsed.host_str()) {
        (Some(host), Some(expected)) if wildcard => expected
            .strip_prefix("wildcard.")
            .is_some_and(|suffix| host.ends_with(&format!(".{suffix}"))),
        (Some(host), Some(expected)) => host == expected,
        _ => false,
    }
}
