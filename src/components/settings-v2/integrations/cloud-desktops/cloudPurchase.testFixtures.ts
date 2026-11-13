import type { CloudDesktopParams } from "@limecloud/app-server-client";

/** Explicit fixture for the service-owned, quote-bound network observation. */
export function purchaseNetworkProof(
  params: Extract<CloudDesktopParams, { action: "preflightEcsPurchase" }>,
) {
  return {
    data: {
      quoteId: params.quoteId,
      networkReady: true,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}
