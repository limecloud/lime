import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const APP_NAME = "Lime";
const DEV_BUNDLE_IDENTIFIER = "com.limecloud.lime.dev";
const DEV_APP_DIR = path.join(".lime", "electron-dev-host");
const APP_ICON_SOURCE = path.join("lime-rs", "icons", "icon.icns");
const APP_ICON_NAME = "icon.icns";

export function spawnElectron({
  electronPath,
  args = ["."],
  env = process.env,
  platform = process.platform,
  repoRoot = process.cwd(),
  shell,
  stdio = "inherit",
  runner = spawn,
} = {}) {
  const command = resolveElectronLaunchPath({
    electronPath,
    env,
    platform,
    repoRoot,
  });

  return runner(command, args, {
    env,
    stdio,
    shell: shell ?? platform === "win32",
  });
}

export function resolveElectronLaunchPath({
  electronPath,
  env = process.env,
  platform = process.platform,
  repoRoot = process.cwd(),
  prepare = prepareBrandedElectronApp,
} = {}) {
  if (!electronPath) {
    throw new Error("Electron executable path is required.");
  }
  if (platform !== "darwin" || env.LIME_ELECTRON_BRAND_DEV_APP === "0") {
    return electronPath;
  }

  return prepare({ electronPath, repoRoot }).executablePath;
}

export function prepareBrandedElectronApp({
  electronPath,
  repoRoot = process.cwd(),
  appName = APP_NAME,
  bundleIdentifier = DEV_BUNDLE_IDENTIFIER,
  iconSourcePath = path.resolve(repoRoot, APP_ICON_SOURCE),
  appDirectory = path.resolve(repoRoot, DEV_APP_DIR),
  copyApp = cpSync,
  copyFile = copyFileSync,
  fileExists = existsSync,
  makeDir = mkdirSync,
  readFile = readFileSync,
  renameFile = renameSync,
  writeFile = writeFileSync,
  signApp = codesignAppBundle,
} = {}) {
  const sourceAppPath = resolveMacElectronAppBundle(electronPath);
  makeDir(appDirectory, { recursive: true });
  const sourceExecutableName = path.basename(electronPath);
  const executableName = appName;
  const stableCandidates = [
    path.join(appDirectory, `${appName}.app`),
    path.join(appDirectory, `${appName}-dev.app`),
  ];
  for (const appPath of stableCandidates) {
    const candidate = electronAppBundlePaths(appPath, executableName);
    if (
      isBrandedElectronAppReady({
        appPath: candidate.appPath,
        executablePath: candidate.executablePath,
        infoPlistPath: candidate.infoPlistPath,
        appName,
        bundleIdentifier,
        fileExists,
        readFile,
        readLink: readlinkSync,
      })
    ) {
      return candidate;
    }
  }

  const destinationAppPath =
    stableCandidates.find((candidate) => !fileExists(candidate)) ??
    stableCandidates.at(-1) ??
    path.join(appDirectory, `${appName}-${process.pid}-${Date.now()}.app`);
  copyApp(sourceAppPath, destinationAppPath, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });

  const resourcesPath = path.join(destinationAppPath, "Contents", "Resources");
  makeDir(resourcesPath, { recursive: true });
  if (fileExists(iconSourcePath)) {
    copyFile(iconSourcePath, path.join(resourcesPath, APP_ICON_NAME));
  }

  renameMacExecutable({
    appPath: destinationAppPath,
    sourceExecutableName,
    executableName,
    fileExists,
    renameFile,
  });

  const infoPlistPath = path.join(destinationAppPath, "Contents", "Info.plist");
  const originalInfoPlist = readFile(infoPlistPath, "utf8");
  const brandedInfoPlist = brandInfoPlist(originalInfoPlist, {
    appName,
    bundleIdentifier,
    executableName,
    iconFile: APP_ICON_NAME,
  });
  if (brandedInfoPlist !== originalInfoPlist) {
    writeFile(infoPlistPath, brandedInfoPlist);
  }

  signApp(destinationAppPath);

  return {
    ...electronAppBundlePaths(destinationAppPath, executableName),
    infoPlistPath,
  };
}

function electronAppBundlePaths(appPath, executableName) {
  return {
    appPath,
    executablePath: path.join(appPath, "Contents", "MacOS", executableName),
    infoPlistPath: path.join(appPath, "Contents", "Info.plist"),
  };
}

export function isBrandedElectronAppReady({
  appPath,
  executablePath,
  infoPlistPath,
  appName = APP_NAME,
  bundleIdentifier = DEV_BUNDLE_IDENTIFIER,
  fileExists = existsSync,
  readFile = readFileSync,
  readLink = readlinkSync,
} = {}) {
  if (!fileExists(executablePath) || !fileExists(infoPlistPath)) {
    return false;
  }
  if (
    appPath &&
    !hasUsableElectronFramework({ appPath, fileExists, readLink })
  ) {
    return false;
  }
  try {
    const infoPlist = readFile(infoPlistPath, "utf8");
    return (
      infoPlist.includes(`<key>CFBundleDisplayName</key>`) &&
      infoPlist.includes(`<key>CFBundleName</key>`) &&
      infoPlist.includes(`<string>${appName}</string>`) &&
      infoPlist.includes(`<key>CFBundleExecutable</key>`) &&
      infoPlist.includes(`<string>${appName}</string>`) &&
      infoPlist.includes(`<key>CFBundleIdentifier</key>`) &&
      infoPlist.includes(`<string>${bundleIdentifier}</string>`) &&
      infoPlist.includes(`<key>CFBundleIconFile</key>`) &&
      infoPlist.includes(`<string>${APP_ICON_NAME}</string>`) &&
      [
        "NSCameraUsageDescription",
        "NSMicrophoneUsageDescription",
        "NSAppleEventsUsageDescription",
        "NSLocationUsageDescription",
        "NSLocationWhenInUseUsageDescription",
        "NSLocalNetworkUsageDescription",
      ].every((key) => Boolean(rootPlistString(infoPlist, key)?.[4]?.trim()))
    );
  } catch {
    return false;
  }
}

function hasUsableElectronFramework({
  appPath,
  fileExists = existsSync,
  readLink = readlinkSync,
}) {
  const frameworkPath = path.join(
    appPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  const requiredResourcePath = path.join(
    frameworkPath,
    "Versions",
    "A",
    "Resources",
    "icudtl.dat",
  );
  if (!fileExists(requiredResourcePath)) {
    return false;
  }

  const symlinkChecks = [
    { path: path.join(frameworkPath, "Versions", "Current"), target: "A" },
    {
      path: path.join(frameworkPath, "Resources"),
      target: path.join("Versions", "Current", "Resources"),
    },
    {
      path: path.join(frameworkPath, "Electron Framework"),
      target: path.join("Versions", "Current", "Electron Framework"),
    },
  ];

  for (const check of symlinkChecks) {
    try {
      const target = String(readLink(check.path));
      if (path.isAbsolute(target) || target !== check.target) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export function resolveMacElectronAppBundle(electronPath) {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = String(electronPath).lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `Cannot resolve macOS Electron.app bundle from executable: ${electronPath}`,
    );
  }
  return electronPath.slice(0, markerIndex);
}

export function brandInfoPlist(
  content,
  {
    appName = APP_NAME,
    bundleIdentifier = DEV_BUNDLE_IDENTIFIER,
    executableName = appName,
    iconFile = APP_ICON_NAME,
  } = {},
) {
  return setPlistStringValues(content, {
    CFBundleDisplayName: appName,
    CFBundleName: appName,
    CFBundleExecutable: executableName,
    CFBundleIdentifier: bundleIdentifier,
    CFBundleIconFile: iconFile,
    LSApplicationCategoryType: "public.app-category.productivity",
    NSCameraUsageDescription: "Lime 需要访问摄像头以使用视觉输入功能",
    NSMicrophoneUsageDescription: "Lime 需要访问麦克风以使用语音输入功能",
    NSAppleEventsUsageDescription: "Lime 需要控制其他应用以完成电脑操作",
    NSLocationUsageDescription: "Lime 需要访问位置以向获准的网站提供当前位置",
    NSLocationWhenInUseUsageDescription:
      "Lime 需要访问位置以向获准的网站提供当前位置",
    NSLocalNetworkUsageDescription: "Lime 需要连接获准的局域网服务",
  });
}

function renameMacExecutable({
  appPath,
  sourceExecutableName,
  executableName,
  fileExists = existsSync,
  renameFile = renameSync,
}) {
  if (sourceExecutableName === executableName) {
    return;
  }

  const macOsDir = path.join(appPath, "Contents", "MacOS");
  const sourcePath = path.join(macOsDir, sourceExecutableName);
  const destinationPath = path.join(macOsDir, executableName);
  if (fileExists(destinationPath) || !fileExists(sourcePath)) {
    return;
  }

  renameFile(sourcePath, destinationPath);
}

export function setPlistStringValues(content, values) {
  let next = String(content);
  for (const [key, value] of Object.entries(values)) {
    next = setPlistStringValue(next, key, value);
  }
  return next;
}

function setPlistStringValue(content, key, value) {
  const existing = rootPlistString(content, key);
  const entry = `<key>${key}</key>\n\t<string>${escapePlistString(value)}</string>`;
  if (existing) {
    return (
      content.slice(0, existing.index) +
      entry +
      content.slice(existing.index + existing[0].length)
    );
  }
  // Privacy usage strings must be root entries, outside ElectronAsarIntegrity.
  if (!/<\/dict>\s*<\/plist>\s*$/.test(content)) {
    throw new Error("Expected an XML plist with a root dictionary");
  }
  return content.replace(
    /<\/dict>(\s*<\/plist>\s*)$/,
    (_, tail) => `\t${entry}\n</dict>${tail}`,
  );
}

function rootPlistString(content, key) {
  let depth = 0;
  for (const token of content.matchAll(
    /<(\/?)(dict|array)>|<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g,
  )) {
    if (token[2]) depth += token[1] ? -1 : 1;
    else if (depth === 1 && token[3] === key) return token;
  }
}

function escapePlistString(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function codesignAppBundle(appPath) {
  const result = spawnSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    {
      stdio: "ignore",
      shell: false,
    },
  );
  if (result.error || result.status !== 0) {
    console.warn(
      `[electron-launcher] unable to ad-hoc sign ${appPath}; continuing with unsigned dev bundle`,
    );
  }
}
