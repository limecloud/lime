/**
 * Desktop Host renderer adapter.
 *
 * current 主链固定为：
 * Frontend -> Electron Desktop Host IPC -> App Server JSON-RPC -> RuntimeCore / backend。
 * 本文件里的 mock 数据只允许通过 invokeMockOnly 作为测试夹具使用，生产 invoke 不再回退 mock。
 */

import {
  invokeViaHttp,
  isDevBridgeAvailable,
  normalizeDevBridgeError,
} from "../dev-bridge/http-client";
import { getElectronHostBridge } from "@/lib/electron-host";

type MockHandler = (args?: any) => any;

const mockCommands = new Map<string, (...args: any[]) => any>();
const shouldLogMockInfo = import.meta.env.MODE !== "test";
let defaultMocksPromise: Promise<Record<string, MockHandler>> | null = null;
let loadedMockResetters: Array<() => void> = [];

function isTestEnvironment(): boolean {
  return Boolean(import.meta.env?.MODE === "test" || import.meta.env?.VITEST);
}

function assertTestMockEnvironment(apiName: string): void {
  if (isTestEnvironment()) {
    return;
  }
  throw new Error(
    `[Mock] ${apiName} 只能在测试环境使用；生产路径必须进入 Electron Desktop Host IPC / App Server JSON-RPC。`,
  );
}

function logMockInfo(...args: Parameters<typeof console.log>) {
  if (!shouldLogMockInfo) {
    return;
  }
  console.log(...args);
}

function loadDefaultMocks(): Promise<Record<string, MockHandler>> {
  assertTestMockEnvironment("loadDefaultMocks");
  defaultMocksPromise ??= (async () => {
    const [
      browser,
      fileSystem,
      layeredDesign,
      log,
      mediaTask,
      memory,
      model,
      provider,
      sessionFile,
      skillManagement,
      skillForge,
      update,
      workspace,
      voice,
    ] = await Promise.all([
      import("./browserMocks"),
      import("./fileSystemMocks"),
      import("./layeredDesignMocks"),
      import("./logMocks"),
      import("./mediaTaskMocks"),
      import("./memoryMocks"),
      import("./modelMocks"),
      import("./providerMocks"),
      import("./sessionFileMocks"),
      import("./skillManagementMocks"),
      import("./skillForgeMocks"),
      import("./updateMocks"),
      import("./workspaceMocks"),
      import("./voiceMocks"),
    ]);

    loadedMockResetters = [
      skillForge.clearSkillForgeMocks,
      layeredDesign.clearLayeredDesignMocks,
    ];

    return {
      ...skillForge.skillForgeMocks,
      ...browser.browserMocks,

      ...skillManagement.skillManagementMocks,
      ...provider.providerMocks,
      ...mediaTask.mediaTaskMocks,
      ...memory.memoryMocks,
      ...sessionFile.sessionFileMocks,
      ...layeredDesign.layeredDesignMocks,
      ...model.modelMocks,

      ...fileSystem.fileSystemMocks,
      ...log.logMocks,

      ...voice.voiceMocks,
      ...update.updateMocks,

      ...workspace.workspaceMocks,
    };
  })();
  return defaultMocksPromise;
}

async function invokeDefaultMock<T = any>(
  cmd: string,
  args?: Record<string, unknown>,
  options: { log?: boolean } = {},
): Promise<T> {
  if (options.log !== false) {
    logMockInfo(`[Mock] invoke: ${cmd}`, args);
  }

  if (mockCommands.has(cmd)) {
    const handler = mockCommands.get(cmd)!;
    return handler(args);
  }

  const defaultMocks = await loadDefaultMocks();
  if (cmd in defaultMocks) {
    return defaultMocks[cmd](args);
  }

  throw new Error(
    `[Mock] 未注册命令 "${cmd}"。显式测试 mock 不能静默伪造成功结果；请为 test-only 场景注册 mock，或把生产命令迁移到 Electron Desktop Host / App Server current 主链。`,
  );
}

/**
 * 显式 mock 入口，仅供测试夹具使用。
 * 这里不能再次探测 HTTP bridge，否则会把一次后端未就绪放大成多条 console error。
 */
export async function invokeMockOnly<T = any>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  assertTestMockEnvironment("invokeMockOnly");
  return invokeDefaultMock<T>(cmd, args);
}

/**
 * Renderer invoke 只进入 Electron Desktop Host IPC 或开发 HTTP bridge。
 * 不能回退 defaultMocks，否则会把 App Server / backend 缺口伪装成成功。
 */
export async function invoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const electronHost = getElectronHostBridge();
  if (electronHost) {
    return electronHost.invoke<T>(cmd, args);
  }

  if (isDevBridgeAvailable()) {
    try {
      return await invokeViaHttp<T>(cmd, args);
    } catch (error) {
      throw normalizeDevBridgeError(cmd, error);
    }
  }

  throw new Error(
    `[Electron] Desktop Host IPC 不可用，命令 "${cmd}" 无法进入 App Server JSON-RPC 主链。`,
  );
}

/**
 * Register a mock command handler
 */
export function mockCommand(cmd: string, handler: (...args: any[]) => any) {
  assertTestMockEnvironment("mockCommand");
  mockCommands.set(cmd, handler);
}

/**
 * Clear all mock commands
 */
export function clearMocks() {
  assertTestMockEnvironment("clearMocks");
  mockCommands.clear();
  for (const reset of loadedMockResetters) {
    reset();
  }
}

export function convertFileSrc(filePath: string, _protocol?: string): string {
  const electronHost = getElectronHostBridge();
  if (electronHost?.convertFileSrc) {
    return electronHost.convertFileSrc(filePath, _protocol);
  }

  throw new Error(
    `[Electron] Desktop Host IPC 不可用，本地文件路径无法转换: ${filePath}`,
  );
}

export type InvokeOptions = Record<string, unknown>;
