import { isDeepStrictEqual } from "node:util";
import {
  assertBrowserHistoryPage,
  parseBrowserHistoryQuery,
} from "../src/lib/api/browserHistoryTypes";
import type { BrowserHistoryHost } from "./browserHistoryHost";
import type { BrowserPermissionAnchor } from "./browserPermissions";
import type { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";
import { readRequiredString } from "./browserTabState";

interface HistoryRead {
  anchor: BrowserPermissionAnchor;
  canceled: boolean;
}

const approvalText = {
  "zh-CN": ["允许 Agent 查询你的浏览历史：", "最近的浏览记录"],
  "zh-TW": ["允許 Agent 查詢你的瀏覽記錄：", "最近的瀏覽記錄"],
  "en-US": [
    "Allow this Agent query of your browsing history: ",
    "recent browsing history",
  ],
  "ja-JP": ["Agent による閲覧履歴の検索を許可しますか：", "最近の閲覧履歴"],
  "ko-KR": ["Agent의 방문 기록 검색 허용: ", "최근 방문 기록"],
} as const;

/** Agent queries share the user's history owner and have a separate access policy. */
export class BrowserHistoryTool {
  readonly #reads = new Set<HistoryRead>();
  #locale: keyof typeof approvalText = "en-US";

  setLocale(locale: string): void {
    this.#locale = Object.hasOwn(approvalText, locale)
      ? (locale as keyof typeof approvalText)
      : "en-US";
  }

  constructor(
    readonly options: {
      history: BrowserHistoryHost;
      policy: BrowserTabPolicy;
      refreshSettings: () => Promise<void>;
      anchor: (call: BrowserToolCall) => BrowserPermissionAnchor;
    },
  ) {}

  async preflight(
    call: BrowserToolCall,
    requestApproval: (reason: string) => BrowserToolResult,
  ): Promise<BrowserToolResult> {
    this.#assertAccess();
    this.#query(call);
    if (this.options.policy.historyAccess === "alwaysAsk") {
      const [prefix, recent] = approvalText[this.#locale];
      const query =
        typeof call.arguments.query === "string" && call.arguments.query.trim()
          ? JSON.stringify(call.arguments.query)
          : recent;
      return requestApproval(`${prefix}${query}`);
    }
    return this.read(call);
  }

  async read(call: BrowserToolCall): Promise<BrowserToolResult> {
    this.#assertAccess();
    const query = this.#query(call);
    const revision = this.options.policy.revision;
    const read: HistoryRead = {
      anchor: this.options.anchor(call),
      canceled: false,
    };
    this.#reads.add(read);
    try {
      const result = await this.options.history.invoke(
        "browser_history_list",
        query,
      );
      // A GUI config write or external edit can revoke access while disk IO is pending.
      await this.options.refreshSettings();
      this.#assertAccess();
      if (
        read.canceled ||
        revision !== this.options.policy.revision ||
        !isDeepStrictEqual(read.anchor, this.options.anchor(call))
      )
        throw new Error(
          "Browser history query became unavailable after its owner or policy changed",
        );
      assertBrowserHistoryPage(result);
      return { status: "completed", data: result };
    } finally {
      this.#reads.delete(read);
    }
  }

  cancel(predicate: (anchor: BrowserPermissionAnchor) => boolean): void {
    for (const read of this.#reads)
      if (predicate(read.anchor)) read.canceled = true;
  }

  #assertAccess(): void {
    if (
      !this.options.policy.enabled ||
      this.options.policy.historyAccess === "disabled"
    )
      throw new Error("Browser Agent history access is disabled in settings");
  }

  #query(call: BrowserToolCall) {
    if (Object.hasOwn(call.arguments, "tabId"))
      readRequiredString(call.arguments, "tabId");
    const query = { ...call.arguments };
    delete query.tabId;
    return parseBrowserHistoryQuery(query);
  }
}
