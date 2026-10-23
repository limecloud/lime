/** jsdom has no sheet adoption; only native Electron can establish CSP behavior. */
export function installConstructedSheets(realm = window) {
  const constructor = Object.getOwnPropertyDescriptor(realm, "CSSStyleSheet");
  Object.defineProperty(realm, "CSSStyleSheet", {
    configurable: true,
    writable: true,
    value: class {
      css = "";
      replaceSync(css: string) {
        this.css = css;
      }
    },
  });
  const sheets = new WeakMap<object, CSSStyleSheet[]>();
  const prototypes = [realm.Document.prototype, realm.ShadowRoot.prototype];
  const descriptors = prototypes.map((prototype) =>
    Object.getOwnPropertyDescriptor(prototype, "adoptedStyleSheets"),
  );
  prototypes.forEach((prototype) =>
    Object.defineProperty(prototype, "adoptedStyleSheets", {
      configurable: true,
      get() {
        return sheets.get(this) ?? [];
      },
      set(value: CSSStyleSheet[]) {
        sheets.set(this, value);
      },
    }),
  );
  return () => {
    if (constructor) Object.defineProperty(realm, "CSSStyleSheet", constructor);
    else Reflect.deleteProperty(realm, "CSSStyleSheet");
    prototypes.forEach((prototype, index) => {
      const descriptor = descriptors[index];
      if (descriptor)
        Object.defineProperty(prototype, "adoptedStyleSheets", descriptor);
      else Reflect.deleteProperty(prototype, "adoptedStyleSheets");
    });
  };
}
