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

    expect(container.textContent).toContain("已沉淀内容：GitHub 仓库线索");
    expect(container.textContent).toContain(
      "项目目录：/Users/coso/.proxycast/projects/project-1",
    );
    expect(container.textContent).toContain(
      "Markdown 文件：exports/x-article-export/github-mcp/index.md",
    );
    expect(container.textContent).toContain(
      "图片资源：7 张 · exports/x-article-export/github-mcp/images",
    );
    expect(
      container.querySelector(
        '[data-testid="service-skill-execution-open-browser-runtime"]',
      ),
    ).toBeNull();
  });
});
