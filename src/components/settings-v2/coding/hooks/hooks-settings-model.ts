import type { HookMetadata, HooksListEntry } from "@/lib/api/hooks";

export type HookSourceGroup =
  | "user"
  | "admin"
  | "plugin"
  | "project"
  | "sessionFlags"
  | "unknown";
export interface HookSourceEntry extends HooksListEntry {
  id: string;
  source: HookSourceGroup;
  pluginId?: string | null;
}

// Source: hooks-settings-model in the Desktop ASAR; local names are descriptive,
// since the shipped module only exports minified bindings (see the execution plan).
export function hookSourceGroup(
  source: HookMetadata["source"],
): HookSourceGroup {
  switch (source) {
    case "system":
    case "mdm":
    case "cloudRequirements":
    case "cloudManagedConfig":
    case "legacyManagedConfigFile":
    case "legacyManagedConfigMdm":
      return "admin";
    default:
      return source;
  }
}

export function needsHookReview(hook: HookMetadata): boolean {
  return hook.trustStatus === "untrusted" || hook.trustStatus === "modified";
}

export function hookSourceEntries(data: HooksListEntry[]): HookSourceEntry[] {
  const result: HookSourceEntry[] = [];
  const aggregate = (source: HookSourceGroup, pluginId?: string | null) => {
    const matching = data.flatMap((entry) =>
      entry.hooks.filter(
        (hook) =>
          hookSourceGroup(hook.source) === source &&
          (source !== "plugin" || (hook.pluginId ?? null) === pluginId),
      ),
    );
    const unique = new Map<string, HookMetadata>();
    for (const hook of matching)
      if (!unique.has(hook.key)) unique.set(hook.key, hook);
    const hooks = [...unique.values()];
    const keys = new Set(hooks.map((hook) => hook.key));
    const entries = data.filter(
      (entry) =>
        entry.hooks.some((hook) => keys.has(hook.key)) ||
        (source === "unknown" &&
          entry.hooks.length === 0 &&
          (entry.warnings.length > 0 || entry.errors.length > 0)),
    );
    if (hooks.length === 0 && entries.length === 0) return;
    result.push({
      id: JSON.stringify([source, pluginId ?? null]),
      source,
      pluginId,
      cwd: "",
      hooks,
      warnings: [...new Set(entries.flatMap((entry) => entry.warnings))],
      errors: [
        ...new Map(
          entries
            .flatMap((entry) => entry.errors)
            .map((error) => [
              JSON.stringify([error.path, error.message]),
              error,
            ]),
        ).values(),
      ],
    });
  };
  aggregate("user");
  aggregate("admin");
  const plugins = new Set(
    data.flatMap((entry) =>
      entry.hooks
        .filter((hook) => hook.source === "plugin")
        .map((hook) => hook.pluginId ?? null),
    ),
  );
  [...plugins]
    .sort((a, b) => (a == null ? 1 : b == null ? -1 : a.localeCompare(b)))
    .forEach((id) => aggregate("plugin", id));
  for (const entry of data) {
    const hooks = entry.hooks.filter((hook) => hook.source === "project");
    if (hooks.length > 0)
      result.push({
        ...entry,
        id: JSON.stringify(["project", entry.cwd]),
        source: "project",
        hooks,
      });
  }
  aggregate("sessionFlags");
  aggregate("unknown");
  return result;
}

export function hooksByEvent(hooks: HookMetadata[]) {
  return [...new Set(hooks.map((hook) => hook.eventName))].map((eventName) => ({
    eventName,
    hooks: hooks
      .filter((hook) => hook.eventName === eventName)
      .sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}
