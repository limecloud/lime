/**
 * Mock for @tauri-apps/plugin-deep-link
 */

type UrlCallback = (urls: string[]) => void;
type UnlistenFn = () => void;

/**
 * Mock onOpenUrl function
 * 在浏览器环境中，deep link 通常不可用
 */
export async function onOpenUrl(handler: UrlCallback): Promise<UnlistenFn> {
  console.log("[Mock] Deep link onOpenUrl registered");

  // 模拟从 URL 获取 deep link 参数
  if (typeof window !== "undefined") {
    const urlParams = new URLSearchParams(window.location.search);
    const deepLinkUrl = urlParams.get("lime");

    if (deepLinkUrl) {
      console.log("[Mock] Deep link URL from params:", deepLinkUrl);
      setTimeout(() => handler([deepLinkUrl]), 100);
    }
  }

  // 返回 unlisten 函数
  return () => {
    console.log("[Mock] Deep link unlisten");
  };
}

/**
 * Mock getUrls function (获取当前打开的 URL)
 */
export async function getUrls(): Promise<string[]> {
  console.log("[Mock] Deep link getUrls");

  if (typeof window !== "undefined") {
    const urlParams = new URLSearchParams(window.location.search);
    const deepLinkUrl = urlParams.get("lime");
    return deepLinkUrl ? [deepLinkUrl] : [];
  }

  return [];
}

/**
 * Mock getCurrent function
 * 对齐 @tauri-apps/plugin-deep-link 的启动 URL 读取接口
 */
export async function getCurrent(): Promise<string[] | null> {
  const urls = await getUrls();
  return urls.length > 0 ? urls : null;
}
