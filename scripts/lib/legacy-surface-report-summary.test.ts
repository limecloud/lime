import { describe, expect, it } from "vitest";

import {
  buildLegacySurfaceSummary,
  getCommandStatus,
  getImportStatus,
  getTextCountStatus,
  getTextStatus,
} from "./legacy-surface-report-summary.mjs";

describe("legacy-surface-report-summary", () => {
  it("应正确判定各类 surface 状态", () => {
    expect(
      getImportStatus({
        violations: [],
        references: [],
        existingTargets: [],
      }),
    ).toBe("已删除");

    expect(
      getCommandStatus({
        violations: [],
        referencesByCommand: new Map([["cmd", []]]),
      }),
    ).toBe("零引用");

    expect(
      getTextStatus({
        violations: [],
        references: ["src/foo.ts"],
      }),
    ).toBe("受控");

    expect(
      getTextCountStatus({
        violations: [],
        runtimeMatches: [],
      }),
    ).toBe("零引用");
  });

  it("应汇总零引用候选、分类漂移与违规", () => {
    const summary = buildLegacySurfaceSummary({
      importResults: [
        {
          id: "import-monitor",
          classification: "compat",
          description: "import drift",
          references: [],
          existingTargets: ["src/legacy.ts"],
          violations: [],
        },
      ],
      commandResults: [
        {
          id: "command-monitor",
          classification: "current",
          referencesByCommand: new Map([["legacy_cmd", ["src/foo.ts"]]]),
          violations: ["legacy_cmd -> src/foo.ts"],
        },
      ],
      frontendTextResults: [
        {
          id: "frontend-monitor",
          classification: "deprecated",
          references: [],
          violations: [],
        },
      ],
      rustTextResults: [],
      rustTextCountResults: [],
    });

    expect(summary.zeroReferenceCandidates).toEqual([
      "import-monitor (import drift)",
    ]);
    expect(summary.classificationDriftCandidates).toEqual([
      "import-monitor -> compat / 零引用",
      "frontend-monitor -> deprecated / 零引用",
    ]);
    expect(summary.violations).toEqual([
      "command-monitor -> legacy_cmd -> src/foo.ts",
    ]);
  });
});
