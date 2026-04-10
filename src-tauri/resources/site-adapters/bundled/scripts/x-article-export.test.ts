// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const runnerSource = fs.readFileSync(
  path.resolve(
    globalThis.process?.cwd() || "",
    "src-tauri/resources/site-adapters/bundled/scripts/x-article-export.js",
  ),
  "utf8",
);

const xArticleExportRunner = Function(
  '"use strict"; return (' +
    runnerSource.trim().replace(/;\s*$/, "") +
    ");",
)() as (args: Record<string, unknown>, helpers: Record<string, unknown>) => Promise<{
  ok: boolean;
  data?: {
    markdown?: string;
    images?: Array<{ url?: string }>;
  };
}>;

function createHelpers(
  overrides: Partial<Record<string, (...args: unknown[]) => unknown>> = {},
) {
  return {
    sleep: async () => undefined,
    absoluteUrl(value: string) {
      try {
        return new URL(value, "https://x.com/GoogleCloudTech/article/2033953579824758855").toString();
      } catch {
        return value;
      }
    },
    async waitFor<T>(resolver: () => T) {
      const value = resolver();
      if (!value) {
        throw new Error("waitFor 在测试夹具中未命中元素");
      }
      return value;
    },
    looksLikeLoginWall() {
      return false;
    },
    waitForDomStable: async () => true,
    scrollUntilSettled: async () => ({
      scrolls: 0,
      scrollY: 0,
      scrollHeight: 0,
      stableCount: 0,
    }),
    waitForImagesReady: async () => ({
      total: 0,
      ready: 0,
    }),
    ...overrides,
  };
}

describe("x/article-export adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "GoogleCloudTech on X";
    window.history.replaceState(
      {},
      "",
      "/GoogleCloudTech/article/2033953579824758855",
    );
  });

  it("能从更宽的文章容器中提取代码块和背景图图片", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div class="article-body">
          <div data-testid="twitter-article-title">5 Agent Skill design patterns every ADK developer should know</div>
          <div data-testid="longformRichTextComponent">
            <div data-contents="true">
              <div><span>Intro paragraph before examples.</span></div>
            </div>
          </div>
          <div
            class="prism-code language-markdown"
            data-testid="rich-code-block"
            data-language="markdown"
            style="white-space: pre-wrap; font-family: Menlo, monospace;"
          ># skills/api-expert/SKILL.md
---
name: api-expert
description: FastAPI development best practices and conventions.</div>
          <figure
            aria-label="Skill diagram"
            style="width: 640px; height: 360px; background-image: url('https://pbs.twimg.com/media/skill-diagram?format=png&name=small');"
          ></figure>
          <div data-testid="longformRichTextComponent">
            <div data-contents="true">
              <div><span>Outro paragraph after examples.</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers(),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain("Intro paragraph before examples.");
    expect(result.data?.markdown).toContain("```markdown");
    expect(result.data?.markdown).toContain("# skills/api-expert/SKILL.md");
    expect(result.data?.markdown).toContain("name: api-expert");
    expect(result.data?.markdown).toContain("![Skill diagram]");
    expect(result.data?.markdown).toContain("Outro paragraph after examples.");
    expect(result.data?.images).toHaveLength(1);
    expect(result.data?.images?.[0]?.url).toContain(
      "https://pbs.twimg.com/media/skill-diagram?format=png&name=orig",
    );
  });

  it("能按整篇文章顺序提取分散在不同包装层里的正文、代码块和图片", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <section class="title-wrap">
          <div data-testid="twitter-article-title">Wrapped article export</div>
        </section>
        <section class="intro-wrap">
          <div data-testid="longformRichTextComponent">
            <div data-contents="true">
              <div><span>Intro paragraph before the rich blocks.</span></div>
            </div>
          </div>
        </section>
        <section class="diagram-wrap">
          <figure>
            <img
              alt="Pattern 1 diagram"
              src="https://pbs.twimg.com/media/pattern-1-diagram?format=jpg&name=small"
            />
          </figure>
        </section>
        <section class="code-wrap">
          <div
            class="rich-block-shell"
            style="white-space: pre-wrap; font-family: Menlo, monospace;"
          ># skills/api-expert/SKILL.md
---
name: api-expert
description: FastAPI development best practices and conventions.
metadata:
  pattern: tool-wrapper</div>
        </section>
        <section class="outro-wrap">
          <div data-testid="longformRichTextComponent">
            <div data-contents="true">
              <div><span>Outro paragraph after the rich blocks.</span></div>
            </div>
          </div>
        </section>
      </div>
    `;

    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers(),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain("Intro paragraph before the rich blocks.");
    expect(result.data?.markdown).toContain("![Pattern 1 diagram]");
    expect(result.data?.markdown).toContain("```");
    expect(result.data?.markdown).toContain("# skills/api-expert/SKILL.md");
    expect(result.data?.markdown).toContain("pattern: tool-wrapper");
    expect(result.data?.markdown).toContain("Outro paragraph after the rich blocks.");
    expect(result.data?.images).toHaveLength(1);
    expect(result.data?.images?.[0]?.url).toContain(
      "https://pbs.twimg.com/media/pattern-1-diagram?format=jpg&name=orig",
    );
  });

  it("不会把包着真实内容的交互容器误判成噪音节点", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title">Interactive wrapper export</div>
        <div data-testid="longformRichTextComponent">
          <div data-contents="true">
            <div><span>Paragraph before interactive content.</span></div>
            <div role="button" aria-label="Open example image">
              <a href="https://x.com/GoogleCloudTech/status/1/photo/1">
                <div
                  aria-label="Pattern overview"
                  style="width: 640px; height: 360px; background-image: url('https://pbs.twimg.com/media/pattern-overview?format=png&name=small');"
                ></div>
              </a>
            </div>
            <div role="button" aria-label="Expand code sample">
              <div
                class="code-shell"
                data-language="markdown"
                style="white-space: pre-wrap; font-family: Menlo, monospace;"
              ># skills/report-generator/SKILL.md
---
name: report-generator
description: Generates structured technical reports in Markdown.</div>
            </div>
            <div><span>Paragraph after interactive content.</span></div>
          </div>
        </div>
      </div>
    `;

    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers(),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain("Paragraph before interactive content.");
    expect(result.data?.markdown).toContain("![Pattern overview]");
    expect(result.data?.markdown).toContain("```markdown");
    expect(result.data?.markdown).toContain("# skills/report-generator/SKILL.md");
    expect(result.data?.markdown).toContain("Paragraph after interactive content.");
    expect(result.data?.images).toHaveLength(1);
    expect(result.data?.images?.[0]?.url).toContain(
      "https://pbs.twimg.com/media/pattern-overview?format=png&name=orig",
    );
  });

  it("会在滚动预热后提取延迟挂载的技能代码块和图片", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title">Warmup export</div>
        <div data-testid="longformRichTextComponent">
          <div data-contents="true">
            <div><span>Paragraph before lazy content.</span></div>
            <div id="lazy-slot"></div>
            <div><span>Paragraph after lazy content.</span></div>
          </div>
        </div>
      </div>
    `;

    let warmupCalled = false;
    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers({
        async scrollUntilSettled() {
          warmupCalled = true;
          const lazySlot = document.querySelector("#lazy-slot");
          if (lazySlot) {
            lazySlot.innerHTML = `
              <div
                class="lazy-code-shell"
                data-language="markdown"
                style="white-space: pre-wrap; font-family: Menlo, monospace;"
              ># skills/doc-pipeline/SKILL.md
---
name: doc-pipeline
description: Generates API documentation from source.</div>
              <div
                role="img"
                aria-label="Pipeline diagram"
                style="width: 640px; height: 360px; background-image: url('https://pbs.twimg.com/media/pipeline-diagram?format=png&name=small');"
              ></div>
            `;
          }
          return {
            scrolls: 3,
            scrollY: 1200,
            scrollHeight: 2400,
            stableCount: 2,
          };
        },
      }),
    );

    expect(warmupCalled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain("Paragraph before lazy content.");
    expect(result.data?.markdown).toContain("```markdown");
    expect(result.data?.markdown).toContain("# skills/doc-pipeline/SKILL.md");
    expect(result.data?.markdown).toContain("![Pipeline diagram]");
    expect(result.data?.images).toHaveLength(1);
  });

  it("会在长文先渲染纯文本骨架时执行二次预热并补回图片与代码块", async () => {
    const repeatedParagraph =
      "This section explains why agents need structured skills, reusable templates, and review gates. ".repeat(
        24,
      );
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title">Structured recovery export</div>
        <div data-testid="longformRichTextComponent">
          <div data-contents="true">
            <div><span>${repeatedParagraph}</span></div>
            <div><span>## Pattern 1: The Tool Wrapper</span></div>
            <div><span>Here is the first rich example block:</span></div>
            <div id="late-rich-content"></div>
            <div><span>## Pattern 2: The Generator</span></div>
            <div><span>${repeatedParagraph}</span></div>
          </div>
        </div>
      </div>
    `;

    let scrollCallCount = 0;
    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers({
        async scrollUntilSettled() {
          scrollCallCount += 1;
          if (scrollCallCount === 2) {
            const lateRichContent = document.querySelector("#late-rich-content");
            if (lateRichContent) {
              lateRichContent.innerHTML = `
                <div data-testid="tweetPhoto">
                  <img
                    alt="Late skill diagram"
                    src="https://pbs.twimg.com/media/late-skill-diagram?format=png&name=small"
                  />
                </div>
                <div
                  class="late-code-shell"
                  data-language="markdown"
                  style="white-space: pre-wrap; font-family: Menlo, monospace;"
                ># skills/late-loader/SKILL.md
---
name: late-loader
description: Recovers delayed rich content after a second warmup pass.</div>
              `;
            }
          }
          return {
            scrolls: 6,
            scrollY: 1200,
            scrollHeight: 4200,
            stableCount: 1,
          };
        },
      }),
    );

    expect(scrollCallCount).toBeGreaterThanOrEqual(2);
    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain("![Late skill diagram]");
    expect(result.data?.markdown).toContain("```markdown");
    expect(result.data?.markdown).toContain("# skills/late-loader/SKILL.md");
    expect(result.data?.images).toHaveLength(1);
    expect(result.data?.images?.[0]?.url).toContain(
      "https://pbs.twimg.com/media/late-skill-diagram?format=png&name=orig",
    );
  });

  it("能兼容真实 X 长文常见的 twitterArticleRichTextView 结构并保留封面图", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title">Real X article DOM export</div>
        <div data-testid="tweetPhoto">
          <img
            alt="Article cover"
            src="https://pbs.twimg.com/media/article-cover?format=jpg&name=small"
          />
        </div>
        <div data-testid="twitterArticleRichTextView">
          <div data-block="true">
            <span data-text="true">Intro paragraph from the real DOM layout.</span>
          </div>
          <section data-block="true">
            <div data-testid="tweetPhoto">
              <img
                alt="Skill overview"
                src="https://pbs.twimg.com/media/skill-overview?format=png&name=small"
              />
            </div>
          </section>
          <section data-block="true">
            <div data-testid="markdown-code-block">
              <code># skills/api-expert/SKILL.md
---
name: api-expert
description: FastAPI development best practices and conventions.
metadata:
  pattern: tool-wrapper</code>
            </div>
          </section>
          <div data-block="true">
            <span data-text="true">Outro paragraph from the real DOM layout.</span>
          </div>
        </div>
      </div>
    `;

    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers(),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.markdown).toContain(
      "Intro paragraph from the real DOM layout.",
    );
    expect(result.data?.markdown).toContain("![Article cover]");
    expect(result.data?.markdown).toContain("![Skill overview]");
    expect(result.data?.markdown).toContain("```");
    expect(result.data?.markdown).toContain("# skills/api-expert/SKILL.md");
    expect(result.data?.markdown).toContain("pattern: tool-wrapper");
    expect(result.data?.markdown).toContain(
      "Outro paragraph from the real DOM layout.",
    );
    expect(result.data?.images).toHaveLength(2);
    const imageUrls = (result.data?.images || []).map((image) => image.url || "");
    expect(imageUrls).toContain(
      "https://pbs.twimg.com/media/article-cover?format=jpg&name=orig",
    );
    expect(imageUrls).toContain(
      "https://pbs.twimg.com/media/skill-overview?format=png&name=orig",
    );
  });

  it("检测到媒体容器但资源未就绪时应返回错误而不是假成功", async () => {
    document.body.innerHTML = `
      <div data-testid="twitterArticleReadView">
        <div data-testid="twitter-article-title">Incomplete media export</div>
        <div data-testid="longformRichTextComponent">
          <div data-contents="true">
            <div><span>Paragraph before incomplete image.</span></div>
            <figure>
              <img alt="Broken image" />
            </figure>
          </div>
        </div>
      </div>
    `;

    const result = await xArticleExportRunner(
      {
        url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
      },
      createHelpers(),
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error_code: "adapter_runtime_error",
    });
    expect(String((result as { error_message?: string }).error_message || "")).toContain(
      "图片资源尚未完全加载",
    );
  });
});
