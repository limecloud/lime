/** Shipped default-width calculation; user resizing remains owned by LayoutTransition. */
export function getDefaultContentPaneWidth(
  mainContentWidth: number,
  shellHeight: number,
  defaultWidth = 600,
): number {
  const preferred = defaultWidth === 600
    ? Math.max(
        320,
        Math.min(shellHeight * 1.6, mainContentWidth - 500),
        Math.min(640, mainContentWidth - 352),
      )
    : defaultWidth;
  return Math.max(280, Math.min(preferred, Math.max(280, mainContentWidth - 280)));
}
