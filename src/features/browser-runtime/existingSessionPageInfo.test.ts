import { describe, expect, it } from "vitest";
import type { ChromeBridgePageInfo } from "@/lib/webview-api";
import {
  mergeExistingSessionObserverPageInfo,
  mergeExistingSessionPageInfo,
  syncExistingSessionPageInfoRecord,
  updateExistingSessionPageInfoRecord,
} from "./existingSessionPageInfo";

const OLD_PAGE_INFO: ChromeBridgePageInfo = {
  title: "旧页面",
  url: "https://example.com/old",
  markdown: "# 旧页面",
  updated_at: "2026-03-16T10:00:05Z",
};

const NEW_PAGE_INFO: ChromeBridgePageInfo = {
  title: "新页面",
  url: "https://example.com/new",
  markdown: "# 新页面",
  updated_at: "2026-03-16T10:00:08Z",
};

describe("existingSessionPageInfo", () => {
  it("应优先保留较新的页面摘要", () => {
    expect(mergeExistingSessionPageInfo(OLD_PAGE_INFO, NEW_PAGE_INFO)).toEqual(
      NEW_PAGE_INFO,
    );
    expect(mergeExistingSessionPageInfo(NEW_PAGE_INFO, OLD_PAGE_INFO)).toEqual(
      NEW_PAGE_INFO,
    );
  });

  it("observer 缺失时应清空 override，observer 较旧时应保留现值", () => {
    expect(
      mergeExistingSessionObserverPageInfo(NEW_PAGE_INFO, null),
    ).toBeNull();
    expect(
      mergeExistingSessionObserverPageInfo(NEW_PAGE_INFO, {
        last_page_info: OLD_PAGE_INFO,
      }),
    ).toEqual(NEW_PAGE_INFO);
  });

  it("应以 profile_key 为粒度更新页面摘要记录", () => {
    const previous = {
      weibo_attach: OLD_PAGE_INFO,
    };

    expect(
      updateExistingSessionPageInfoRecord(
        previous,
        "weibo_attach",
        NEW_PAGE_INFO,
      ),
    ).toEqual({
      weibo_attach: NEW_PAGE_INFO,
    });
    expect(
      updateExistingSessionPageInfoRecord(
        previous,
        "weibo_attach",
        OLD_PAGE_INFO,
      ),
    ).toBe(previous);
  });

  it("同步桥接快照时不应让较旧 observer 覆盖较新的页面摘要", () => {
    expect(
      syncExistingSessionPageInfoRecord(
        {
          weibo_attach: NEW_PAGE_INFO,
        },
        {
          observer_count: 1,
          control_count: 0,
          pending_command_count: 0,
          observers: [
            {
              client_id: "observer-1",
              profile_key: "weibo_attach",
              connected_at: "2026-03-16T10:00:00Z",
              last_page_info: OLD_PAGE_INFO,
            },
          ],
          controls: [],
          pending_commands: [],
        },
      ),
    ).toEqual({
      weibo_attach: NEW_PAGE_INFO,
    });
  });
});
