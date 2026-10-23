/** Inline images selected in the trusted annotation editor; never file-read authority. */
export interface BrowserAnnotationImage {
  id: string;
  dataUrl: string;
  filename?: string;
}

export const BROWSER_ANNOTATION_IMAGE_LIMIT = 20;
export const BROWSER_ANNOTATION_IMAGE_BYTES = 10 * 1024 * 1024;
export const BROWSER_ANNOTATION_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const BROWSER_ANNOTATION_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export function readBrowserAnnotationImages(
  value: unknown,
): BrowserAnnotationImage[] {
  if (!Array.isArray(value) || value.length > BROWSER_ANNOTATION_IMAGE_LIMIT)
    throw new Error("Invalid browser annotation images");
  const ids = new Set<string>();
  let total = 0;
  return value.map((image: unknown) => {
    if (!image || typeof image !== "object" || Array.isArray(image))
      throw new Error("Invalid browser annotation image");
    const entry = image as Record<string, unknown>;
    if (
      Object.keys(entry).some(
        (key) => !["id", "dataUrl", "filename"].includes(key),
      ) ||
      typeof entry.id !== "string" ||
      !/^[a-zA-Z0-9._:-]{1,100}$/u.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.dataUrl !== "string" ||
      entry.dataUrl.length > (BROWSER_ANNOTATION_IMAGE_BYTES * 4) / 3 + 100 ||
      (entry.filename !== undefined &&
        (typeof entry.filename !== "string" ||
          !entry.filename.trim() ||
          entry.filename.length > 255 ||
          entry.filename.split("").some((char) => char.charCodeAt(0) < 32)))
    )
      throw new Error("Invalid browser annotation image");
    const match = /^data:image\/(?:png|jpeg|webp|gif);base64,/u.exec(
      entry.dataUrl,
    );
    const data = match ? entry.dataUrl.slice(match[0].length) : "";
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data))
      throw new Error("Invalid browser annotation image data");
    const size =
      (data.length / 4) * 3 -
      (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    total += size;
    if (
      size > BROWSER_ANNOTATION_IMAGE_BYTES ||
      total > BROWSER_ANNOTATION_TOTAL_IMAGE_BYTES
    )
      throw new Error("Browser annotation image size exceeded");
    ids.add(entry.id);
    return {
      id: entry.id,
      dataUrl: entry.dataUrl,
      ...(entry.filename === undefined
        ? {}
        : { filename: entry.filename as string }),
    };
  });
}

export function sameBrowserAnnotationImages(
  left: readonly BrowserAnnotationImage[],
  right: readonly BrowserAnnotationImage[],
): boolean {
  return (
    left.length === right.length &&
    left.every((image, index) => {
      const other = right[index];
      return (
        image.id === other.id &&
        image.dataUrl === other.dataUrl &&
        image.filename === other.filename
      );
    })
  );
}
