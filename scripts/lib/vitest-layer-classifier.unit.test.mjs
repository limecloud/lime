import { describe, expect, it } from "vitest";

import {
  classifyVitestTestFile,
  isVitestTestFile,
  normalizeVitestPath,
} from "./vitest-layer-classifier.mjs";

function sample(...parts) {
  return parts.join("");
}

describe("vitest-layer-classifier unit boundary", () => {
  it("应识别 Vitest 测试文件路径并归一 Windows 分隔符", () => {
    expect(isVitestTestFile("src/lib/foo.test.ts")).toBe(true);
    expect(isVitestTestFile("src/lib/foo.spec.tsx")).toBe(true);
    expect(isVitestTestFile("src/lib/foo.ts")).toBe(false);
    expect(normalizeVitestPath("src\\lib\\foo.test.ts")).toBe(
      "src/lib/foo.test.ts",
    );
  });

  it("无外部边界的 TypeScript 测试默认归为 unit", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/lib/model/providerModelLoadOptions.test.ts",
        source: "import { describe, expect, it } from 'vitest';",
      }),
    ).toMatchObject({
      layer: "unit",
      reasons: ["default:unit"],
    });
  });

  it("React 或 jsdom 测试应归为 component", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/components/Foo.test.tsx",
        source: sample(
          "import { render, screen } from '@testing-library",
          "/react';",
        ),
      }),
    ).toMatchObject({
      layer: "component",
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/components/Foo.test.ts",
        source: sample("expect(win", "dow.local", "Storage).toBeDefined();"),
      }),
    ).toMatchObject({
      layer: "component",
    });
  });

  it("Vitest 异步断言轮询不属于 React 组件边界", () => {
    expect(
      classifyVitestTestFile({
        filePath: "electron/host.test.ts",
        source: "await vi.waitFor(() => expect(connection.ready).toBe(true));",
      }),
    ).toMatchObject({ layer: "unit", reasons: ["default:unit"] });

    expect(
      classifyVitestTestFile({
        filePath: "src/hooks/composer.test.ts",
        source: "await waitFor(() => expect(editor.ready).toBe(true));",
      }),
    ).toMatchObject({ layer: "component", reasons: ["react-render"] });
  });

  it("普通字符串或注释中的浏览器词不应误归为 component", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/i18n/__tests__/types.test.ts",
        source: [
          "import { describe, expect, it } from 'vitest';",
          "const keys = [",
          "  'workspace.document.editor.placeholder',",
          "  'errors.svgRenderer.error.renderFailed',",
          "  'settings.browser.window.navigator.label',",
          "];",
          "// document window localStorage 只是注释中的词",
          "it('checks translation keys', () => expect(keys).toHaveLength(3));",
        ].join("\n"),
      }),
    ).toMatchObject({
      layer: "unit",
      reasons: ["default:unit"],
    });
  });

  it("真实浏览器全局对象代码引用仍应归为 component", () => {
    const samples = [
      {
        filePath: "src/lib/api/skillCatalog.test.ts",
        source:
          "it('reads storage', () => expect(window.localStorage).toBeDefined());",
      },
      {
        filePath: "src/lib/layered-design/analyzer.test.ts",
        source:
          "it('creates element', () => document.createElement('canvas'));",
      },
      {
        filePath: "src/components/Foo.test.ts",
        source:
          "it('matches media', () => expect(matchMedia('(dark)')).toBeDefined());",
      },
      {
        filePath: "src/components/Foo.test.ts",
        source:
          "it('observes resize', () => expect(new ResizeObserver(() => undefined)).toBeDefined());",
      },
    ];

    for (const sample of samples) {
      expect(classifyVitestTestFile(sample)).toMatchObject({
        layer: "component",
        reasons: ["browser-dom"],
      });
    }
  });

  it("局部 document 领域对象不应误归为 component", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/lib/layered-design/documentProjection.test.ts",
        source: [
          "import { describe, expect, it } from 'vitest';",
          "it('exports layered document', () => {",
          "  const document = createLayeredDesignDocument({ layers: [] });",
          "  expect(document.layers).toHaveLength(0);",
          "});",
        ].join("\n"),
      }),
    ).toMatchObject({
      layer: "unit",
      reasons: ["default:unit"],
    });
  });

  it("显式 unit 后缀不能掩盖 React/jsdom 组件边界", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/components/Foo.unit.test.tsx",
        source: sample(
          "import { render, screen } from '@testing-library",
          "/react';",
        ),
      }),
    ).toMatchObject({
      layer: "component",
      explicitLayer: "unit",
    });
  });

  it("组件测试可标记适合继续抽 VM 的候选信号", () => {
    const source = [
      sample("import { render, screen } from '@testing-library", "/react';"),
      "describe('heavy component', () => {",
      ...Array.from(
        { length: 20 },
        (_, index) =>
          `it('case ${index}', () => { expect(screen).toBeDefined(); });`,
      ),
      "it('covers business projection', () => {",
      "expect('filter group sort formatter request builder runtime metadata reducer selector').toBeTruthy();",
      "});",
      "});",
    ].join("\n");

    expect(
      classifyVitestTestFile({
        filePath: "src/components/Foo.test.tsx",
        source,
      }),
    ).toMatchObject({
      layer: "component",
      unitMigrationHints: ["large-component-suite", "business-logic-keywords"],
    });
  });

  it("Desktop Host / bridge / command catalog 测试应归为 contract", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/lib/api/agent.test.ts",
        source: sample(
          "import { safe",
          "Invoke } from '../dev",
          "-bridge/safe",
          "Invoke';",
        ),
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["safeInvoke", "dev-bridge"],
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/lib/desktop-host/core.test.ts",
        source: "import { describe, expect, it } from 'vitest';",
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["desktop-host-api"],
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/lib/governance/commands.test.ts",
        source: sample(
          "expect(mockPriority",
          "Commands).toContain('agent_runtime_submit_turn');",
        ),
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["command-catalog"],
    });
  });

  it("legacy desktop host API 测试只能作为旧宿主 contract 信号", () => {
    const legacyHostPackage = ["@", "ta", "uri-apps/api/core"].join("");
    const legacyHostGlobal = ["__TA", "URI__"].join("");

    expect(
      classifyVitestTestFile({
        filePath: "src/lib/legacy-host/adapter.test.ts",
        source: sample(`import { invoke } from '${legacyHostPackage}';`),
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["legacy-desktop-host-api"],
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/lib/legacy-host/window.test.ts",
        source: `expect(globalThis.${legacyHostGlobal}).toBeDefined();`,
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["legacy-desktop-host-api"],
    });
  });

  it("文件系统、子进程、网络和显式 integration 名称应归为 integration", () => {
    const samples = [
      {
        filePath: "scripts/foo.test.ts",
        source: sample("import fs from 'node:", "fs';"),
      },
      {
        filePath: "scripts/foo.test.ts",
        source: sample(
          "import { spa",
          "wnSync } from 'node:child",
          "_process';",
        ),
      },
      {
        filePath: "scripts/foo.test.ts",
        source: sample("await fet", "ch('http://127.0.0.1:3030/health');"),
      },
      {
        filePath: sample("src/components/Foo.integra", "tion.test.tsx"),
        source: sample("import { render } from '@testing-library", "/react';"),
      },
      {
        filePath: sample("src/lib/api/project-integra", "tion.test.ts"),
        source: "import { describe, expect, it } from 'vitest';",
      },
    ];

    for (const sample of samples) {
      expect(classifyVitestTestFile(sample)).toMatchObject({
        layer: "integration",
      });
    }
  });

  it("更高风险边界优先于组件特征", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/components/Foo.test.tsx",
        source: sample(
          "import { render } from '@testing-library",
          "/react'; import fs from 'node:",
          "fs';",
        ),
      }),
    ).toMatchObject({
      layer: "integration",
    });
  });

  it("显式低风险后缀不能掩盖契约、集成或 E2E 边界", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/lib/api/project.unit.test.ts",
        source: sample("import fs from 'node:", "fs';"),
      }),
    ).toMatchObject({
      layer: "integration",
      explicitLayer: "unit",
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/lib/api/project.unit.test.ts",
        source: sample(
          "import { safe",
          "Invoke } from '@/lib/dev",
          "-bridge/safe",
          "Invoke';",
        ),
      }),
    ).toMatchObject({
      layer: "contract",
      explicitLayer: "unit",
    });

    expect(
      classifyVitestTestFile({
        filePath: "src/features/browser.unit.test.ts",
        source: sample("import { test } from '@playwright", "/test';"),
      }),
    ).toMatchObject({
      layer: "e2e",
      explicitLayer: "unit",
    });
  });

  it("显式高风险后缀可以把无外部边界的测试提升到对应层", () => {
    expect(
      classifyVitestTestFile({
        filePath: "src/lib/parser.contract.test.ts",
        source: "import { describe, expect, it } from 'vitest';",
      }),
    ).toMatchObject({
      layer: "contract",
      reasons: ["name:contract"],
    });

    expect(
      classifyVitestTestFile({
        filePath: sample("src/components/Foo.integra", "tion.test.tsx"),
        source: sample("import { render } from '@testing-library", "/react';"),
      }),
    ).toMatchObject({
      layer: "integration",
      reasons: ["name:integration"],
    });
  });

  it("显式 e2e / smoke / live 和 Playwright 自动化测试应归为 e2e", () => {
    const samples = [
      {
        filePath: sample("src/features/foo.e", "2e.test.ts"),
        source: "import { describe, expect, it } from 'vitest';",
      },
      {
        filePath: sample("src/features/foo-smo", "ke.test.ts"),
        source: "import { describe, expect, it } from 'vitest';",
      },
      {
        filePath: sample(
          "src/components/image-gen/useImageGen.li",
          "ve.test.ts",
        ),
        source: "import { describe, expect, it } from 'vitest';",
      },
      {
        filePath: "src/features/foo.test.ts",
        source: sample("import { test } from '@playwright", "/test';"),
      },
    ];

    for (const sample of samples) {
      expect(classifyVitestTestFile(sample)).toMatchObject({
        layer: "e2e",
      });
    }
  });

  it("smoke helper 和 Playwright 文本引用不应误归为 e2e", () => {
    expect(
      classifyVitestTestFile({
        filePath: "scripts/lib/openai-compatible-fixture-server.test.mjs",
        source: "import { describe, expect, it } from 'vitest';",
      }),
    ).toMatchObject({
      layer: "unit",
    });

    expect(
      classifyVitestTestFile({
        filePath:
          "src/components/agent/chat/utils/toolSearchResultSummary.test.ts",
        source:
          "expect(resolveLabel('mcp__playwright__browser_click')).toBe('扩展工具');",
      }),
    ).toMatchObject({
      layer: "unit",
    });
  });
});
