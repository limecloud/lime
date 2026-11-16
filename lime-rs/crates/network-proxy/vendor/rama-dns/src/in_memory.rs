use crate::DnsResolver;
use ahash::{HashMap, HashMapExt as _};
use rama_core::error::{ErrorContext as _, OpaqueError};
use rama_net::address::{AsDomainRef, Domain, DomainTrie};
use serde::{Deserialize, Serialize, de};

use std::{
    borrow::Cow,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    sync::Arc,
};

#[derive(Debug, Clone)]
/// Wrapper struct that can be used to add
/// dns overwrites to a service Context.
///
/// This is supported by the official `rama`
/// consumers such as [`TcpConnector`].
pub struct DnsOverwrite(DnsOverwriteKind);

#[derive(Debug, Clone)]
enum DnsOverwriteKind {
    Trie(Arc<InMemoryDns>),
    Ips(Arc<Vec<IpAddr>>),
}

impl<'de> Deserialize<'de> for DnsOverwrite {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let mut map = <HashMap<Cow<'de, str>, Vec<IpAddr>>>::deserialize(deserializer)?;

        Ok(Self(
            if map.len() == 1
                && let Some(ip_addrs) = map.remove("*")
            {
                DnsOverwriteKind::Ips(Arc::new(ip_addrs))
            } else {
                let result: Result<DomainTrie<Vec<IpAddr>>, OpaqueError> = map
                    .into_iter()
                    .map(|(s, ips)| s.parse().map(|d: Domain| (d, ips)))
                    .collect();

                let trie = result.map_err(de::Error::custom)?;
                DnsOverwriteKind::Trie(Arc::new(InMemoryDns {
                    trie,
                    ..Default::default()
                }))
            },
        ))
    }
}

impl Serialize for DnsOverwrite {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match &self.0 {
            DnsOverwriteKind::Trie(in_memory_dns) => {
                let mut map = HashMap::new();
                for (domain, value) in in_memory_dns.trie.iter() {
                    map.insert(domain, value);
                }
                map.serialize(serializer)
            }
            DnsOverwriteKind::Ips(ip_addrs) => {
                let mut map = HashMap::new();
                map.insert("*", ip_addrs.as_ref());
                map.serialize(serializer)
            }
        }
    }
}

impl From<InMemoryDns> for DnsOverwrite {
    fn from(value: InMemoryDns) -> Self {
        Self(DnsOverwriteKind::Trie(Arc::new(value)))
    }
}

impl From<Vec<IpAddr>> for DnsOverwrite {
    fn from(value: Vec<IpAddr>) -> Self {
        Self(DnsOverwriteKind::Ips(Arc::new(value)))
    }
}

#[derive(Debug, Clone, Default)]
/// in-memory Dns that can be used as a simplistic cache,
/// or wrapped in [`DnsOverwrite`] to indicate dns overwrites.
pub struct InMemoryDns {
    trie: DomainTrie<Vec<IpAddr>>,
    txt_trie: DomainTrie<Vec<Vec<u8>>>,
}

impl InMemoryDns {
    /// Creates a new empty [`InMemoryDns`] instance.
    #[must_use]
    pub fn new() -> Self {
        Default::default()
    }

    /// Inserts a TXT record to the [`InMemoryDns`].
    ///
    /// Existing mappings will be overwritten.
    pub fn insert_txt_records(
        &mut self,
        name: impl AsDomainRef,
        values: Vec<Vec<u8>>,
    ) -> &mut Self {
        self.txt_trie.insert_domain(name, values);
        self
    }

    /// Inserts a domain to IP address mapping to the [`InMemoryDns`].
    ///
    /// Existing mappings will be overwritten.
    pub fn insert(&mut self, name: impl AsDomainRef, addresses: Vec<IpAddr>) -> &mut Self {
        self.trie.insert_domain(name, addresses);
        self
    }

    /// Insert an IP address for a domain.
    ///
    /// This method accepts any type that can be converted into an `IpAddr`,
    /// such as `Ipv4Addr` or `Ipv6Addr`.
    pub fn insert_address<A: Into<IpAddr>>(
        &mut self,
        name: impl AsDomainRef,
        addr: A,
    ) -> &mut Self {
        self.insert(name, vec![addr.into()])
    }

    /// Insert multiple IP addresses for a domain.
    ///
    /// This method accepts any iterator which item type can be converted into an `IpAddr`,
    /// such as `Ipv4Addr` or `Ipv6Addr`.
    pub fn insert_addresses<I: IntoIterator<Item: Into<IpAddr>>>(
        &mut self,
        name: impl AsDomainRef,
        addresses: I,
    ) -> &mut Self {
        self.insert(name, addresses.into_iter().map(Into::into).collect())
    }

    /// Extend the [`InMemoryDns`] with the given mappings.
    ///
    /// Existing mappings will be overwritten.
    pub fn extend(
        &mut self,
        overwrites: impl IntoIterator<Item = (Domain, Vec<IpAddr>)>,
    ) -> &mut Self {
        self.trie.extend(overwrites);
        self
    }
}

impl DnsResolver for DnsOverwrite {
    type Error = OpaqueError;

    async fn txt_lookup(&self, domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
        match &self.0 {
            DnsOverwriteKind::Trie(in_memory_dns) => in_memory_dns.txt_lookup(domain).await,
            DnsOverwriteKind::Ips(_) => Err(OpaqueError::from_display(
                "no txt record in ip-hardcoded dns overwrite",
            )),
        }
    }

    async fn ipv4_lookup(&self, domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
        match &self.0 {
            DnsOverwriteKind::Trie(in_memory_dns) => in_memory_dns.ipv4_lookup(domain).await,
            DnsOverwriteKind::Ips(ips) => {
                let ips: Vec<_> = ips
                    .iter()
                    .filter_map(|ip| match ip {
                        IpAddr::V4(ip) => Some(*ip),
                        IpAddr::V6(_) => None,
                    })
                    .collect();
                Ok(ips)
            }
        }
    }

    async fn ipv6_lookup(&self, domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
        match &self.0 {
            DnsOverwriteKind::Trie(in_memory_dns) => in_memory_dns.ipv6_lookup(domain).await,
            DnsOverwriteKind::Ips(ips) => {
                let ips: Vec<_> = ips
                    .iter()
                    .filter_map(|ip| match ip {
                        IpAddr::V6(ip) => Some(*ip),
                        IpAddr::V4(_) => None,
                    })
                    .collect();
                Ok(ips)
            }
        }
    }
}

impl DnsResolver for InMemoryDns {
    type Error = OpaqueError;

    async fn txt_lookup(&self, domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
        self.txt_trie
            .match_exact(domain)
            .cloned()
            .context("no value found for given TXT entry (key)")
    }

    async fn ipv4_lookup(&self, domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
        self.trie
            .match_exact(domain)
            .map(|ips| {
                ips.iter()
                    .filter_map(|ip| match ip {
                        IpAddr::V4(ip) => Some(*ip),
                        IpAddr::V6(_) => None,
                    })
                    .collect()
            })
            .ok_or_else(|| OpaqueError::from_display("no A records found for domain in memory"))
    }

    async fn ipv6_lookup(&self, domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
        self.trie
            .match_exact(domain)
            .map(|ips| {
                ips.iter()
                    .filter_map(|ip| match ip {
                        IpAddr::V4(_) => None,
                        IpAddr::V6(ip) => Some(*ip),
                    })
                    .collect()
            })
            .ok_or_else(|| OpaqueError::from_display("no AAAA records found for domain in memory"))
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr};

    use super::*;

    #[tokio::test]
    async fn test_dns_overwrite_deserialize() {
        let dns_overwrite: DnsOverwrite =
            serde_html_form::from_str("example.com=127.0.0.1").unwrap();
        assert_eq!(
            dns_overwrite
                .ipv4_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv4Addr::LOCALHOST
        );
        assert!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_json() {
        let dns_overwrite: DnsOverwrite =
            serde_json::from_str(r##"{"example.com":["127.0.0.1"]}"##).unwrap();
        assert_eq!(
            dns_overwrite
                .ipv4_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv4Addr::LOCALHOST
        );
        assert!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_ipv6() {
        let dns_overwrite: DnsOverwrite = serde_html_form::from_str("example.com=::1").unwrap();
        assert!(
            dns_overwrite
                .ipv4_lookup(Domain::example())
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv6Addr::LOCALHOST
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_ipv6_for_any() {
        let dns_overwrite: DnsOverwrite = serde_html_form::from_str("*=::1").unwrap();
        assert!(
            dns_overwrite
                .ipv4_lookup(Domain::example())
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv6Addr::LOCALHOST
        );
        assert_eq!(
            dns_overwrite
                .ipv6_lookup(Domain::from_static("plabayo.tech"))
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv6Addr::LOCALHOST
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_multi() {
        let dns_overwrite: DnsOverwrite =
            serde_html_form::from_str("example.com=127.0.0.1&example.com=127.0.0.2").unwrap();
        let mut ipv4_it = dns_overwrite
            .ipv4_lookup(Domain::example())
            .await
            .unwrap()
            .into_iter();
        assert_eq!(ipv4_it.next().unwrap(), Ipv4Addr::LOCALHOST);
        assert_eq!(ipv4_it.next().unwrap(), Ipv4Addr::new(127, 0, 0, 2));
        assert!(ipv4_it.next().is_none());
        assert!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_multi_combo() {
        let dns_overwrite: DnsOverwrite =
            serde_html_form::from_str("example.com=127.0.0.1&example.com=::1").unwrap();
        assert_eq!(
            dns_overwrite
                .ipv4_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv4Addr::LOCALHOST
        );
        assert_eq!(
            dns_overwrite
                .ipv6_lookup(Domain::example())
                .await
                .unwrap()
                .into_iter()
                .next()
                .unwrap(),
            Ipv6Addr::LOCALHOST
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_not_found() {
        let dns_overwrite: DnsOverwrite =
            serde_html_form::from_str("example.com=127.0.0.1").unwrap();
        assert!(
            dns_overwrite
                .ipv4_lookup(Domain::from_static("plabayo.tech"))
                .await
                .is_err()
        );
        assert!(
            dns_overwrite
                .ipv6_lookup(Domain::from_static("plabayo.tech"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn test_dns_overwrite_deserialize_empty() {
        let dns_overwrite: DnsOverwrite = serde_html_form::from_str("").unwrap();
        assert!(dns_overwrite.ipv4_lookup(Domain::example()).await.is_err());
        assert!(dns_overwrite.ipv6_lookup(Domain::example()).await.is_err());
    }
}
