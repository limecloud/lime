import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityDraftsApi } from "@/lib/api/capabilityDrafts";
import { CapabilityDraftPanel } from "./CapabilityDraftPanel";

vi.mock("@/lib/api/capabilityDrafts", () => ({
  capabilityDraftsApi: {
    list: vi.fn(),
    verify: vi.fn(),
    register: vi.fn(),
  },
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderPanel(props?: Parameters<typeof CapabilityDraftPanel>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CapabilityDraftPanel {...props} />);
  });
  mountedRoots.push({ container, root });
  return container;
}

describe("CapabilityDraftPanel", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(capabilityDraftsApi.list).mockReset();
    vi.mocked(capabilityDraftsApi.verify).mockReset();
    vi.mocked(capabilityDraftsApi.register).mockReset();
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

  it("没有项目根目录时只显示选择项目提示，不读取草案", () => {
    const container = renderPanel();

    expect(container.textContent).toContain("能力草案");
    expect(container.textContent).toContain("选择或进入一个项目");
    expect(capabilityDraftsApi.list).not.toHaveBeenCalled();
  });

  it("应展示未验证草案，并明确没有运行或注册入口", async () => {
    vi.mocked(capabilityDraftsApi.list).mockResolvedValueOnce([
      {
        draftId: "capdraft-1",
        name: "竞品监控草案",
        description: "每天汇总竞品价格和上新变化。",
        userGoal: "持续监控竞品爆款并产出待复核清单。",
        sourceKind: "manual",
        sourceRefs: ["docs/research/skill-forge"],
        permissionSummary: ["Level 0 只读发现"],
        generatedFiles: [
          { relativePath: "SKILL.md", byteLength: 32, sha256: "abc" },
          { relativePath: "scripts/check.ts", byteLength: 64, sha256: "def" },
        ],
        verificationStatus: "unverified",
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-1",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-1/manifest.json",
      },
    ]);

    const container = renderPanel({ workspaceRoot: "/tmp/work" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.list).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
    });
    expect(container.textContent).toContain("竞品监控草案");
    expect(container.textContent).toContain("未验证");
    expect(container.textContent).toContain("还没有运行 verification gate");
    expect(container.textContent).toContain("Level 0 只读发现");
    expect(container.textContent).toContain("SKILL.md / scripts/check.ts");
    expect(container.textContent).toContain("当前没有运行、注册或自动化入口");
    expect(container.textContent).toContain("运行验证");
    expect(container.textContent).not.toContain("立即运行");
    const forbiddenActionButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("注册成方法"));
    expect(forbiddenActionButton).toBeUndefined();
  });

  it("运行验证后应刷新草案状态，并只展示注册入口", async () => {
    vi.mocked(capabilityDraftsApi.list).mockResolvedValueOnce([
      {
        draftId: "capdraft-verify",
        name: "只读 CLI 报告草案",
        description: "整理 CLI 输出。",
        userGoal: "生成 Markdown 趋势摘要。",
        sourceKind: "cli",
        sourceRefs: ["trendctl --help"],
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        generatedFiles: [
          { relativePath: "SKILL.md", byteLength: 128, sha256: "a" },
          {
            relativePath: "contract/input.schema.json",
            byteLength: 32,
            sha256: "b",
          },
          {
            relativePath: "contract/output.schema.json",
            byteLength: 32,
            sha256: "c",
          },
          {
            relativePath: "examples/input.sample.json",
            byteLength: 16,
            sha256: "d",
          },
        ],
        verificationStatus: "unverified",
        lastVerification: null,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-verify",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-verify/manifest.json",
      },
    ]);
    vi.mocked(capabilityDraftsApi.verify).mockResolvedValueOnce({
      draft: {
        draftId: "capdraft-verify",
        name: "只读 CLI 报告草案",
        description: "整理 CLI 输出。",
        userGoal: "生成 Markdown 趋势摘要。",
        sourceKind: "cli",
        sourceRefs: ["trendctl --help"],
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        generatedFiles: [],
        verificationStatus: "verified_pending_registration",
        lastVerification: {
          reportId: "capver-1",
          status: "passed",
          summary: "最小 verification gate 通过，等待后续注册阶段。",
          checkedAt: "2026-05-05T01:00:00.000Z",
          failedCheckCount: 0,
        },
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-verify",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-verify/manifest.json",
      },
      report: {
        draftId: "capdraft-verify",
        reportId: "capver-1",
        status: "passed",
        summary: "最小 verification gate 通过，等待后续注册阶段。",
        checkedAt: "2026-05-05T01:00:00.000Z",
        failedCheckCount: 0,
        checks: [
          {
            id: "readonly_http_fixture_dry_run_execute",
            label: "只读 HTTP fixture dry-run 执行",
            status: "passed",
            message: "通过",
            suggestions: [],
            canAgentRepair: false,
            evidence: [
              { key: "scriptPath", value: "scripts/dry-run.mjs" },
              {
                key: "expectedOutputPath",
                value: "tests/expected-output.json",
              },
              { key: "durationMs", value: "42" },
              {
                key: "actualSha256",
                value: "abc123def4567890abc123def4567890",
              },
              {
                key: "expectedSha256",
                value: "abc123def4567890abc123def4567890",
              },
              {
                key: "stdoutPreview",
                value: "{\"markdown_report\":\"# 趋势摘要\"}",
              },
            ],
          },
          {
            id: "readonly_http_execution_preflight",
            label: "只读 HTTP 执行 preflight",
            status: "passed",
            message: "已找到 execution_preflight。",
            suggestions: [],
            canAgentRepair: false,
            evidence: [
              { key: "preflightMode", value: "approval_request" },
              { key: "endpointSource", value: "runtime_input" },
              { key: "method", value: "GET" },
              {
                key: "credentialReferenceId",
                value: "readonly_api_session",
              },
              {
                key: "evidenceSchema",
                value:
                  "request_url_hash,request_method,response_status,response_sha256,executed_at",
              },
              {
                key: "policyPath",
                value: "policy/readonly-http-session.json",
              },
            ],
          },
        ],
      },
    });

    const container = renderPanel({ workspaceRoot: "/tmp/work" });

    await act(async () => {
      await Promise.resolve();
    });

    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("运行验证"),
    );
    expect(verifyButton).toBeTruthy();

    await act(async () => {
      verifyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.verify).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
      draftId: "capdraft-verify",
    });
    expect(container.textContent).toContain("验证通过，待注册");
    expect(container.textContent).toContain("所有检查均已通过");
    expect(container.textContent).toContain("验证证据");
    expect(container.textContent).toContain("只读 HTTP fixture dry-run 执行");
    expect(container.textContent).toContain("脚本");
    expect(container.textContent).toContain("scripts/dry-run.mjs");
    expect(container.textContent).toContain("期望输出");
    expect(container.textContent).toContain("tests/expected-output.json");
    expect(container.textContent).toContain("耗时");
    expect(container.textContent).toContain("42ms");
    expect(container.textContent).toContain("实际 Hash");
    expect(container.textContent).toContain("abc123def4567890...");
    expect(container.textContent).toContain("只读 HTTP 执行 preflight");
    expect(container.textContent).toContain("凭证引用");
    expect(container.textContent).toContain("readonly_api_session");
    expect(container.textContent).toContain("方法");
    expect(container.textContent).toContain("GET");
    expect(container.textContent).toContain("证据 Schema");
    expect(container.textContent).toContain("注册只会复制为 Workspace 本地 Skill");
    const registerButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("注册到 Workspace"));
    expect(registerButton).toBeTruthy();
    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("立即运行"),
    );
    expect(runButton).toBeUndefined();
  });

  it("注册后应展示注册目录，但仍不展示运行或自动化入口", async () => {
    vi.mocked(capabilityDraftsApi.list).mockResolvedValueOnce([
      {
        draftId: "capdraft-register",
        name: "只读 CLI 报告草案",
        description: "整理 CLI 输出。",
        userGoal: "生成 Markdown 趋势摘要。",
        sourceKind: "cli",
        sourceRefs: ["trendctl --help"],
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        generatedFiles: [
          { relativePath: "SKILL.md", byteLength: 128, sha256: "a" },
        ],
        verificationStatus: "verified_pending_registration",
        lastVerification: {
          reportId: "capver-1",
          status: "passed",
          summary: "最小 verification gate 通过，等待后续注册阶段。",
          checkedAt: "2026-05-05T01:00:00.000Z",
          failedCheckCount: 0,
        },
        lastRegistration: null,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:00:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-register",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-register/manifest.json",
      },
    ]);
    vi.mocked(capabilityDraftsApi.register).mockResolvedValueOnce({
      draft: {
        draftId: "capdraft-register",
        name: "只读 CLI 报告草案",
        description: "整理 CLI 输出。",
        userGoal: "生成 Markdown 趋势摘要。",
        sourceKind: "cli",
        sourceRefs: ["trendctl --help"],
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        generatedFiles: [
          { relativePath: "SKILL.md", byteLength: 128, sha256: "a" },
        ],
        verificationStatus: "registered",
        lastVerification: {
          reportId: "capver-1",
          status: "passed",
          summary: "最小 verification gate 通过，等待后续注册阶段。",
          checkedAt: "2026-05-05T01:00:00.000Z",
          failedCheckCount: 0,
        },
        lastRegistration: {
          registrationId: "capreg-1",
          registeredAt: "2026-05-05T01:10:00.000Z",
          skillDirectory: "capability-register",
          registeredSkillDirectory: "/tmp/work/.agents/skills/capability-register",
          sourceDraftId: "capdraft-register",
          sourceVerificationReportId: "capver-1",
          generatedFileCount: 4,
          permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
        },
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T01:10:00.000Z",
        draftRoot: "/tmp/work/.lime/capability-drafts/capdraft-register",
        manifestPath:
          "/tmp/work/.lime/capability-drafts/capdraft-register/manifest.json",
      },
      registration: {
        registrationId: "capreg-1",
        registeredAt: "2026-05-05T01:10:00.000Z",
        skillDirectory: "capability-register",
        registeredSkillDirectory: "/tmp/work/.agents/skills/capability-register",
        sourceDraftId: "capdraft-register",
        sourceVerificationReportId: "capver-1",
        generatedFileCount: 4,
        permissionSummary: ["Level 0 只读发现", "允许执行本地 CLI"],
      },
    });

    const onRegisteredSkillsChanged = vi.fn();
    const container = renderPanel({
      workspaceRoot: "/tmp/work",
      onRegisteredSkillsChanged,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const registerButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("注册到 Workspace"));
    expect(registerButton).toBeTruthy();

    await act(async () => {
      registerButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(capabilityDraftsApi.register).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/work",
      draftId: "capdraft-register",
    });
    expect(container.textContent).toContain("已注册");
    expect(container.textContent).toContain("已注册目录：capability-register");
    expect(container.textContent).toContain("运行与自动化仍需后续 runtime gate");
    expect(onRegisteredSkillsChanged).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("立即运行");
    expect(container.textContent).not.toContain("创建自动化");
  });
});
