import { beforeEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({
  readStorage: vi.fn(),
  refreshStorage: vi.fn(),
  reviewStorage: vi.fn(),
  deleteStorage: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    constructor() {
      return client;
    }
  },
}));
vi.mock("./agentRuntime/sessionClient", () => ({
  notifyAgentRuntimeSessionsChanged: client.changed,
}));
import { readStorage, reviewStorage, deleteStorage } from "./storage";
beforeEach(() => vi.resetAllMocks());
it("passes typed requests and preserves partial measurement and cache state", async () => {
  const state = {
    status: "scanning",
    usage: null,
    measuredAt: null,
    completedCategories: [],
  };
  client.readStorage.mockResolvedValue({ result: state });
  expect(await readStorage()).toEqual(state);
  expect(client.readStorage).toHaveBeenCalledWith({});
  client.refreshStorage.mockResolvedValue({ result: state });
  await readStorage(true);
  expect(client.refreshStorage).toHaveBeenCalledWith({});
  client.reviewStorage.mockResolvedValue({
    result: { cutoffMs: 10, archivedOnly: true, candidates: [] },
  });
  await reviewStorage({ days: 90, archivedOnly: true });
  expect(client.reviewStorage).toHaveBeenCalledWith({
    days: 90,
    archivedOnly: true,
  });
});
it.each([
  null,
  { status: "ready", usage: null, measuredAt: -1, completedCategories: [] },
  {
    status: "error",
    usage: { totalBytes: -2 },
    measuredAt: null,
    completedCategories: [],
  },
])("rejects malformed storage results", async (result) => {
  client.readStorage.mockResolvedValue({ result });
  await expect(readStorage()).rejects.toThrow("storage");
});
it("invalidates the same canonical session cache even if cleanup fails after partial progress", async () => {
  client.deleteStorage.mockRejectedValue(new Error("failed"));
  await expect(
    deleteStorage({ cutoffMs: 10, archivedOnly: true, candidates: [] }),
  ).rejects.toThrow("failed");
  expect(client.changed).toHaveBeenCalledOnce();
});
