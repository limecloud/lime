import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseMcpReturn } from "@/hooks/useMcp";
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpServerInfo,
  McpToolDefinition,
} from "@/lib/api/mcp";
import { McpPanel } from "./McpPanel";

const useMcpMock = vi.hoisted(() => vi.fn<() => UseMcpReturn>());

vi.mock("@/hooks/useMcp", () => ({
  useMcp: useMcpMock,
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createServer(overrides: Partial<McpServerInfo> = {}): McpServerInfo {
  return {
    id: "server-demo",
    name: "demo",
    description: "Demo MCP server",
    config: { command: "npx", args: ["demo"] },
    is_running: true,
    server_info: {
      name: "demo",
      version: "1.0.0",
      supports_tools: true,
      supports_prompts: true,
      supports_resources: true,
    },
    enabled_lime: true,
    enabled_claude: true,
    enabled_codex: true,
    enabled_gemini: false,
    ...overrides,
  };
}

function createTool(
  overrides: Partial<McpToolDefinition> = {},
): McpToolDefinition {
  return {
    name: "mcp__demo__search_docs",
    description: "搜索文档",
    input_schema: { type: "object" },
    server_name: "demo",
    ...overrides,
  };
}

function createMcpState(overrides: Partial<UseMcpReturn> = {}): UseMcpReturn {
  return {
    servers: [createServer()],
    tools: [createTool()],
    prompts: [
      {
        name: "write_summary",
        description: "生成摘要",
        arguments: [],
        server_name: "demo",
      } satisfies McpPromptDefinition,
    ],
    resources: [
      {
        uri: "file://demo/readme.md",
        name: "README",
        description: "项目说明",
        server_name: "demo",
      } satisfies McpResourceDefinition,
    ],
    loading: false,
    error: null,
    serverConnectionStates: {},
    startServer: vi.fn(async () => undefined),
    stopServer: vi.fn(async () => undefined),
    reconnectServer: vi.fn(async () => undefined),
    refreshServers: vi.fn(async () => undefined),
    refreshTools: vi.fn(async () => undefined),
    callTool: vi.fn(async () => ({ content: [], is_error: false })),
    refreshPrompts: vi.fn(async () => undefined),
    getPrompt: vi.fn(async () => ({ messages: [] })),
    refreshResources: vi.fn(async () => undefined),
    readResource: vi.fn(async () => ({ uri: "file://demo/readme.md" })),
    ...overrides,
  };
}

async function renderPanel(
  props: Partial<React.ComponentProps<typeof McpPanel>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<McpPanel {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  mountedRoots.push({ container, root });
  return container;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  useMcpMock.mockReturnValue(createMcpState());
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("McpPanel", () => {
  it("设置页内嵌时仍渲染统一页头和摘要指标", async () => {
    const container = await renderPanel({ hideHeader: true });

    expect(container.textContent).toContain("MCP 服务器");
    expect(container.textContent).toContain("Model Context Protocol");
    expect(container.textContent).toContain("1 个运行中");
    expect(container.textContent).toContain("工具 / 提示词 / 资源");
    expect(container.textContent).toContain("已同步");
  });

  it("运行状态空态应引导到配置管理，而不是只显示旧式空白列表", async () => {
    useMcpMock.mockReturnValue(
      createMcpState({
        servers: [],
        tools: [],
        prompts: [],
        resources: [],
      }),
    );

    const container = await renderPanel({ hideHeader: true });

    expect(container.textContent).toContain("还没有 MCP 服务器");
    expect(container.textContent).toContain(
      "去“配置管理”添加或导入服务器后，这里会显示运行状态。",
    );
  });

  it("工具页继续复用统一容器，并能引导回运行状态", async () => {
    useMcpMock.mockReturnValue(
      createMcpState({
        servers: [createServer({ is_running: false, server_info: undefined })],
        tools: [],
        prompts: [],
        resources: [],
      }),
    );
    const container = await renderPanel({ hideHeader: true });

    await act(async () => {
      findButton(container, "工具").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "已配置服务器，但当前没有运行中的 MCP 服务器",
    );

    await act(async () => {
      findButton(container, "去启动服务器").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("服务器状态");
  });
});
