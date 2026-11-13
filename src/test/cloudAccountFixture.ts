import { afterEach, beforeEach, vi } from "vitest";
import { readCloudAccount } from "@/lib/cloudAccount";
import type {
  AppServerAccount,
  AppServerGetAccountResponse,
} from "@/lib/api/appServerTypes";

const fixture = vi.hoisted(() => ({
  serviceUrl: "https://core.example.test" as string | null,
  serviceError: null as string | null,
  account: null as AppServerAccount | null,
  authorizations: [] as AppServerGetAccountResponse["authorizations"],
  login: vi.fn(),
  logout: vi.fn(),
  read: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/api/account", () => ({
  loginAccount: fixture.login,
  logoutAccount: fixture.logout,
  readAccount: fixture.read,
}));
vi.mock("@/lib/api/cloud", () => ({ requestCloud: fixture.request }));

export const accountFixture = fixture;
export const cloudRequestMock = fixture.request;

export function cloudAccountMetadata(
  input: Partial<Extract<AppServerAccount, { type: "cloud" }>> = {},
): Extract<AppServerAccount, { type: "cloud" }> {
  return {
    type: "cloud",
    baseUrl: "https://core.example.test",
    issuer: "https://identity.example.test",
    applicationId: "lime",
    clientId: "lime-native",
    environment: "sandbox",
    userId: "user-one",
    email: "user@example.test",
    displayName: "Test User",
    generation: "generation-one",
    resources: [],
    ...input,
  };
}
export async function seedCloudAccount(
  input: Partial<Extract<AppServerAccount, { type: "cloud" }>> = {},
) {
  fixture.account = cloudAccountMetadata(input);
  const result = await readCloudAccount();
  console.log("SEED", input.user?.id, "->", result?.account?.userId);
  return fixture.account;
}

beforeEach(async () => {
  fixture.serviceUrl = "https://core.example.test";
  fixture.serviceError = null;
  fixture.account = null;
  fixture.authorizations = [];
  fixture.read.mockReset().mockImplementation(async () => ({
    serviceUrl: fixture.account?.baseUrl ?? fixture.serviceUrl,
    serviceError: fixture.serviceError,
    account: fixture.account,
    authorizations: fixture.authorizations,
  }));
  fixture.login.mockReset().mockResolvedValue({
    authUrl: "https://identity.example.test/authorize?state=public-state",
    authorization: {
      id: "authorization-one",
      resource: "default",
      status: "pending",
    },
  });
  fixture.logout.mockReset().mockImplementation(async () => {
    fixture.account = null;
    fixture.authorizations = [];
    return {};
  });
  fixture.request.mockReset();
  await readCloudAccount();
});
afterEach(async () => {
  fixture.account = null;
  fixture.authorizations = [];
  fixture.read.mockImplementation(async () => ({
    serviceUrl: null,
    account: null,
    authorizations: [],
  }));
  await readCloudAccount();
});
