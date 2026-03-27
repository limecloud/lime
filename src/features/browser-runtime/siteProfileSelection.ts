import type { BrowserProfileRecord, ChromeBridgeStatusSnapshot } from "./api";

type ChromeBridgeObserverSnapshot =
  ChromeBridgeStatusSnapshot["observers"][number];

function normalizeDomain(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function matchesSiteScope(
  siteScope: string | null | undefined,
  adapterDomain: string | null | undefined,
) {
  const normalizedScope = normalizeDomain(siteScope);
  const normalizedDomain = normalizeDomain(adapterDomain);
  if (!normalizedScope || !normalizedDomain) {
    return false;
  }

  return (
    normalizedDomain === normalizedScope ||
    normalizedDomain.endsWith(`.${normalizedScope}`) ||
    normalizedScope.endsWith(`.${normalizedDomain}`)
  );
}

function observerMatchesDomain(
  observer: ChromeBridgeObserverSnapshot | undefined,
  adapterDomain: string | null | undefined,
) {
  const url = observer?.last_page_info?.url;
  if (!url || !adapterDomain) {
    return false;
  }

  try {
    return matchesSiteScope(new URL(url).hostname, adapterDomain);
  } catch {
    return false;
  }
}

function findFirstProfile(
  profiles: BrowserProfileRecord[],
  predicate: (
    profile: BrowserProfileRecord,
    observer: ChromeBridgeObserverSnapshot | undefined,
  ) => boolean,
  observersByProfileKey: Map<string, ChromeBridgeObserverSnapshot>,
) {
  return (
    profiles.find((profile) =>
      predicate(profile, observersByProfileKey.get(profile.profile_key)),
    ) || null
  );
}

export function pickPreferredSiteAdapterProfile(params: {
  profiles: BrowserProfileRecord[];
  adapterDomain?: string | null;
  bridgeStatus?: ChromeBridgeStatusSnapshot | null;
}) {
  const { profiles, adapterDomain, bridgeStatus } = params;
  if (profiles.length === 0) {
    return null;
  }

  const observersByProfileKey = new Map(
    (bridgeStatus?.observers ?? []).map((observer) => [
      observer.profile_key,
      observer,
    ]),
  );

  return (
    findFirstProfile(
      profiles,
      (profile, observer) =>
        profile.transport_kind === "existing_session" &&
        observerMatchesDomain(observer, adapterDomain),
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) =>
        profile.transport_kind === "existing_session" &&
        observersByProfileKey.has(profile.profile_key) &&
        matchesSiteScope(profile.site_scope, adapterDomain),
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) =>
        profile.transport_kind === "existing_session" &&
        observersByProfileKey.has(profile.profile_key) &&
        !profile.site_scope,
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) =>
        profile.transport_kind === "managed_cdp" &&
        matchesSiteScope(profile.site_scope, adapterDomain),
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) => matchesSiteScope(profile.site_scope, adapterDomain),
      observersByProfileKey,
    ) ||
    profiles.find((profile) => profile.profile_key === "default") ||
    profiles.find((profile) => profile.transport_kind === "managed_cdp") ||
    profiles[0] ||
    null
  );
}

export function pickPreferredAttachedSiteAdapterProfile(params: {
  profiles: BrowserProfileRecord[];
  adapterDomain?: string | null;
  bridgeStatus?: ChromeBridgeStatusSnapshot | null;
}) {
  const { profiles, adapterDomain, bridgeStatus } = params;
  if (profiles.length === 0) {
    return null;
  }

  const observersByProfileKey = new Map(
    (bridgeStatus?.observers ?? []).map((observer) => [
      observer.profile_key,
      observer,
    ]),
  );

  return (
    findFirstProfile(
      profiles,
      (profile, observer) =>
        profile.transport_kind === "existing_session" &&
        observerMatchesDomain(observer, adapterDomain),
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) =>
        profile.transport_kind === "existing_session" &&
        observersByProfileKey.has(profile.profile_key) &&
        matchesSiteScope(profile.site_scope, adapterDomain),
      observersByProfileKey,
    ) ||
    findFirstProfile(
      profiles,
      (profile) =>
        profile.transport_kind === "existing_session" &&
        observersByProfileKey.has(profile.profile_key) &&
        !profile.site_scope,
      observersByProfileKey,
    ) ||
    null
  );
}

export function buildEffectiveSiteProfileKey(params: {
  manualProfileKey?: string | null;
  selectedProfileKey?: string | null;
  recommendedProfile?: Pick<BrowserProfileRecord, "profile_key"> | null;
}) {
  const manualProfileKey = params.manualProfileKey?.trim();
  if (manualProfileKey) {
    return manualProfileKey;
  }

  const selectedProfileKey = params.selectedProfileKey?.trim();
  if (selectedProfileKey) {
    return selectedProfileKey;
  }

  return params.recommendedProfile?.profile_key?.trim() || "";
}
