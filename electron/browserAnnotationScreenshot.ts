import type { NativeImage } from "electron";
import type {
  BrowserAnnotationScreenshot,
  BrowserAnnotationSelection,
} from "../src/lib/api/browserAnnotationTypes";
import { annotationCrop } from "./browserAnnotationModel";

/** Capture policy and pixel scaling share one owner for element, text and region. */
export function annotationScreenshot(
  image: NativeImage,
  selection: BrowserAnnotationSelection,
  mode: "always" | "necessary",
): BrowserAnnotationScreenshot {
  if (image.isEmpty()) throw new Error("Empty Browser annotation screenshot");
  const crop = annotationCrop(selection, image.getSize(), mode);
  let output = crop ? image.crop(crop.pixels) : image;
  const limit = crop ? 1024 : 1280;
  const size = output.getSize();
  const scale = Math.min(1, limit / Math.max(size.width, size.height));
  if (scale < 1)
    output = output.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "best",
    });
  if (output.isEmpty()) throw new Error("Empty Browser annotation crop");
  return {
    dataUrl: output.toDataURL(),
    ...output.getSize(),
    kind: crop ? "crop" : "viewport",
    viewportSize: selection.viewportSize,
    ...(crop ? { cropRect: crop.viewport } : {}),
  };
}
