import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgePackStatus, KnowledgePackSummary } from "@/lib/api/knowledge";
import type { AgentInitialKnowledgePackSelectionParams } from "@/types/page";
import { useWorkspaceKnowledgeRuntime } from "./useWorkspaceKnowledgeRuntime";

type WorkspaceKnowledgeRuntime = ReturnType<typeof useWorkspaceKnowledgeRuntime>;

const knowledgeApiMocks = vi.hoisted(() => ({
  listKnowledgePacks: vi.fn(),
}));

vi.mock("@/lib/api/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/knowledge")>();
  return {
    ...actual,
    listKnowledgePacks: knowledgeApiMocks.listKnowledgePacks,
  };
});

function buildPack(params: {
  name: string;
  type: string;
  status?: KnowledgePackStatus;
  defaultForWorkspace?: boolean;
}): KnowledgePackSummary {
  return {
    metadata: {
      name: params.name,
      description: params.name,
      type: params.type,
      status: params.status ?? "ready",
      maintainers: [],
    },
    rootPath: "/tmp/lime-project",
    knowledgePath: `/tmp/lime-project/.lime/knowledge/packs/${params.name}`,
    defaultForWorkspace: params.defaultForWorkspace ?? false,
    updatedAt: 1,
    sourceCount: 1,
    wikiCount: 0,
    compiledCount: 1,
    runCount: 0,
    preview: null,
  };
}

interface ProbeProps {
  initialKnowledgePackSelection: AgentInitialKnowledgePackSelectionParams;
  onRuntimeChange: (runtime: WorkspaceKnowledgeRuntime) => void;
}

function Probe({ initialKnowledgePackSelection, onRuntimeChange }: ProbeProps) {
  const runtime = useWorkspaceKnowledgeRuntime({
    projectRootPath: "/tmp/lime-project",
    currentSessionTitle: "营销文案",
    input: "",
    setInput: vi.fn(),
    handleSend: vi.fn(),
    initialKnowledgePackSelection,
  });

  useEffect(() => {
    onRuntimeChange(runtime);
  }, [onRuntimeChange, runtime]);

  return null;
}

async function flushEffects(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("useWorkspaceKnowledgeRuntime initial Knowledge selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    knowledgeApiMocks.listKnowledgePacks.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("从 Knowledge chooser 回流 Agent 时不应在资料列表加载前丢失显式 data 协同资料", async () => {
    knowledgeApiMocks.listKnowledgePacks.mockResolvedValue({
      packs: [
        buildPack({ name: "xiejing-persona", type: "personal-ip", defaultForWorkspace: true }),
        buildPack({ name: "content-calendar", type: "content-operations" }),
        buildPack({ name: "private-domain", type: "private-domain-operations" }),
      ],
    });

    const latestRuntimeRef: { current: WorkspaceKnowledgeRuntime | null } = {
      current: null,
    };
    act(() => {
      root.render(
        <Probe
          initialKnowledgePackSelection={{
            enabled: true,
            packName: "content-calendar",
            workingDir: "/tmp/lime-project",
            label: "内容运营资料",
            status: "ready",
            companionPacks: [
              { name: "xiejing-persona", activation: "explicit" },
              { name: "private-domain", activation: "explicit" },
            ],
          }}
          onRuntimeChange={(runtime) => {
            latestRuntimeRef.current = runtime;
          }}
        />,
      );
    });

    await flushEffects();

    expect(latestRuntimeRef.current?.knowledgePackSelection).toMatchObject({
      enabled: true,
      packName: "content-calendar",
      companionPacks: [
        { name: "xiejing-persona", activation: "implicit" },
        { name: "private-domain", activation: "explicit" },
      ],
    });
  });
});
