import { act } from "react";
import { describe, expect, it } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { deferred } from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import {
  service,
  harness,
  stop,
  entry,
  page,
  root,
  search,
  row,
  button,
  click,
  flush,
  render,
  setupBrowserDownloadsPageTests,
} from "./browserDownloadsPage.testFixtures";

setupBrowserDownloadsPageTests();

describe("BrowserDownloadsPage actions", () => {
  it("keeps resumable interrupted downloads active and only offers removal for finished interruptions", async () => {
    service.list.mockResolvedValue(
      page([
        entry("active-interrupted", {
          state: "interrupted",
          receivedBytes: 1024,
          canResume: true,
          canCancel: true,
        }),
        entry("resume-only", { state: "interrupted", canResume: true }),
        entry("cancel-only", { state: "interrupted", canCancel: true }),
        entry("finished-interrupted", { state: "interrupted" }),
      ]),
    );
    await render();
    await flush();
    expect(button("Resume active-interrupted.pdf").disabled).toBe(false);
    expect(button("Cancel active-interrupted.pdf").disabled).toBe(false);
    expect(
      row("active-interrupted").querySelector('[aria-label^="Remove "]'),
    ).toBeNull();
    expect(row("active-interrupted").querySelector("progress")?.value).toBe(50);
    expect(button("Resume resume-only.pdf").disabled).toBe(false);
    expect(button("Cancel cancel-only.pdf").disabled).toBe(false);
    expect(
      row("resume-only").querySelector('[aria-label^="Remove "]'),
    ).toBeNull();
    expect(
      row("cancel-only").querySelector('[aria-label^="Remove "]'),
    ).toBeNull();
    expect(
      button("Remove finished-interrupted.pdf from history").disabled,
    ).toBe(false);
    expect(
      row("finished-interrupted").querySelector('[aria-label^="Resume "]'),
    ).toBeNull();
    expect(
      row("finished-interrupted").querySelector('[aria-label^="Cancel "]'),
    ).toBeNull();
    expect(row("finished-interrupted").querySelector("progress")).toBeNull();
    await click(button("Resume active-interrupted.pdf"));
    await click(button("Cancel active-interrupted.pdf"));
    await click(button("Remove finished-interrupted.pdf from history"));
    expect(service.manage.mock.calls).toEqual([
      ["active-interrupted", "resume"],
      ["active-interrupted", "cancel"],
      ["finished-interrupted", "remove"],
    ]);
  });

  it.each([
    ["Pause active.pdf", "pause"],
    ["Resume active.pdf", "resume"],
    ["Cancel active.pdf", "cancel"],
    ["Open active.pdf", "open"],
    ["Show active.pdf in folder", "reveal"],
    ["Remove active.pdf from history", "remove"],
  ] as const)("dispatches %s by native record id", async (label, action) => {
    service.list.mockResolvedValue(
      page([
        entry("active", {
          state:
            action === "pause" || action === "cancel"
              ? "progressing"
              : action === "resume"
                ? "paused"
                : "completed",
          canPause: action === "pause",
          canResume: action === "resume",
          canCancel: action === "cancel",
        }),
      ]),
    );
    await render();
    await flush();
    await click(button(label));
    expect(service.manage).toHaveBeenCalledExactlyOnceWith("active", action);
    expect(service.clear).not.toHaveBeenCalled();
    expect(service.toastError).not.toHaveBeenCalled();
  });

  it("prevents duplicate pending actions and leaves a failed download operation available to retry", async () => {
    const pending = deferred<void>();
    service.manage.mockReturnValueOnce(pending.promise);
    await render();
    await flush();
    const open = button("Open report.pdf");
    await act(async () => {
      open.click();
      open.click();
    });
    expect(service.manage).toHaveBeenCalledOnce();
    expect(open.disabled).toBe(true);
    expect(button("Clear all").disabled).toBe(true);
    await act(async () => pending.reject(new Error("file unavailable")));
    expect(row("report")).not.toBeNull();
    expect(open.disabled).toBe(false);
    expect(service.toastError).toHaveBeenCalledExactlyOnceWith(
      "Could not complete this download action. Try again.",
    );
    expect(root().querySelector("[role=alert]")).toBeNull();
    expect(service.list).toHaveBeenCalledOnce();
    await click(open);
    expect(service.manage).toHaveBeenCalledTimes(2);
    expect(service.toastError).toHaveBeenCalledOnce();
    expect(root().querySelector("[role=alert]")).toBeNull();
  });

  it("disables clear when the history contains only active downloads", async () => {
    service.list.mockResolvedValue(
      page([
        entry("active", { state: "paused", canResume: true, canCancel: true }),
      ]),
    );
    await render();
    await flush();
    expect(button("Clear all").disabled).toBe(true);
    await click(button("Clear all"));
    expect(service.clear).not.toHaveBeenCalled();
  });

  it("clears the unfiltered history even when the current search has no results", async () => {
    service.list.mockImplementation(({ query }) =>
      Promise.resolve(query ? page([]) : page()),
    );
    await render();
    await flush();
    await harness.change(search(), "not-found");
    await flush(200);
    expect(root().textContent).toContain("No matching downloads");
    expect(button("Clear all").disabled).toBe(false);
    await click(button("Clear all"));
    expect(service.clear).toHaveBeenCalledExactlyOnceWith();
  });

  it("clears directly without a second confirmation, prevents duplicates and preserves rows after failure for retry", async () => {
    const pending = deferred<void>();
    service.clear.mockReturnValueOnce(pending.promise);
    await render();
    await flush();
    const clear = button("Clear all");
    await act(async () => {
      clear.click();
      clear.click();
    });
    expect(service.clear).toHaveBeenCalledExactlyOnceWith();
    expect(clear.disabled).toBe(true);
    expect(root().querySelector("[role=alertdialog]")).toBeNull();
    await act(async () => pending.reject(new Error("write failed")));
    expect(row("report")).not.toBeNull();
    expect(service.toastError).toHaveBeenCalledExactlyOnceWith(
      "Unable to clear download history. Try again.",
    );
    expect(root().querySelector("[role=alert]")).toBeNull();
    expect(service.list).toHaveBeenCalledOnce();
    expect(clear.disabled).toBe(false);
    service.list.mockResolvedValue(
      page(
        [
          entry("active", {
            state: "progressing",
            canPause: true,
            canCancel: true,
          }),
        ],
        null,
        2,
      ),
    );
    await click(clear);
    expect(service.clear).toHaveBeenCalledTimes(2);
    expect(service.toastError).toHaveBeenCalledOnce();
    expect(service.manage).not.toHaveBeenCalled();
    expect(root().querySelector("[role=alertdialog]")).toBeNull();
    expect(row("active")).not.toBeNull();
    expect(row("report")).toBeNull();
    expect(clear.disabled).toBe(true);
  });

  it("releases a late subscription and ignores action errors after leaving the page", async () => {
    const subscription = deferred<() => void>();
    const operation = deferred<void>();
    service.listen.mockReturnValue(subscription.promise);
    service.manage.mockReturnValue(operation.promise);
    await render();
    await flush();
    await click(button("Open report.pdf"));
    await harness.render(<p>Other settings</p>);
    await act(async () => {
      subscription.resolve(stop);
      operation.reject(new Error("late file open failure"));
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(document.body.textContent).toBe("Other settings");
    expect(service.list).toHaveBeenCalledOnce();
    expect(service.toastError).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders translated page, capabilities, action errors and direct clear in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      service.list.mockResolvedValue(
        page([
          entry(),
          entry("unknown-size", { state: "started", totalBytes: null }),
        ]),
      );
      await render();
      await flush();
      const t = getLimeI18n().getFixedT(locale, "settings");
      expect(search().placeholder).toBe(t("browserDownloads.search"));
      expect(root().querySelector("h1")?.textContent).toBe(
        t("browserDownloads.title"),
      );
      expect(root().querySelector("h2")?.textContent).toBe(
        t("browserDownloads.allTime"),
      );
      expect(
        button(t("browserDownloads.open", { filename: "report.pdf" })).disabled,
      ).toBe(false);
      expect(row("unknown-size").getAttribute("data-download-state")).toBe(
        "started",
      );
      service.manage.mockRejectedValueOnce(new Error("fixture open failure"));
      await click(
        button(t("browserDownloads.open", { filename: "report.pdf" })),
      );
      expect(service.toastError).toHaveBeenCalledExactlyOnceWith(
        t("browserDownloads.operationError"),
      );
      expect(root().querySelector("[role=alert]")).toBeNull();
      service.clear.mockRejectedValueOnce(new Error("fixture clear failure"));
      await click(button(t("browserDownloads.clear")));
      expect(service.clear).toHaveBeenCalledOnce();
      expect(service.toastError).toHaveBeenLastCalledWith(
        t("browserDownloads.clearError"),
      );
      expect(row("report")).not.toBeNull();
      expect(root().querySelector("[role=alert]")).toBeNull();
      await click(button(t("browserDownloads.clear")));
      expect(service.clear).toHaveBeenCalledTimes(2);
      expect(root().querySelector("[role=alertdialog]")).toBeNull();
      expect(root().textContent).not.toContain("browserDownloads.");
      expect(root().textContent).not.toMatch(/\{\{[^}]+\}\}/u);
    },
  );
});
