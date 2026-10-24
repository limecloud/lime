const close = (actual, expected, tolerance = 2) =>
  Number.isFinite(actual) &&
  Number.isFinite(expected) &&
  Math.abs(actual - expected) <= tolerance;
const sameRect = (actual, expected, tolerance = 2) =>
  !!actual &&
  !!expected &&
  ["x", "y", "width", "height"].every((key) =>
    close(actual[key], expected[key], tolerance),
  );

/** Validate measured native/DOM/capture output; no product geometry helper is reused. */
export function browserDeviceAnnotationAssertions(cell) {
  const { selection, capture, before, editor, expectedRect, image, input } =
    cell;
  const viewport = selection?.viewportSize;
  const bounds = before?.native?.bounds;
  const anchor = selection?.targetRect;
  const usable =
    viewport?.width > 0 &&
    viewport?.height > 0 &&
    bounds?.width > 0 &&
    bounds?.height > 0;
  const left =
    usable && anchor
      ? bounds.x + (anchor.x * bounds.width) / viewport.width
      : NaN;
  const top =
    usable && anchor
      ? bounds.y + (anchor.y * bounds.height) / viewport.height
      : NaN;
  const width = Math.min(360, (editor?.window?.width ?? 0) - 16);
  let x =
    left +
    ((anchor?.width ?? 0) * (bounds?.width ?? 0)) / (viewport?.width ?? 1) +
    12;
  if (x + width > (editor?.window?.width ?? 0) - 8) x = left - width - 12;
  const expectedEditor = {
    x: Math.round(
      Math.max(0, Math.min((editor?.window?.width ?? 0) - width, x)),
    ),
    y: Math.round(
      Math.max(
        0,
        Math.min(
          (editor?.window?.height ?? 0) - (editor?.native?.bounds?.height ?? 0),
          top,
        ),
      ),
    ),
    width,
    height: editor?.native?.bounds?.height,
  };
  const crop = capture?.screenshot?.cropRect;
  const extent = crop
    ? {
        width: (crop.width * image?.rawSize?.width) / viewport?.width,
        height: (crop.height * image?.rawSize?.height) / viewport?.height,
      }
    : image?.rawSize;
  const factor = extent
    ? Math.min(1, (crop ? 1024 : 1280) / Math.max(extent.width, extent.height))
    : NaN;
  const projected = before?.state?.deviceViewport?.bounds ?? bounds;
  return {
    liveSelectionMatchesInput:
      selection?.kind === cell.kind &&
      sameRect(anchor, expectedRect, cell.tolerance ?? 2),
    cssViewportMatchesPage:
      usable &&
      close(viewport.width, before.metrics.innerWidth, 0.01) &&
      close(viewport.height, before.metrics.innerHeight, 0.01),
    nativeBoundsMatchProjection: sameRect(bounds, projected, 0),
    inputInsideNativeView:
      !!input?.length &&
      input.every(
        (point) =>
          point.x >= 0 &&
          point.y >= 0 &&
          point.x < bounds.width &&
          point.y < bounds.height,
      ),
    editorUsesActualPageBounds: sameRect(
      editor?.native?.bounds,
      expectedEditor,
      1,
    ),
    editorStaysWithNativeOwner:
      editor?.native?.windowId === before.native.windowId &&
      editor?.native?.ownerWebContentsId === before.native.ownerWebContentsId &&
      editor.native.webContentsId !== before.native.webContentsId,
    trustedEditorHasNarrowBridge:
      editor?.bridge?.narrow === true &&
      editor.bridge.node === false &&
      editor.bridge.general === false,
    captureSucceeded:
      capture?.status === "success" &&
      capture.screenshotStatus === "captured" &&
      !!image?.file,
    capturePolicyMatchesSelection:
      capture?.screenshot?.kind ===
      (cell.kind === "region" ? "crop" : "viewport"),
    capturePixelDimensions:
      close(
        image?.size?.width,
        Math.max(1, Math.round(extent?.width * factor)),
        1,
      ) &&
      close(
        image?.size?.height,
        Math.max(1, Math.round(extent?.height * factor)),
        1,
      ) &&
      close(image?.size?.width, capture?.screenshot?.width, 0) &&
      close(image?.size?.height, capture?.screenshot?.height, 0),
    captureContainsSelectedColor:
      image?.sample?.length === 4 &&
      cell.baselineSample?.length === 4 &&
      image.sample[1] > image.sample[0] + 25 &&
      image.sample[1] > image.sample[2] + 25 &&
      image.sample.every((value, index) =>
        close(value, cell.baselineSample[index], 40),
      ),
    pickerDidNotActivatePage:
      before?.metrics?.clicks === 0 && cell.clicksAfter === 0,
  };
}
