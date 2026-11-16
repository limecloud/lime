//! dns using the [`hickory_resolver`] crate

use std::{
    net::{Ipv4Addr, Ipv6Addr},
    sync::Arc,
};

pub use hickory_resolver as resolver;
use hickory_resolver::{
    TokioResolver,
    config::{CLOUDFLARE, GOOGLE, QUAD9, ResolverConfig},
    net::runtime::TokioRuntimeProvider,
    proto::rr::{
        Name, RData,
        rdata::{A, AAAA},
    },
};

use rama_core::error::{ErrorContext, OpaqueError};
use rama_core::telemetry::tracing;
use rama_net::address::Domain;
use rama_utils::macros::generate_set_and_with;

use crate::DnsResolver;

#[derive(Debug, Clone)]
/// [`DnsResolver`] using the [`hickory_resolver`] crate
pub struct HickoryDns(Arc<TokioResolver>);

impl Default for HickoryDns {
    #[cfg(any(target_family = "unix", target_os = "windows"))]
    fn default() -> Self {
        Self::try_new_system().unwrap_or_else(|err| {
            tracing::warn!(
                "fail to create system HickoryDns client: fallback to cloudflare: {err}"
            );
            Self::new_cloudflare()
        })
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    fn default() -> Self {
        Self::new_cloudflare()
    }
}

impl HickoryDns {
    #[inline]
    /// Construct a [`HickoryDnsBuilder`] used to build
    /// a custom [`HickoryDns`] instead of the default [`HickoryDns::new`].
    #[must_use]
    pub fn builder() -> HickoryDnsBuilder {
        HickoryDnsBuilder::default()
    }

    #[inline]
    /// Construct a new [`HickoryDns`] instance with the [`Default`] setup.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    /// Construct a new non-shared [`HickoryDns`] instance using Google's nameservers.
    ///
    /// Creates a default configuration, using `8.8.8.8`, `8.8.4.4` and `2001:4860:4860::8888`,
    /// `2001:4860:4860::8844` (thank you, Google).
    ///
    /// Please see Google's [privacy
    /// statement](https://developers.google.com/speed/public-dns/privacy) for important information
    /// about what they track, many ISP's track similar information in DNS.
    ///
    /// To use the system configuration see: [`Self::new_system`].
    pub fn new_google() -> Self {
        tracing::trace!("create HickoryDns resolver using default google config");
        Self::builder()
            .with_config(ResolverConfig::udp_and_tcp(&GOOGLE))
            .build()
    }

    #[inline]
    /// Construct a new non-shared [`HickoryDns`] instance using Cloudflare's nameservers.
    ///
    /// Creates a default configuration, using `1.1.1.1`, `1.0.0.1` and `2606:4700:4700::1111`, `2606:4700:4700::1001` (thank you, Cloudflare).
    ///
    /// Please see: <https://www.cloudflare.com/dns/>
    ///
    /// To use the system configuration see: [`Self::new_system`].
    pub fn new_cloudflare() -> Self {
        tracing::trace!("create HickoryDns resolver using default cloudflare config");
        Self::builder()
            .with_config(ResolverConfig::udp_and_tcp(&CLOUDFLARE))
            .build()
    }

    #[inline]
    /// Construct a new non-shared [`HickoryDns`] instance using Quad9's nameservers.
    ///
    /// Creates a configuration, using `9.9.9.9`, `149.112.112.112` and `2620:fe::fe`, `2620:fe::fe:9`,
    /// the "secure" variants of the quad9 settings (thank you, Quad9).
    ///
    /// Please see: <https://www.quad9.net/faq/>
    ///
    /// To use the system configuration see: [`Self::new_system`].
    pub fn new_quad9() -> Self {
        tracing::trace!("create HickoryDns resolver using default quad9 config");
        Self::builder()
            .with_config(ResolverConfig::udp_and_tcp(&QUAD9))
            .build()
    }

    #[cfg(any(target_family = "unix", target_os = "windows"))]
    /// Construct a new [`HickoryDns`] with the system configuration.
    ///
    /// This will use `/etc/resolv.conf` on Unix OSes and the registry on Windows.
    pub fn try_new_system() -> Result<Self, OpaqueError> {
        tracing::trace!("try to create HickoryDns resolver using system config");
        Ok(TokioResolver::builder_tokio()
            .context("build async dns resolver with system conf")
            .inspect_err(|err| {
                tracing::debug!("failed to create HickoryDns resolver using system config: {err:?}")
            })?
            .build()
            .context("build async dns resolver with system conf")?
            .into())
    }
}

impl From<TokioResolver> for HickoryDns {
    fn from(value: TokioResolver) -> Self {
        Self(Arc::new(value))
    }
}

#[derive(Debug, Clone, Default)]
/// A [`Builder`] to [`build`][`Self::build`] a [`HickoryDns`] instance.
pub struct HickoryDnsBuilder {
    config: Option<self::resolver::config::ResolverConfig>,
    options: Option<self::resolver::config::ResolverOpts>,
}

impl HickoryDnsBuilder {
    generate_set_and_with! {
        /// Define the [`ResolverConfig`][`config::ResolverConfig`] used.
        pub fn config(mut self, config: Option<self::resolver::config::ResolverConfig>) -> Self {
            self.config = config;
            self
        }
    }

    generate_set_and_with! {
        /// Define the [`ResolverOpts`][`config::ResolverOpts`] used.
        #[must_use]
        pub fn options(mut self, options: Option<self::resolver::config::ResolverOpts>) -> Self {
            self.options = options;
            self
        }
    }

    /// Build a [`HickoryDns`] instance, consuming [`self`].
    ///
    /// [`Clone`] the [`HickoryDnsBuilder`] prior to calling this method in case you
    /// still need the builder afterwards.
    pub fn build(self) -> HickoryDns {
        let mut resolver_builder = TokioResolver::builder_with_config(
            self.config
                .unwrap_or_else(|| ResolverConfig::udp_and_tcp(&CLOUDFLARE)),
            TokioRuntimeProvider::default(),
        );
        if let Some(options) = self.options {
            *resolver_builder.options_mut() = options;
        }
        HickoryDns(Arc::new(
            resolver_builder
                .build()
                .expect("valid DNS resolver configuration"),
        ))
    }
}

impl DnsResolver for HickoryDns {
    type Error = OpaqueError;

    async fn txt_lookup(&self, domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
        let name = fqdn_from_domain(domain)?;

        let mut results = vec![];
        let lookup = self.0.txt_lookup(name).await.context("lookup TXT entry")?;
        for record in lookup.answers() {
            if let RData::TXT(txt) = &record.data {
                for value in &txt.txt_data {
                    results.push(value.to_vec());
                }
            }
        }
        Ok(results)
    }

    async fn ipv4_lookup(&self, domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
        let name = fqdn_from_domain(domain)?;
        Ok(self
            .0
            .ipv4_lookup(name)
            .await
            .context("lookup IPv4 address(es)")?
            .answers()
            .iter()
            .filter_map(|record| match &record.data {
                RData::A(A(ip)) => Some(*ip),
                _ => None,
            })
            .collect())
    }

    async fn ipv6_lookup(&self, domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
        let name = fqdn_from_domain(domain)?;
        Ok(self
            .0
            .ipv6_lookup(name)
            .await
            .context("lookup IPv6 address(es)")?
            .answers()
            .iter()
            .filter_map(|record| match &record.data {
                RData::AAAA(AAAA(ip)) => Some(*ip),
                _ => None,
            })
            .collect())
    }
}

fn fqdn_from_domain(domain: Domain) -> Result<Name, OpaqueError> {
    let mut name = Name::from_utf8(domain).context("try to consume a Domain as a Dns Name")?;
    name.set_fqdn(true);
    Ok(name)
}
