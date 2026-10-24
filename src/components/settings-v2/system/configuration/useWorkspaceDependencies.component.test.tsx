import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppConfigSnapshot } from "@/lib/api/appConfig";
import type { DiagnoseDependenciesResponse } from "@/lib/api/primaryRuntime";
import { useWorkspaceDependencies } from "./useWorkspaceDependencies";

const api = vi.hoisted(() => ({
  write: vi.fn(),
  diagnose: vi.fn(),
  install: vi.fn(),
  reset: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  configLayerFile: (layer: AppConfigSnapshot["layer"]) => layer.name.file,
  writeConfigValue: api.write,
}));
vi.mock("@/lib/api/primaryRuntime", () => ({
  primaryRuntime: {
    diagnoseDependencies: api.diagnose,
    runUpdateNow: api.install,
    resetDependencies: api.reset,
    cancelInstall: api.cancel,
  },
  isInstallActive: (update?: { phase: string }) =>
    Boolean(update && !["ready", "error", "canceled"].includes(update.phase)),
}));

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useWorkspaceDependencies>;
let diagnosis: DiagnoseDependenciesResponse;
const snapshot = (managed = false) =>
  ({
    config: {},
    layer: {
      name: { type: "user", file: "/user/config.yaml" },
      config: {},
      version: "v1",
      disabledReason: null,
    },
    origins: managed
      ? {
          features: {
            name: { type: "mdm", domain: "fixture", key: "config" },
            version: "m1",
          },
        }
      : {},
  }) as unknown as AppConfigSnapshot;

function Probe({ config }: { config: AppConfigSnapshot | null }) {
  state = useWorkspaceDependencies(config);
  return null;
}
async function mount(config: AppConfigSnapshot | null = snapshot()) {
  await act(async () => root.render(<Probe config={config} />));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  diagnosis = {
    supported: true,
    enabled: false,
    installed: false,
    expectedVersion: "fixture-1",
    bundleVersion: null,
    problems: [],
    update: null,
  };
  api.diagnose.mockImplementation(async () => diagnosis);
  api.write.mockResolvedValue(undefined);
  api.install.mockResolvedValue(undefined);
  api.reset.mockResolvedValue(undefined);
  api.cancel.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("被动加载只读状态，不探测二进制或启动安装", async () => {
  await mount();
  expect(api.diagnose.mock.calls).toEqual([[]]);
  expect(api.install).not.toHaveBeenCalled();
  expect(state.loading).toBe(false);
  expect(state.readonly).toBe(false);
});

it("保存失败保留失败状态，重试保存成功之后才安装", async () => {
  api.write.mockRejectedValueOnce(new Error("write failed"));
  await mount();
  await act(async () => state.change(true));
  expect(state.error).toBe("save");
  expect(api.install).not.toHaveBeenCalled();
  await act(async () => state.retry());
  expect(api.write).toHaveBeenLastCalledWith({
    keyPath: "features.workspace_dependencies",
    value: true,
    filePath: "/user/config.yaml",
  });
  expect(api.install).toHaveBeenCalledTimes(1);
  expect(api.write.mock.invocationCallOrder[1]).toBeLessThan(
    api.install.mock.invocationCallOrder[0],
  );
  expect(state.error).toBeNull();
});

it("安装失败后只重试安装，不重复写已保存配置", async () => {
  api.install.mockRejectedValueOnce(new Error("install failed"));
  await mount();
  await act(async () => state.change(true));
  expect(state.error).toBe("install");
  await act(async () => state.retry());
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(api.install).toHaveBeenCalledTimes(2);
  expect(state.error).toBeNull();
});

it("受管父字段与配置未就绪时均拒绝写入", async () => {
  await mount(snapshot(true));
  expect(state.readonly).toBe(true);
  await act(async () => state.change(true));
  expect(state.error).toBe("save");
  await mount(null);
  await act(async () => state.change(false));
  expect(api.write).not.toHaveBeenCalled();
  expect(api.install).not.toHaveBeenCalled();
});

it("禁用不触发安装，显式诊断才请求可执行文件探测", async () => {
  await mount();
  await act(async () => state.change(false));
  expect(api.write).toHaveBeenCalledWith(
    expect.objectContaining({ value: false }),
  );
  expect(api.install).not.toHaveBeenCalled();
  diagnosis = { ...diagnosis, installed: true };
  await act(async () => state.diagnose());
  expect(api.diagnose).toHaveBeenCalledWith({ probeExecutables: true });
  expect(state.diagnosed).toBe(true);
});

it("重装与取消复用服务操作，取消携带当前操作 identity", async () => {
  diagnosis.update = {
    id: "operation-1",
    phase: "downloading",
    downloadedBytes: 1,
    totalBytes: 10,
    error: null,
  };
  await mount();
  await act(async () => state.cancel());
  expect(api.cancel).toHaveBeenCalledWith({ id: "operation-1" });
  await act(async () => state.reinstall());
  expect(api.reset).toHaveBeenCalledTimes(1);
  expect(api.write).not.toHaveBeenCalled();
});

it("配置变化后丢弃旧诊断，避免迟到状态覆盖新状态", async () => {
  const old = deferred<DiagnoseDependenciesResponse>();
  api.diagnose.mockReturnValueOnce(old.promise);
  await mount();
  diagnosis = {
    ...diagnosis,
    enabled: true,
    installed: true,
    bundleVersion: "new",
  };
  await mount(snapshot());
  expect(state.diagnostics?.bundleVersion).toBe("new");
  await act(async () =>
    old.resolve({
      ...diagnosis,
      enabled: false,
      installed: false,
      bundleVersion: "old",
    }),
  );
  expect(state.diagnostics?.bundleVersion).toBe("new");
});
