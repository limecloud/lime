export const minBrowserZoom = 0.25;
export const maxBrowserZoom = 5;

export function clampBrowserPageZoom(value: number): number {
  return (
    Math.round(
      Math.min(maxBrowserZoom, Math.max(minBrowserZoom, value)) * 100,
    ) / 100
  );
}

export function renderedBrowserZoom(
  zoomFactor: number,
  viewportScale: number,
): number {
  return Math.round(zoomFactor * 100 * viewportScale);
}

export function browserPageZoomFromRendered(
  percent: number,
  viewportScale: number,
): number {
  const target = Math.min(
    maxBrowserZoom * 100,
    Math.max(minBrowserZoom * 100, percent),
  );
  return clampBrowserPageZoom(
    Math.round(viewportScale <= 0 ? target : target / viewportScale) / 100,
  );
}
