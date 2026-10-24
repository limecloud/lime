import { beforeEach, expect, it, vi } from "vitest";
import { getConfigRequirements } from "./configRequirements";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));
beforeEach(() => vi.resetAllMocks());

it("reads the independent public policy on each request without user paths or stale cache", async () => {
  request.mockResolvedValueOnce({ result: { requirements: null } });
  expect(await getConfigRequirements()).toBeNull();
  const policy = {
    allowedApprovalPolicies: ["on-request"],
    allowedSandboxModes: ["read-only"],
    allowedWebSearchModes: ["disabled"],
  };
  request.mockResolvedValueOnce({ result: { requirements: policy } });
  expect(await getConfigRequirements()).toEqual(policy);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith("configRequirements/read", {});
});

it.each([
  undefined,
  [],
  {},
  {
    allowedApprovalPolicies: [],
    allowedSandboxModes: null,
    allowedWebSearchModes: null,
  },
  {
    allowedApprovalPolicies: null,
    allowedSandboxModes: ["full"],
    allowedWebSearchModes: null,
  },
  {
    allowedApprovalPolicies: null,
    allowedSandboxModes: null,
    allowedWebSearchModes: ["live"],
  },
])(
  "rejects malformed policies instead of treating them as unrestricted: %j",
  async (requirements) => {
    request.mockResolvedValue({ result: { requirements } });
    await expect(getConfigRequirements()).rejects.toThrow();
  },
);

it("propagates unavailable authority instead of returning an unrestricted policy", async () => {
  request.mockRejectedValue(Error("policy unreadable"));
  await expect(getConfigRequirements()).rejects.toThrow("policy unreadable");
});
