import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  BROWSER_ANNOTATION_IMAGE_BYTES,
  readBrowserAnnotationImages,
  sameBrowserAnnotationImages,
} from "./browserAnnotationImages";

const image = {
  id: "image-1",
  dataUrl: "data:image/png;base64,YWJj",
  filename: "参考😀.png",
};
describe("Browser annotation inline image boundary", () => {
  it("keeps ordered raster images without paths or shared mutable records", () => {
    const input = [
      image,
      { ...image, id: "second", dataUrl: "data:image/gif;base64,YQ==" },
    ];
    const images = readBrowserAnnotationImages(input);
    expect(images).toEqual(input);
    expect(images[0]).not.toBe(input[0]);
    expect(sameBrowserAnnotationImages(images, input)).toBe(true);
    expect(sameBrowserAnnotationImages(images, [...input].reverse())).toBe(
      false,
    );
  });
  it.each([
    undefined,
    null,
    {},
    [null],
    [image, image],
    [{ ...image, localPath: "/private/file" }],
    [{ ...image, dataUrl: "https://example.test/a.png" }],
    [{ ...image, dataUrl: "data:image/svg+xml;base64,YWJj" }],
    [{ ...image, dataUrl: "data:image/png;base64,YWJj==" }],
    [{ ...image, dataUrl: "data:image/png;base64,Y WJj" }],
    [{ ...image, filename: "\u0000invalid" }],
    Array.from({ length: 21 }, (_, i) => ({ ...image, id: String(i) })),
  ])("rejects malformed image authority or payload %j", (input) => {
    expect(() => readBrowserAnnotationImages(input)).toThrow();
  });
  it("checks decoded per-image and aggregate sizes on real large base64 strings", () => {
    const dataUrl =
      "data:image/png;base64," +
      Buffer.alloc(BROWSER_ANNOTATION_IMAGE_BYTES).toString("base64");
    expect(readBrowserAnnotationImages([{ ...image, dataUrl }])).toHaveLength(
      1,
    );
    expect(
      readBrowserAnnotationImages([
        { ...image, dataUrl },
        { ...image, id: "second", dataUrl },
      ]),
    ).toHaveLength(2);
    expect(() =>
      readBrowserAnnotationImages([
        { ...image, dataUrl },
        { ...image, id: "second", dataUrl },
        { ...image, id: "third" },
      ]),
    ).toThrow("size");
    expect(() =>
      readBrowserAnnotationImages([
        {
          ...image,
          dataUrl:
            "data:image/png;base64," +
            Buffer.alloc(BROWSER_ANNOTATION_IMAGE_BYTES + 1).toString("base64"),
        },
      ]),
    ).toThrow();
  });
});
