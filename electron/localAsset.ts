/** 标准asset协议保留固定host，文件身份仅从编码后的pathname读取。 */
export function decodeLocalAssetFilePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== "asset:" || url.host !== "localhost") return null;
    const filePath = decodeURIComponent(url.pathname.slice(1));
    return filePath.startsWith("/") ||
      /^[a-zA-Z]:[\\/]/.test(filePath) ||
      filePath.startsWith("\\\\")
      ? filePath
      : null;
  } catch {
    return null;
  }
}
