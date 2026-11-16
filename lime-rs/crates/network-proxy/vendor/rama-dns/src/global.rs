use rama_core::error::BoxError;
use rama_net::address::Domain;

use crate::{BoxDnsResolver, DnsResolver, HickoryDns};
use std::{
    net::{Ipv4Addr, Ipv6Addr},
    sync::OnceLock,
};

static GLOBAL_DNS_RESOLVER: OnceLock<BoxDnsResolver> = OnceLock::new();

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct GlobalDnsResolver;

impl GlobalDnsResolver {
    #[inline]
    /// Create a new [`GlobalDnsResolver`].
    ///
    /// This has no cost.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Default for GlobalDnsResolver {
    #[inline]
    fn default() -> Self {
        Self
    }
}

impl DnsResolver for GlobalDnsResolver {
    type Error = BoxError;

    #[inline]
    fn txt_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Vec<u8>>, Self::Error>> + Send + '_ {
        let resolver = global_dns_resolver();
        async move { resolver.txt_lookup(domain).await }
    }

    #[inline]
    fn ipv4_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Ipv4Addr>, Self::Error>> + Send + '_ {
        let resolver = global_dns_resolver();
        async move { resolver.ipv4_lookup(domain).await }
    }

    #[inline]
    fn ipv6_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Ipv6Addr>, Self::Error>> + Send + '_ {
        let resolver = global_dns_resolver();
        async move { resolver.ipv6_lookup(domain).await }
    }

    fn boxed(self) -> BoxDnsResolver {
        global_dns_resolver()
    }
}

/// Get the global [`DnsResolver`].
///
/// This is a shared once-time init dns resolver used by default in rama.
/// By default it is created in a lazy fashion using [`HickoryDns::default`].
///
/// Use [`init_global_dns_resolver`] or [`try_init_global_dns_resolver`] to overwrite
/// the global [`DnsResolver`]. This has to be done as early as possible,
/// as it fails if the global resolver was already initialised (e.g. using the default).
pub fn global_dns_resolver() -> BoxDnsResolver {
    GLOBAL_DNS_RESOLVER
        .get_or_init(default_init_global_dns_resolver)
        .clone()
}

#[inline]
fn default_init_global_dns_resolver() -> BoxDnsResolver {
    HickoryDns::default().boxed()
}

/// Initialises the global [`DnsResolver`].
///
/// # Panics
///
/// Panics in case the global [`DnsResolver`] was already set.
/// Use [`try_init_global_dns_resolver`] in case you wish to handle this more gracefully.
pub fn init_global_dns_resolver(resolver: impl DnsResolver) {
    if try_init_global_dns_resolver(resolver).is_err() {
        panic!("global DNS resolver already set");
    }
}

/// Tries to initialise the global [`DnsResolver`].
///
/// This returns the input [`DnsResolver`] boxed but useless back,
/// in case the global [`DnsResolver`] was already set.
///
/// You can use [`init_global_dns_resolver`] should you want to panic on failure instead.
pub fn try_init_global_dns_resolver(resolver: impl DnsResolver) -> Result<(), BoxDnsResolver> {
    GLOBAL_DNS_RESOLVER.set(resolver.boxed())
}
