/* global process, NodeJS */
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ChromeExtensionCandidate {
  id: string;
  name: string;
  version: string;
  path: string;
}

interface ChromeManifest {
  name?: unknown;
  version?: unknown;
  manifest_version?: unknown;
  default_locale?: unknown;
}

async function resolveManifestName(
  extensionPath: string,
  manifest: ChromeManifest,
): Promise<string | null> {
  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  if (!name) return null;
  const messageKey = /^__MSG_(.+)__$/.exec(name)?.[1];
  if (!messageKey) return name;
  const locale =
    typeof manifest.default_locale === "string" &&
    manifest.default_locale.trim()
      ? manifest.default_locale.trim()
      : "en";
  try {
    const messages = JSON.parse(
      await readFile(
        path.join(extensionPath, "_locales", locale, "messages.json"),
        "utf8",
      ),
    ) as Record<string, { message?: unknown }>;
    const key = messageKey.toLowerCase();
    const entry =
      messages[messageKey] ??
      messages[key] ??
      Object.entries(messages).find(
        ([candidate]) => candidate.toLowerCase() === key,
      )?.[1];
    return typeof entry?.message === "string" && entry.message.trim()
      ? entry.message.trim()
      : null;
  } catch {
    return null;
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function chromeProfileRoots(
  homeDir: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "darwin") {
    return [
      path.join(homeDir, "Library", "Application Support", "Google", "Chrome"),
    ];
  }
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return localAppData
      ? [path.join(localAppData, "Google", "Chrome", "User Data")]
      : [];
  }
  return [path.join(homeDir, ".config", "google-chrome")];
}

export async function discoverChromeExtensions(
  profileRoots: readonly string[],
): Promise<ChromeExtensionCandidate[]> {
  const byId = new Map<string, ChromeExtensionCandidate>();
  for (const root of profileRoots) {
    let profiles: string[];
    try {
      profiles = await readdir(root);
    } catch {
      continue;
    }
    for (const profile of profiles) {
      if (profile !== "Default" && !profile.startsWith("Profile ")) continue;
      const extensionsDir = path.join(root, profile, "Extensions");
      let ids: string[];
      try {
        ids = await readdir(extensionsDir);
      } catch {
        continue;
      }
      for (const id of ids) {
        let versions: string[];
        try {
          versions = await readdir(path.join(extensionsDir, id));
        } catch {
          continue;
        }
        const sorted = versions.sort(compareVersions).reverse();
        for (const version of sorted) {
          const extensionPath = path.join(extensionsDir, id, version);
          let manifest: ChromeManifest;
          try {
            manifest = JSON.parse(
              await readFile(path.join(extensionPath, "manifest.json"), "utf8"),
            ) as ChromeManifest;
          } catch {
            continue;
          }
          const existing = byId.get(id);
          if (existing && compareVersions(existing.version, version) >= 0)
            break;
          const name = await resolveManifestName(extensionPath, manifest);
          byId.set(id, {
            id,
            name: name ?? id,
            version:
              typeof manifest.version === "string" && manifest.version.trim()
                ? manifest.version
                : version,
            path: extensionPath,
          });
          break;
        }
      }
    }
  }
  return [...byId.values()];
}

export async function copyChromeExtension(
  sourcePath: string,
  targetRoot: string,
  id: string,
  version: string,
): Promise<string> {
  const destination = path.join(targetRoot, `${id}-${version}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourcePath, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  return destination;
}
