type DeveloperDeferredSection =
  | "service-skill-catalog"
  | "site-adapter-catalog"
  | "workspace-repair-history"
  | "clipboard-guide";

type DeveloperDeferredModule = Promise<unknown>;

const developerDeferredLoaders: Record<
  DeveloperDeferredSection,
  () => DeveloperDeferredModule
> = {
  "service-skill-catalog": () => import("./ServiceSkillCatalogTools"),
  "site-adapter-catalog": () => import("./SiteAdapterCatalogTools"),
  "workspace-repair-history": () =>
    import("../shared/WorkspaceRepairHistoryCard"),
  "clipboard-guide": () => import("../shared/ClipboardPermissionGuideCard"),
};

function preloadDeveloperSection(section: DeveloperDeferredSection) {
  return developerDeferredLoaders[section]();
}

export function preloadDeveloperDefaultSections() {
  return Promise.all([
    preloadDeveloperSection("service-skill-catalog"),
    preloadDeveloperSection("site-adapter-catalog"),
    preloadDeveloperSection("workspace-repair-history"),
  ]);
}
