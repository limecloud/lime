import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfig,
  getConfigSnapshot,
  invalidateAppConfigCache,
  updateConfig,
  writeConfigValue,
} from "./appConfig";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

let config: Record<string, unknown>, version: number, file: string;
const read = () => ({
  result: {
    config: structuredClone(config),
    origins: {},
    layers: [
      {
        name: { type: "user", file },
        config: structuredClone(config),
        version: `v${version}`,
      },
    ],
  },
});
const written = () => ({
  result: { status: "ok", version: `v${version}`, filePath: file },
});
const change = (keyPath: string, value: unknown) =>
  writeConfigValue({ keyPath, value, filePath: "/fixture/config.yaml" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  invalidateAppConfigCache();
  config = {
    default_provider: "fixture",
    model_verbosity: null,
    approval_policy: "on-request",
    desktop: { unrelated: true },
  };
  version = 1;
  file = "/fixture/config.yaml";
  request.mockImplementation(async (method, params) => {
    if (method === "config/read") return read();
    if (params.expectedVersion !== `v${version}`)
      throw Error("configVersionConflict");
    if (method === "config/value/write") config[params.keyPath] = params.value;
    else if (method === "config/batchWrite")
      for (const edit of params.edits) config[edit.keyPath] = edit.value;
    else throw Error(`Unexpected ${method}`);
    ++version;
    return written();
  });
});

describe("single configuration value writes", () => {
  it("returns source identity and isolated snapshots from the existing configuration owner", async () => {
    const snapshot = await getConfigSnapshot();
    expect(snapshot.layer.name.file).toBe(file);
    snapshot.config.model_verbosity = "high";
    (snapshot.layer.config as Record<string, unknown>).approval_policy =
      "never";
    expect((await getConfig()).model_verbosity).toBeNull();
    expect((await getConfigSnapshot()).layer.config).toMatchObject({
      approval_policy: "on-request",
    });
  });

  it("reads the latest version and writes only the selected key while preserving unrelated external edits", async () => {
    await getConfigSnapshot();
    config.desktop = { external: true };
    ++version;
    const result = await change("model_verbosity", "high");
    expect(request).toHaveBeenCalledWith("config/value/write", {
      keyPath: "model_verbosity",
      value: "high",
      mergeStrategy: "upsert",
      expectedVersion: "v2",
      filePath: file,
    });
    expect(result.config.desktop).toEqual({ external: true });
    expect(result.config.model_verbosity).toBe("high");
  });

  it("uses replace for a null model default", async () => {
    await change("model_verbosity", null);
    expect(request).toHaveBeenCalledWith(
      "config/value/write",
      expect.objectContaining({ value: null, mergeStrategy: "replace" }),
    );
  });

  it("serializes different fields and refreshes their revisions", async () => {
    const gate = deferred<unknown>();
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (
        method === "config/value/write" &&
        params.keyPath === "approval_policy"
      )
        await gate.promise;
      return serve(method, params);
    });
    const first = change("approval_policy", "never"),
      second = change("model_verbosity", "high");
    await vi.waitFor(() =>
      expect(request.mock.calls.some(([m]) => m === "config/value/write")).toBe(
        true,
      ),
    );
    expect(
      request.mock.calls.filter(([m]) => m === "config/value/write"),
    ).toHaveLength(1);
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(
      request.mock.calls
        .filter(([m]) => m === "config/value/write")
        .map(([, p]) => p.expectedVersion),
    ).toEqual(["v1", "v2"]);
    expect(config).toMatchObject({
      approval_policy: "never",
      model_verbosity: "high",
    });
  });

  it("shares the mutation queue with existing full-config consumers", async () => {
    const gate = deferred<unknown>();
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (method === "config/value/write") await gate.promise;
      return serve(method, params);
    });
    const first = change("model_verbosity", "high");
    const second = updateConfig((current) => ({
      ...current,
      approval_policy: "never",
    }));
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "config/value/write",
        expect.anything(),
      ),
    );
    expect(request.mock.calls.some(([m]) => m === "config/batchWrite")).toBe(
      false,
    );
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(config).toMatchObject({
      approval_policy: "never",
      model_verbosity: "high",
    });
  });

  it.each(["system", "missing-file"])(
    "rejects an invalid writable source: %s",
    async (source) => {
      const response = read();
      if (source === "system") response.result.layers[0].name.type = source;
      else response.result.layers[0].name.file = "";
      request.mockResolvedValueOnce(response);
      await expect(change("model_verbosity", "high")).rejects.toThrow(
        /配置来源|配置层/,
      );
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a source path change instead of writing a different user file", async () => {
    file = "/other/config.yaml";
    await expect(change("approval_policy", "never")).rejects.toThrow(
      "配置来源已变化",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a read-only layer", async () => {
    const response = read();
    request.mockResolvedValueOnce({
      result: {
        ...response.result,
        layers: [{ ...response.result.layers[0], disabledReason: "managed" }],
      },
    });
    await expect(change("approval_policy", "never")).rejects.toThrow("不可写");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("surfaces a write conflict and allows a later request to recover with the new revision", async () => {
    const serve = request.getMockImplementation()!;
    let conflict = true;
    request.mockImplementation(async (method, params) => {
      if (method === "config/value/write" && conflict) {
        ++version;
        conflict = false;
      }
      return serve(method, params);
    });
    await expect(change("approval_policy", "never")).rejects.toThrow(
      "configVersionConflict",
    );
    expect(config.approval_policy).toBe("on-request");
    await change("model_verbosity", "high");
    expect(config.model_verbosity).toBe("high");
  });

  it("does not present a failed readback as a confirmed save", async () => {
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (method === "config/read" && version === 2)
        throw Error("readback failed");
      return serve(method, params);
    });
    await expect(change("model_verbosity", "high")).rejects.toThrow(
      "readback failed",
    );
    expect(config.model_verbosity).toBe("high");
    request.mockImplementation(serve);
    expect((await getConfigSnapshot()).config.model_verbosity).toBe("high");
  });

  it("prevents an older read from poisoning the refreshed cache or its file identity", async () => {
    const older = deferred<ReturnType<typeof read>>();
    const oldResponse = read();
    request.mockReturnValueOnce(older.promise);
    const oldRead = getConfigSnapshot();
    config.model_verbosity = "high";
    ++version;
    const current = await getConfigSnapshot();
    older.resolve(oldResponse);
    expect((await oldRead).config.model_verbosity).toBeNull();
    expect(current.config.model_verbosity).toBe("high");
    expect((await getConfig()).model_verbosity).toBe("high");
  });
});

describe("project configuration layers", () => {
  const cwd = "/fixture/repo";
  const projectFile = `${cwd}/.lime/config.toml`;
  function serveProject(disabledReason?: string) {
    let projectVersion = "p1";
    let revision = 1;
    let projectValue = "high";
    request.mockImplementation(async (method, params) => {
      if (method === "config/read") {
        const response = read();
        if (!params.cwd) return response;
        return {
          result: {
            ...response.result,
            config: {
              ...response.result.config,
              model_verbosity: projectValue,
            },
            layers: [
              ...response.result.layers,
              {
                name: { type: "project", dotCodexFolder: `${cwd}/.lime` },
                config: { model_verbosity: projectValue },
                version: projectVersion,
                disabledReason,
              },
            ],
          },
        };
      }
      if (params.filePath === projectFile) {
        if (params.expectedVersion !== projectVersion)
          throw Error("configVersionConflict");
        projectVersion = `p${++revision}`;
        projectValue = params.value;
        return {
          result: {
            status: "ok",
            version: projectVersion,
            filePath: projectFile,
          },
        };
      }
      if (params.expectedVersion !== `v${version}`)
        throw Error("configVersionConflict");
      config[params.keyPath] = params.value;
      ++version;
      return written();
    });
  }

  it("keeps cwd projections out of the global user cache and selects independent layer revisions", async () => {
    serveProject();
    const snapshot = await getConfigSnapshot({ cwd });
    expect(snapshot.config.model_verbosity).toBe("high");
    expect(snapshot.layer.name.file).toBe(file);
    expect((await getConfig()).model_verbosity).toBeNull();
    const saved = await writeConfigValue({
      keyPath: "model_verbosity",
      value: "low",
      cwd,
      filePath: projectFile,
      expectedVersion: "p1",
    });
    expect(saved.config.model_verbosity).toBe("low");
    expect(request).toHaveBeenCalledWith(
      "config/value/write",
      expect.objectContaining({ filePath: projectFile, expectedVersion: "p1" }),
    );
    expect((await getConfig()).model_verbosity).toBeNull();
  });

  it("preserves a project editor's stale revision so external edits fail instead of being overwritten", async () => {
    serveProject();
    await expect(
      writeConfigValue({
        keyPath: "model_verbosity",
        value: "low",
        cwd,
        filePath: projectFile,
        expectedVersion: "old",
      }),
    ).rejects.toThrow("configVersionConflict");
    expect((await getConfigSnapshot({ cwd })).config.model_verbosity).toBe(
      "high",
    );
  });

  it("advances only acknowledged local revisions for queued edits from the same project snapshot", async () => {
    serveProject();
    await Promise.all([
      writeConfigValue({
        keyPath: "model_verbosity",
        value: "low",
        cwd,
        filePath: projectFile,
        expectedVersion: "p1",
      }),
      writeConfigValue({
        keyPath: "model_verbosity",
        value: "medium",
        cwd,
        filePath: projectFile,
        expectedVersion: "p1",
      }),
    ]);
    expect(
      request.mock.calls
        .filter(([method]) => method === "config/value/write")
        .map(([, params]) => params.expectedVersion),
    ).toEqual(["p1", "p2"]);
    expect((await getConfigSnapshot({ cwd })).config.model_verbosity).toBe(
      "medium",
    );
  });

  it("refuses disabled project writes before dispatch and continues to allow global preferences", async () => {
    serveProject("not trusted");
    await expect(
      writeConfigValue({
        keyPath: "model_verbosity",
        value: "low",
        cwd,
        filePath: projectFile,
      }),
    ).rejects.toThrow();
    expect(
      request.mock.calls.filter(([method]) => method === "config/value/write"),
    ).toHaveLength(0);
    await change("approval_policy", "never");
    expect((await getConfig()).approval_policy).toBe("never");
  });
});
