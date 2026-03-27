import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearServiceSkillCatalogCache,
  getSeededServiceSkillCatalog,
  saveServiceSkillCatalog,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import { recordServiceSkillAutomationLink } from "./automationLinkStorage";
import { recordServiceSkillCloudRun } from "./cloudRunStorage";
import { useServiceSkills } from "./useServiceSkills";

interface HookHarness {
  getValue: () => ReturnType<typeof useServiceSkills>;
  unmount: () => void;
}

function buildRemoteCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-24",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-24T12:00:00.000Z",
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-daily-briefing",
        title: "租户日报摘要",
        summary: "远端同步后的目录项",
        version: "tenant-2026-03-24",
      },
      {
        ...seeded.items[1]!,
        id: "local-playbook-template",
        title: "本地增长打法模版",
        summary: "项目内维护的本地补充技能。",
        source: "local_custom",
        version: "local-2026-03-24",
      },
    ],
  };
}

function buildCloudCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-27",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-27T12:00:00.000Z",
    items: [
      {
        ...seeded.items[1]!,
        id: "cloud-video-dubbing",
        title: "云端视频配音",
        summary: "把参考视频与文案提交到 OEM 云端执行，并把结果回流到本地工作区。",
        executionLocation: "cloud_required",
        defaultExecutorBinding: "cloud_scene",
        themeTarget: "video",
        version: "tenant-2026-03-27",
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

  it("目录更新事件后应刷新服务型技能列表", async () => {
    const harness = mountHook();

    try {
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
      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "github-repo-radar"),
      ).toEqual(
        expect.objectContaining({
          runnerLabel: "浏览器站点执行",
          actionLabel: "启动采集",
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
      expect(
        harness
          .getValue()
          .skills.find((skill) => skill.id === "carousel-post-replication")
          ?.automationStatus?.detail,
      ).toContain("下次");

      act(() => {
        saveServiceSkillCatalog(buildRemoteCatalog(), "bootstrap_sync");
      });

      await flushEffects();

      expect(harness.getValue().skills).toHaveLength(2);
      expect(harness.getValue().skills[0]?.id).toBe("tenant-daily-briefing");
      expect(harness.getValue().skills[1]?.id).toBe("local-playbook-template");
      expect(harness.getValue().skills[0]?.badge).toBe("云目录");
      expect(harness.getValue().skills[1]?.badge).toBe("本地技能");
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "tenant-demo",
          version: "tenant-2026-03-24",
          sourceLabel: "租户云目录",
          isSeeded: false,
        }),
      );

      act(() => {
        clearServiceSkillCatalogCache();
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

  it("有 OEM 会话时应先显示本地目录再后台刷新远端目录", async () => {
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
        "https://oem.example.com/api/v1/public/tenants/tenant-demo/client/service-skills",
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

      expect(harness.getValue().skills).toHaveLength(2);
      expect(harness.getValue().skills[0]?.id).toBe("tenant-daily-briefing");
      expect(harness.getValue().skills[1]?.id).toBe("local-playbook-template");
      expect(harness.getValue().catalogMeta).toEqual(
        expect.objectContaining({
          tenantId: "tenant-demo",
          version: "tenant-2026-03-24",
          sourceLabel: "租户云目录",
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
        saveServiceSkillCatalog(buildCloudCatalog(), "manual_override");
      });

      await flushEffects();

      act(() => {
        recordServiceSkillCloudRun("cloud-video-dubbing", {
          id: "cloud-run-1",
          status: "success",
          outputSummary: "云端结果已生成",
          finishedAt: "2026-03-27T12:03:00.000Z",
          updatedAt: "2026-03-27T12:03:00.000Z",
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
