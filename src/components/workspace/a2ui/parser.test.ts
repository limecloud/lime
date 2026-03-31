import { describe, expect, it } from "vitest";
import { parseA2UIJson } from "./parser";

describe("A2UI parser", () => {
  it("应聚合 v0.9 JSONL 消息流", () => {
    const response = parseA2UIJson(`
{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}}
{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Column","children":["header","date-picker"]},{"id":"header","component":"Text","text":"# Book Your Table","variant":"h1"},{"id":"date-picker","component":"DateTimeInput","label":"Select Date","value":{"path":"/reservation/date"},"enableDate":true}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"main","path":"/reservation","value":{"date":"2025-12-15"}}}
    `);

    expect(response?.id).toBe("surface-main");
    expect(response?.root).toBe("root");
    expect(response?.components).toHaveLength(3);
    expect(response?.components[2]).toMatchObject({
      id: "date-picker",
      component: "DateTimeInput",
    });
    expect(response?.data).toEqual({
      reservation: {
        date: "2025-12-15",
      },
    });
  });

  it("应兼容 v0.8 消息数组并保持 beginRendering 指定的根节点", () => {
    const response = parseA2UIJson(
      JSON.stringify([
        {
          surfaceUpdate: {
            surfaceId: "legacy",
            components: [
              {
                id: "layout",
                component: {
                  Column: {
                    children: {
                      explicitList: ["title"],
                    },
                  },
                },
              },
              {
                id: "title",
                component: {
                  Text: {
                    text: {
                      path: "title",
                    },
                    usageHint: "h2",
                  },
                },
              },
            ],
          },
        },
        {
          dataModelUpdate: {
            surfaceId: "legacy",
            contents: [
              {
                key: "title",
                valueString: "Legacy Surface",
              },
            ],
          },
        },
        {
          beginRendering: {
            surfaceId: "legacy",
            root: "layout",
          },
        },
      ]),
    );

    expect(response?.id).toBe("surface-legacy");
    expect(response?.root).toBe("layout");
    expect(response?.data).toEqual({ title: "Legacy Surface" });
    expect(response?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "layout",
          component: "Column",
          children: ["title"],
        }),
        expect.objectContaining({
          id: "title",
          component: "Text",
          variant: "h2",
          text: { path: "title" },
        }),
      ]),
    );
  });
});
