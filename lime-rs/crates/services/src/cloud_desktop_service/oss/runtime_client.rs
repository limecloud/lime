//! 软件包专用 OSS HTTPS 客户端；无自动重试、重定向、全局工具或身份回退。
//! V4 wire contract: aliyun/alibabacloud-oss-go-sdk-v2, d3474aa, oss/signer/v4.go.

use super::*;
use hmac::{Hmac, Mac};
use reqwest::{header::HeaderMap, Method, Response};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tokio::io::AsyncReadExt;

pub(super) const LIFECYCLE: &str = "<LifecycleConfiguration><Rule><ID>lime-runtime-expiry</ID><Prefix>runtime/</Prefix><Status>Enabled</Status><Expiration><Days>1</Days></Expiration><AbortMultipartUpload><Days>1</Days></AbortMultipartUpload></Rule></LifecycleConfiguration>";
pub(super) const FAILED: &str = "OSS_RUNTIME_INSPECT_OR_CLEANUP";

pub(super) struct Client {
    http: reqwest::Client,
    credentials: Credentials,
    region: String,
    bucket: String,
}

impl Client {
    pub(super) fn new(
        credentials: Credentials,
        region: &str,
        bucket: &str,
    ) -> Result<Self, String> {
        validate_region(region)?;
        validate_bucket(bucket)?;
        Ok(Self {
            http: reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(300))
                .build()
                .map_err(|_| FAILED)?,
            credentials,
            region: region.into(),
            bucket: bucket.into(),
        })
    }

    fn url(&self, key: &str) -> String {
        format!(
            "https://{}.oss-{}.aliyuncs.com/{key}",
            self.bucket, self.region
        )
    }

    async fn send(
        &self,
        method: Method,
        key: &str,
        query: &str,
        mut headers: BTreeMap<String, String>,
        body: reqwest::Body,
    ) -> Result<Response, String> {
        if self.credentials.expires_at <= chrono::Utc::now().timestamp() + 30 {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let now = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        headers.insert("x-oss-date".into(), now.clone());
        headers.insert(
            "x-oss-security-token".into(),
            self.credentials.token.clone(),
        );
        headers.insert("x-oss-content-sha256".into(), "UNSIGNED-PAYLOAD".into());
        let canonical = canonical(method.as_str(), &self.bucket, key, query, &headers);
        let (scope, signature) =
            signature(&self.credentials.secret_key, &self.region, &now, &canonical);
        headers.insert(
            "authorization".into(),
            format!(
                "OSS4-HMAC-SHA256 Credential={}/{scope},Signature={signature}",
                self.credentials.access_key
            ),
        );
        let headers: HeaderMap = headers
            .iter()
            .map(|(name, value)| {
                let mut header_value = value.parse::<reqwest::header::HeaderValue>().map_err(|_| FAILED)?;
                if matches!(name.as_str(), "authorization" | "x-oss-security-token") { header_value.set_sensitive(true); }
                Ok((
                    name.parse::<reqwest::header::HeaderName>()
                        .map_err(|_| FAILED)?,
                    header_value,
                ))
            })
            .collect::<Result<_, String>>()?;
        let url = if query.is_empty() {
            self.url(key)
        } else {
            format!("{}?{query}", self.url(key))
        };
        self.http
            .request(method, url)
            .headers(headers)
            .body(body)
            .send()
            .await
            .map_err(|_| FAILED.into())
    }

    pub(super) async fn bucket_exists(&self) -> Result<bool, String> {
        let response = self
            .send(Method::HEAD, "", "", BTreeMap::new(), "".into())
            .await?;
        match response.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            _ => Err(FAILED.into()),
        }
    }

    pub(super) async fn create(&self) -> Result<(), String> {
        let xml = format!("<CreateBucketConfiguration><LocationConstraint>oss-{}</LocationConstraint></CreateBucketConfiguration>", self.region);
        let headers = BTreeMap::from([("x-oss-acl".into(), "private".into())]);
        success(self.send(Method::PUT, "", "", headers, xml.into()).await?).map(|_| ())
    }

    pub(super) async fn configure_expiry(&self) -> Result<(), String> {
        use base64::Engine;
        let checksum = base64::engine::general_purpose::STANDARD.encode(md5::compute(LIFECYCLE).0);
        let headers = BTreeMap::from([("content-md5".into(), checksum)]);
        success(
            self.send(Method::PUT, "", "lifecycle", headers, LIFECYCLE.into())
                .await?,
        )?;
        self.verify_expiry().await
    }

    pub(super) async fn verify_expiry(&self) -> Result<(), String> {
        let response = success(
            self.send(Method::GET, "", "lifecycle", BTreeMap::new(), "".into())
                .await?,
        )?;
        let bytes = bounded(response, 16384).await?;
        let xml = String::from_utf8(bytes).map_err(|_| FAILED)?;
        // This dedicated bucket has exactly one fixed rule. Namespace and XML
        // declaration may differ; relevant server-returned fields must not.
        let compact = xml.split_whitespace().collect::<String>();
        if ![
            "<ID>lime-runtime-expiry</ID>",
            "<Prefix>runtime/</Prefix>",
            "<Status>Enabled</Status>",
            "<Expiration><Days>1</Days></Expiration>",
            "<AbortMultipartUpload><Days>1</Days></AbortMultipartUpload>",
        ]
        .iter()
        .all(|part| compact.contains(part))
        {
            return Err(FAILED.into());
        }
        Ok(())
    }

    pub(super) async fn upload(
        &self,
        key: &str,
        file: File,
        bytes: u64,
        md5: &str,
        digest: &str,
    ) -> Result<(), String> {
        let file = tokio::fs::File::from_std(file);
        let stream =
            futures::stream::try_unfold((file, 0u64), move |(mut file, received)| async move {
                let mut buffer = vec![0; 65536];
                let count = file.read(&mut buffer).await?;
                if count == 0 {
                    return if received == bytes {
                        Ok(None)
                    } else {
                        Err(std::io::Error::other("runtime package changed"))
                    };
                }
                if received + count as u64 > bytes {
                    return Err(std::io::Error::other("runtime package changed"));
                }
                buffer.truncate(count);
                Ok(Some((buffer, (file, received + count as u64))))
            });
        let headers = BTreeMap::from([
            ("content-length".into(), bytes.to_string()),
            ("content-md5".into(), md5.into()),
            ("x-oss-object-acl".into(), "private".into()),
            ("x-oss-server-side-encryption".into(), "AES256".into()),
            ("x-oss-forbid-overwrite".into(), "true".into()),
            ("x-oss-meta-lime-sha256".into(), digest.into()),
        ]);
        success(
            self.send(
                Method::PUT,
                key,
                "",
                headers,
                reqwest::Body::wrap_stream(stream),
            )
            .await?,
        )
        .map(|_| ())
    }

    pub(super) async fn verify_object(
        &self,
        key: &str,
        bytes: u64,
        digest: &str,
    ) -> Result<bool, String> {
        let response = self
            .send(Method::GET, key, "", BTreeMap::new(), "".into())
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(false);
        }
        let mut response = success(response)?;
        if response.content_length() != Some(bytes) {
            return Err(FAILED.into());
        }
        let mut count = 0u64;
        let mut hash = Sha256::new();
        while let Some(block) = response.chunk().await.map_err(|_| FAILED)? {
            count += block.len() as u64;
            if count > bytes {
                return Err(FAILED.into());
            }
            hash.update(&block);
        }
        if count != bytes || format!("{:x}", hash.finalize()) != digest {
            return Err(FAILED.into());
        }
        Ok(true)
    }

    pub(super) fn download_url(&self, key: &str) -> Result<(String, i64), String> {
        let now = chrono::Utc::now();
        let expires = (self.credentials.expires_at - now.timestamp() - 60).min(2 * 60 * 60);
        if expires < 30 * 60 {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let scope = format!("{}/{}/oss/aliyun_v4_request", &date[..8], self.region);
        let query = BTreeMap::from([
            ("x-oss-signature-version", "OSS4-HMAC-SHA256".to_owned()),
            ("x-oss-date", date.clone()),
            ("x-oss-expires", expires.to_string()),
            (
                "x-oss-credential",
                format!("{}/{scope}", self.credentials.access_key),
            ),
            ("x-oss-security-token", self.credentials.token.clone()),
        ])
        .into_iter()
        .map(|(name, value)| format!("{name}={}", escape(&value, true)))
        .collect::<Vec<_>>()
        .join("&");
        let request = canonical("GET", &self.bucket, key, &query, &BTreeMap::new());
        let (_, signature) = signature(&self.credentials.secret_key, &self.region, &date, &request);
        Ok((
            format!("{}?{query}&x-oss-signature={signature}", self.url(key)),
            now.timestamp() + expires,
        ))
    }

    pub(super) async fn object_matches(
        &self,
        key: &str,
        bytes: u64,
        digest: &str,
    ) -> Result<bool, String> {
        let response = self
            .send(Method::HEAD, key, "", BTreeMap::new(), "".into())
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(false);
        }
        let response = success(response)?;
        Ok(response.headers().get("content-length").and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok()) == Some(bytes)
            && response
                .headers()
                .get("x-oss-meta-lime-sha256")
                .and_then(|value| value.to_str().ok())
                == Some(digest)
            && response
                .headers()
                .get("x-oss-server-side-encryption")
                .and_then(|value| value.to_str().ok())
                == Some("AES256"))
    }

    pub(super) async fn cleanup(&self, key: &str) -> Result<(), String> {
        if !self.bucket_exists().await? {
            return Ok(());
        }
        let object = self
            .send(Method::DELETE, key, "", BTreeMap::new(), "".into())
            .await?;
        if object.status().as_u16() != 404 {
            success(object)?;
        }
        // DeleteBucket fails for nonempty buckets. Never recursively remove
        // unrelated objects, versions or incomplete multipart uploads.
        let bucket = self
            .send(Method::DELETE, "", "", BTreeMap::new(), "".into())
            .await?;
        if bucket.status().as_u16() != 404 {
            success(bucket)?;
        }
        if self.bucket_exists().await? {
            return Err(FAILED.into());
        }
        Ok(())
    }
}

fn success(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(FAILED.into())
    }
}

async fn bounded(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(block) = response.chunk().await.map_err(|_| FAILED)? {
        if bytes.len() + block.len() > limit {
            return Err(FAILED.into());
        }
        bytes.extend_from_slice(&block);
    }
    Ok(bytes)
}

fn escape(value: &str, separator: bool) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) || (!separator && byte == b'/') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn canonical(
    method: &str,
    bucket: &str,
    key: &str,
    query: &str,
    headers: &BTreeMap<String, String>,
) -> String {
    let mut params = query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| part.trim_end_matches('='))
        .collect::<Vec<_>>();
    params.sort_unstable();
    let headers = headers
        .iter()
        .filter(|(name, _)| {
            name.starts_with("x-oss-") || matches!(name.as_str(), "content-type" | "content-md5")
        })
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect::<String>();
    format!(
        "{method}\n{}\n{}\n{headers}\n\nUNSIGNED-PAYLOAD",
        escape(&format!("/{bucket}/{key}"), false),
        params.join("&")
    )
}

fn signature(secret: &str, region: &str, date: &str, request: &str) -> (String, String) {
    fn hmac(key: &[u8], text: &str) -> Vec<u8> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts arbitrary key sizes");
        mac.update(text.as_bytes());
        mac.finalize().into_bytes().to_vec()
    }
    let scope = format!("{}/{region}/oss/aliyun_v4_request", &date[..8]);
    let mut key = format!("aliyun_v4{secret}").into_bytes();
    for value in [&date[..8], region, "oss", "aliyun_v4_request"] {
        key = hmac(&key, value);
    }
    let text = format!(
        "OSS4-HMAC-SHA256\n{date}\n{scope}\n{:x}",
        Sha256::digest(request)
    );
    let signature = hmac(&key, &text)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    (scope, signature)
}

#[cfg(test)]
mod tests;
