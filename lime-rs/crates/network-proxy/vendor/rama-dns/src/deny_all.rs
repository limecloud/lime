use crate::DnsResolver;
use rama_net::address::Domain;
use rama_utils::macros::error::static_str_error;
use std::net::{Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone, Default)]
#[non_exhaustive]
/// a [`DnsResolver`] implementation which
/// denies all incoming DNS requests with a [`DnsDeniedError`].
pub struct DenyAllDns;

impl DenyAllDns {
    #[inline]
    /// Create a new [`Default`] [`DenyAllDns`].
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

static_str_error! {
    #[doc = "Dns denied"]
    pub struct DnsDeniedError;
}

impl DnsResolver for DenyAllDns {
    type Error = DnsDeniedError;

    async fn txt_lookup(&self, _domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
        Err(DnsDeniedError)
    }

    async fn ipv4_lookup(&self, _domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
        Err(DnsDeniedError)
    }

    async fn ipv6_lookup(&self, _domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
        Err(DnsDeniedError)
    }
}
