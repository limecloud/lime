/** The properties observed in the retained reference's element inspector. */
export const BROWSER_DESIGN_PROPERTIES = [
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "border-radius",
  "border-color",
  "border-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "opacity",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "row-gap",
  "column-gap",
] as const;

export interface BrowserDesignDeclaration {
  property: string;
  previousValue: string;
  value: string;
}
export interface BrowserDesignText {
  previousValue: string;
  value: string;
}
export interface BrowserDesignChange {
  declarations: BrowserDesignDeclaration[];
  text?: BrowserDesignText;
}
export interface BrowserDesignSnapshot extends BrowserDesignChange {
  elementTagName: string;
}
export interface BrowserDesignLabels {
  title: string;
  text: string;
  reset: string;
  invalid: string;
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Browser design object");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !keys.includes(key)))
    throw new Error("Unknown Browser design field");
  return source;
}
function string(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Invalid Browser design string");
  return value;
}
function readChange(value: unknown): BrowserDesignChange {
  const source = record(value, ["declarations", "text"]);
  if (!Array.isArray(source.declarations) || source.declarations.length > 25)
    throw new Error("Invalid Browser design declarations");
  const properties = new Set<string>();
  const declarations = source.declarations.map((value) => {
    const item = record(value, ["property", "value", "previousValue"]);
    const property = string(item.property, 100);
    if (
      !(BROWSER_DESIGN_PROPERTIES as readonly string[]).includes(property) ||
      properties.has(property)
    )
      throw new Error("Invalid Browser design property");
    properties.add(property);
    return {
      property,
      previousValue: string(item.previousValue, 4096),
      value: string(item.value, 4096),
    };
  });
  declarations.sort(
    (a, b) =>
      BROWSER_DESIGN_PROPERTIES.indexOf(
        a.property as (typeof BROWSER_DESIGN_PROPERTIES)[number],
      ) -
      BROWSER_DESIGN_PROPERTIES.indexOf(
        b.property as (typeof BROWSER_DESIGN_PROPERTIES)[number],
      ),
  );
  const result: BrowserDesignChange = { declarations };
  if (source.text !== undefined) {
    const text = record(source.text, ["value", "previousValue"]);
    result.text = {
      previousValue: string(text.previousValue, 20_000),
      value: string(text.value, 20_000),
    };
  }
  return result;
}

export function readBrowserDesignSnapshot(
  value: unknown,
): BrowserDesignSnapshot {
  const source = record(value, ["elementTagName", "declarations", "text"]);
  const change = readChange({
    declarations: source.declarations,
    ...(source.text === undefined ? {} : { text: source.text }),
  });
  const elementTagName = string(source.elementTagName, 100);
  if (
    !/^[a-z][a-z0-9:-]*$/u.test(elementTagName) ||
    !change.declarations.length ||
    change.declarations.some((item) => item.value !== item.previousValue) ||
    (change.text && change.text.value !== change.text.previousValue)
  )
    throw new Error("Invalid Browser design baseline");
  return { ...change, elementTagName };
}

/** Baselines are immutable; callers may only change fields declared by the captured target. */
export function readBrowserDesignChange(
  value: unknown,
  snapshot?: BrowserDesignSnapshot,
): BrowserDesignChange | null {
  if (value === null || value === undefined) return null;
  const change = readChange(value);
  if (snapshot) {
    for (const item of change.declarations) {
      const baseline = snapshot.declarations.find(
        (candidate) => candidate.property === item.property,
      );
      if (!baseline || baseline.previousValue !== item.previousValue)
        throw new Error("Browser design baseline changed");
    }
    if (
      change.text &&
      (!snapshot.text ||
        change.text.previousValue !== snapshot.text.previousValue)
    )
      throw new Error("Browser design text is unavailable");
  }
  change.declarations = change.declarations.filter(
    (item) => item.value !== item.previousValue,
  );
  if (change.text?.value === change.text?.previousValue) delete change.text;
  return change.declarations.length || change.text ? change : null;
}

export function sameBrowserDesignChange(
  a: BrowserDesignChange | null | undefined,
  b: BrowserDesignChange | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function updateBrowserDesignChange(
  snapshot: BrowserDesignSnapshot,
  current: BrowserDesignChange | null,
  property: string,
  value: string,
): BrowserDesignChange | null {
  const next: BrowserDesignChange = structuredClone(
    current ?? { declarations: [] },
  );
  if (property === "text") {
    if (!snapshot.text) throw new Error("Browser design text is unavailable");
    next.text = { previousValue: snapshot.text.previousValue, value };
  } else {
    const baseline = snapshot.declarations.find(
      (item) => item.property === property,
    );
    if (!baseline) throw new Error("Browser design property is unavailable");
    next.declarations = [
      ...next.declarations.filter((item) => item.property !== property),
      { ...baseline, value },
    ];
  }
  return readBrowserDesignChange(next, snapshot);
}
