import { describe, expect, it } from "vitest";

import { buildDocFreshnessReport } from "./doc-freshness-core.mjs";

describe("doc-freshness-core", () => {
  it("应在回链与路径都正常时返回 clean 报告", () => {
    const report = buildDocFreshnessReport({
      repoRoot: "/tmp/lime",
      specs: [
        {
          path: "docs/tech/harness/entropy-governance-workflow.md",
          requiredMentions: [
            "iteration-roadmap.md",
            "tooling-roadmap.md",
            "harness-evals.md",
            "scripts/report-generated-slop.mjs",
            "scripts/check-doc-freshness.mjs",
          ],
        },
      ],
      documents: [
        {
          path: "docs/tech/harness/entropy-governance-workflow.md",
          content: `
[Roadmap](iteration-roadmap.md)
[Tooling](tooling-roadmap.md)
[Evals](../../test/harness-evals.md)
\`scripts/report-generated-slop.mjs\`
\`scripts/check-doc-freshness.mjs\`
`,
        },
      ],
      deletedSurfaceTargets: ["src/lib/api/agentCompat.ts"],
      pathExists: (_absolutePath, repoRelativePath) =>
        [
          "docs/tech/harness/iteration-roadmap.md",
          "docs/tech/harness/tooling-roadmap.md",
          "docs/test/harness-evals.md",
          "scripts/report-generated-slop.mjs",
          "scripts/check-doc-freshness.mjs",
        ].includes(repoRelativePath),
    });

    expect(report.summary.issueCount).toBe(0);
    expect(report.documents[0].requiredMentions.every((entry) => entry.found)).toBe(
      true,
    );
  });

  it("应识别缺失回链、坏链接、坏路径与已删除表面引用", () => {
    const report = buildDocFreshnessReport({
      repoRoot: "/tmp/lime",
      specs: [
        {
          path: "docs/tech/harness/review-decision-workflow.md",
          requiredMentions: [
            "external-analysis-handoff.md",
            "iteration-roadmap.md",
          ],
        },
      ],
      documents: [
        {
          path: "docs/tech/harness/review-decision-workflow.md",
          content: `
[Bad Link](missing-doc.md)
\`scripts/missing-tool.mjs\`
旧入口：src/lib/api/agentCompat.ts
`,
        },
      ],
      deletedSurfaceTargets: ["src/lib/api/agentCompat.ts"],
      pathExists: () => false,
    });

    expect(report.summary.issueCount).toBe(5);
    expect(report.issues.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "missing-required-reference",
        "broken-markdown-link",
        "broken-code-path-reference",
        "deleted-surface-reference",
      ]),
    );
  });
});
