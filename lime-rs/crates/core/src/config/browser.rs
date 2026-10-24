//! 内置浏览器 Desktop 偏好；准入策略由根 browser_use 独立持有。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserApprovalMode {
    #[default]
    AlwaysAsk,
    NeverAsk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserHistoryAccess {
    #[default]
    AlwaysAsk,
    NeverAsk,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserAnnotationScreenshot {
    #[default]
    Always,
    Necessary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrowserConfig {
    pub enabled: bool,
    pub show_full_url: bool,
    pub annotation_screenshot: BrowserAnnotationScreenshot,
    pub download_directory: Option<String>,
    pub ask_download_location: bool,
    #[serde(rename = "approvalMode")]
    pub approval_mode: BrowserApprovalMode,
    #[serde(rename = "downloadApprovalMode")]
    pub download_approval_mode: BrowserApprovalMode,
    #[serde(rename = "uploadApprovalMode")]
    pub upload_approval_mode: BrowserApprovalMode,
    #[serde(rename = "iabHistoryApprovalMode")]
    pub iab_history_approval_mode: BrowserHistoryAccess,
    #[serde(rename = "fullCdpAccessEnabled")]
    pub full_cdp_access_enabled: bool,
    #[serde(rename = "webMcpEnabled")]
    pub web_mcp_enabled: bool,
    #[serde(rename = "allowedOrigins", deserialize_with = "deserialize_origins")]
    pub allowed_origins: Vec<String>,
    #[serde(rename = "deniedOrigins", deserialize_with = "deserialize_origins")]
    pub denied_origins: Vec<String>,
    #[serde(
        rename = "allowedDownloadOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub allowed_download_origins: Vec<String>,
    #[serde(
        rename = "deniedDownloadOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub denied_download_origins: Vec<String>,
    #[serde(
        rename = "allowedUploadOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub allowed_upload_origins: Vec<String>,
    #[serde(
        rename = "deniedUploadOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub denied_upload_origins: Vec<String>,
    #[serde(
        rename = "allowedFullCdpOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub allowed_full_cdp_origins: Vec<String>,
    #[serde(
        rename = "deniedFullCdpOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub denied_full_cdp_origins: Vec<String>,
    #[serde(
        rename = "allowedWebMcpOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub allowed_web_mcp_origins: Vec<String>,
    #[serde(
        rename = "deniedWebMcpOrigins",
        deserialize_with = "deserialize_origins"
    )]
    pub denied_web_mcp_origins: Vec<String>,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            show_full_url: false,
            annotation_screenshot: BrowserAnnotationScreenshot::Always,
            download_directory: None,
            ask_download_location: false,
            approval_mode: BrowserApprovalMode::AlwaysAsk,
            download_approval_mode: BrowserApprovalMode::AlwaysAsk,
            upload_approval_mode: BrowserApprovalMode::AlwaysAsk,
            iab_history_approval_mode: BrowserHistoryAccess::AlwaysAsk,
            full_cdp_access_enabled: false,
            web_mcp_enabled: true,
            allowed_origins: Vec::new(),
            denied_origins: Vec::new(),
            allowed_download_origins: Vec::new(),
            denied_download_origins: Vec::new(),
            allowed_upload_origins: Vec::new(),
            denied_upload_origins: Vec::new(),
            allowed_full_cdp_origins: Vec::new(),
            denied_full_cdp_origins: Vec::new(),
            allowed_web_mcp_origins: Vec::new(),
            denied_web_mcp_origins: Vec::new(),
        }
    }
}

impl BrowserConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

pub(super) fn deserialize_site_pattern<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?.trim().to_lowercase();
    if value.is_empty() || value.chars().any(char::is_whitespace) || value.contains(['?', '#', '@'])
    {
        return Err(serde::de::Error::custom("invalid browser site pattern"));
    }
    let has_scheme = value.starts_with("http://") || value.starts_with("https://");
    let host_part = value
        .split_once("://")
        .map_or(value.as_str(), |(_, host)| host);
    let wildcard = host_part.starts_with("*.");
    let probe = if wildcard {
        value.replacen("*.", "wildcard.", 1)
    } else {
        value.clone()
    };
    let url = url::Url::parse(&if has_scheme {
        probe
    } else {
        format!("https://{probe}")
    })
    .map_err(|_| serde::de::Error::custom("invalid browser site pattern"))?;
    let host = url
        .host_str()
        .ok_or_else(|| serde::de::Error::custom("invalid browser site pattern"))?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "/" | "/*")
        || host.contains('*')
        || (!host.contains('.') && !host.contains(':') && host != "localhost")
        || (wildcard && host == "wildcard.localhost")
    {
        return Err(serde::de::Error::custom("invalid browser site pattern"));
    }
    let normalized_host = if wildcard {
        host.replacen("wildcard.", "*.", 1)
    } else {
        host.to_string()
    };
    let explicit_port = value
        .trim_end_matches("/*")
        .trim_end_matches('/')
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok());
    let port = if has_scheme {
        url.port()
    } else {
        explicit_port
    };
    let authority = port.map_or(normalized_host.clone(), |port| {
        format!("{normalized_host}:{port}")
    });
    Ok(if has_scheme {
        format!("{}://{authority}", url.scheme())
    } else {
        authority
    })
}

fn deserialize_origins<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    struct Origin(#[serde(deserialize_with = "deserialize_site_pattern")] String);
    let origins = Vec::<Origin>::deserialize(deserializer)?;
    Ok(origins.into_iter().map(|origin| origin.0).collect())
}
