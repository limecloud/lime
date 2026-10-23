// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDesignPreview } from "./browserDesignPreview";
import { installConstructedSheets } from "./browserDesignPreview.testFixture";

const previews: BrowserDesignPreview[] = [];
let restoreSheets: () => void;
beforeEach(() => {
  restoreSheets = installConstructedSheets();
});
afterEach(() => {
  previews.splice(0).forEach((preview) => preview.dispose());
  document.body.replaceChildren();
  restoreSheets();
  vi.unstubAllGlobals();
});

function setup(root: Document | ShadowRoot = document) {
  const element = document.createElement("button");
  element.append(
    document.createTextNode("  Original  "),
    document.createElement("span"),
  );
  (root instanceof Document ? root.body : root).append(element);
  const preview = new BrowserDesignPreview();
  previews.push(preview);
  const snapshot = preview.capture("one", element, () => true)!;
  return { preview, element, snapshot };
}

describe("temporary Browser design preview", () => {
  it("can capture an insecure page where Web Crypto has no randomUUID", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const { preview, element } = setup();
    preview.update("one", {
      declarations: [],
      text: { previousValue: "Original", value: "Changed" },
    });
    expect(element.textContent).toBe("Changed");
  });
  it("previews text without losing the original node identities, listeners or inline styles on reset", () => {
    const { preview, element } = setup();
    const originalNodes = Array.from(element.childNodes);
    element.style.color = "black";
    preview.update("one", {
      declarations: [],
      text: { value: "Changed", previousValue: "Original" },
    });
    expect(element.textContent).toBe("Changed");
    preview.update("one", null);
    expect(Array.from(element.childNodes)).toEqual(originalNodes);
    expect(element.textContent).toBe("  Original  ");
    expect(element.style.color).toBe("black");
    expect(
      element
        .getAttributeNames()
        .filter((name) => name.startsWith("data-browser-design-")),
    ).toEqual([]);
  });

  it("restores original temporarily and replays the same change; hidden or expired targets remain unchanged", () => {
    const { preview, element } = setup();
    const change = {
      declarations: [],
      text: { value: "Changed", previousValue: "Original" },
    };
    preview.update("one", change);
    preview.setVisible("one", false);
    expect(element.textContent).toBe("  Original  ");
    preview.setVisible("one", true);
    expect(element.textContent).toBe("Changed");
    preview.remove("one");
    preview.update("one", change);
    expect(element.textContent).toBe("  Original  ");
  });

  it("keeps layered changes on the same target and restores nodes only when the last text change is removed", () => {
    const { preview, element } = setup();
    const originalNodes = Array.from(element.childNodes);
    preview.capture("two", element, () => true);
    preview.update("one", {
      declarations: [],
      text: { value: "First", previousValue: "Original" },
    });
    preview.update("two", {
      declarations: [],
      text: { value: "Second", previousValue: "Original" },
    });
    expect(element.textContent).toBe("Second");
    preview.remove("two");
    expect(element.textContent).toBe("First");
    preview.remove("one");
    expect(Array.from(element.childNodes)).toEqual(originalNodes);
  });

  it("uses a local CSSOM rule in the target shadow root and cannot inject extra rules", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const { preview, snapshot } = setup(shadow);
    const baseline = snapshot.declarations.find(
      (item) => item.property === "color",
    )!;
    expect(() =>
      preview.update("one", {
        declarations: [{ ...baseline, value: "red; } body { display:none" }],
      }),
    ).toThrow();
    expect(shadow.querySelector("style")).toBeNull();
    preview.update("one", { declarations: [{ ...baseline, value: "red" }] });
    expect(shadow.adoptedStyleSheets).toHaveLength(1);
    expect(shadow.querySelector("style")).toBeNull();
    preview.remove("one");
    expect(shadow.adoptedStyleSheets).toHaveLength(0);
  });

  it("preserves page-owned sheets while preview holds, resumes and disposes", () => {
    const { preview, snapshot } = setup();
    const pageSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [pageSheet];
    const baseline = snapshot.declarations.find(
      (item) => item.property === "color",
    )!;
    preview.update("one", { declarations: [{ ...baseline, value: "red" }] });
    const previewSheet = document.adoptedStyleSheets[1];
    expect(document.adoptedStyleSheets).toEqual([pageSheet, previewSheet]);
    preview.setOriginal("one", true);
    expect(document.adoptedStyleSheets).toEqual([pageSheet]);
    preview.setOriginal("one", false);
    expect(document.adoptedStyleSheets).toEqual([pageSheet, previewSheet]);
    preview.dispose();
    expect(document.adoptedStyleSheets).toEqual([pageSheet]);
  });
});
