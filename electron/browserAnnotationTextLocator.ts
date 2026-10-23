/// <reference lib="dom" />
export function annotationSelector(element: Element): string {
  const escape = (text: string) => {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(text);
    return Array.from(text, (character, index) => {
      const code = character.codePointAt(0)!;
      if (code === 0) return "\uFFFD";
      if (
        code <= 31 ||
        code === 127 ||
        (/[0-9]/u.test(character) &&
          (index === 0 || (index === 1 && text[0] === "-")))
      )
        return `\\${code.toString(16)} `;
      if (character === "-" && text.length === 1) return "\\-";
      return code >= 128 || /[a-zA-Z0-9_-]/u.test(character)
        ? character
        : `\\${character}`;
    }).join("");
  };
  const parts: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (
      node.id &&
      (node.getRootNode() as Document | ShadowRoot).querySelectorAll(
        `#${escape(node.id)}`,
      ).length === 1
    ) {
      parts.unshift(`#${escape(node.id)}`);
      break;
    }
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter(
          (child) => child.localName === node!.localName,
        )
      : Array.from(node.getRootNode().childNodes).filter(
          (child) =>
            child.nodeType === 1 &&
            (child as Element).localName === node!.localName,
        );
    parts.unshift(
      `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`,
    );
  }
  return parts.join(" > ");
}

export function annotationParent(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? annotationShadowRoot(root)?.host ?? null;
}

export function annotationShadowRoot(node: Node): ShadowRoot | null {
  return node.nodeType === 11 && "host" in node ? (node as ShadowRoot) : null;
}

export function annotationShadowHosts(element: Element): string[] {
  const hosts: string[] = [];
  for (
    let root = element.getRootNode();
    annotationShadowRoot(root);
    root = (root as ShadowRoot).host.getRootNode()
  )
    hosts.unshift(annotationSelector((root as ShadowRoot).host));
  return hosts;
}

export function annotationElementAt(
  point: {
    x: number;
    y: number;
  },
  doc: Document = document,
): Element | null {
  let hit = doc.elementFromPoint(point.x, point.y);
  while (hit?.shadowRoot)
    hit = hit.shadowRoot.elementFromPoint(point.x, point.y);
  return hit;
}

/** Axis-aligned positive scale/translation can be mapped without inventing rotated glyphs. */
export function annotationUnrotated(element: Element): boolean {
  for (
    let node: Element | null = element;
    node;
    node = annotationParent(node)
  ) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!style) return false;
    if (style.transform && style.transform !== "none") {
      const matrix = /^matrix\(([^)]+)\)$/u
        .exec(style.transform)?.[1]
        ?.split(",")
        .map(Number);
      if (
        !matrix ||
        matrix.length !== 6 ||
        matrix.some((value) => !Number.isFinite(value)) ||
        Math.abs(matrix[1]) > 1e-6 ||
        Math.abs(matrix[2]) > 1e-6 ||
        matrix[0] <= 0 ||
        matrix[3] <= 0
      )
        return false;
    }
    const rotate = style.getPropertyValue("rotate");
    if (rotate && rotate !== "none" && rotate !== "0deg") return false;
    const scale = style.getPropertyValue("scale");
    if (
      scale &&
      scale !== "none" &&
      scale
        .split(/\s+/u)
        .some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)
    )
      return false;
  }
  return true;
}
