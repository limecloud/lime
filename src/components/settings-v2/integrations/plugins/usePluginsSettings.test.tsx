import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import { usePluginsSettings } from "./usePluginsSettings";

const api = vi.hoisted(() => ({
  projects: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  uninstall: vi.fn(),
}));
vi.mock("@/lib/api/project", () => ({ listProjects: api.projects }));
vi.mock("@/lib/api/pluginCatalog", () => ({
  listInstalledPlugins: api.read,
  setPluginEnabled: api.write,
  uninstallPlugin: api.uninstall,
  PLUGIN_CATALOG_CHANGED_EVENT: "test:plugins-confirmation",
}));
vi.mock("@/lib/cloudAccount", () => ({
  getCloudAccount: () => null,
  cloudAccountIdentity: () => null,
  cloudAccountIdentityVersion: () => 0,
  subscribeCloudAccount: () => () => {},
}));
let root: Root,
  container: HTMLDivElement,
  controller: ReturnType<typeof usePluginsSettings>;
const plugin = (id = "alpha", enabled = true): AppServerPluginSummary => ({
  id,
  name: id,
  installed: true,
  enabled,
  source: { type: "local", path: `/fixture/${id}` },
  installPolicy: "AVAILABLE",
  authPolicy: "ON_USE",
  availability: "AVAILABLE",
  interface: null,
  keywords: [],
});
const response = (plugins = [plugin()]) => ({
  marketplaces: [
    {
      name: "fixture",
      path: "/fixture/marketplace.json",
      interface: null,
      plugins,
    },
  ],
  marketplaceLoadErrors: [],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
function Surface() {
  controller = usePluginsSettings();
  return null;
}
const mount = () => act(async () => root.render(<Surface />));
const notify = () =>
  act(async () => {
    window.dispatchEvent(new Event("test:plugins-confirmation"));
  });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.projects.mockResolvedValue([]);
  api.read.mockResolvedValue(response());
  api.write.mockResolvedValue(undefined);
  api.uninstall.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("queues changes during the initial read without accepting an obsolete final list", async () => {
  const first = deferred<ReturnType<typeof response>>();
  api.read
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(response([plugin("beta")]));
  await mount();
  await notify();
  await notify();
  expect(api.read).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(response()));
  expect(api.read).toHaveBeenCalledTimes(2);
  expect(controller.plugins.map((item) => item.id)).toEqual(["beta"]);
  expect(controller.loading).toBe(false);
});

it("coalesces changes before readback and reads again for notifications arriving during readback", async () => {
  await mount();
  const readback = deferred<ReturnType<typeof response>>();
  api.read
    .mockReturnValueOnce(readback.promise)
    .mockResolvedValue(response([plugin("beta")]));
  let operation!: Promise<boolean>;
  await act(async () => {
    operation = controller.mutate(controller.plugins[0], false);
  });
  await notify();
  await notify();
  expect(api.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    readback.resolve(response([plugin("alpha", false)]));
    await operation;
  });
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(api.read).toHaveBeenCalledTimes(3);
  expect(controller.plugins.map((item) => item.id)).toEqual(["beta"]);
});

it("locks successful writes until a complete read confirms the same canonical identity", async () => {
  await mount();
  const original = controller.plugins[0];
  api.read.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => {
    expect(await controller.mutate(original, false)).toBe(false);
  });
  expect(controller.awaitingConfirmation).toBe(true);
  expect(controller.error).toBe("refresh");
  expect(controller.plugins).toEqual([original]);
  await act(async () => {
    expect(await controller.mutate(original, false)).toBe(false);
  });
  expect(api.write).toHaveBeenCalledTimes(1);
  api.read.mockRejectedValueOnce(new Error("still unavailable"));
  await act(async () => {
    await controller.reload();
  });
  expect(controller.error).toBe("refresh");
  expect(controller.awaitingConfirmation).toBe(true);
  api.read.mockResolvedValue(response([plugin("alpha", false)]));
  await act(async () => {
    await controller.reload();
  });
  expect(controller.error).toBeNull();
  expect(controller.awaitingConfirmation).toBe(false);
  expect(controller.plugins[0].enabled).toBe(false);
  expect(api.write).toHaveBeenCalledTimes(1);
});

it("reports an effective override when read-only confirmation disagrees with the saved state", async () => {
  await mount();
  api.read.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => {
    await controller.mutate(controller.plugins[0], false);
  });
  await act(async () => {
    await controller.reload();
  });
  expect(controller.error).toBe("overridden");
  expect(controller.plugins[0].enabled).toBe(true);
  expect(controller.awaitingConfirmation).toBe(false);
  expect(api.write).toHaveBeenCalledTimes(1);
});

it("does not repeat an uninstall while its saved result is unconfirmed", async () => {
  await mount();
  const original = controller.plugins[0];
  api.read.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => {
    await controller.mutate(original);
  });
  await act(async () => {
    await controller.mutate(original);
  });
  expect(api.uninstall).toHaveBeenCalledTimes(1);
  expect(controller.awaitingConfirmation).toBe(true);
  api.read.mockResolvedValue(response([]));
  await act(async () => {
    await controller.reload();
  });
  expect(controller.plugins).toEqual([]);
  expect(controller.error).toBeNull();
  expect(controller.awaitingConfirmation).toBe(false);
  expect(api.uninstall).toHaveBeenCalledTimes(1);
});

it("drops stale StrictMode reads and does not restart a queued read after unmount", async () => {
  const stale = deferred<ReturnType<typeof response>>();
  api.projects.mockReturnValueOnce(stale.promise).mockResolvedValue([]);
  await act(async () =>
    root.render(
      <StrictMode>
        <Surface />
      </StrictMode>,
    ),
  );
  expect(controller.plugins[0].id).toBe("alpha");
  await act(async () => stale.resolve(response([plugin("stale")])));
  expect(controller.plugins[0].id).toBe("alpha");
  const last = deferred<ReturnType<typeof response>>();
  api.read.mockReturnValueOnce(last.promise);
  await act(async () => {
    void controller.reload();
  });
  await notify();
  const calls = api.read.mock.calls.length;
  await act(async () => root.render(null));
  await act(async () => last.resolve(response([plugin("late")])));
  expect(api.read).toHaveBeenCalledTimes(calls);
});
