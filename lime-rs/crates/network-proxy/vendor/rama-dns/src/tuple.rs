use rama_core::error::OpaqueError;
use rama_core::telemetry::tracing;
use rama_net::address::Domain;
use rama_utils::macros::all_the_tuples_no_last_special_case;
use std::net::{Ipv4Addr, Ipv6Addr};

use super::DnsResolver;

macro_rules! dns_resolve_tuple_impl {
    ($($ty:ident),+ $(,)?) => {
        #[allow(non_snake_case)]
        impl<$($ty,)+> DnsResolver for ($($ty,)+)
        where
            $(
                $ty: DnsResolver,
            )+
        {
            type Error = OpaqueError;

            async fn txt_lookup(&self, domain: Domain) -> Result<Vec<Vec<u8>>, Self::Error> {
                let ($($ty,)+) = self;

                $(
                    match $ty.txt_lookup(domain.clone()).await {
                        Ok(result) => return Ok(result),
                        Err(err) => {
                            let err = err.into();
                            tracing::debug!("failed to resolve TXT for domain '{domain}': {err}");
                        }
                    }
                )+

                Err(OpaqueError::from_display("none of the resolvers were able to resolve TXT"))
            }

            async fn ipv4_lookup(&self, domain: Domain) -> Result<Vec<Ipv4Addr>, Self::Error> {
                let ($($ty,)+) = self;

                $(
                    match $ty.ipv4_lookup(domain.clone()).await {
                        Ok(result) => return Ok(result),
                        Err(err) => {
                            let err = err.into();
                            tracing::debug!("failed to resolve A for domain '{domain}': {err}");
                        }
                    }
                )+

                Err(OpaqueError::from_display("none of the resolvers were able to resolve A"))
            }

            async fn ipv6_lookup(&self, domain: Domain) -> Result<Vec<Ipv6Addr>, Self::Error> {
                let ($($ty,)+) = self;

                $(
                    match $ty.ipv6_lookup(domain.clone()).await {
                        Ok(result) => return Ok(result),
                        Err(err) => {
                            let err = err.into();
                            tracing::debug!("failed to resolve AAAA for domain '{domain}': {err}");
                        }
                    }
                )+

                Err(OpaqueError::from_display("none of the resolvers were able to resolve AAAA"))
            }
        }
    };
}

all_the_tuples_no_last_special_case!(dns_resolve_tuple_impl);
