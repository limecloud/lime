const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s<>"'，。！？、；：）】》]+/i;
const DOMAIN_URL_PATTERN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'，。！？、；：）】》]*)?/i;
const TRAILING_URL_PUNCTUATION_PATTERN = /[，。！？、；：'"’”)\]}>]+$/g;
const BROWSER_ASSIST_INTENT_PATTERN =
  /浏览器协助|browser assist|右侧画布|实时画面|实时浏览器|浏览器模式|在画布中|画布里|浏览器里|browser mode/i;
const BROWSER_NAVIGATION_PATTERN =
  /打开|访问|进入|前往|跳转|导航|\bopen\b|\bvisit\b|\bnavigate\b/i;
const BROWSER_ASSIST_ACTION_PATTERN =
  /打开|访问|进入|前往|跳转|导航|启动|使用|调用|显示|展示|查看|连接|附着|\bopen\b|\bvisit\b|\bnavigate\b|\blaunch\b|\buse\b|\bshow\b|\bconnect\b|\battach\b/i;
const BROWSER_ASSIST_REFERENCE_PATTERN =
  /(?:浏览器协助|browser assist|右侧画布|实时画面|实时浏览器|浏览器模式|在画布中|画布里|浏览器里|browser mode)\s*(?:禁用|关闭|回归|门禁|指标|策略|检查|校验)|(?:禁用|关闭|回归|门禁|指标|策略|检查|校验)\s*(?:浏览器协助|browser assist|右侧画布|实时画面|实时浏览器|浏览器模式|在画布中|画布里|浏览器里|browser mode)/i;
const BROWSER_ASSIST_NEGATED_ACTION_PATTERN =
  /(?:不|不要|无需|不用|禁止|避免)(?:打开|访问|进入|前往|跳转|导航|启动|使用|调用|显示|展示|查看|连接|附着).{0,12}(?:浏览器协助|browser assist|右侧画布|实时画面|实时浏览器|浏览器模式|在画布中|画布里|浏览器里|browser mode)|(?:浏览器协助|browser assist|右侧画布|实时画面|实时浏览器|浏览器模式|在画布中|画布里|浏览器里|browser mode).{0,12}(?:不|不要|无需|不用|禁止|避免)(?:打开|访问|进入|前往|跳转|导航|启动|使用|调用|显示|展示|查看|连接|附着)/i;

function sanitizeDetectedUrl(value: string): string {
  return value.trim().replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
}

export function extractExplicitUrlFromText(input: string): string | null {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  const absoluteMatch = normalized.match(ABSOLUTE_URL_PATTERN);
  if (absoluteMatch?.[0]) {
    return sanitizeDetectedUrl(absoluteMatch[0]);
  }

  const domainMatch = normalized.match(DOMAIN_URL_PATTERN);
  if (domainMatch?.[0]) {
    return `https://${sanitizeDetectedUrl(domainMatch[0])}`;
  }

  return null;
}

export function hasBrowserAssistIntent(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }

  const explicitUrl = extractExplicitUrlFromText(normalized);
  if (BROWSER_ASSIST_INTENT_PATTERN.test(normalized)) {
    if (
      !explicitUrl &&
      (BROWSER_ASSIST_REFERENCE_PATTERN.test(normalized) ||
        BROWSER_ASSIST_NEGATED_ACTION_PATTERN.test(normalized))
    ) {
      return false;
    }
    return Boolean(explicitUrl) || BROWSER_ASSIST_ACTION_PATTERN.test(normalized);
  }

  return Boolean(explicitUrl) && BROWSER_NAVIGATION_PATTERN.test(normalized);
}

export function shouldAutoOpenBrowserAssistForPrompt(input: string): boolean {
  return Boolean(
    extractExplicitUrlFromText(input) && hasBrowserAssistIntent(input),
  );
}

export function resolveBrowserAssistLaunchUrl(input: string): string {
  const explicitUrl = extractExplicitUrlFromText(input);
  if (explicitUrl) {
    return explicitUrl;
  }

  const value = input.trim();
  if (!value) {
    return "https://www.google.com";
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
