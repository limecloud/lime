import { describe, expect, it } from "vitest";
import { resolveKnowledgeHubState } from "./knowledgeHubState";

describe("resolveKnowledgeHubState", () => {
  it("无资料时应引导添加项目资料", () => {
    const state = resolveKnowledgeHubState({
      knowledgePackSelection: null,
      knowledgePackOptions: [],
      hasInputText: false,
      canManageKnowledgePacks: true,
      canStartKnowledgeOrganize: true,
    });

    expect(state.title).toBe("添加项目资料");
    expect(state.primaryAction).toBe("organize");
    expect(state.primaryLabel).toBe("开始添加资料");
  });

  it("无资料但输入框已有内容时应引导沉淀当前输入", () => {
    const state = resolveKnowledgeHubState({
      knowledgePackSelection: null,
      knowledgePackOptions: [],
      hasInputText: true,
      canManageKnowledgePacks: true,
      canStartKnowledgeOrganize: true,
    });

    expect(state.primaryAction).toBe("organize");
    expect(state.primaryLabel).toBe("整理当前输入为资料");
  });

  it("有待确认资料且无可用选择时应先确认资料", () => {
    const state = resolveKnowledgeHubState({
      knowledgePackSelection: null,
      knowledgePackOptions: [
        {
          packName: "draft-pack",
          label: "待确认资料",
          status: "needs-review",
        },
      ],
      hasInputText: false,
      canManageKnowledgePacks: true,
      canStartKnowledgeOrganize: true,
    });

    expect(state.title).toBe("有资料待确认");
    expect(state.primaryAction).toBe("manage");
    expect(state.primaryLabel).toBe("去确认资料");
    expect(state.pendingCount).toBe(1);
  });

  it("有可用资料但未启用时应引导使用资料", () => {
    const state = resolveKnowledgeHubState({
      knowledgePackSelection: {
        enabled: false,
        packName: "brand-pack",
        workingDir: "/workspace",
        label: "品牌资料",
        status: "ready",
      },
      knowledgePackOptions: [
        {
          packName: "brand-pack",
          label: "品牌资料",
          status: "ready",
        },
      ],
      hasInputText: false,
      canManageKnowledgePacks: true,
      canStartKnowledgeOrganize: true,
    });

    expect(state.title).toBe("可使用：品牌资料");
    expect(state.primaryAction).toBe("use");
    expect(state.primaryLabel).toBe("使用这份资料");
  });

  it("已启用资料时应引导补充资料", () => {
    const state = resolveKnowledgeHubState({
      knowledgePackSelection: {
        enabled: true,
        packName: "brand-pack",
        workingDir: "/workspace",
        label: "品牌资料",
        status: "ready",
      },
      knowledgePackOptions: [
        {
          packName: "brand-pack",
          label: "品牌资料",
          status: "ready",
        },
      ],
      hasInputText: true,
      canManageKnowledgePacks: true,
      canStartKnowledgeOrganize: true,
    });

    expect(state.title).toBe("正在使用：品牌资料");
    expect(state.primaryAction).toBe("supplement");
    expect(state.primaryLabel).toBe("把当前输入补充为资料");
  });
});
