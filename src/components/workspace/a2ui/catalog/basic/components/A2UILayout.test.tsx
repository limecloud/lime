import { afterEach, describe, expect, it, vi } from "vitest";
import { CardRenderer } from "./Card";
import { ColumnRenderer } from "./Column";
import { DividerRenderer } from "./Divider";
import { ListRenderer } from "./List";
import { RowRenderer } from "./Row";
import { A2UI_LAYOUT_TOKENS } from "../../../layoutTokens";
import {
  cleanupMountedRoots,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

setupReactActEnvironment();

describe("A2UI 布局组件", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  const baseRendererProps = {
    data: {},
    formData: {},
    onFormChange: vi.fn(),
    onAction: vi.fn(),
  };

  it("Row 应使用统一布局类并渲染子组件", () => {
    const { container } = mountHarness(
      RowRenderer,
      {
        component: {
          id: "row",
          component: "Row",
          children: ["text"],
          justify: "center",
          align: "start",
          gap: 8,
        },
        components: [
          {
            id: "text",
            component: "Text",
            text: "行布局内容",
            variant: "body",
          },
        ],
        ...baseRendererProps,
      },
      mountedRoots,
    );

    const row = container.querySelector("div");
    expect(row?.className).toContain(A2UI_LAYOUT_TOKENS.flexBase);
    expect(row?.className).toContain(A2UI_LAYOUT_TOKENS.rowDirection);
    expect(container.textContent).toContain("行布局内容");
  });

  it("Row 开启 wrap 时应给子项分配最小宽度与弹性布局", () => {
    const { container } = mountHarness(
      RowRenderer,
      {
        component: {
          id: "row",
          component: "Row",
          children: ["left", "right"],
          align: "stretch",
          gap: 12,
          wrap: true,
          minChildWidth: 240,
        },
        components: [
          {
            id: "left",
            component: "TextField",
            label: "左侧字段",
            value: "",
            variant: "shortText",
            weight: 1,
          },
          {
            id: "right",
            component: "TextField",
            label: "右侧字段",
            value: "",
            variant: "shortText",
            weight: 1,
          },
        ],
        ...baseRendererProps,
      },
      mountedRoots,
    );

    const row = container.firstElementChild as HTMLElement | null;
    const childWrappers = row?.children || [];
    expect(row?.style.flexWrap).toBe("wrap");
    expect((childWrappers[0] as HTMLElement | undefined)?.style.flex).toBe(
      "1 1 0px",
    );
    expect((childWrappers[0] as HTMLElement | undefined)?.style.minWidth).toBe(
      "240px",
    );
  });

  it("Column 应使用统一布局类并渲染子组件", () => {
    const { container } = mountHarness(
      ColumnRenderer,
      {
        component: {
          id: "column",
          component: "Column",
          children: ["text"],
          justify: "start",
          align: "stretch",
          gap: 12,
        },
        components: [
          {
            id: "text",
            component: "Text",
            text: "列布局内容",
            variant: "body",
          },
        ],
        ...baseRendererProps,
      },
      mountedRoots,
    );

    const column = container.querySelector("div");
    expect(column?.className).toContain(A2UI_LAYOUT_TOKENS.flexBase);
    expect(column?.className).toContain(A2UI_LAYOUT_TOKENS.columnDirection);
    expect(container.textContent).toContain("列布局内容");
  });

  it("Card 应使用统一卡片样式包裹子组件", () => {
    const { container } = mountHarness(
      CardRenderer,
      {
        component: {
          id: "card",
          component: "Card",
          child: "text",
        },
        components: [
          {
            id: "text",
            component: "Text",
            text: "卡片内容",
            variant: "body",
          },
        ],
        ...baseRendererProps,
      },
      mountedRoots,
    );

    const card = container.querySelector("div");
    expect(card?.className).toBe(A2UI_LAYOUT_TOKENS.cardShell);
    expect(container.textContent).toContain("卡片内容");
  });

  it("List 应展开模板 children 并解析相对数据路径", () => {
    const { container } = mountHarness(
      ListRenderer,
      {
        component: {
          id: "list",
          component: "List",
          children: {
            componentId: "item-template",
            path: "/items",
          },
          direction: "vertical",
          align: "stretch",
        },
        components: [
          {
            id: "item-template",
            component: "Text",
            text: {
              path: "name",
            },
            variant: "body",
          },
        ],
        ...baseRendererProps,
        data: {
          items: [{ name: "Alpha" }, { name: "Beta" }],
        },
      },
      mountedRoots,
    );

    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
  });

  it("Divider 应使用统一分隔线样式", () => {
    const { container } = mountHarness(
      DividerRenderer,
      {
        component: {
          id: "divider",
          component: "Divider",
          axis: "vertical",
        },
      },
      mountedRoots,
    );

    const divider = container.querySelector("div");
    expect(divider?.className).toContain(A2UI_LAYOUT_TOKENS.dividerBase);
    expect(divider?.className).toContain(A2UI_LAYOUT_TOKENS.dividerVertical);
  });
});
