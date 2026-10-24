import process from "node:process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeI18nRtlReadinessReport,
  formatI18nRtlReadinessReport,
  runCli,
} from "./i18n-rtl-readiness-report";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lime-i18n-rtl-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("i18n rtl readiness report", () => {
  it("应盘点方向基础与主路径 RTL 敏感布局面", () => {
    const root = createTempDir();

    writeFile(
      root,
      "src/i18n/locales.ts",
      [
        "export function resolveDocumentDirection(locale?: string | null) {",
        '  document.documentElement.dir = "rtl";',
        "}",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/i18n/createI18n.ts",
      [
        "export function syncDocumentLocale() {",
        '  document.documentElement.dir = "ltr";',
        "}",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/App.tsx",
      [
        "export const App = () => (",
        '  <main className="ml-1 text-left">',
        "    <div style={{ paddingLeft: 10, left: 0, right: 0 }} />",
        "  </main>",
        ");",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/components/settings-v2/_layout/SettingsSidebar.tsx",
      [
        "export const SettingsSidebar = () => (",
        '  <aside className="flex justify-between border-l rounded-r-lg">',
        "    <span>Settings</span>",
        "  </aside>",
        ");",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/components/agent/chat/workspace/WorkspaceMainArea.tsx",
      [
        "export const WorkspaceMainArea = () => (",
        '  <section className="mr-2 text-right">',
        "    <div>Workspace</div>",
        "  </section>",
        ");",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "src/components/channels/ImConfigPage.tsx",
      [
        "export const ImConfigPage = () => (",
        '  <div className="pl-3 border-r">',
        "    <div>Channels</div>",
        "  </div>",
        ");",
        "",
      ].join("\n"),
    );
    writeFile(
      root,
      "internal/roadmap/i18n/evidence/rtl-playwright-smoke-report.json",
      JSON.stringify(
        {
          schemaVersion: "lime.i18n.rtlPlaywrightSmokeReport.v1",
          summary: {
            homeSidebarOnRight: true,
            settingsNavVisible: true,
            userMenuDialogVisible: true,
          },
        },
        null,
        2,
      ),
    );

    const report = analyzeI18nRtlReadinessReport({ repoRoot: root });

    expect(report.schemaVersion).toBe("lime.i18n.rtlReadinessReport.v1");
    expect(report.summary.directionAwareFoundationFileCount).toBe(1);
    expect(report.summary.surfaceCount).toBe(4);
    expect(report.summary.totalMarkerCount).toBeGreaterThan(0);
    expect(report.summary.highRiskFileCount).toBeGreaterThan(0);
    expect(report.summary.missingRtlScreenshotEvidence).toBe(true);
    expect(report.summary.missingPlaywrightSmokeEvidence).toBe(false);
    expect(report.summary.missingRequiredSurfaceSmokeEvidence).toBe(true);
    expect(report.summary.requiredSurfaceSmokeCoveredCount).toBe(3);
    expect(report.summary.requiredSurfaceSmokeMissingCount).toBe(1);
    expect(report.smokeCoverage).toEqual(
      expect.objectContaining({
        coveredSurfaces: ["sidebar", "settings", "dialogs"],
        missingSurfaces: ["workspace"],
        requiredSurfaces: ["sidebar", "settings", "workspace", "dialogs"],
        summaryKeys: [
          "homeSidebarOnRight",
          "settingsNavVisible",
          "userMenuDialogVisible",
        ],
      }),
    );

    const appShell = report.surfaces.find(
      (surface) => surface.name === "app-shell",
    );
    expect(appShell).toEqual(
      expect.objectContaining({
        fileCount: 1,
        markerCount: 2,
      }),
    );
    expect(appShell?.files[0]).toEqual(
      expect.objectContaining({
        path: "src/App.tsx",
        markerCount: 2,
      }),
    );

    expect(formatI18nRtlReadinessReport(report, "text")).toContain(
      "[i18n:rtl] readiness inventory",
    );
    expect(formatI18nRtlReadinessReport(report, "text")).toContain(
      "missing required surface smoke: workspace",
    );
    expect(JSON.parse(formatI18nRtlReadinessReport(report, "json"))).toEqual(
      expect.objectContaining({
        schemaVersion: "lime.i18n.rtlReadinessReport.v1",
      }),
    );
  });

  it("应识别 PRD 要求的 RTL smoke surface 全部覆盖", () => {
    const root = createTempDir();

    writeFile(
      root,
      "internal/roadmap/i18n/evidence/rtl-playwright-smoke-report.json",
      JSON.stringify(
        {
          schemaVersion: "lime.i18n.rtlPlaywrightSmokeReport.v1",
          summary: {
            homeSidebarOnRight: true,
            settingsNavVisible: true,
            userMenuDialogVisible: true,
            workspaceVisible: true,
          },
        },
        null,
        2,
      ),
    );

    const report = analyzeI18nRtlReadinessReport({ repoRoot: root });

    expect(report.summary.missingRequiredSurfaceSmokeEvidence).toBe(false);
    expect(report.summary.requiredSurfaceSmokeCoveredCount).toBe(4);
    expect(report.summary.requiredSurfaceSmokeMissingCount).toBe(0);
    expect(report.smokeCoverage.missingSurfaces).toEqual([]);
  });

  it("应支持 CLI 写出 JSON evidence", () => {
    const root = createTempDir();
    writeFile(
      root,
      "src/i18n/locales.ts",
      ["export const resolveDocumentDirection = () => 'rtl';", ""].join("\n"),
    );
    writeFile(
      root,
      "src/App.tsx",
      ['export const App = () => <main className="text-left" />;', ""].join(
        "\n",
      ),
    );

    const outFile = path.join(root, "rtl-readiness.json");
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const exitCode = runCli([
      "--format",
      "json",
      "--repo-root",
      root,
      "--output",
      outFile,
    ]);

    expect(exitCode).toBe(0);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(outFile, "utf8"))).toEqual(
      expect.objectContaining({
        schemaVersion: "lime.i18n.rtlReadinessReport.v1",
      }),
    );
  });
});
