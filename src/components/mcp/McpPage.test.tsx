import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n/config";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { McpServer } from "@/lib/api/mcp";
import { McpPage } from "./McpPage";

const useMcpServersMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useMcpServers", () => ({
  useMcpServers: useMcpServersMock,
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

interface McpServersHookValue {
  servers: McpServer[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  addServer: ReturnType<typeof vi.fn>;
  updateServer: ReturnType<typeof vi.fn>;
  deleteServer: ReturnType<typeof vi.fn>;
  toggleServer: ReturnType<typeof vi.fn>;
  importFromApp: ReturnType<typeof vi.fn>;
  importFromAllApps: ReturnType<typeof vi.fn>;
  syncAllToLive: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
}

const mountedRoots: RenderResult[] = [];

function createServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "server-docs",
    name: "docs",
    description: "Docs server",
    server_config: {
      command: "node",
      args: ["server.js"],
    },
    enabled_lime: true,
    enabled_claude: false,
    enabled_codex: true,
    enabled_gemini: false,
    created_at: 1,
    ...overrides,
  };
}

function createHookValue(
  overrides: Partial<McpServersHookValue> = {},
): McpServersHookValue {
  const value: McpServersHookValue = {
    servers: [createServer()],
    loading: false,
    importing: false,
    error: null,
    addServer: vi.fn(async () => undefined),
    updateServer: vi.fn(async () => undefined),
    deleteServer: vi.fn(async () => undefined),
    toggleServer: vi.fn(async () => undefined),
    importFromApp: vi.fn(async () => 0),
    importFromAllApps: vi.fn(async () => 0),
    syncAllToLive: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  };
  useMcpServersMock.mockReturnValue(value);
  return value;
}

async function renderPage(
  props: Partial<React.ComponentProps<typeof McpPage>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<McpPage {...props} />);
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

function findButtonByTitle(
  container: HTMLElement,
  title: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[title="${title}"]`,
  );
  if (!button) {
    throw new Error(`未找到按钮标题：${title}`);
  }
  return button;
}

function findByTestId<T extends HTMLElement>(
  container: HTMLElement,
  testId: string,
): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`未找到测试节点：${testId}`);
  }
  return element;
}

function findServerItem(container: HTMLElement, name: string): HTMLElement {
  const item = Array.from(
    container.querySelectorAll<HTMLElement>(".cursor-pointer"),
  ).find((candidate) => candidate.textContent?.includes(name));
  if (!item) {
    throw new Error(`未找到服务器：${name}`);
  }
  return item;
}

function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  return changeLimeLocale("zh-CN").then(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    createHookValue();
  });
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
  vi.restoreAllMocks();
});

describe("McpPage", () => {
  it("选择服务器后应从配置页表单保存到 App Server current 网关状态", async () => {
    const hookValue = createHookValue();
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findServerItem(container, "docs").click();
      await Promise.resolve();
    });

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="服务器名称"]',
    );
    const configTextarea =
      container.querySelector<HTMLTextAreaElement>("textarea");
    expect(nameInput?.value).toBe("docs");
    expect(configTextarea?.value).toContain('"command": "node"');

    await act(async () => {
      setFieldValue(nameInput!, " docs-updated ");
      setFieldValue(
        configTextarea!,
        JSON.stringify({ command: "node", args: ["updated.js"] }, null, 2),
      );
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(hookValue.updateServer).toHaveBeenCalledWith({
      ...createServer(),
      name: "docs-updated",
      description: "Docs server",
      server_config: {
        command: "node",
        args: ["updated.js"],
      },
      enabled_lime: true,
      enabled_claude: false,
      enabled_codex: true,
      enabled_gemini: false,
    });
  });

  it("JSON 配置无效时应阻止保存，避免提交坏配置", async () => {
    const hookValue = createHookValue();
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findServerItem(container, "docs").click();
      await Promise.resolve();
    });
    await act(async () => {
      setFieldValue(
        container.querySelector<HTMLTextAreaElement>("textarea")!,
        "{",
      );
      await Promise.resolve();
    });

    const saveButton = findButton(container, "保存");
    expect(container.textContent).toContain("JSON 格式错误");
    expect(saveButton.disabled).toBe(true);
    expect(hookValue.updateServer).not.toHaveBeenCalled();
  });

  it("新建预设应保持当前配置页创建链路", async () => {
    const hookValue = createHookValue({ servers: [] });
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findButtonByTitle(container, "新建").click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "GitHub").click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLInputElement>(
        'input[placeholder="服务器名称"]',
      )?.value,
    ).toBe("GitHub");
    expect(container.querySelector("textarea")?.value).toContain(
      "@modelcontextprotocol/server-github",
    );

    await act(async () => {
      findButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(hookValue.addServer).toHaveBeenCalledWith({
      name: "GitHub",
      description: "GitHub API",
      server_config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "" },
      },
      enabled_lime: true,
      enabled_claude: true,
      enabled_codex: true,
      enabled_gemini: true,
    });
  });

  it("Context7 预设应生成可启动的 streamable HTTP MCP 配置", async () => {
    const hookValue = createHookValue({ servers: [] });
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findByTestId<HTMLButtonElement>(
        container,
        "mcp-config-create-server",
      ).click();
      await Promise.resolve();
    });
    await act(async () => {
      findByTestId<HTMLButtonElement>(
        container,
        "mcp-config-preset-context7",
      ).click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLInputElement>(
        'input[placeholder="服务器名称"]',
      )?.value,
    ).toBe("Context7");
    expect(container.querySelector("textarea")?.value).toContain(
      "https://mcp.context7.com/mcp",
    );
    expect(container.querySelector("textarea")?.value).toContain(
      "CONTEXT7_API_KEY",
    );
    expect(container.textContent).toContain("连接配置");
    expect(container.textContent).toContain("streamable_http");
    expect(container.textContent).toContain("HTTP header 环境变量");
    expect(container.textContent).toContain(
      "CONTEXT7_API_KEY ← CONTEXT7_API_KEY",
    );

    await act(async () => {
      findButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(hookValue.addServer).toHaveBeenCalledWith({
      name: "Context7",
      description: "最新文档检索",
      server_config: {
        transport: "streamable_http",
        url: "https://mcp.context7.com/mcp",
        env_http_headers: {
          CONTEXT7_API_KEY: "CONTEXT7_API_KEY",
        },
        tool_timeout: 60,
      },
      enabled_lime: true,
      enabled_claude: true,
      enabled_codex: true,
      enabled_gemini: true,
    });
  });

  it("You.com 预设应生成免鉴权的 streamable HTTP MCP 配置", async () => {
    const hookValue = createHookValue({ servers: [] });
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findByTestId<HTMLButtonElement>(
        container,
        "mcp-config-create-server",
      ).click();
      await Promise.resolve();
    });
    await act(async () => {
      findByTestId<HTMLButtonElement>(
        container,
        "mcp-config-preset-youcom",
      ).click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLInputElement>(
        'input[placeholder="服务器名称"]',
      )?.value,
    ).toBe("You.com");
    expect(container.querySelector("textarea")?.value).toContain(
      "https://api.you.com/mcp?profile=free",
    );
    expect(container.textContent).toContain("连接配置");
    expect(container.textContent).toContain("streamable_http");

    await act(async () => {
      findButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(hookValue.addServer).toHaveBeenCalledWith({
      name: "You.com",
      description: "网页搜索与内容提取",
      server_config: {
        transport: "streamable_http",
        url: "https://api.you.com/mcp?profile=free",
        tool_timeout: 60,
      },
      enabled_lime: true,
      enabled_claude: true,
      enabled_codex: true,
      enabled_gemini: true,
    });
  });

  it("Context7 连接配置表单应直接写回 streamable HTTP JSON", async () => {
    const hookValue = createHookValue({ servers: [] });
    const container = await renderPage({ hideHeader: true });

    await act(async () => {
      findButtonByTitle(container, "新建").click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton(container, "Context7").click();
      await Promise.resolve();
    });

    const urlInput = findByTestId<HTMLInputElement>(
      container,
      "mcp-config-connection-url",
    );
    const envVarInput = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        '[data-testid="mcp-config-env-header-env-var"]',
      ),
    ).find((input) => input.value === "CONTEXT7_API_KEY");
    expect(findByTestId(container, "mcp-config-json")).toBeTruthy();
    expect(findByTestId(container, "mcp-config-save")).toBeTruthy();

    await act(async () => {
      setFieldValue(urlInput!, "https://mcp.context7.com/v1/mcp");
      setFieldValue(envVarInput!, "CONTEXT7_API_KEY_LIVE");
      await Promise.resolve();
    });

    expect(container.querySelector("textarea")?.value).toContain(
      "https://mcp.context7.com/v1/mcp",
    );
    expect(container.querySelector("textarea")?.value).toContain(
      "CONTEXT7_API_KEY_LIVE",
    );
    expect(container.textContent).toContain(
      "CONTEXT7_API_KEY ← CONTEXT7_API_KEY_LIVE",
    );

    await act(async () => {
      findButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(hookValue.addServer).toHaveBeenCalledWith({
      name: "Context7",
      description: "最新文档检索",
      server_config: {
        transport: "streamable_http",
        url: "https://mcp.context7.com/v1/mcp",
        env_http_headers: {
          CONTEXT7_API_KEY: "CONTEXT7_API_KEY_LIVE",
        },
        tool_timeout: 60,
      },
      enabled_lime: true,
      enabled_claude: true,
      enabled_codex: true,
      enabled_gemini: true,
    });
  });
});
