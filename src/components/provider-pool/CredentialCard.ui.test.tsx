import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialCard } from "./CredentialCard";
import type { CredentialDisplay } from "@/lib/api/providerPool";

vi.mock("@/lib/api/providerPool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/providerPool")>(
    "@/lib/api/providerPool",
  );
  return {
    ...actual,
    getKiroCredentialFingerprint: vi.fn(),
    switchKiroToLocal: vi.fn(),
    kiroCredentialApi: {},
  };
});

vi.mock("@/lib/api/usage", () => ({
  usageApi: {},
}));

vi.mock("./UsageDisplay", () => ({
  UsageDisplay: () => <div data-testid="usage-display">usage</div>,
}));

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function createCredential(
  overrides: Partial<CredentialDisplay> = {},
): CredentialDisplay {
  return {
    uuid: "credential-1",
    provider_type: "openai",
    credential_type: "openai_key",
    name: "主账号",
    display_credential: "sk-***",
    is_healthy: false,
    is_disabled: true,
    check_health: true,
    not_supported_models: [],
    usage_count: 12,
    error_count: 1,
    created_at: "2026-04-18T10:00:00.000Z",
    updated_at: "2026-04-18T10:00:00.000Z",
    source: "manual",
    ...overrides,
  };
}

function renderCard(credential = createCredential()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <CredentialCard
        credential={credential}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onReset={vi.fn()}
        onCheckHealth={vi.fn()}
        onEdit={vi.fn()}
        deleting={false}
        checkingHealth={false}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
});

describe("CredentialCard UI", () => {
  it("禁用态卡片应保持浅色主题，不再包含深色背景 fallback", () => {
    const container = renderCard();
    const card = container.querySelector(".rounded-xl.border-2");
    const buttons = container.querySelectorAll("button");

    expect(card).toBeTruthy();
    expect(card?.className).toContain("bg-slate-50/80");
    expect(card?.className).not.toContain("dark:bg-slate-900/60");
    expect(buttons[0]?.className).toContain("bg-emerald-100");
    expect(buttons[0]?.className).not.toContain("dark:bg-emerald-900/30");
  });
});
