import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimStoredOemCloudReferralInvite,
  handleOemCloudReferralInviteUrl,
  parseOemCloudReferralInviteUrl,
  readStoredOemCloudReferralInvite,
  storeOemCloudReferralInvite,
} from "./oemCloudReferralClaim";
import {
  clearStoredOemCloudSessionState,
  setStoredOemCloudSessionState,
} from "./oemCloudSession";

const { mockClaimClientReferral } = vi.hoisted(() => ({
  mockClaimClientReferral: vi.fn(),
}));

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  claimClientReferral: mockClaimClientReferral,
}));

function setCloudSession(tenantId = "tenant-0001") {
  setStoredOemCloudSessionState({
    token: "session-token-001",
    tenant: { id: tenantId, name: "Lime" },
    user: { id: "user-001", displayName: "晚风" },
    session: { id: "session-001" },
  });
}

describe("oemCloudReferralClaim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T08:00:00.000Z"));
    vi.clearAllMocks();
    mockClaimClientReferral.mockResolvedValue({});
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
  });

  afterEach(() => {
    clearStoredOemCloudSessionState();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("应解析 lime 与 web 邀请链接并规范化邀请码", () => {
    const deepLink = parseOemCloudReferralInviteUrl(
      "lime://invite?code=nm-45bc-8dhw&tenantId=tenant-0001",
    );
    const webLink = parseOemCloudReferralInviteUrl(
      "https://limeai.run/referral?referralCode=lime-2026",
    );

    expect(deepLink).toMatchObject({
      code: "NM-45BC-8DHW",
      tenantId: "tenant-0001",
      landingPath: "/invite?code=nm-45bc-8dhw&tenantId=tenant-0001",
      capturedAt: "2026-04-28T08:00:00.000Z",
    });
    expect(webLink).toMatchObject({
      code: "LIME-2026",
      landingPath: "/referral?referralCode=lime-2026",
    });
    expect(parseOemCloudReferralInviteUrl("https://limeai.run/download")).toBe(
      null,
    );
  });

  it("未登录时应缓存邀请码等待登录后领取", async () => {
    const result = await handleOemCloudReferralInviteUrl(
      "https://limeai.run/invite?code=lime-2026&tenantId=tenant-0001",
    );

    expect(result.status).toBe("pending_login");
    expect(mockClaimClientReferral).not.toHaveBeenCalled();
    expect(readStoredOemCloudReferralInvite()).toMatchObject({
      code: "LIME-2026",
      tenantId: "tenant-0001",
    });
  });

  it("已登录时应调用当前租户 claim 接口并清理缓存", async () => {
    setCloudSession("tenant-0001");
    storeOemCloudReferralInvite({
      code: "LIME-2026",
      tenantId: "tenant-0001",
      sourceUrl: "https://limeai.run/invite?code=LIME-2026",
      landingPath: "/invite?code=LIME-2026",
      capturedAt: "2026-04-28T08:00:00.000Z",
      receivedAt: Date.now(),
    });

    const result = await claimStoredOemCloudReferralInvite();

    expect(result.status).toBe("claimed");
    expect(mockClaimClientReferral).toHaveBeenCalledWith("tenant-0001", {
      code: "LIME-2026",
      claimMethod: "auto",
      entrySource: "link",
      landingPath: "/invite?code=LIME-2026",
      capturedAt: "2026-04-28T08:00:00.000Z",
    });
    expect(readStoredOemCloudReferralInvite()).toBeNull();
  });

  it("租户不匹配时不调用 claim 接口", async () => {
    setCloudSession("tenant-0002");

    const result = await handleOemCloudReferralInviteUrl(
      "https://limeai.run/invite?code=LIME-2026&tenantId=tenant-0001",
    );

    expect(result.status).toBe("tenant_mismatch");
    expect(mockClaimClientReferral).not.toHaveBeenCalled();
  });

  it("过期的缓存邀请码应被忽略并清理", () => {
    storeOemCloudReferralInvite({
      code: "OLD-CODE",
      sourceUrl: "https://limeai.run/invite?code=OLD-CODE",
      landingPath: "/invite?code=OLD-CODE",
      capturedAt: "2026-03-20T08:00:00.000Z",
      receivedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });

    expect(readStoredOemCloudReferralInvite()).toBeNull();
  });
});
