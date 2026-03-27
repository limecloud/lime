import path from "node:path";

export const DOC_FRESHNESS_SPECS = [
  {
    path: "docs/tech/harness/README.md",
    requiredMentions: [
      "iteration-roadmap.md",
      "review-decision-workflow.md",
      "tooling-roadmap.md",
      "entropy-governance-workflow.md",
    ],
  },
  {
    path: "docs/tech/harness/iteration-roadmap.md",
    requiredMentions: [
      "review-decision-workflow.md",
      "tooling-roadmap.md",
      "entropy-governance-workflow.md",
      "scripts/report-generated-slop.mjs",
      "scripts/check-doc-freshness.mjs",
    ],
  },
  {
    path: "docs/tech/harness/tooling-roadmap.md",
    requiredMentions: [
      "harness-evals.md",
      "scripts/report-generated-slop.mjs",
      "scripts/check-doc-freshness.mjs",
    ],
  },
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
  {
    path: "docs/tech/harness/review-decision-workflow.md",
    requiredMentions: [
      "external-analysis-handoff.md",
      "iteration-roadmap.md",
    ],
  },
  {
    path: "docs/tech/harness/external-analysis-handoff.md",
    requiredMentions: [
      "iteration-roadmap.md",
      "review-decision-workflow.md",
      "tooling-roadmap.md",
    ],
  },
  {
    path: "docs/tech/harness/implementation-blueprint.md",
    requiredMentions: [
      "harness-evals.md",
      "scripts/report-generated-slop.mjs",
    ],
  },
  {
    path: "docs/test/harness-evals.md",
    requiredMentions: [
      "tooling-roadmap.md",
      "entropy-governance-workflow.md",
      "scripts/report-generated-slop.mjs",
      "scripts/check-doc-freshness.mjs",
    ],
  },
  {
    path: "docs/aiprompts/governance.md",
    requiredMentions: [],
  },
  {
    path: "docs/aiprompts/quality-workflow.md",
    requiredMentions: [],
  },
];

const LOCAL_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const REPO_PATH_TOKEN_PATTERN =
  /(^|[\s("'`])((?:docs|scripts|src|src-tauri|\.github)\/[A-Za-z0-9._/-]+(?:\.[A-Za-z0-9]+)?)/gm;
const REPO_ROOT_RELATIVE_PREFIXES = [
  "docs/",
  "scripts/",
  "src/",
  "src-tauri/",
  ".github/",
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function stripAnchor(target) {
  const anchorIndex = target.indexOf("#");
  return anchorIndex >= 0 ? target.slice(0, anchorIndex) : target;
}

function cleanLinkTarget(target) {
  const trimmed = String(target ?? "").trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("vscode:") ||
    trimmed.startsWith("file://")
  ) {
    return "";
  }

  const withoutAngleBrackets =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const withoutTitle = withoutAngleBrackets.split(/\s+"/, 1)[0];
  const withoutAnchor = stripAnchor(withoutTitle);

  return withoutAnchor.includes("<") ? "" : withoutAnchor;
}

function resolveRepoPath({ repoRoot, documentPath, rawPath }) {
  const cleanedPath = cleanLinkTarget(rawPath);
  if (!cleanedPath) {
    return null;
  }

  const normalizedRepoRoot = path.resolve(repoRoot);
  let absolutePath = "";

  if (path.isAbsolute(cleanedPath)) {
    const normalizedAbsolute = path.resolve(cleanedPath);
    if (!normalizedAbsolute.startsWith(normalizedRepoRoot)) {
      return null;
    }
    absolutePath = normalizedAbsolute;
  } else if (
    REPO_ROOT_RELATIVE_PREFIXES.some((prefix) => cleanedPath.startsWith(prefix))
  ) {
    absolutePath = path.resolve(normalizedRepoRoot, cleanedPath);
  } else {
    absolutePath = path.resolve(
      normalizedRepoRoot,
      path.dirname(documentPath),
      cleanedPath,
    );
  }

  const repoRelativePath = normalizePath(
    path.relative(normalizedRepoRoot, absolutePath),
  );
  if (repoRelativePath.startsWith("..")) {
    return null;
  }

  return {
    absolutePath,
    repoRelativePath,
  };
}

function collectLocalLinks(content) {
  const results = [];
  for (const match of content.matchAll(LOCAL_LINK_PATTERN)) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }
    results.push(rawTarget);
  }
  return [...new Set(results)];
}

function collectRepoPathTokens(content) {
  const results = [];
  for (const match of content.matchAll(REPO_PATH_TOKEN_PATTERN)) {
    const rawTarget = match[2];
    if (!rawTarget) {
      continue;
    }
    results.push(rawTarget.trim());
  }
  return [...new Set(results)];
}

function createIssue(kind, documentPath, detail) {
  return {
    kind,
    documentPath,
    detail,
  };
}

export function buildDocFreshnessReport({
  repoRoot,
  documents,
  deletedSurfaceTargets = [],
  pathExists,
  specs = DOC_FRESHNESS_SPECS,
}) {
  const documentsByPath = new Map(
    (Array.isArray(documents) ? documents : []).map((entry) => [
      normalizePath(entry.path),
      String(entry.content ?? ""),
    ]),
  );
  const issues = [];
  const documentReports = [];

  for (const spec of specs) {
    const documentPath = normalizePath(spec.path);
    const content = documentsByPath.get(documentPath);

    if (content == null) {
      issues.push(createIssue("missing-document", documentPath, documentPath));
      documentReports.push({
        path: documentPath,
        exists: false,
        requiredMentions: [],
        localLinks: [],
        codePathMentions: [],
        deletedSurfaceReferences: [],
      });
      continue;
    }

    const requiredMentions = (spec.requiredMentions ?? []).map((needle) => ({
      needle,
      found: content.includes(needle),
    }));
    for (const entry of requiredMentions) {
      if (!entry.found) {
        issues.push(
          createIssue("missing-required-reference", documentPath, entry.needle),
        );
      }
    }

    const localLinks = collectLocalLinks(content).map((rawTarget) => {
      const resolved = resolveRepoPath({
        repoRoot,
        documentPath,
        rawPath: rawTarget,
      });
      if (!resolved) {
        return {
          rawTarget,
          repoRelativePath: "",
          exists: true,
        };
      }

      const exists = pathExists(resolved.absolutePath, resolved.repoRelativePath);
      if (!exists) {
        issues.push(
          createIssue(
            "broken-markdown-link",
            documentPath,
            `${rawTarget} -> ${resolved.repoRelativePath}`,
          ),
        );
      }

      return {
        rawTarget,
        repoRelativePath: resolved.repoRelativePath,
        exists,
      };
    });

    const codePathMentions = collectRepoPathTokens(content).map((rawTarget) => {
      const resolved = resolveRepoPath({
        repoRoot,
        documentPath,
        rawPath: rawTarget,
      });
      if (!resolved) {
        return {
          rawTarget,
          repoRelativePath: "",
          exists: true,
        };
      }

      const exists = pathExists(resolved.absolutePath, resolved.repoRelativePath);
      if (!exists) {
        issues.push(
          createIssue(
            "broken-code-path-reference",
            documentPath,
            `${rawTarget} -> ${resolved.repoRelativePath}`,
          ),
        );
      }

      return {
        rawTarget,
        repoRelativePath: resolved.repoRelativePath,
        exists,
      };
    });

    const deletedSurfaceReferences = [...new Set(deletedSurfaceTargets)]
      .filter(Boolean)
      .filter((target) => content.includes(target));
    for (const target of deletedSurfaceReferences) {
      issues.push(
        createIssue("deleted-surface-reference", documentPath, target),
      );
    }

    documentReports.push({
      path: documentPath,
      exists: true,
      requiredMentions,
      localLinks,
      codePathMentions,
      deletedSurfaceReferences,
    });
  }

  const summary = {
    monitoredDocumentCount: specs.length,
    existingDocumentCount: documentReports.filter((entry) => entry.exists).length,
    issueCount: issues.length,
    missingDocumentCount: issues.filter((entry) => entry.kind === "missing-document")
      .length,
    missingRequiredReferenceCount: issues.filter(
      (entry) => entry.kind === "missing-required-reference",
    ).length,
    brokenMarkdownLinkCount: issues.filter(
      (entry) => entry.kind === "broken-markdown-link",
    ).length,
    brokenCodePathReferenceCount: issues.filter(
      (entry) => entry.kind === "broken-code-path-reference",
    ).length,
    deletedSurfaceReferenceCount: issues.filter(
      (entry) => entry.kind === "deleted-surface-reference",
    ).length,
  };

  return {
    reportVersion: "v1",
    generatedAt: new Date().toISOString(),
    repoRoot: path.resolve(repoRoot),
    summary,
    documents: documentReports,
    issues,
  };
}

export function renderDocFreshnessText(report) {
  const lines = [
    "[lime] doc freshness report",
    `[lime] monitored docs: ${report.summary.monitoredDocumentCount}`,
    `[lime] existing docs: ${report.summary.existingDocumentCount}`,
    `[lime] issues: ${report.summary.issueCount}`,
    `[lime] missing docs: ${report.summary.missingDocumentCount}`,
    `[lime] missing required refs: ${report.summary.missingRequiredReferenceCount}`,
    `[lime] broken markdown links: ${report.summary.brokenMarkdownLinkCount}`,
    `[lime] broken code path refs: ${report.summary.brokenCodePathReferenceCount}`,
    `[lime] deleted surface refs: ${report.summary.deletedSurfaceReferenceCount}`,
  ];

  if (report.issues.length === 0) {
    lines.push("[lime] doc freshness: clean");
    return `${lines.join("\n")}\n`;
  }

  lines.push("[lime] issues:");
  for (const issue of report.issues) {
    lines.push(`  - [${issue.kind}] ${issue.documentPath} -> ${issue.detail}`);
  }

  return `${lines.join("\n")}\n`;
}
