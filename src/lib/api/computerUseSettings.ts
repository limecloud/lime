import type {
  ComputerUseConfig,
  ComputerUseStatusResponse,
  ConfigRequirements,
  ComputerUseAdapterKind,
  ComputerUseTargetIdentity,
  ComputerUseGrantScope,
} from "@limecloud/app-server-client";
import { getConfigSnapshot, updateConfig, type Config } from "./appConfig";
import { getConfigRequirements } from "./configRequirements";
import { isConfigFieldManaged } from "./configLayers";
import { readComputerUseStatus, setupComputerUse } from "./computerUse";

export type AllowedComputerApp = {
  id: string;
  name: string;
  platform: "all" | "macos" | "windows";
  field: "default" | "bundle" | "aumid" | "exe";
  key: string;
  managed: boolean;
};

export interface ComputerUseSettingsSnapshot {
  enabled: Record<ComputerUseAdapterKind, boolean>;
  managed: Record<ComputerUseAdapterKind, boolean>;
  allowedApps: AllowedComputerApp[];
  persistentApprovalAllowed: boolean;
  status: ComputerUseStatusResponse;
}

const features = {
  native: "computer_use",
  chrome: "chrome_use",
  office: "office_use",
} as const;

export function allowedComputerApps(
  config: ComputerUseConfig | null | undefined,
): AllowedComputerApp[] {
  const entries: AllowedComputerApp[] = [];
  if (config?.default_app_access === "allow")
    entries.push({
      id: "default",
      name: "",
      platform: "all",
      field: "default",
      key: "",
      managed: false,
    });
  for (const [field, platform, values] of [
    ["bundle", "macos", config?.macos?.bundle_ids],
    ["aumid", "windows", config?.windows?.aumids],
  ] as const) {
    for (const [key, access] of Object.entries(values ?? {})) {
      if (access === "allow")
        entries.push({
          id: `${field}:${key}`,
          name: key,
          platform,
          field,
          key,
          managed: false,
        });
    }
  }
  for (const rule of config?.windows?.exes ?? []) {
    if (rule.access !== "allow") continue;
    const key = JSON.stringify([
      rule.publisher_name,
      rule.product_name,
      rule.binary_name ?? null,
    ]);
    entries.push({
      id: `exe:${key}`,
      name: rule.product_name,
      platform: "windows",
      field: "exe",
      key,
      managed: false,
    });
  }
  return entries;
}

function appPath(app: AllowedComputerApp): string {
  if (app.field === "default") return "computer_use.default_app_access";
  if (app.field === "exe") return "computer_use.windows.exes";
  return app.field === "bundle"
    ? `computer_use.macos.bundle_ids.${app.key}`
    : `computer_use.windows.aumids.${app.key}`;
}

function blocked(requirements: ConfigRequirements | null): boolean {
  return requirements?.allowBrowserAndComputerUse === false;
}

export async function getComputerUseSettings(): Promise<ComputerUseSettingsSnapshot> {
  const [snapshot, requirements, status] = await Promise.all([
    getConfigSnapshot(),
    getConfigRequirements(),
    readComputerUseStatus(),
  ]);
  const config = snapshot.config;
  return {
    persistentApprovalAllowed:
      !blocked(requirements) &&
      requirements?.computerUse?.allowPersistentApproval !== false,
    enabled: Object.fromEntries(
      Object.entries(features).map(([adapter, feature]) => [
        adapter,
        config.features?.[feature] === true,
      ]),
    ) as ComputerUseSettingsSnapshot["enabled"],
    managed: Object.fromEntries(
      Object.entries(features).map(([adapter, feature]) => [
        adapter,
        blocked(requirements) ||
          isConfigFieldManaged(snapshot.origins, `features.${feature}`),
      ]),
    ) as ComputerUseSettingsSnapshot["managed"],
    allowedApps: allowedComputerApps(config.computer_use).map((app) => ({
      ...app,
      managed: isConfigFieldManaged(snapshot.origins, appPath(app)),
    })),
    status,
  };
}

export async function setComputerUseEnabled(
  enabled: boolean,
  expected: boolean,
  adapter: ComputerUseAdapterKind = "native",
): Promise<void> {
  const feature = features[adapter];
  await updateConfig((current) => {
    if ((current.features?.[feature] === true) !== expected)
      throw new Error("Computer Use settings changed; reload before saving");
    return {
      ...current,
      features: { ...current.features, [feature]: enabled },
    };
  });
}

export async function removeAllowedComputerApp(
  app: AllowedComputerApp,
): Promise<void> {
  if (app.managed) throw new Error("Application approval is managed");
  await updateConfig((current: Config) => {
    const config = structuredClone(current.computer_use ?? {});
    if (!allowedComputerApps(config).some((entry) => entry.id === app.id))
      throw new Error("Application approval changed; reload before removing");
    // A broad default still authorizes this app; remove that rule first.
    if (app.field !== "default" && config.default_app_access === "allow")
      throw new Error(
        "Remove the default approval before removing an application",
      );
    if (app.field === "default") delete config.default_app_access;
    else if (app.field === "bundle" && config.macos?.bundle_ids)
      delete config.macos.bundle_ids[app.key];
    else if (app.field === "aumid" && config.windows?.aumids)
      delete config.windows.aumids[app.key];
    else if (app.field === "exe" && config.windows?.exes)
      config.windows.exes = config.windows.exes.filter(
        (rule) =>
          JSON.stringify([
            rule.publisher_name,
            rule.product_name,
            rule.binary_name ?? null,
          ]) !== app.key,
      );
    return { ...current, computer_use: config };
  });
}

export async function setupComputerUseAdapter(
  adapter: ComputerUseAdapterKind,
  target?: ComputerUseTargetIdentity,
  grantScope: ComputerUseGrantScope = "session",
): Promise<void> {
  // Setup without a target can request OS permissions, but cannot grant app access.
  const result = await setupComputerUse({
    adapter,
    target,
    grantScope,
  });
  if (!result.accepted || (target && !result.grant))
    throw new Error(
      result.status.reason || "Computer Use setup was not approved",
    );
}
