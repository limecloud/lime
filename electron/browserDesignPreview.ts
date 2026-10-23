/// <reference lib="dom" />
import {
  BROWSER_DESIGN_PROPERTIES,
  readBrowserDesignChange,
  type BrowserDesignChange,
  type BrowserDesignSnapshot,
} from "../src/lib/api/browserDesign";

interface Preview {
  element: Element;
  current: () => boolean;
  snapshot: BrowserDesignSnapshot;
  change: BrowserDesignChange | null;
  visible: boolean;
  original: boolean;
  attribute: string;
  style: CSSStyleSheet;
  css: string;
  root: Document | ShadowRoot;
}

/** Temporary presentation on the exact captured element; it cannot locate a new target. */
export class BrowserDesignPreview {
  readonly #entries = new Map<string, Preview>();
  readonly #originals = new Map<Element, Node[]>();
  readonly #observers = new Map<Document | ShadowRoot, MutationObserver>();
  #scheduled = false;
  #disposed = false;

  capture(
    id: string,
    element: Element,
    current: () => boolean,
  ): BrowserDesignSnapshot | null {
    if (this.#disposed || !element.isConnected || !current()) return null;
    const existing = this.#entries.get(id);
    if (existing) return structuredClone(existing.snapshot);
    const document = element.ownerDocument;
    const view = document.defaultView;
    const root = element.getRootNode() as Document | ShadowRoot;
    if (!view || (root.nodeType !== 9 && !("host" in root))) return null;
    const computed = view.getComputedStyle(element);
    const flex = ["flex", "inline-flex"].includes(computed.display);
    const declarations = BROWSER_DESIGN_PROPERTIES.slice(0, flex ? 25 : 19).map(
      (property) => {
        const value = computed.getPropertyValue(property).trim();
        return { property, value, previousValue: value };
      },
    );
    const originalNodes = this.#originals.get(element) ?? [
      ...Array.from(element.childNodes),
    ];
    const directText = originalNodes
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    const hasChildText = originalNodes.some(
      (node) => node.nodeType === 1 && node.textContent?.trim(),
    );
    const snapshot: BrowserDesignSnapshot = {
      declarations,
      elementTagName: element.tagName.toLowerCase(),
      ...(directText && !hasChildText
        ? { text: { previousValue: directText, value: directText } }
        : {}),
    };
    this.#entries.set(id, {
      element,
      current,
      snapshot,
      change: null,
      visible: true,
      original: false,
      root,
      attribute: `data-browser-design-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("")}`,
      style: new view.CSSStyleSheet(),
      css: "",
    });
    if (!this.#observers.has(root)) {
      const observer = new view.MutationObserver(() => {
        if (this.#scheduled || this.#disposed) return;
        this.#scheduled = true;
        queueMicrotask(() => {
          this.#scheduled = false;
          if (!this.#disposed) this.#reconcile();
        });
      });
      observer.observe(root, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      this.#observers.set(root, observer);
    }
    return structuredClone(snapshot);
  }

  update(id: string, value: unknown): void {
    const entry = this.#entries.get(id);
    if (!entry || this.#disposed) return;
    const change = readBrowserDesignChange(value, entry.snapshot);
    // Parse all values before mutating the page. CSSOM serializes values; strings are not rules.
    const scratch = entry.element.ownerDocument.createElement("span").style;
    for (const declaration of change?.declarations ?? []) {
      if (!declaration.value.trim() || /[;{}<>]/u.test(declaration.value))
        throw new Error("Invalid Browser design CSS value");
      scratch.setProperty(declaration.property, declaration.value, "important");
      if (!scratch.getPropertyValue(declaration.property))
        throw new Error("Unsupported Browser design CSS value");
    }
    entry.change = change;
    entry.css = change?.declarations.length
      ? `[${entry.attribute}]{${scratch.cssText}}`
      : "";
    // Constructed sheets preserve the page CSP and work in its exact document/shadow root.
    entry.style.replaceSync(entry.css);
    this.#reconcile();
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.visible = visible;
    this.#reconcile();
  }

  setOriginal(id: string, original: boolean): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.original = original;
    this.#reconcile();
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    entry.element.removeAttribute(entry.attribute);
    entry.root.adoptedStyleSheets = entry.root.adoptedStyleSheets.filter(
      (sheet) => sheet !== entry.style,
    );
    this.#reconcile();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const observer of this.#observers.values()) observer.disconnect();
    this.#observers.clear();
    for (const id of [...this.#entries.keys()]) this.remove(id);
  }

  #reconcile(): void {
    const texts = new Map<Element, string>();
    for (const entry of this.#entries.values()) {
      const { element, change } = entry;
      const active =
        entry.visible &&
        !entry.original &&
        element.isConnected &&
        element.getRootNode() === entry.root &&
        entry.current();
      if (active && change?.declarations.length) {
        if (!element.hasAttribute(entry.attribute))
          element.setAttribute(entry.attribute, "");
        if (!entry.root.adoptedStyleSheets.includes(entry.style))
          entry.root.adoptedStyleSheets = [
            ...entry.root.adoptedStyleSheets,
            entry.style,
          ];
      } else {
        if (element.hasAttribute(entry.attribute))
          element.removeAttribute(entry.attribute);
        if (entry.root.adoptedStyleSheets.includes(entry.style))
          entry.root.adoptedStyleSheets = entry.root.adoptedStyleSheets.filter(
            (sheet) => sheet !== entry.style,
          );
      }
      if (active && change?.text) {
        if (!this.#originals.has(element))
          this.#originals.set(element, Array.from(element.childNodes));
        texts.set(element, change.text.value);
      }
    }
    for (const [element, nodes] of this.#originals) {
      const text = texts.get(element);
      if (text !== undefined) {
        if (element.textContent !== text) element.textContent = text;
      } else {
        element.replaceChildren(...nodes);
        this.#originals.delete(element);
      }
    }
  }
}
