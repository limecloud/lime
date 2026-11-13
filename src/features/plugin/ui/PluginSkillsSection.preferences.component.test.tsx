import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { notifyManager } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { changeLimeLocale } from "@/i18n/createI18n";
import { seedCloudAccount } from "@/test/cloudAccountFixture";
import type { AppServerPluginDetail } from "@/lib/api/appServerTypes";
import { PluginSkillsSection } from "./PluginSkillsSection";
import { skillPreviewDetail } from "../model/skillPreviewTestFixtures";
import { skillPreviewQueryClient } from "../model/skillPreviewQueries";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  read: vi.fn(),
  contents: vi.fn(),
}));
vi.mock("@/lib/api/pluginCatalog", () => ({
  readPluginSkill: mocks.contents,
  readPlugin: mocks.read,
  setPluginSkillEnabled: mocks.write,
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  readFileBytes: async () =>
    new TextEncoder().encode((await mocks.contents()).contents),
}));
const installedSkillPath = "/plugins/research/skills/research/SKILL.md";

function Harness({ detail }: { detail: AppServerPluginDetail }) {
  const { t } = useTranslation("agent");
  return <PluginSkillsSection detail={detail} t={t} />;
}
function installed(enabled = false) {
  const detail = skillPreviewDetail();
  detail.summary.installed = true;
  detail.summary.enabled = false;
  detail.skills[0].enabled = enabled;
  detail.skills[0].path = installedSkillPath;
  return detail;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
const switches = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
];
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const render = async (detail = installed()) => {
  await act(async () => root.render(<Harness detail={detail} />));
};
const seed = (user = "one") =>
  seedCloudAccount({
    userId: user,
    generation: `generation-${user}`,
  });

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler(queueMicrotask);
  skillPreviewQueryClient.clear();
  mocks.contents.mockReset();
  mocks.write.mockReset();
  mocks.read.mockReset();
  mocks.contents.mockResolvedValue({ contents: "Cached skill body" });
  mocks.write.mockResolvedValue(undefined);
  await changeLimeLocale("zh-CN");
  await seed();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  skillPreviewQueryClient.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

describe("installed shared plugin skill preferences", () => {
  it("卡片和预览共享pending及fresh detail，插件整体停用不覆盖技能偏好", async () => {
    const write = deferred<void>();
    const read = deferred<{ plugin: AppServerPluginDetail }>();
    mocks.write.mockReturnValue(write.promise);
    mocks.read.mockReturnValue(read.promise);
    await render();
    const card = container.querySelector<HTMLButtonElement>(
      '[data-testid="plugin-skill-card"]',
    )!;
    await act(async () => {
      card.focus();
      card.click();
    });
    expect(switches()).toHaveLength(2);
    await click(switches()[1]);
    expect(
      switches().every(
        (item) =>
          item.disabled && item.getAttribute("aria-checked") === "false",
      ),
    ).toBe(true);
    await click(switches()[0]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith({
      path: installedSkillPath,
      enabled: true,
    });
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => write.resolve());
    expect(mocks.read).toHaveBeenCalledWith({
      remoteMarketplaceName: "workspace-directory",
      pluginName: "opaque~1",
    });
    expect(switches().every((item) => item.disabled)).toBe(true);
    await act(async () => read.resolve({ plugin: installed(true) }));
    expect(
      switches().every(
        (item) =>
          !item.disabled && item.getAttribute("aria-checked") === "true",
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("Cached skill body");
    expect(mocks.contents).toHaveBeenCalledTimes(1);
    await click(
      document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!,
    );
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(card));
    });
    expect(card.querySelector("button")).toBeNull();
  });

  it("保存失败保留原偏好，不伪造成功或读取新状态", async () => {
    mocks.write.mockRejectedValue(new Error("HTTP 500"));
    await render();
    await click(switches()[0]);
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(switches()[0].disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "无法保存技能设置",
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("保存成功后的刷新失败可重试读取，不重复提交，拒绝其他插件响应", async () => {
    const other = installed(true);
    other.summary.remotePluginId = "other";
    mocks.read
      .mockResolvedValueOnce({ plugin: other })
      .mockResolvedValueOnce({ plugin: installed(true) });
    await render();
    await click(switches()[0]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "设置已保存，但无法刷新",
    );
    expect(switches()[0].disabled).toBe(true);
    await click(
      [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "重试",
      )!,
    );
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("未安装仍可预览但不显示开关，管理员停用禁止修改", async () => {
    const detail = installed(true);
    detail.summary.installed = false;
    await render(detail);
    expect(switches()).toHaveLength(0);
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="plugin-skill-card"]',
      )!,
    );
    expect(document.body.textContent).toContain("Cached skill body");
    expect(switches()).toHaveLength(0);
    const blocked = installed(true);
    blocked.summary.availability = "DISABLED_BY_ADMIN";
    await render(blocked);
    expect(switches()[0].disabled).toBe(true);
    expect(switches()[0].title).toContain("管理员");
    await click(switches()[0]);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["app", "materialized-template"])(
    "%s缺少真实授权事实不能启用；已启用技能仍可关闭",
    async (kind) => {
      const detail = installed(true);
      if (kind === "app") detail.apps = [{ id: "app-one", name: "One" }];
      else
        detail.appTemplates = [
          {
            templateId: "template",
            name: "Template",
            materializedAppIds: ["app-one"],
          },
        ];
      const fresh = structuredClone(detail);
      fresh.skills[0].enabled = false;
      mocks.read.mockResolvedValue({ plugin: fresh });
      await render(detail);
      expect(switches()[0].disabled).toBe(false);
      await click(switches()[0]);
      expect(mocks.write).toHaveBeenCalledWith({
        path: installedSkillPath,
        enabled: false,
      });
      expect(switches()[0].disabled).toBe(true);
      expect(switches()[0].title).toContain("连接所需应用");
      await click(switches()[0]);
      expect(mocks.write).toHaveBeenCalledTimes(1);
    },
  );

  it("未materialize的模板不伪造应用连接需求", async () => {
    const detail = installed();
    detail.appTemplates = [
      { templateId: "template", name: "Template", materializedAppIds: [] },
    ];
    mocks.read.mockResolvedValue({ plugin: installed(true) });
    await render(detail);
    expect(switches()[0].disabled).toBe(false);
    await click(switches()[0]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("A→B→A丢弃迟到保存结果，关闭预览且不污染新代际", async () => {
    const write = deferred<void>();
    mocks.write.mockReturnValue(write.promise);
    const detail = installed();
    await render(detail);
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="plugin-skill-card"]',
      )!,
    );
    await click(switches()[1]);
    await act(async () => {
      await seed("two");
      await seed("one");
    });
    expect(
      document.querySelector('[data-testid="plugin-skill-preview"]'),
    ).toBeNull();
    await act(async () => write.resolve());
    expect(mocks.read).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(switches()[0].disabled).toBe(false);
  });

  it("切换详情后不接受上一详情的迟到fresh read", async () => {
    const read = deferred<{ plugin: AppServerPluginDetail }>();
    mocks.read.mockReturnValue(read.promise);
    await render();
    await click(switches()[0]);
    const replacement = installed(false);
    replacement.summary.remotePluginId = "replacement";
    replacement.summary.id = "replacement@workspace-directory";
    await render(replacement);
    await act(async () => read.resolve({ plugin: installed(true) }));
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(switches()[0].disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("刷新网络失败和重复重试不会重复提交已保存偏好", async () => {
    const read = deferred<{ plugin: AppServerPluginDetail }>();
    mocks.read
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockReturnValueOnce(read.promise);
    await render();
    await click(switches()[0]);
    const retry = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "重试",
    )!;
    await click(retry);
    await click(retry);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve({ plugin: installed(true) }));
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
  });

  it.each([
    ["zh-CN", "使用 Researcher", "无法保存技能设置"],
    ["zh-TW", "使用 Researcher", "無法儲存技能設定"],
    ["en-US", "Use Researcher", "Could not save skill settings"],
    ["ja-JP", "Researcherを使用", "スキル設定を保存できませんでした"],
    ["ko-KR", "Researcher 사용", "스킬 설정을 저장하지 못했습니다"],
  ] as const)("%s提供可访问名称和失败反馈", async (locale, label, message) => {
    await changeLimeLocale(locale);
    mocks.write.mockRejectedValue(new Error("HTTP 403"));
    await render();
    expect(switches()[0].getAttribute("aria-label")).toBe(label);
    await click(switches()[0]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      message,
    );
  });
});
