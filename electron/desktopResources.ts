import path from "node:path";

export function desktopApplicationPath(
  executablePath: string,
  platform: string,
): string {
  const marker = executablePath.lastIndexOf(".app/Contents/");
  return platform === "darwin" && marker >= 0
    ? executablePath.slice(0, marker + 4)
    : executablePath;
}

/** A branded Electron executable can report isPackaged during default-app development. */
export function resolveDesktopResourcesRoot(options: {
  isPackaged: boolean;
  defaultApp?: boolean;
  resourcesPath?: string;
  appPath: string;
}): string | null {
  if (options.isPackaged && options.defaultApp !== true)
    return options.resourcesPath?.trim()
      ? path.resolve(options.resourcesPath)
      : null;
  return path.resolve(options.appPath, "dist-electron");
}
