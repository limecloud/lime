#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type I18nRtlReadinessReportFormat = "text" | "json";

export interface I18nRtlReadinessMarker {
  kind: string;
  line: number;
  snippet: string;
}

export interface I18nRtlReadinessFileReport {
  markerCount: number;
  markers: I18nRtlReadinessMarker[];
  path: string;
}

export interface I18nRtlReadinessSurfaceReport {
  fileCount: number;
  markerCount: number;
  name: string;
  files: I18nRtlReadinessFileReport[];
}

export interface I18nRtlReadinessReport {
  foundation: {
    fileCount: number;
    hasDirectionAwareFoundation: boolean;
    markerCount: number;
    files: I18nRtlReadinessFileReport[];
  };
  repoRoot: string;
  schemaVersion: string;
  smokeCoverage: {
    coveredSurfaces: string[];
    evidencePath: string;
    missingSurfaces: string[];
    requiredSurfaces: string[];
    summaryKeys: string[];
  };
  surfaces: I18nRtlReadinessSurfaceReport[];
  summary: {
    auditedFileCount: number;
    directionAwareFoundationFileCount: number;
    highRiskFileCount: number;
    missingPlaywrightSmokeEvidence: boolean;
    missingRequiredSurfaceSmokeEvidence: boolean;
    missingRtlScreenshotEvidence: boolean;
    requiredSurfaceSmokeCoveredCount: number;
    requiredSurfaceSmokeMissingCount: number;
    surfaceCount: number;
    totalMarkerCount: number;
  };
}

interface CliOptions {
  format: I18nRtlReadinessReportFormat;
  output?: string;
  repoRoot: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REPO_ROOT = REPO_ROOT;

const RTL_FOUNDATION_FILES = [
  "src/i18n/locales.ts",
  "src/i18n/createI18n.ts",
] as const;

const RTL_SURFACE_GROUPS = [
  {
    name: "app-shell",
    files: [
      "src/App.tsx",
      "src/components/AppSidebar.tsx",
      "src/components/app-sidebar/AppSidebarConversationShelf.tsx",
    ],
  },
  {
    name: "settings",
    files: [
      "src/components/settings-v2/_layout/index.tsx",
      "src/components/settings-v2/_layout/SettingsSidebar.tsx",
      "src/components/settings-v2/general/appearance/index.tsx",
      "src/components/settings-v2/general/memory/index.tsx",
      "src/components/settings-v2/agent/providers/index.tsx",
      "src/components/settings-v2/system/channels/ChannelsDebugWorkbench.tsx",
      "src/components/settings-v2/system/channels/ChannelLogTailPanel.tsx",
      "src/components/settings-v2/system/automation/index.tsx",
      "src/components/settings-v2/coding/local-environments/LocalEnvironmentsSettings.tsx",
      "src/components/settings-v2/system/web-search/index.tsx",
      "src/components/settings-v2/system/about/index.tsx",
    ],
  },
  {
    name: "workspace",
    files: [
      "src/components/agent/chat/workspace/WorkspaceShellScene.tsx",
      "src/components/agent/chat/workspace/WorkspaceMainArea.tsx",
      "src/components/agent/chat/workspace/WorkspaceGeneralWorkbenchSidebar.tsx",
      "src/components/agent/chat/workspace/WorkspaceConversationScene.tsx",
      "src/components/agent/chat/workspace/WorkspaceHarnessDialogs.tsx",
      "src/components/workspace/document/DocumentToolbar.tsx",
      "src/components/workspace/canvas/shared/CanvasBreadcrumbHeader.tsx",
      "src/components/workspace/video/VideoSidebar.tsx",
    ],
  },
  {
    name: "dialogs",
    files: [
      "src/components/Modal.tsx",
      "src/components/channels/ImConfigPage.tsx",
      "src/components/api-key-provider/ImportExportDialog.tsx",
      "src/components/connect/ConnectConfirmDialog.tsx",
      "src/components/skills/SkillScaffoldDialog.tsx",
    ],
  },
] as const;

const REQUIRED_RTL_SMOKE_SURFACES = [
  {
    name: "sidebar",
    summaryKey: "homeSidebarOnRight",
  },
  {
    name: "settings",
    summaryKey: "settingsNavVisible",
  },
  {
    name: "workspace",
    summaryKey: "workspaceVisible",
  },
  {
    name: "dialogs",
    summaryKey: "userMenuDialogVisible",
  },
] as const;

const LAYOUT_MARKERS: Array<{ kind: string; regex: RegExp }> = [
  {
    kind: "physical-spacing-class",
    regex: /\b(?:m|p)(?:l|r)-[A-Za-z0-9[/].-]+/g,
  },
  { kind: "physical-text-align-class", regex: /\btext-(?:left|right)\b/g },
  { kind: "physical-justify-class", regex: /\bjustify-(?:start|end)\b/g },
  { kind: "physical-border-class", regex: /\bborder-(?:l|r)\b/g },
  { kind: "physical-corner-class", regex: /\brounded-(?:l|r)\b/g },
  {
    kind: "physical-position-css",
    regex:
      /\b(?:margin-left|margin-right|padding-left|padding-right|left|right|text-align|inset-inline-start|inset-inline-end)\s*:/g,
  },
  {
    kind: "direction-aware-code",
    regex:
      /documentElement\.dir|resolveDocumentDirection|isRtlLocale|\bdir\s*=/g,
  },
];

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function displayPath(filePath: string, repoRoot: string): string {
  const relative = path.relative(repoRoot, filePath);
  return normalizePath(
    relative && !relative.startsWith("..") ? relative : filePath,
  );
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!fileExists(filePath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function collectEvidenceFiles(repoRoot: string): string[] {
  const evidenceDir = path.join(
    repoRoot,
    "internal",
    "roadmap",
    "i18n",
    "evidence",
  );
  if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readMarkers(filePath: string): I18nRtlReadinessMarker[] {
  if (!fileExists(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const markers: I18nRtlReadinessMarker[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const marker of LAYOUT_MARKERS) {
      if (!marker.regex.test(line)) {
        continue;
      }

      markers.push({
        kind: marker.kind,
        line: index + 1,
        snippet: line.trim().slice(0, 180),
      });
      marker.regex.lastIndex = 0;
    }
  }

  return markers;
}

function buildFileReport(
  repoRoot: string,
  relativePath: string,
): I18nRtlReadinessFileReport | null {
  const filePath = path.join(repoRoot, relativePath);
  if (!fileExists(filePath)) {
    return null;
  }

  const markers = readMarkers(filePath);
  return {
    markerCount: markers.length,
    markers: markers.slice(0, 3),
    path: displayPath(filePath, repoRoot),
  };
}

function buildSurfaceReport(
  repoRoot: string,
  name: string,
  files: readonly string[],
): I18nRtlReadinessSurfaceReport {
  const fileReports = files
    .map((relativePath) => buildFileReport(repoRoot, relativePath))
    .filter((fileReport): fileReport is I18nRtlReadinessFileReport =>
      Boolean(fileReport),
    );
  const markerCount = fileReports.reduce(
    (total, fileReport) => total + fileReport.markerCount,
    0,
  );

  return {
    fileCount: fileReports.length,
    markerCount,
    name,
    files: fileReports.sort(
      (left, right) => right.markerCount - left.markerCount,
    ),
  };
}

function buildFoundationReport(repoRoot: string) {
  const files = RTL_FOUNDATION_FILES.map((relativePath) =>
    buildFileReport(repoRoot, relativePath),
  ).filter((fileReport): fileReport is I18nRtlReadinessFileReport =>
    Boolean(fileReport),
  );
  const markerCount = files.reduce(
    (total, fileReport) => total + fileReport.markerCount,
    0,
  );
  const hasDirectionAwareFoundation = files.some((fileReport) =>
    fileReport.markers.some((marker) => marker.kind === "direction-aware-code"),
  );

  return {
    fileCount: files.length,
    hasDirectionAwareFoundation,
    markerCount,
    files: files.sort((left, right) => right.markerCount - left.markerCount),
  };
}

function buildSmokeCoverageReport(
  repoRoot: string,
): I18nRtlReadinessReport["smokeCoverage"] {
  const evidencePath = path.join(
    repoRoot,
    "internal",
    "roadmap",
    "i18n",
    "evidence",
    "rtl-playwright-smoke-report.json",
  );
  const report = readJsonObject(evidencePath);
  const summary = isRecord(report?.summary) ? report.summary : {};
  const summaryKeys = Object.keys(summary).sort((left, right) =>
    left.localeCompare(right),
  );
  const coveredSurfaces = REQUIRED_RTL_SMOKE_SURFACES.filter(
    (surface) => summary[surface.summaryKey] === true,
  ).map((surface) => surface.name);
  const requiredSurfaces = REQUIRED_RTL_SMOKE_SURFACES.map(
    (surface) => surface.name,
  );

  return {
    coveredSurfaces,
    evidencePath: displayPath(evidencePath, repoRoot),
    missingSurfaces: requiredSurfaces.filter(
      (surface) => !coveredSurfaces.includes(surface),
    ),
    requiredSurfaces,
    summaryKeys,
  };
}

export function analyzeI18nRtlReadinessReport(
  options: Pick<CliOptions, "repoRoot">,
): I18nRtlReadinessReport {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const foundation = buildFoundationReport(repoRoot);
  const surfaces = RTL_SURFACE_GROUPS.map((group) =>
    buildSurfaceReport(repoRoot, group.name, group.files),
  );
  const allFiles = [
    ...foundation.files,
    ...surfaces.flatMap((surface) => surface.files),
  ];
  const totalMarkerCount = allFiles.reduce(
    (total, fileReport) => total + fileReport.markerCount,
    0,
  );
  const auditedFileCount = allFiles.length;
  const highRiskFileCount = allFiles.filter(
    (fileReport) => fileReport.markerCount > 0,
  ).length;
  const evidenceFiles = collectEvidenceFiles(repoRoot);
  const missingRtlScreenshotEvidence = !evidenceFiles.some((fileName) =>
    /rtl.*(screenshot|shot|capture)|screenshot.*rtl/i.test(fileName),
  );
  const missingPlaywrightSmokeEvidence = !evidenceFiles.some((fileName) =>
    /rtl.*playwright|playwright.*rtl/i.test(fileName),
  );
  const smokeCoverage = buildSmokeCoverageReport(repoRoot);

  return {
    foundation,
    repoRoot,
    schemaVersion: "lime.i18n.rtlReadinessReport.v1",
    smokeCoverage,
    surfaces,
    summary: {
      auditedFileCount,
      directionAwareFoundationFileCount: foundation.hasDirectionAwareFoundation
        ? 1
        : 0,
      highRiskFileCount,
      missingPlaywrightSmokeEvidence,
      missingRequiredSurfaceSmokeEvidence:
        smokeCoverage.missingSurfaces.length > 0,
      missingRtlScreenshotEvidence,
      requiredSurfaceSmokeCoveredCount: smokeCoverage.coveredSurfaces.length,
      requiredSurfaceSmokeMissingCount: smokeCoverage.missingSurfaces.length,
      surfaceCount: surfaces.length,
      totalMarkerCount,
    },
  };
}

export function formatI18nRtlReadinessReport(
  report: I18nRtlReadinessReport,
  format: I18nRtlReadinessReportFormat,
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const topFiles = [
    ...report.foundation.files,
    ...report.surfaces.flatMap((surface) => surface.files),
  ]
    .filter((fileReport) => fileReport.markerCount > 0)
    .sort((left, right) => right.markerCount - left.markerCount)
    .slice(0, 8);

  const lines = [
    "[i18n:rtl] readiness inventory",
    `repoRoot: ${displayPath(report.repoRoot, report.repoRoot)}`,
    `surfaces audited: ${report.summary.surfaceCount}`,
    `files audited: ${report.summary.auditedFileCount}`,
    `direction-aware foundation: ${report.summary.directionAwareFoundationFileCount > 0 ? "yes" : "no"}`,
    `rtl screenshot evidence: ${report.summary.missingRtlScreenshotEvidence ? "missing" : "present"}`,
    `rtl playwright smoke evidence: ${report.summary.missingPlaywrightSmokeEvidence ? "missing" : "present"}`,
    `required surface smoke coverage: ${report.summary.requiredSurfaceSmokeCoveredCount}/${report.smokeCoverage.requiredSurfaces.length}`,
    `missing required surface smoke: ${report.smokeCoverage.missingSurfaces.join(", ") || "(none)"}`,
    `total directional markers: ${report.summary.totalMarkerCount}`,
    `high-risk files: ${report.summary.highRiskFileCount}`,
    "top risk files:",
    ...topFiles.map(
      (fileReport) =>
        `  - ${fileReport.path}: ${fileReport.markerCount} markers${fileReport.markers.length > 0 ? ` (${fileReport.markers.map((marker) => `${marker.kind}@${marker.line}`).join(", ")})` : ""}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/i18n/i18n-rtl-readiness-report.ts [options]

只读盘点 Lime 当前 RTL readiness 的方向基础、主路径布局敏感面与缺失证据。

Options:
  --format json|text   输出格式，默认 text
  --output <file>      将输出写入文件
  --repo-root <path>   指定仓库根目录，默认当前仓库
  --help, -h           显示帮助
`);
}

function parseArgs(argv: string[]): CliOptions & { help?: boolean } {
  const options: CliOptions & { help?: boolean } = {
    format: "text",
    repoRoot: DEFAULT_REPO_ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--format") {
      const next = argv[++index];
      if (next !== "json" && next !== "text") {
        throw new Error("Expected --format json|text");
      }
      options.format = next;
      continue;
    }

    if (arg === "--output") {
      const next = argv[++index];
      if (!next) {
        throw new Error("Expected value after --output");
      }
      options.output = next;
      continue;
    }

    if (arg === "--repo-root") {
      const next = argv[++index];
      if (!next) {
        throw new Error("Expected value after --repo-root");
      }
      options.repoRoot = next;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function runCli(argv = process.argv.slice(2)): number {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const report = analyzeI18nRtlReadinessReport({
      repoRoot: options.repoRoot,
    });
    const output = formatI18nRtlReadinessReport(report, options.format);
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, output);
    } else {
      process.stdout.write(output);
    }
    return 0;
  } catch (error) {
    process.stderr.write(
      `[i18n:rtl] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runCli();
}
