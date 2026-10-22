import { describe, expect, it } from "vitest";
import { decodeLocalAssetFilePath } from "./localAsset";

describe("local asset file identity", () => {
  it.each([
    [
      "asset://localhost/%2FUsers%2FCase%2F%E5%9B%BE%20%231%3F%25.png",
      "/Users/Case/图 #1?%.png",
    ],
    [
      "asset://localhost/C%3A%5CUsers%5CCase%5CImage.png",
      "C:\\Users\\Case\\Image.png",
    ],
    [
      "asset://localhost/%5C%5CServer%5CShare%5CImage.png",
      "\\\\Server\\Share\\Image.png",
    ],
  ])("解码标准URL并保留原路径：%s", (url, filePath) => {
    expect(decodeLocalAssetFilePath(new URL(url).href)).toBe(filePath);
  });

  it.each([
    "asset://%2Ftmp%2FImage.png",
    "asset://other/%2Ftmp%2FImage.png",
    "https://localhost/%2Ftmp%2FImage.png",
    "asset://localhost/relative.png",
    "asset://localhost/%E0%A4%A",
    "asset://localhost:1234/%2Ftmp%2FImage.png",
    "not a URL",
  ])("拒绝无效来源或非绝对路径：%s", (url) => {
    expect(decodeLocalAssetFilePath(url)).toBeNull();
  });
});
