import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSkillExecutionCard } from "./ServiceSkillExecutionCard";

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderCard(
  props: Partial<React.ComponentProps<typeof ServiceSkillExecutionCard>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ServiceSkillExecutionCard
        state={{
          phase: "blocked",
          adapterName: "github/search",
          skillTitle: "GitHub 仓库线索检索",
          message: "当前没有检测到已附着到真实浏览器的 github.com 页面。",
          reportHint: "请先去浏览器工作台连接真实浏览器。",
        }}
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("ServiceSkillExecutionCard", () => {
  it("阻断态应展示去浏览器工作台入口", () => {
    const onOpenBrowserRuntime = vi.fn();
    const container = renderCard({
      onOpenBrowserRuntime,
    });

    const button = container.querySelector(
      '[data-testid="service-skill-execution-open-browser-runtime"]',
    ) as HTMLButtonElement | null;

    expect(container.textContent).toContain("需要先准备浏览器");
    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onOpenBrowserRuntime).toHaveBeenCalledTimes(1);
  });

  it("成功态不应再展示浏览器工作台入口", () => {
    const container = renderCard({
      state: {
        phase: "success",
        adapterName: "github/search",
        skillTitle: "GitHub 仓库线索检索",
        message: "站点技能已完成，结果已写回当前主稿",
        result: {
          ok: true,
          adapter: "github/search",
          domain: "github.com",
          profile_key: "attached-github",
          entry_url: "https://github.com/search?q=mcp",
          saved_content: {
            content_id: "content-1",
            project_id: "project-1",
            title: "GitHub 仓库线索",
            project_root_path: "/Users/coso/.proxycast/projects/project-1",
            markdown_relative_path:
              "exports/x-article-export/github-mcp/index.md",
            images_relative_dir: "exports/x-article-export/github-mcp/images",
            image_count: 7,
          },
        },
      },
    });

    expect(container.textContent).toContain("结果文件：index.md");
    expect(container.textContent).toContain("图片：7 张");
    expect(
      container.querySelector(
        '[data-testid="service-skill-execution-open-browser-runtime"]',
      ),
    ).toBeNull();
  });

  it("成功态存在导出 Markdown 时应展示当前工作区预览入口", () => {
    const onOpenSavedSiteContent = vi.fn();
    const container = renderCard({
      onOpenSavedSiteContent,
      state: {
        phase: "success",
        adapterName: "x/article-export",
        skillTitle: "X 文章转存",
        message: "站点技能已完成，Markdown 与图片已保存到项目资源",
        result: {
          ok: true,
          adapter: "x/article-export",
          domain: "x.com",
          profile_key: "attached-x",
          entry_url:
            "https://x.com/GoogleCloudTech/article/2033953579824758855",
          saved_content: {
            content_id: "content-article-1",
            project_id: "project-article-1",
            title: "Google Cloud Tech 文章导出",
            markdown_relative_path:
              "exports/x-article-export/google-cloud/index.md",
          },
        },
      },
    });

    const button = container.querySelector(
      '[data-testid="service-skill-execution-open-saved-content"]',
    ) as HTMLButtonElement | null;

    expect(button?.textContent).toContain("在画布中打开 index.md");

    act(() => {
      button?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith({
      projectId: "project-article-1",
      contentId: "content-article-1",
      title: "Google Cloud Tech 文章导出",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/x-article-export/google-cloud/index.md",
      },
    });
  });

  it("存在更新的正式导出目录时应优先打开该结果文件", () => {
    const onOpenResultFile = vi.fn();
    const onOpenSavedSiteContent = vi.fn();
    const container = renderCard({
      onOpenResultFile,
      onOpenSavedSiteContent,
      preferredResultFileTarget: {
        relativePath: "exports/social-article/google-cloud/index.md",
        title: "index.md",
      },
      state: {
        phase: "success",
        adapterName: "x/article-export",
        skillTitle: "X 文章转存",
        message: "站点技能已完成，后续技能包已落盘",
        result: {
          ok: true,
          adapter: "x/article-export",
          domain: "x.com",
          profile_key: "attached-x",
          entry_url:
            "https://x.com/GoogleCloudTech/article/2033953579824758855",
          saved_content: {
            content_id: "content-article-1",
            project_id: "project-article-1",
            title: "Google Cloud Tech 文章导出",
            markdown_relative_path:
              "exports/x-article-export/google-cloud/index.md",
          },
        },
      },
    });

    const button = container.querySelector(
      '[data-testid="service-skill-execution-open-saved-content"]',
    ) as HTMLButtonElement | null;

    expect(button?.textContent).toContain("在画布中打开 index.md");

    act(() => {
      button?.click();
    });

    expect(onOpenResultFile).toHaveBeenCalledWith(
      "exports/social-article/google-cloud/index.md",
    );
    expect(onOpenSavedSiteContent).not.toHaveBeenCalled();
  });
});
