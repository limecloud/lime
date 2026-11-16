use std::{
    net::{Ipv4Addr, Ipv6Addr},
    pin::Pin,
    sync::Arc,
};

use rama_core::error::BoxError;
use rama_net::address::Domain;

use crate::DnsResolver;

/// Internal trait for dynamic dispatch of Async Traits,
/// implemented according to the pioneers of this Design Pattern
/// found at <https://rust-lang.github.io/async-fundamentals-initiative/evaluation/case-studies/builder-provider-api.html#dynamic-dispatch-behind-the-api>
/// and widely published at <https://blog.rust-lang.org/inside-rust/2023/05/03/stabilizing-async-fn-in-trait.html>.
trait DynDnsResolver {
    type Error;

    fn txt_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Vec<u8>>, Self::Error>> + Send + '_>>;

    fn ipv4_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Ipv4Addr>, Self::Error>> + Send + '_>>;

    fn ipv6_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Ipv6Addr>, Self::Error>> + Send + '_>>;
}

impl<T: DnsResolver> DynDnsResolver for T {
    type Error = T::Error;

    fn txt_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Vec<u8>>, Self::Error>> + Send + '_>> {
        Box::pin(self.txt_lookup(domain))
    }

    fn ipv4_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Ipv4Addr>, Self::Error>> + Send + '_>> {
        Box::pin(self.ipv4_lookup(domain))
    }

    fn ipv6_lookup_box(
        &self,
        domain: Domain,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Ipv6Addr>, Self::Error>> + Send + '_>> {
        Box::pin(self.ipv6_lookup(domain))
    }
}

/// A boxed [`DnsResolver`], to resolve dns,
/// for where you require dynamic dispatch.
pub struct BoxDnsResolver {
    inner: Arc<dyn DynDnsResolver<Error = BoxError> + Send + Sync + 'static>,
}

impl Clone for BoxDnsResolver {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl BoxDnsResolver {
    /// Create a new [`BoxDnsResolver`] from the given dns resolver.
    #[inline]
    pub fn new(resolver: impl DnsResolver) -> Self {
        Self {
            inner: Arc::new(BoxedInnerDnsResolver(resolver)),
        }
    }
}

impl std::fmt::Debug for BoxDnsResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BoxDnsResolver").finish()
    }
}

impl DnsResolver for BoxDnsResolver {
    type Error = BoxError;

    #[inline]
    fn txt_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Vec<u8>>, Self::Error>> + Send + '_ {
        self.inner.txt_lookup_box(domain)
    }

    #[inline]
    fn ipv4_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Ipv4Addr>, Self::Error>> + Send + '_ {
        self.inner.ipv4_lookup_box(domain)
    }

    #[inline]
    fn ipv6_lookup(
        &self,
        domain: Domain,
    ) -> impl Future<Output = Result<Vec<Ipv6Addr>, Self::Error>> + Send + '_ {
        self.inner.ipv6_lookup_box(domain)
    }

    fn boxed(self) -> BoxDnsResolver {
        self
    }
}

struct BoxedInnerDnsResolver<R>(R);

impl<R> DnsResolver for BoxedInnerDnsResolver<R>
where
    R: DnsResolver,
{
    type Error = BoxError;

    #[inline]
    async fn txt_lookup(&self, domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
        self.0.txt_lookup(domain).await.map_err(Into::into)
    }

    #[inline]
    async fn ipv4_lookup(&self, domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
        self.0.ipv4_lookup(domain).await.map_err(Into::into)
    }

    #[inline]
    async fn ipv6_lookup(&self, domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
        self.0.ipv6_lookup(domain).await.map_err(Into::into)
    }

    fn boxed(self) -> BoxDnsResolver {
        BoxDnsResolver {
            inner: Arc::new(self),
        }
    }
}
