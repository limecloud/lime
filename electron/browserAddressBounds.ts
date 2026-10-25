import type { BrowserMenuPresentation } from "./browserOverlayModel";

/** Keep the native suggestion surface below the address without intercepting its input. */
export function browserAddressBounds(
  presentation: BrowserMenuPresentation,
  content: { width: number; height: number },
) {
  const { anchor, items } = presentation;
  const width = Math.max(1, Math.min(content.width, Math.ceil(anchor.width)));
  const y = Math.max(
    0,
    Math.min(content.height - 1, Math.ceil(anchor.y + anchor.height + 3)),
  );
  return {
    x: Math.max(0, Math.min(Math.floor(anchor.x), content.width - width)),
    y,
    width,
    height: Math.max(1, Math.min(content.height - y, items.length * 44 + 10)),
  };
}
