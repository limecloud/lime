import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusManager, notifyManager } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { changeLimeLocale } from "@/i18n/createI18n";
import { accountFixture, seedCloudAccount } from "@/test/cloudAccountFixture";
import { readCloudAccount } from "@/lib/cloudAccount";
import type { AppServerPluginDetail } from "@/lib/api/appServerTypes";
import { PluginSkillsSection } from "./PluginSkillsSection";
import { skillPreviewDetail as detail } from "../model/skillPreviewTestFixtures";
import { skillPreviewQueryClient } from "../model/skillPreviewQueries";

const mocks = vi.hoisted(() => ({ read: vi.fn(), file: vi.fn() }));
vi.mock("@/lib/api/pluginCatalog", () => ({ readPluginSkill: mocks.read }));
vi.mock("@/lib/api/fileBrowser", () => ({ readFileBytes: mocks.file }));

function Harness({ plugin }: { plugin: AppServerPluginDetail }) {
  const { t } = useTranslation("agent");
  return <PluginSkillsSection detail={plugin} t={t} />;
}
let root: Root;
let container: HTMLDivElement;
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

async function mount(plugin = detail()) {
  await act(async () => {
    root.render(<Harness plugin={plugin} />);
  });
  const card = container.querySelector<HTMLButtonElement>(
    "[data-testid=plugin-skill-card]",
  )!;
  expect(card.disabled).toBe(false);
  await act(async () => {
    card.focus();
    card.click();
  });
  await settle();
  return card;
}
function contents() {
  return document.querySelector("[data-testid=plugin-skill-contents]");
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  )!;
}

beforeEach(async () => {
  // Flush query notifications with React's existing async act boundaries.
  notifyManager.setScheduler(queueMicrotask);
  skillPreviewQueryClient.clear();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.read.mockReset();
  mocks.file.mockReset();
  await changeLimeLocale("zh-CN");
  await seedCloudAccount({
    userId: "one",
    generation: "generation-one",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  skillPreviewQueryClient.clear();
  vi.useRealTimers();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.clearAllMocks();
});

describe("plugin skill preview", () => {
  it("重开复用五分钟内正文，过期重开保留已有正文并读取新内容", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
    mocks.read.mockResolvedValueOnce({ contents: "Cached body" });
    const card = await mount();
    expect(contents()?.textContent).toContain("Cached body");
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[aria-label=关闭]")!.click();
    });
    vi.setSystemTime(Date.now() + 299_999);
    await act(async () => {
      card.click();
    });
    expect(contents()?.textContent).toContain("Cached body");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[aria-label=关闭]")!.click();
    });
    let resolve!: (result: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => {
      card.click();
    });
    expect(contents()?.textContent).toContain("Cached body");
    expect(contents()?.querySelector("[role=status]")).toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve({ contents: "Updated body" });
    });
    await settle();
    expect(contents()?.textContent).toContain("Updated body");
  });

  it("A→B→A在同一批次也关闭预览，旧缓存不恢复", async () => {
    mocks.read.mockResolvedValueOnce({ contents: "Private cached body" });
    const card = await mount();
    expect(contents()?.textContent).toContain("Private cached body");
    await act(async () => {
      await seedCloudAccount({
        userId: "two",
        generation: "generation-two",
      });
      await seedCloudAccount({
        userId: "one",
        generation: "generation-one",
      });
    });
    expect(
      document.querySelector("[data-testid=plugin-skill-preview]"),
    ).toBeNull();
    mocks.read.mockResolvedValueOnce({ contents: "New account lifetime" });
    await act(async () => {
      card.click();
    });
    await settle();
    expect(contents()?.textContent).toContain("New account lifetime");
    expect(document.body.textContent).not.toContain("Private cached body");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("未安装/未启用仍能读取远端授权正文，只在点击后读取，关闭恢复焦点", async () => {
    let resolve!: (result: { contents: string }) => void;
    mocks.read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => {
      root.render(<Harness plugin={detail()} />);
    });
    expect(mocks.read).not.toHaveBeenCalled();
    const card = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      card.focus();
      card.click();
    });
    expect(contents()?.textContent).toContain("正在加载技能正文");
    expect(mocks.read).toHaveBeenCalledWith(
      {
        remoteMarketplaceName: "workspace-directory",
        remotePluginId: "opaque~1",
        skillName: "research",
      },
      { signal: expect.any(AbortSignal) },
    );
    await act(async () => {
      resolve({
        contents:
          "---\r\nname: research\r\n---\r\n# Different\r\n\r\n## Usage\r\n**Real body**",
      });
    });
    expect(contents()?.querySelector("h1")).toBeNull();
    expect(contents()?.querySelector("h2")?.textContent).toBe("Usage");
    expect(contents()?.querySelector("strong")?.textContent).toBe("Real body");
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[aria-label=关闭]")!.click();
    });
    await settle();
    expect(
      document.querySelector("[data-testid=plugin-skill-preview]"),
    ).toBeNull();
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(card));
    });
    expect(document.activeElement).toBe(card);
    // A settled query remains cached; closing only cancels a pending read.
    expect(signal.aborted).toBe(false);
  });

  it.each([null, "", "---\nname: research\n---\n# Research\n"])(
    "成功但无指令显示空态：%s",
    async (body) => {
      mocks.read.mockResolvedValue({ contents: body });
      await mount();
      expect(contents()?.textContent).toBe("暂无可用指令");
      expect(document.querySelector("[role=alert]")).toBeNull();
    },
  );

  it("失败不伪造空正文，同技能可重试，优先本地path且本地失败不转远端", async () => {
    mocks.file.mockRejectedValueOnce(
      Object.assign(new Error("private file error"), { status: 403 }),
    );
    mocks.file.mockResolvedValueOnce(
      new TextEncoder().encode("# Local\n\nLocal body"),
    );
    await mount(detail("/workspace/skills/research/SKILL.md"));
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "无法加载技能正文",
    );
    expect(document.body.textContent).not.toContain("private file error");
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      button("重试").click();
    });
    expect(contents()?.textContent).toContain("Local body");
    expect(mocks.file).toHaveBeenCalledTimes(2);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("远端失败可重新读取，切换账号丢弃迟到正文", async () => {
    mocks.read.mockRejectedValueOnce(
      Object.assign(new Error("HTTP 404"), { status: 404 }),
    );
    let resolve!: (result: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount();
    expect(document.querySelector("[role=alert]")).not.toBeNull();
    await act(async () => {
      button("重试").click();
    });
    await act(async () => {
      await seedCloudAccount({
        userId: "two",
        generation: "generation-two",
      });
    });
    expect(
      document.querySelector("[data-testid=plugin-skill-preview]"),
    ).toBeNull();
    await act(async () => {
      resolve({ contents: "Stale private body" });
    });
    expect(document.body.textContent).not.toContain("Stale private body");
    mocks.read.mockResolvedValueOnce({ contents: "Fresh account body" });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(contents()?.textContent).toContain("Fresh account body");
    await act(async () => {
      accountFixture.account = null;
      await readCloudAccount();
    });
    expect(
      document.querySelector("[data-testid=plugin-skill-preview]"),
    ).toBeNull();
  });

  it("关闭后打开另一个技能，旧技能迟到正文不覆盖新技能", async () => {
    const plugin = detail();
    plugin.skills.push({
      ...plugin.skills[0],
      name: "another-skill",
      interface: null,
    });
    let resolve!: (result: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    mocks.read.mockResolvedValueOnce({ contents: "Second skill contents" });
    await mount(plugin);
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[aria-label=关闭]")!.click();
    });
    await act(async () => {
      container
        .querySelectorAll<HTMLButtonElement>(
          "[data-testid=plugin-skill-card]",
        )[1]
        .click();
    });
    expect(mocks.read.mock.calls[1][0].skillName).toBe("another-skill");
    expect(contents()?.textContent).toContain("Second skill contents");
    await act(async () => {
      resolve({ contents: "Old skill contents" });
    });
    expect(contents()?.textContent).toContain("Second skill contents");
    expect(contents()?.textContent).not.toContain("Old skill contents");
    expect(signal.aborted).toBe(true);
  });

  it.each([
    ["zh-CN", "无法加载技能正文。", "重试"],
    ["zh-TW", "無法載入技能正文。", "重試"],
    ["en-US", "Unable to load skill contents.", "Retry"],
    ["ja-JP", "スキルの内容を読み込めません。", "再試行"],
    ["ko-KR", "스킬 내용을 불러올 수 없습니다.", "다시 시도"],
  ])("%s显示可操作的失败终态", async (locale, error, retry) => {
    await changeLimeLocale(locale as "zh-CN");
    mocks.read.mockRejectedValue(
      Object.assign(new Error("HTTP 403"), { status: 403 }),
    );
    await mount();
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      error,
    );
    expect(button(retry)).toBeDefined();
  });
});
