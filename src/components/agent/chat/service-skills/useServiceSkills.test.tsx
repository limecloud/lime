import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  saveSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import { recordServiceSkillAutomationLink } from "./automationLinkStorage";
import { recordServiceSkillCloudRun } from "./cloudRunStorage";
import { useServiceSkills } from "./useServiceSkills";

interface HookHarness {
  getValue: () => ReturnType<typeof useServiceSkills>;
  unmount: () => void;
}

function buildRemoteCatalog(): SkillCatalog {
  const seeded = getSeededSkillCatalog();
  return {
    version: "tenant-2026-03-29",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-29T12:00:00.000Z",
    groups: [
      {
        key: "general",
        title: "通用技能",
        summary: "不依赖站点登录态的业务技能。",
        sort: 90,
        itemCount: 2,
      },
    ],
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-daily-briefing",
        title: "租户日报摘要",
        summary: "远端同步后的目录项",
        version: "tenant-2026-03-29",
        groupKey: "general",
      },
      {
        ...seeded.items[1]!,
        id: "local-playbook-template",
        title: "本地增长打法模版",
        summary: "项目内维护的本地补充技能。",
        source: "local_custom",
        version: "local-2026-03-29",
        groupKey: "general",
      },
    ],
  };
}

function buildCloudCatalog(): SkillCatalog {
  const seeded = getSeededSkillCatalog();
  return {
    version: "tenant-2026-03-30",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-30T12:00:00.000Z",
    groups: [
      {
        key: "general",
        title: "通用技能",
        summary: "不依赖站点登录态的业务技能。",
        sort: 90,
        itemCount: 1,
      },
    ],
    items: [
      {
        ...seeded.items[1]!,
        id: "cloud-video-dubbing",
        title: "云端视频配音",
        summary: "把参考视频与文案提交到 OEM 云端执行，并把结果回流到本地工作区。",
        executionLocation: "cloud_required",
        defaultExecutorBinding: "cloud_scene",
        themeTarget: "video",
        version: "tenant-2026-03-30",
        groupKey: "general",
        execution: {
          kind: "cloud_scene",
        },
      },
    ],
  };
}

function buildLegacySiteCatalog(): SkillCatalog {
  const seeded = getSeededSkillCatalog();
  const baseSkill = seeded.items[0]!;

  return {
    version: "tenant-2026-03-31",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-31T12:00:00.000Z",
    groups: [
      {
        key: "github",
        title: "GitHub",
        summary: "围绕仓库与 Issue 的只读研究技能。",
        sort: 10,
        itemCount: 1,
      },
    ],
    items: [
      {
        ...baseSkill,
        id: "legacy-site-skill",
        title: "旧版站点技能",
        summary: "旧目录里遗留的站点技能包装项。",
        defaultExecutorBinding: "browser_assist",
        siteCapabilityBinding: {
          adapterName: "github/search",
          autoRun: true,
          requireAttachedSession: true,
          saveMode: "current_content",
        },
        execution: {
          kind: "site_adapter",
        },
      },
      {
        ...baseSkill,
        id: "tenant-general-skill",
        title: "租户通用技能",
        summary: "保留在首页中的普通技能。",
        groupKey: "general",
        execution: {
          kind: "agent_turn",
        },
      },
    ],
  };
}

function mountHook(): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useServiceSkills> | null = null;

  function TestComponent() {
    hookValue = useServiceSkills();
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function flushEffects(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("useServiceSkills", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("目录更新事件后应刷新技能列表并保留分组元数据", async () => {
    const harness = mountHook();

    try {
      await flushEffects();

      expect(harness.getValue().skills[0]?.id).toBe(
        "carousel-post-replication",
      );
      expect(harness.getValue().groups.length).toBeGreaterThan(0);
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "local-seeded",
          sourceLabel: "本地 Seeded 目录",
          isSeeded: true,
        }),
      );

      act(() => {
        recordServiceSkillAutomationLink({
          skillId: "carousel-post-replication",
          jobId: "automation-job-daily-brief",
          jobName: "每日线索巡检",
        });
      });

      await flushEffects();

      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "carousel-post-replication")
          ?.automationStatus,
      ).toEqual(
        expect.objectContaining({
          jobId: "automation-job-daily-brief",
          jobName: "每日线索巡检",
          statusLabel: "成功",
        }),
      );

      act(() => {
        saveSkillCatalog(buildRemoteCatalog(), "bootstrap_sync");
      });

      await flushEffects();

      expect(harness.getValue().skills.length).toBeGreaterThanOrEqual(2);
      expect(
        harness.getValue().skills.map((skill) => skill.id),
      ).toEqual(
        expect.arrayContaining([
          "tenant-daily-briefing",
          "local-playbook-template",
        ]),
      );
      expect(harness.getValue().skills[0]?.id).toBe("tenant-daily-briefing");
      expect(harness.getValue().skills[0]?.badge).toBe("云目录");
      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "local-playbook-template")
          ?.badge,
      ).toBe("本地技能");
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "tenant-demo",
          version: "tenant-2026-03-29",
          sourceLabel: "租户技能目录",
          isSeeded: false,
        }),
      );

      act(() => {
        clearSkillCatalogCache();
      });

      await flushEffects();

      expect(harness.getValue().skills[0]?.id).toBe(
        "carousel-post-replication",
      );
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "local-seeded",
          sourceLabel: "本地 Seeded 目录",
          isSeeded: true,
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("旧版站点技能目录项不应再出现在首页列表", async () => {
    saveSkillCatalog(buildLegacySiteCatalog(), "bootstrap_sync");

    const harness = mountHook();

    try {
      await flushEffects();

      expect(harness.getValue().skills).toHaveLength(1);
      expect(harness.getValue().skills[0]).toEqual(
        expect.objectContaining({
          id: "tenant-general-skill",
        }),
      );
      expect(
        harness.getValue().skills.some((skill) => skill.id === "legacy-site-skill"),
      ).toBe(false);
      expect(harness.getValue().groups.map((group) => group.key)).toEqual([
        "general",
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("有 OEM 会话时应先显示本地目录再后台刷新远端技能目录", async () => {
    window.__LIME_OEM_CLOUD__ = {
      baseUrl: "https://oem.example.com",
      tenantId: "tenant-demo",
    };
    window.__LIME_SESSION_TOKEN__ = "session-token-demo";

    const responseDeferred = createDeferred<{
      ok: boolean;
      json: () => Promise<unknown>;
    }>();
    const fetchMock = vi.fn(() => responseDeferred.promise);
    vi.stubGlobal("fetch", fetchMock);

    const harness = mountHook();

    try {
      await flushEffects(4);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://oem.example.com/api/v1/public/tenants/tenant-demo/client/skills",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
            Authorization: "Bearer session-token-demo",
          }),
        }),
      );
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "local-seeded",
          sourceLabel: "本地 Seeded 目录",
          isSeeded: true,
        }),
      );

      responseDeferred.resolve({
        ok: true,
        json: async () => ({
          code: 200,
          message: "success",
          data: buildRemoteCatalog(),
        }),
      });

      await flushEffects(4);

      expect(harness.getValue().skills.length).toBeGreaterThanOrEqual(2);
      expect(harness.getValue().skills[0]?.id).toBe("tenant-daily-briefing");
      expect(
        harness.getValue().skills.map((skill) => skill.id),
      ).toEqual(
        expect.arrayContaining([
          "tenant-daily-briefing",
          "local-playbook-template",
        ]),
      );
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "tenant-demo",
          version: "tenant-2026-03-29",
          sourceLabel: "租户技能目录",
          isSeeded: false,
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("cloud_required 技能状态变更后应回灌到首页技能列表", async () => {
    const harness = mountHook();

    try {
      await flushEffects();

      act(() => {
        saveSkillCatalog(buildCloudCatalog(), "manual_override");
      });

      await flushEffects();

      act(() => {
        recordServiceSkillCloudRun("cloud-video-dubbing", {
          id: "cloud-run-1",
          status: "success",
          outputSummary: "云端结果已生成",
          finishedAt: "2026-03-30T12:03:00.000Z",
          updatedAt: "2026-03-30T12:03:00.000Z",
        });
      });

      await flushEffects();

      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "cloud-video-dubbing")
          ?.cloudStatus,
      ).toEqual(
        expect.objectContaining({
          runId: "cloud-run-1",
          statusLabel: "成功",
          tone: "emerald",
          detail: "云端结果已生成",
        }),
      );
      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "cloud-video-dubbing")
          ?.runnerLabel,
      ).toBe("云端托管执行");
    } finally {
      harness.unmount();
    }
  });
});
