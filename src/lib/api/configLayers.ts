import type {
  ConfigLayer,
  ConfigReadResponse,
} from "@limecloud/app-server-client";

export function isManagedSource(source: { type: string }): boolean {
  return [
    "mdm",
    "enterpriseManaged",
    "legacyManagedConfigTomlFromMdm",
    "legacyManagedConfigTomlFromFile",
  ].includes(source.type);
}

export function configLayerScope(layer: ConfigLayer): string {
  const source = layer.name;
  if (
    source.type === "user" ||
    source.type === "system" ||
    source.type === "legacyManagedConfigTomlFromFile"
  )
    return source.file;
  if (source.type === "project")
    return `${source.dotLimeFolder.replace(/[\\/]$/, "")}/config.toml`;
  if (source.type === "mdm")
    return JSON.stringify([source.type, source.domain, source.key]);
  if (source.type === "enterpriseManaged")
    return JSON.stringify([source.type, source.id]);
  return source.type;
}

export function managedConfigPaths(
  origins: ConfigReadResponse["origins"],
): string[] {
  return Object.entries(origins)
    .filter(([, origin]) => {
      if (!origin || typeof origin !== "object" || !("name" in origin))
        return false;
      const name = origin.name;
      return Boolean(
        name &&
        typeof name === "object" &&
        "type" in name &&
        typeof name.type === "string" &&
        isManagedSource({ type: name.type }),
      );
    })
    .map(([path]) => path);
}

export function isConfigFieldManaged(
  origins: ConfigReadResponse["origins"],
  field: string,
): boolean {
  return managedConfigPaths(origins).some(
    (path) =>
      path === field ||
      path.startsWith(`${field}.`) ||
      field.startsWith(`${path}.`),
  );
}
