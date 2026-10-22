// @vitest-environment node
import { describe, expect, it } from "vitest";
import { browserMenuActionIds, browserMenuPersistentActionIds, readBrowserMenuPresentation } from "./browserOverlayModel";

const presentation = (items: unknown) => ({ menuId: "more-1", anchor: { x: 10, y: 20, width: 24, height: 24 }, items });

describe("trusted browser menu data boundary", () => {
  it("selects only enabled leaves and inline controls, including disabled ancestors", () => {
    const menu = readBrowserMenuPresentation(presentation([
      { id: "find", label: "Find" },
      { id: "zoom", label: "Zoom", controls: [{ id: "out", label: "−" }, { id: "reset", label: "100%" }, { id: "in", label: "+", enabled: false }] },
      { id: "tools", label: "Tools", submenu: [{ id: "print", label: "Print" }] },
      { id: "disabled", label: "Disabled", enabled: false, submenu: [{ id: "secret", label: "Secret" }] },
      { separator: true },
    ]));
    expect([...browserMenuActionIds(menu.items)]).toEqual(["find", "out", "reset", "print"]);
    expect([...browserMenuPersistentActionIds(menu.items)]).toEqual(["out", "reset"]);
  });

  it.each([
    [{ id: "x", label: "X", html: "<script>" }],
    [{ id: "x", label: "X", submenu: [{ id: "x", label: "Duplicate" }] }],
    [{ id: "x", label: "X", controls: [{ id: "x", label: "Duplicate" }] }],
    [{ id: "x", label: "X", controls: Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, label: "A" })) }],
    [{ id: "x", label: "X", controls: [{ id: "a", label: "A", url: "https://example.com" }] }],
    [{ id: "x", label: "X", controls: [{ id: "a", label: "A" }], submenu: [{ id: "b", label: "B" }] }],
    [{ separator: true, id: "x" }],
    [{ id: "x", label: "X", enabled: "true" }],
  ])("rejects malformed or executable presentation data %j", (...items) => {
    expect(() => readBrowserMenuPresentation(presentation(items))).toThrow();
  });

  it("bounds structure, text, coordinates and finite identities", () => {
    expect(() => readBrowserMenuPresentation(presentation([{ id: "x", label: " " }]))).toThrow();
    expect(() => readBrowserMenuPresentation(presentation([{ id: "javascript:alert(1)", label: "X" }]))).toThrow();
    expect(() => readBrowserMenuPresentation({ ...presentation([{ id: "x", label: "X" }]), anchor: { x: NaN, y: 0, width: 1, height: 1 } })).toThrow();
    expect(() => readBrowserMenuPresentation(presentation(Array.from({ length: 101 }, (_, index) => ({ id: `a${index}`, label: "A" }))))).toThrow();
    const deep = { id: "a", label: "A", submenu: [{ id: "b", label: "B", submenu: [{ id: "c", label: "C", submenu: [{ id: "d", label: "D", submenu: [{ id: "e", label: "E" }] }] }] }] };
    expect(() => readBrowserMenuPresentation(presentation([deep]))).toThrow();
  });
});
