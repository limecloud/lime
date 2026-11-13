use super::*;
use std::collections::BTreeSet;

impl Manifest {
    pub(super) fn validate(&self) -> Result<(), RuntimeCoreError> {
        if self.schema_version != 1
            || !code(&self.name)
            || !version(&self.version)
            || !self.title.valid(120)
            || !self.description.valid(4000)
            || !safe_text(&self.license, 1, 160)
            || self.hosts.is_empty()
            || self.hosts.len() > 16
            || self.files.len() > MAX_FILES
        {
            return Err(invalid());
        }
        let mut hosts = BTreeSet::new();
        for host in &self.hosts {
            if !code(&host.id)
                || !hosts.insert(&host.id)
                || !version(&host.min_version)
                || host.max_version.as_ref().is_some_and(|max| {
                    !version(max)
                        || semver::Version::parse(&host.min_version).ok()
                            > semver::Version::parse(max).ok()
                })
                || !codes(&host.capabilities, 1, 32)
            {
                return Err(invalid());
            }
        }
        let mut paths = BTreeSet::new();
        let mut size = 0u64;
        for file in &self.files {
            size = size.checked_add(file.size).ok_or_else(invalid)?;
            if !safe_path(&file.path)
                || !digest(&file.sha256)
                || !paths.insert(caseless::default_case_fold_str(&file.path))
                || size > MAX_EXPANDED_BYTES
            {
                return Err(invalid());
            }
        }
        for path in &paths {
            let mut parent = path.as_str();
            while let Some((prefix, _)) = parent.rsplit_once('/') {
                if paths.contains(prefix) {
                    return Err(invalid());
                }
                parent = prefix;
            }
        }
        let entry = |path: &str| safe_path(path) && self.files.iter().any(|file| file.path == path);
        let valid = match self.kind.as_str() {
            "skill" => self.skill.as_ref().is_some_and(|skill| {
                self.mcp.is_none()
                    && self.plugin.is_none()
                    && entry(&skill.entry)
                    && skill.entry.rsplit('/').next() == Some("SKILL.md")
                    && codes(&skill.actions, 0, 64)
            }),
            "mcp" => self.mcp.as_ref().is_some_and(|mcp| {
                self.skill.is_none()
                    && self.plugin.is_none()
                    && codes(&mcp.tools, 0, 128)
                    && mcp.auth.valid()
                    && match mcp.transport.as_str() {
                        "http" => {
                            mcp.endpoint.as_deref().is_some_and(public_endpoint)
                                && mcp.executable.is_none()
                                && mcp.arguments.is_empty()
                        }
                        "stdio" => {
                            mcp.endpoint.is_none()
                                && mcp.executable.as_deref().is_some_and(entry)
                                && mcp.arguments.len() <= 32
                                && mcp.arguments.iter().all(|arg| safe_text(arg, 0, 1024))
                        }
                        _ => false,
                    }
            }),
            "plugin" => self.plugin.as_ref().is_some_and(|plugin| {
                let mut dependencies = BTreeSet::new();
                self.skill.is_none()
                    && self.mcp.is_none()
                    && entry(&plugin.entry)
                    && plugin.dependencies.len() <= 32
                    && plugin.dependencies.iter().all(|dependency| {
                        identifier(&dependency.release_id)
                            && digest(&dependency.sha256)
                            && matches!(dependency.kind.as_str(), "skill" | "mcp")
                            && dependencies.insert(&dependency.release_id)
                    })
            }),
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err(invalid())
        }
    }
}

impl Text {
    fn valid(&self, max: usize) -> bool {
        let valid = |text: &str| !text.trim().is_empty() && text.chars().count() <= max;
        // Cloud owns the locale registry; a host must not freeze a second registry.
        valid(&self.source) && self.translations.values().all(|text| valid(text))
    }
}

impl Authentication {
    fn valid(&self) -> bool {
        match self.r#type.as_str() {
            "none" | "bearer" => self.scopes.is_empty(),
            "oauth2" => {
                let mut seen = BTreeSet::new();
                self.scopes.len() <= 32
                    && self.scopes.iter().all(|scope| {
                        safe_text(scope, 1, 256)
                            && !scope.contains([' ', '\t'])
                            && seen.insert(scope)
                    })
            }
            _ => false,
        }
    }
}

fn code(value: &str) -> bool {
    value.len() <= 64
        && value.bytes().next().is_some_and(|b| b.is_ascii_lowercase())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
}

fn version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            (1..=9).contains(&part.len())
                && part.bytes().all(|b| b.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
        })
}

fn codes(values: &[String], min: usize, max: usize) -> bool {
    let mut seen = BTreeSet::new();
    (min..=max).contains(&values.len())
        && values.iter().all(|value| code(value) && seen.insert(value))
}

fn safe_text(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len()) && !value.chars().any(|c| c < ' ' || c == '\u{7f}')
}

pub(crate) fn safe_path(value: &str) -> bool {
    safe_text(value, 1, 240)
        && unicode_normalization::is_nfc(value)
        && !value.contains(['\\', ':'])
        && !value.starts_with('/')
        && value.split('/').all(|part| {
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            let device = ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|suffix| {
                    suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9')
                })
            });
            !part.is_empty()
                && !matches!(part, "." | "..")
                && !part.ends_with(['.', ' '])
                && !part.contains(['<', '>', '"', '|', '?', '*'])
                && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !device
        })
}

fn public_endpoint(raw: &str) -> bool {
    if !safe_text(raw, 1, 2048) {
        return false;
    }
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !raw.starts_with("https://")
        || raw.contains('\\')
        || raw.strip_prefix("https://").is_some_and(|value| {
            value
                .split('/')
                .next()
                .is_some_and(|authority| authority.contains('@'))
        })
    {
        return false;
    }
    match url.host() {
        Some(url::Host::Domain(host)) => {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            !host.is_empty()
                && host != "localhost"
                && !host.ends_with(".localhost")
                && !host.ends_with(".local")
        }
        Some(url::Host::Ipv4(ip)) => public_ipv4(ip),
        Some(url::Host::Ipv6(ip)) => ip.to_ipv4_mapped().map(public_ipv4).unwrap_or_else(|| {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
        }),
        None => false,
    }
}

fn public_ipv4(ip: std::net::Ipv4Addr) -> bool {
    !ip.is_loopback()
        && !ip.is_private()
        && !ip.is_link_local()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        && !ip.is_broadcast()
}
