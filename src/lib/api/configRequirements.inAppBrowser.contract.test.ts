import { beforeEach, expect, it, vi } from "vitest";
import { getConfigRequirements } from "./configRequirements";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

beforeEach(() => vi.resetAllMocks());

function policy(inAppBrowser: unknown) {
  return {
    allowedApprovalPolicies: null,
    allowedSandboxModes: null,
    allowedWebSearchModes: null,
    inAppBrowser,
  };
}

it.each([
  undefined,
  null,
  {},
  { allowExternalBrowserSettingsImport: undefined },
  { allowExternalBrowserSettingsImport: null },
  { allowExternalBrowserSettingsImport: false },
  { allowExternalBrowserSettingsImport: true },
])("preserves the optional managed import requirement: %j", async (value) => {
  const requirements = policy(value);
  request.mockResolvedValue({ result: { requirements } });
  expect(await getConfigRequirements()).toEqual(requirements);
  expect(request).toHaveBeenCalledWith("configRequirements/read", {});
});

it.each([
  false,
  "false",
  [],
  0,
  { allowExternalBrowserSettingsImport: "false" },
  { allowExternalBrowserSettingsImport: 0 },
  { allowExternalBrowserSettingsImport: [] },
  { allowExternalBrowserSettingsImport: {} },
])("rejects malformed managed import requirements: %j", async (value) => {
  request.mockResolvedValue({ result: { requirements: policy(value) } });
  await expect(getConfigRequirements()).rejects.toThrow("inAppBrowser");
});
