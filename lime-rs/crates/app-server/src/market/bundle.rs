use super::wire::Ticket;
use app_server_protocol::protocol::v2::Account;
use futures::StreamExt;
use reqwest::Url;
use std::{collections::BTreeMap, time::Duration};
use tokio::io::AsyncWriteExt;

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) async fn download_ticket(
    ticket: &Ticket,
    account: &Account,
) -> Result<tempfile::NamedTempFile, String> {
    let expires = chrono::DateTime::parse_from_rfc3339(&ticket.download.expires_at)
        .map_err(|_| "invalid plugin download ticket")?;
    if ticket.download.method != "GET"
        || expires.timestamp() <= chrono::Utc::now().timestamp()
        || ticket.size == 0
        || ticket.size > super::wire::MAX_ARCHIVE_BYTES
        || ticket.download.headers.len() > 20
    {
        return Err("invalid plugin download ticket".into());
    }
    download_inner(
        &ticket.download.url,
        account,
        ticket.size,
        DOWNLOAD_TIMEOUT,
        &ticket.download.headers,
    )
    .await
}

#[cfg(test)]
async fn download_with_limit(
    location: &str,
    account: &Account,
    max_bytes: u64,
    budget: Duration,
) -> Result<tempfile::NamedTempFile, String> {
    download_inner(location, account, max_bytes, budget, &BTreeMap::new()).await
}

async fn download_inner(
    location: &str,
    account: &Account,
    max_bytes: u64,
    budget: Duration,
    headers: &BTreeMap<String, String>,
) -> Result<tempfile::NamedTempFile, String> {
    let Account::Cloud { base_url, .. } = account;
    let issuer = Url::parse(base_url).map_err(|_| "invalid plugin issuer URL")?;
    let loopback = (issuer.scheme() == "http" && is_loopback(&issuer)).then(|| issuer.origin());
    let url = Url::parse(location).map_err(|_| "invalid plugin bundle URL")?;
    if !allowed(&url, loopback.as_ref()) {
        return Err("unsupported plugin bundle URL".into());
    }
    let builder = reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .timeout(budget)
        .redirect(reqwest::redirect::Policy::none());
    let builder = if is_loopback(&url) {
        builder.no_proxy()
    } else {
        builder
    };
    let client = builder.build().map_err(|_| "plugin download unavailable")?;
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in headers {
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "invalid plugin ticket header")?;
        if [
            "cookie",
            "host",
            "connection",
            "proxy-authorization",
            "content-length",
            "accept-encoding",
        ]
        .contains(&name.as_str())
            || value.len() > 8192
        {
            return Err("invalid plugin ticket header".into());
        }
        let value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| "invalid plugin ticket header")?;
        request = request.header(name, value);
    }
    tokio::time::timeout(budget, async {
        // Only the short-lived ticket's own headers may reach object storage.
        // Account credentials and browser Cookies never enter this request.
        let response = request
            .send()
            .await
            .map_err(|_| "plugin bundle download failed")?;
        if response.status() != reqwest::StatusCode::OK {
            return Err("plugin bundle download failed".into());
        }
        if response.content_length().is_some_and(|v| v > max_bytes) {
            return Err("plugin bundle exceeds size limit".into());
        }
        let temporary = tempfile::NamedTempFile::new().map_err(|_| "plugin staging unavailable")?;
        lime_infra::secure_file::ensure_owner_only_permissions(temporary.path())
            .map_err(|_| "plugin staging unavailable")?;
        let mut file = tokio::fs::File::from_std(
            temporary
                .reopen()
                .map_err(|_| "plugin staging unavailable")?,
        );
        let mut size = 0u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "plugin bundle download failed")?;
            size = size
                .checked_add(chunk.len() as u64)
                .ok_or("plugin bundle exceeds size limit")?;
            if size > max_bytes {
                return Err("plugin bundle exceeds size limit".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "plugin staging unavailable")?;
        }
        file.flush()
            .await
            .map_err(|_| "plugin staging unavailable")?;
        Ok(temporary)
    })
    .await
    .map_err(|_| "plugin bundle download timed out".to_string())?
}

pub(super) fn allowed(url: &Url, loopback: Option<&url::Origin>) -> bool {
    url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && (url.scheme() == "https"
            || url.scheme() == "http" && loopback == Some(&url.origin()) && is_loopback(url))
}
pub(super) fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(host)) => host == "localhost",
        None => false,
    }
}
#[cfg(test)]
mod tests;
