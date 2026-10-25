//! 本地 MCP 子进程环境。
//! 复制并适配自 Codex 970111f6cb62cc02fe36a82ea7d71b37a2889c97，Apache-2.0。
//! 本机 env_vars 使用 Desktop 同版本的字符串列表；远程来源由配置边界拒绝。
use agent_protocol::shell_environment::is_non_inheritable_env_var;
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;

const CUSTOM_CA_ENV_KEYS: [&str; 11] = [
    "CODEX_CA_CERTIFICATE",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "GIT_SSL_CAINFO",
    "CARGO_HTTP_CAINFO",
    "PIP_CERT",
    "BUNDLE_SSL_CA_CERT",
    "npm_config_cafile",
    "NPM_CONFIG_CAFILE",
];

pub(crate) fn create_env_for_mcp_server(
    extra_env: Option<HashMap<OsString, OsString>>,
    env_vars: &[String],
) -> std::io::Result<HashMap<OsString, OsString>> {
    if env_vars
        .iter()
        .any(|name| name.trim().is_empty() || name.contains(['=', '\0']))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid MCP environment variable name",
        ));
    }
    let additional_env_vars = env_vars.iter().map(String::as_str);
    let mut env: HashMap<OsString, OsString> = DEFAULT_ENV_VARS
        .iter()
        .copied()
        .chain(additional_env_vars)
        .filter_map(|var| env::var_os(var).map(|value| (OsString::from(var), value)))
        .collect();
    for name in CUSTOM_CA_ENV_KEYS {
        let Some(value) = env::var_os(name) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let value = std::path::absolute(value)?.into_os_string();
        #[cfg(windows)]
        env.retain(|key, _| !key.to_string_lossy().eq_ignore_ascii_case(name));
        env.insert(OsString::from(name), value);
    }
    for (name, value) in extra_env.unwrap_or_default() {
        if cfg!(windows)
            || name.to_str().is_some_and(|name| {
                CUSTOM_CA_ENV_KEYS
                    .iter()
                    .any(|ca_name| ca_name.eq_ignore_ascii_case(name))
            })
        {
            env.retain(|key, _| {
                !key.to_string_lossy()
                    .eq_ignore_ascii_case(&name.to_string_lossy())
            });
        }
        env.insert(name, value);
    }
    env.retain(|name, _| {
        name.to_str()
            .is_none_or(|name| !is_non_inheritable_env_var(name))
    });
    Ok(env)
}

#[cfg(unix)]
pub(crate) const DEFAULT_ENV_VARS: &[&str] = &[
    "HOME",
    "LOGNAME",
    "PATH",
    "SHELL",
    "USER",
    "__CF_USER_TEXT_ENCODING",
    "LANG",
    "LC_ALL",
    "TERM",
    "TMPDIR",
    "TZ",
];

#[cfg(windows)]
pub(crate) const DEFAULT_ENV_VARS: &[&str] =
    agent_protocol::shell_environment::WINDOWS_CORE_ENV_VARS;

#[cfg(test)]
#[path = "utils_tests.rs"]
mod tests;
