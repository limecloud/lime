import { describe, expect, it } from "vitest";
import {
  annotationCrop,
  readAnnotationSelection,
} from "./browserAnnotationModel";

const source = {
  kind: "region",
  framePath: [],
  targetRect: { x: 0, y: 0, width: 100, height: 80 },
  viewportSize: { width: 800, height: 600 },
  scrollPosition: { x: 0, y: 0 },
  devicePixelRatio: 2,
  markerViewportPoint: { x: 12, y: 12 },
  targetSelector: null,
  targetPath: null,
  targetRole: null,
  targetText: null,
};
describe("Browser annotation geometry boundary", () => {
  it.each([
    { targetRect: { x: 790, y: 0, width: 100, height: 80 } },
    { viewportSize: { width: NaN, height: 600 } },
    { devicePixelRatio: 0 },
    { markerViewportPoint: { x: -1, y: 0 } },
    { framePath: "child" },
    { kind: "text" },
  ])("rejects malformed or unsupported geometry %j", (patch) => {
    expect(() =>
      readAnnotationSelection(
        { ...source, ...patch },
        "region",
        "https://page.test",
        "Page",
      ),
    ).toThrow();
  });
  it("clamps a necessary crop at image edges and does not crop always mode", () => {
    const selection = readAnnotationSelection(
      source,
      "region",
      "https://page.test",
      "Page",
    );
    expect(
      annotationCrop(selection, { width: 1600, height: 1200 }, "necessary"),
    ).toEqual({
      pixels: { x: 0, y: 0, width: 232, height: 192 },
      viewport: { x: 0, y: 0, width: 116, height: 96 },
    });
    expect(
      annotationCrop(selection, { width: 1600, height: 1200 }, "always"),
    ).toBeNull();
  });
  it("keeps same-origin and inherited frame identity while canonicalizing top-level URL", () => {
    for (const frameUrl of [
      "https://page.test/child",
      "about:blank",
      "about:srcdoc",
    ]) {
      expect(
        readAnnotationSelection(
          {
            ...source,
            frameUrl,
            framePath: [{ selector: "#frame", shadowHosts: ["#shadow"] }],
          },
          "region",
          "https://page.test/",
          "Page",
        ),
      ).toMatchObject({
        pageUrl: "https://page.test/",
        frameUrl,
        framePath: [{ selector: "#frame", shadowHosts: ["#shadow"] }],
      });
    }
  });
  it.each([
    {
      framePath: [{ selector: "", shadowHosts: [] }],
      frameUrl: "https://page.test/child",
    },
    {
      framePath: [{ selector: "#frame", shadowHosts: [null] }],
      frameUrl: "https://page.test/child",
    },
    {
      framePath: [{ selector: "#frame", shadowHosts: [] }],
      frameUrl: "https://cross.test/",
    },
    {
      framePath: [{ selector: "#frame", shadowHosts: [] }],
      frameUrl: "javascript:alert(1)",
    },
    {
      framePath: Array(33).fill({ selector: "#frame", shadowHosts: [] }),
      frameUrl: "https://page.test/child",
    },
  ])("rejects invalid or cross-origin frame identity %j", (patch) => {
    expect(() =>
      readAnnotationSelection(
        { ...source, ...patch },
        "region",
        "https://page.test/",
        "Page",
      ),
    ).toThrow();
  });
  const text = {
    ...source,
    kind: "text",
    targetText: "a😀b",
    targetSelector: "#text",
    selectionRects: [{ x: 0, y: 0, width: 50, height: 20 }],
    textLocator: {
      kind: "dom",
      selector: "#text",
      shadowHosts: ["#host"],
      direction: "backward",
      rangeText: "a😀b",
      startOffset: 2,
      endOffset: 6,
    },
  };
  it("preserves only validated UTF-16 text metadata while keeping URL authority in the Host", () => {
    const selection = readAnnotationSelection(
      {
        ...text,
        pageUrl: "https://forged.test",
        textLocator: { ...text.textLocator, arbitrary: "discard" },
      },
      "text",
      "https://actual.test",
      "Actual",
    );
    expect(selection).toMatchObject({
      kind: "text",
      pageUrl: "https://actual.test",
      frameUrl: "https://actual.test",
      targetText: "a😀b",
      textLocator: text.textLocator,
      selectionRects: text.selectionRects,
    });
    expect(selection.textLocator).not.toHaveProperty("arbitrary");
  });
  it.each([
    { targetText: "" },
    { targetText: "different" },
    { textLocator: { ...text.textLocator, startOffset: 2.5 } },
    { textLocator: { ...text.textLocator, endOffset: 1 } },
    { textLocator: { ...text.textLocator, kind: "unsupported" } },
    { textLocator: { ...text.textLocator, kind: "form-control" } },
    { textLocator: { ...text.textLocator, shadowHosts: [null] } },
    { selectionRects: [] },
    { selectionRects: [{ x: 99, y: 0, width: 10, height: 20 }] },
    { selectionRects: Array(1001).fill(text.selectionRects[0]) },
  ])("rejects malformed text metadata %j", (patch) => {
    expect(() =>
      readAnnotationSelection(
        { ...text, ...patch },
        "text",
        "https://actual.test",
        "Actual",
      ),
    ).toThrow();
  });
  it("validates a form value range without inventing a DOM rangeText", () => {
    const { rangeText: _rangeText, ...range } = text.textLocator;
    const selection = readAnnotationSelection(
      {
        ...text,
        textLocator: { ...range, kind: "form-control", arbitrary: "discard" },
      },
      "text",
      "https://actual.test",
      "Actual",
    );
    expect(selection.textLocator).toEqual({ ...range, kind: "form-control" });
    expect(selection.textLocator).not.toHaveProperty("rangeText");
  });
});
