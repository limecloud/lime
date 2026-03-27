import {
  siteApplyAdapterCatalogBootstrap,
  siteClearAdapterCatalogCache,
  type SiteAdapterCatalogStatus,
} from "@/lib/webview-api";

export const SITE_ADAPTER_CATALOG_BOOTSTRAP_EVENT =
  "lime:site-adapter-catalog-bootstrap";
export const SITE_ADAPTER_CATALOG_CHANGED_EVENT =
  "lime:site-adapter-catalog-changed";

declare global {
  interface Window {
    __LIME_BOOTSTRAP__?: unknown;
    __LIME_SITE_ADAPTER_CATALOG__?: unknown;
  }
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function emitSiteAdapterCatalogChanged(
  status: SiteAdapterCatalogStatus | null,
): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SiteAdapterCatalogStatus | null>(
      SITE_ADAPTER_CATALOG_CHANGED_EVENT,
      {
        detail: status,
      },
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function looksLikeCatalog(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.adapters);
}

function extractFromRecord(record: Record<string, unknown>): unknown | null {
  for (const key of [
    "siteAdapterCatalog",
    "site_adapter_catalog",
    "bootstrap",
    "data",
  ]) {
    const nested = record[key];
    const extracted = extractSiteAdapterCatalogFromBootstrapPayload(nested);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

export function extractSiteAdapterCatalogFromBootstrapPayload(
  payload: unknown,
): unknown | null {
  if (looksLikeCatalog(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  return extractFromRecord(payload);
}

export async function syncSiteAdapterCatalogFromBootstrapPayload(
  payload: unknown,
): Promise<SiteAdapterCatalogStatus | null> {
  const catalog = extractSiteAdapterCatalogFromBootstrapPayload(payload);
  if (!catalog) {
    return null;
  }

  try {
    const status = await siteApplyAdapterCatalogBootstrap(catalog);
    emitSiteAdapterCatalogChanged(status);
    return status;
  } catch (error) {
    console.warn("[siteAdapterCatalogBootstrap] 同步站点适配器目录失败", error);
    return null;
  }
}

export async function clearSiteAdapterCatalogCache(): Promise<SiteAdapterCatalogStatus | null> {
  try {
    const status = await siteClearAdapterCatalogCache();
    emitSiteAdapterCatalogChanged(status);
    return status;
  } catch (error) {
    console.warn("[siteAdapterCatalogBootstrap] 清理站点适配器目录失败", error);
    return null;
  }
}

export async function applyInitialSiteAdapterCatalogBootstrap(): Promise<SiteAdapterCatalogStatus | null> {
  if (!hasWindow()) {
    return null;
  }

  if (window.__LIME_SITE_ADAPTER_CATALOG__ !== undefined) {
    const directCatalog = await syncSiteAdapterCatalogFromBootstrapPayload({
      siteAdapterCatalog: window.__LIME_SITE_ADAPTER_CATALOG__,
    });
    if (directCatalog) {
      return directCatalog;
    }
  }

  return syncSiteAdapterCatalogFromBootstrapPayload(window.__LIME_BOOTSTRAP__);
}

export function emitSiteAdapterCatalogBootstrap(payload: unknown): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SITE_ADAPTER_CATALOG_BOOTSTRAP_EVENT, {
      detail: payload,
    }),
  );
}

export function subscribeSiteAdapterCatalogBootstrap(
  listener?: (status: SiteAdapterCatalogStatus | null) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    void syncSiteAdapterCatalogFromBootstrapPayload(event.detail).then(
      (status) => {
        listener?.(status);
      },
    );
  };

  window.addEventListener(SITE_ADAPTER_CATALOG_BOOTSTRAP_EVENT, handler);
  return () => {
    window.removeEventListener(SITE_ADAPTER_CATALOG_BOOTSTRAP_EVENT, handler);
  };
}

export function subscribeSiteAdapterCatalogChanged(
  listener?: (status: SiteAdapterCatalogStatus | null) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    listener?.(event.detail as SiteAdapterCatalogStatus | null);
  };

  window.addEventListener(SITE_ADAPTER_CATALOG_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(SITE_ADAPTER_CATALOG_CHANGED_EVENT, handler);
  };
}
