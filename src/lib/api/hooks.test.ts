import { beforeEach, expect, it, vi } from "vitest";
import { listHooks, updateHookState } from "./hooks";

const request = vi.hoisted(() => vi.fn());
vi.mock("./appServer", () => ({ createAppServerClient: () => ({ request }) }));
beforeEach(() => {
  request.mockReset();
});

it("lists hooks through the current protocol, including explicit roots", async () => {
  const response = {
    data: [{ cwd: "/work/project", hooks: [], errors: [], warnings: [] }],
  };
  request.mockResolvedValue({ result: response });
  expect(await listHooks({ cwds: ["/work/project"] })).toEqual(response);
  expect(request).toHaveBeenCalledWith("hooks/list", {
    cwds: ["/work/project"],
  });
});

it("writes one quoted state batch without creating another control API", async () => {
  const key = 'C:\\work\\a.b\\"quoted":pre_tool_use:0:0';
  request.mockResolvedValue({
    result: {
      status: "ok",
      filePath: "/home/.lime/config.toml",
      version: "next",
    },
  });
  expect(
    (
      await updateHookState([
        { key, enabled: false, trustedHash: "hash" },
        { key: "other", enabled: true },
      ])
    ).status,
  ).toBe("ok");
  expect(request).toHaveBeenCalledWith("config/batchWrite", {
    filePath: null,
    expectedVersion: null,
    reloadUserConfig: true,
    edits: [
      {
        keyPath: `hooks.state.${JSON.stringify(key)}.enabled`,
        value: false,
        mergeStrategy: "upsert",
      },
      {
        keyPath: `hooks.state.${JSON.stringify(key)}.trusted_hash`,
        value: "hash",
        mergeStrategy: "upsert",
      },
      {
        keyPath: 'hooks.state."other".enabled',
        value: true,
        mergeStrategy: "upsert",
      },
    ],
  });
});

it("propagates transport rejection without a fallback", async () => {
  request.mockRejectedValue(new Error("transport unavailable"));
  await expect(listHooks()).rejects.toThrow("transport unavailable");
  await expect(
    updateHookState([{ key: "key", enabled: false }]),
  ).rejects.toThrow("transport unavailable");
});
