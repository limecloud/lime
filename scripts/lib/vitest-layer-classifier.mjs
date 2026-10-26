import fs from "node:fs";
import path from "node:path";

export const VITEST_LAYER_NAMES = [
  "unit",
  "component",
  "contract",
  "integration",
  "e2e",
];

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const EXPLICIT_LAYER_PATTERN =
  /(?:^|[._-])(unit|component|contract|integration|e2e)[._-](?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const LIVE_TEST_PATTERN =
  /(?:^|[._-])live[._-](?:test|spec)\.(?:[cm]?[jt]sx?)$/i;

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const EXCLUDED_PATH_SEGMENTS = [
  "/lime-rs/target/",
  "/tmp/lime-pnpm-frozen-node_modules/",
];

const INTEGRATION_PATTERNS = [
  {
    reason: "name:integration",
    pattern: /\.integration\.(?:test|spec)\./i,
  },
  { reason: "node:fs", pattern: /\bnode:fs\b|from\s+["']fs["']|\bfs\./ },
  {
    reason: "node:child_process",
    pattern:
      /\bnode:child_process\b|from\s+["']child_process["']|\b(execFile|spawn|spawnSync|execSync)\b/,
  },
  { reason: "temp-files", pattern: /\bmkdtemp\b|\btmpdir\b/ },
  {
    reason: "local-server",
    pattern: /\bMockServer\b|\bcreateServer\b|\.listen\s*\(/,
  },
];

const E2E_PATTERNS = [
  {
    reason: "name:e2e",
    pattern: /(?:^|[._-])(?:e2e|smoke)[._-](?:test|spec)\./i,
  },
  {
    reason: "playwright",
    pattern:
      /from\s+["']@playwright\/test["']|from\s+["']playwright["']|require\(\s*["']@playwright\/test["']\s*\)|require\(\s*["']playwright["']\s*\)/,
  },
  {
    reason: "browser-automation",
    pattern:
      /\bchromium\.launch\b|\bbrowser\.newPage\b|\bpage\.goto\b|\bpage\.locator\b/,
  },
];

const NETWORK_INTEGRATION_PATTERNS = [
  {
    reason: "network-surface",
    pattern:
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bEventSource\b|\bWebSocket\b|\bnode:(?:http|https|net|tls)\b|from\s+["'](?:node:)?(?:http|https|net|tls)["']/,
  },
];

const LEGACY_DESKTOP_HOST_API_PATTERN = new RegExp(
  [
    ["@", "ta", "uri-apps", "\\/api"].join(""),
    ["__TA", "URI__"].join(""),
  ].join("|"),
);

const CONTRACT_PATTERNS = [
  { reason: "safeInvoke", pattern: /\bsafeInvoke\b|\binvoke\s*\(/ },
  { reason: "dev-bridge", pattern: /\bDevBridge\b|dev-bridge/ },
  { reason: "desktop-host-api", pattern: /desktop-host|DesktopHost/ },
  { reason: "legacy-desktop-host-api", pattern: LEGACY_DESKTOP_HOST_API_PATTERN },
  {
    reason: "command-catalog",
    pattern:
      /\bmockPriorityCommands\b|\bdefaultMocks\b|\bagentCommandCatalog\b|\bagentRuntimeCommandSchema\b|\bcheck-command-contracts\b/,
  },
];

const COMPONENT_PATTERNS = [
  { reason: "react-testing-library", pattern: /@testing-library\/react/ },
  { reason: "react-dom", pattern: /react-dom\/client|\broot\.render\s*\(/ },
  { reason: "render-hook", pattern: /\brenderHook\s*\(/ },
  {
    reason: "react-render",
    pattern: /\brender\s*\(|\bscreen\.|\bfireEvent\.|\buserEvent\.|\bwithin\s*\(|(?<![\w$.])waitFor\s*\(/,
  },
];

const BROWSER_DOM_COMPONENT_PATTERNS = [
  {
    reason: "browser-dom",
    pattern:
      /\bwindow\s*\.|\bnavigator\s*\.|\bglobalThis\s*\.\s*(?:window|document|navigator|localStorage|sessionStorage|ResizeObserver|IntersectionObserver|matchMedia)\b|(?:^|[^\w$])(?:localStorage|sessionStorage)\s*\.|\bnew\s+(?:ResizeObserver|IntersectionObserver)\b|(?:^|[^\w$])matchMedia\s*\(|\bdocument\s*\.\s*(?:createElement|createTextNode|querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName|body|documentElement|head|activeElement|addEventListener|removeEventListener|dispatchEvent|cookie|title|visibilityState|fonts)\b/,
  },
];

const LAYER_RISK_RANK = {
  unit: 0,
  component: 1,
  contract: 2,
  integration: 3,
  e2e: 4,
};

const COMPONENT_MIGRATION_KEYWORDS = [
  "filter",
  "group",
  "sort",
  "formatter",
  "format",
  "request builder",
  "runtime metadata",
  "runtime parameter",
  "execution strategy",
  "state machine",
  "reducer",
  "selector",
  "projection",
  "view model",
  "viewModel",
];

export function normalizeVitestPath(filePath) {
  return String(filePath || "").replaceAll("\\", "/");
}

export function isVitestTestFile(filePath) {
  return TEST_FILE_PATTERN.test(normalizeVitestPath(filePath));
}

function explicitLayerFromPath(filePath) {
  const match = normalizeVitestPath(filePath).match(EXPLICIT_LAYER_PATTERN);
  return match?.[1] ?? null;
}

function includesTsxPath(filePath) {
  return /\.tsx$/i.test(normalizeVitestPath(filePath));
}

function matchReasons(patterns, input) {
  return patterns
    .filter(({ pattern }) => pattern.test(input))
    .map(({ reason }) => reason);
}

function stripTextLiteralsAndComments(source) {
  return String(source || "")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, " ")
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, " ")
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1 ");
}

function countPattern(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function buildComponentUnitMigrationHints(source) {
  const hints = [];
  const testCaseCount = countPattern(source, /\b(?:it|test)\s*\(/g);
  const lineCount = source.split(/\r?\n/).length;
  const lowerSource = source.toLowerCase();
  const keywordCount = COMPONENT_MIGRATION_KEYWORDS.filter((keyword) =>
    lowerSource.includes(keyword.toLowerCase()),
  ).length;

  if (testCaseCount >= 20) {
    hints.push("large-component-suite");
  }
  if (lineCount >= 800) {
    hints.push("large-component-file");
  }
  if (keywordCount >= 4) {
    hints.push("business-logic-keywords");
  }

  return hints;
}

function createLayerClassification(
  layer,
  explicitLayer,
  reasons,
  { source = "" } = {},
) {
  return {
    layer,
    explicitLayer,
    live: false,
    reasons,
    unitMigrationHints:
      layer === "component" ? buildComponentUnitMigrationHints(source) : [],
  };
}

function shouldUseExplicitLayer(explicitLayer, detectedLayer) {
  if (!explicitLayer || !VITEST_LAYER_NAMES.includes(explicitLayer)) {
    return false;
  }
  return LAYER_RISK_RANK[explicitLayer] >= LAYER_RISK_RANK[detectedLayer];
}

export function classifyVitestTestFile({ filePath, source = "" }) {
  const normalizedPath = normalizeVitestPath(filePath);
  const text = `${normalizedPath}\n${source}`;
  const explicitLayer = explicitLayerFromPath(normalizedPath);

  if (LIVE_TEST_PATTERN.test(normalizedPath)) {
    return {
      layer: "e2e",
      explicitLayer,
      live: true,
      reasons: ["name:live"],
      unitMigrationHints: [],
    };
  }

  const e2eReasons = matchReasons(E2E_PATTERNS, text);
  if (e2eReasons.length > 0) {
    return createLayerClassification("e2e", explicitLayer, e2eReasons);
  }

  const integrationReasons = matchReasons(INTEGRATION_PATTERNS, text);
  if (integrationReasons.length > 0) {
    if (shouldUseExplicitLayer(explicitLayer, "integration")) {
      return createLayerClassification(explicitLayer, explicitLayer, [
        `name:${explicitLayer}`,
      ]);
    }
    return createLayerClassification(
      "integration",
      explicitLayer,
      integrationReasons,
    );
  }

  const contractReasons = matchReasons(CONTRACT_PATTERNS, text);
  if (contractReasons.length > 0) {
    if (shouldUseExplicitLayer(explicitLayer, "contract")) {
      return createLayerClassification(explicitLayer, explicitLayer, [
        `name:${explicitLayer}`,
      ]);
    }
    return createLayerClassification("contract", explicitLayer, contractReasons);
  }

  const networkIntegrationReasons = matchReasons(
    NETWORK_INTEGRATION_PATTERNS,
    text,
  );
  if (networkIntegrationReasons.length > 0) {
    if (shouldUseExplicitLayer(explicitLayer, "integration")) {
      return createLayerClassification(explicitLayer, explicitLayer, [
        `name:${explicitLayer}`,
      ]);
    }
    return createLayerClassification(
      "integration",
      explicitLayer,
      networkIntegrationReasons,
    );
  }

  const componentReasons = [
    ...matchReasons(COMPONENT_PATTERNS, text),
    ...matchReasons(
      BROWSER_DOM_COMPONENT_PATTERNS,
      stripTextLiteralsAndComments(source),
    ),
  ];
  if (componentReasons.length > 0 || includesTsxPath(normalizedPath)) {
    if (shouldUseExplicitLayer(explicitLayer, "component")) {
      return createLayerClassification(
        explicitLayer,
        explicitLayer,
        [`name:${explicitLayer}`],
        { source },
      );
    }
    return createLayerClassification(
      "component",
      explicitLayer,
      componentReasons.length > 0 ? componentReasons : ["extension:tsx"],
      { source },
    );
  }

  if (explicitLayer && VITEST_LAYER_NAMES.includes(explicitLayer)) {
    return createLayerClassification(
      explicitLayer,
      explicitLayer,
      [`name:${explicitLayer}`],
      { source },
    );
  }

  return createLayerClassification("unit", explicitLayer, ["default:unit"]);
}

function shouldSkipDirectory(dirName) {
  return EXCLUDED_DIR_NAMES.has(dirName);
}

function shouldSkipPath(filePath) {
  const normalized = normalizeVitestPath(path.resolve(filePath));
  return EXCLUDED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

export function collectVitestTestFiles(repoRoot = process.cwd()) {
  const results = [];

  function visit(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name) && !shouldSkipPath(entryPath)) {
          visit(entryPath);
        }
        continue;
      }

      if (!entry.isFile() || shouldSkipPath(entryPath)) {
        continue;
      }

      const relativePath = normalizeVitestPath(
        path.relative(repoRoot, entryPath),
      );
      if (isVitestTestFile(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  visit(repoRoot);
  return results.sort((a, b) => a.localeCompare(b));
}

export function readVitestTestSource(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

export function classifyVitestTestFiles(repoRoot, files) {
  return files.map((file) => ({
    file,
    ...classifyVitestTestFile({
      filePath: file,
      source: readVitestTestSource(repoRoot, file),
    }),
  }));
}
