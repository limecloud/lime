import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;
import { AppSidebarSearchDialog } from "./AppSidebarSearchDialog";
import type { AppSidebarSearchDialogCopy } from "./AppSidebarSearchDialog";

const copy: AppSidebarSearchDialogCopy = {
  inputLabel: "搜索对话",
  closeLabel: "关闭",
  createConversationLabel: "新建对话",
  matchesLabel: "匹配结果",
  recentLabel: "最近",
  loadingLabel: "正在加载对话",
  selectProjectFirstLabel: "请先选择项目工作区",
  emptyMatchesLabel: "没有匹配的对话",
  emptyRecentLabel: "还没有最近对话",
  contentSearchErrorLabel: "内容搜索暂时不可用，已保留标题匹配",
  loadingMoreLabel: "正在加载...",
  moreMatchesLabel: "查看更多匹配结果",
  moreRecentLabel: "查看更多对话",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof AppSidebarSearchDialog>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <AppSidebarSearchDialog
        isOpen
        query=""
        inputRef={{ current: null }}
        copy={copy}
        sessions={[]}
        hasQuery={false}
        hasMoreResults={false}
        loading={false}
        loadingMore={false}
        resolveSessionTitle={(session) => session.name ?? session.id}
        formatSessionMeta={() => "刚刚"}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onCreateConversation={vi.fn()}
        onResultClick={vi.fn()}
        onShowMore={vi.fn()}
        {...props}
      />,
    );
  });
  return {
    root,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("AppSidebarSearchDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("显示同一条 thread/search 摘要", () => {
    const view = renderDialog({
      query: "needle",
      hasQuery: true,
      sessions: [
        {
          id: "session-1",
          name: "对话标题",
          created_at: 1,
          updated_at: 1,
          searchSnippet: "found needle",
        },
      ],
    });

    expect(document.body.textContent).toContain("对话标题");
    expect(
      document.body.querySelector("[data-testid='app-sidebar-search-snippet']")
        ?.textContent,
    ).toBe("found needle");
    view.unmount();
  });

  it("有查询时不要求先选项目", () => {
    const view = renderDialog({
      query: "needle",
      hasQuery: true,
      currentProjectId: null,
    });

    expect(document.body.textContent).toContain("没有匹配的对话");
    expect(document.body.textContent).not.toContain("请先选择项目工作区");
    view.unmount();
  });

  it("内容搜索失败时保留标题匹配提示", () => {
    const view = renderDialog({
      query: "needle",
      hasQuery: true,
      contentSearchError: true,
      sessions: [
        {
          id: "session-2",
          name: "只有标题",
          created_at: 1,
          updated_at: 1,
        },
      ],
    });

    expect(
      document.body.querySelector("[data-testid='app-sidebar-search-error']")
        ?.textContent,
    ).toBe("内容搜索暂时不可用，已保留标题匹配");
    expect(document.body.textContent).toContain("只有标题");
    view.unmount();
  });

  it("命令事件循环选择结果并打开当前项", () => {
    const onResultClick = vi.fn();
    const view = renderDialog({
      sessions: [
        { id: "s1", name: "One", created_at: 1, updated_at: 2 },
        { id: "s2", name: "Two", created_at: 3, updated_at: 4 },
      ],
      onResultClick,
    });
    try {
      act(() => {
        window.dispatchEvent(new CustomEvent("lime:search-chats-next"));
      });
      expect(
        document.querySelector('[data-search-selected="true"]')?.textContent,
      ).toContain("One");
      act(() => {
        window.dispatchEvent(new CustomEvent("lime:search-chats-next"));
      });
      expect(
        document.querySelector('[data-search-selected="true"]')?.textContent,
      ).toContain("Two");
      act(() => {
        window.dispatchEvent(new CustomEvent("lime:search-chats-open"));
      });
      expect(onResultClick).toHaveBeenCalledWith(expect.objectContaining({ id: "s2" }));
    } finally {
      view.unmount();
    }
  });

});
