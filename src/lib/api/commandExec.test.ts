import { afterEach, describe, expect, it, vi } from "vitest";
import {
  execCommand,
  resizeCommandExec,
  subscribeCommandExecOutput,
  terminateCommandExec,
  writeCommandExec,
} from "./commandExec";

const { subscribeAppServerNotifications, flushNotifications } = vi.hoisted(
  () => ({
    subscribeAppServerNotifications: vi.fn(),
    flushNotifications: vi.fn(async () => undefined),
  }),
);

vi.mock("./appServerEventBus", () => ({
  subscribeAppServerNotifications,
  getDefaultAppServerEventBus: () => ({ flushNotifications }),
}));

function createClient() {
  return {
    execCommand: vi
      .fn()
      .mockResolvedValue({ result: { exitCode: 0, stdout: "", stderr: "" } }),
    writeCommandExec: vi.fn().mockResolvedValue({ result: {} }),
    resizeCommandExec: vi.fn().mockResolvedValue({ result: {} }),
    terminateCommandExec: vi.fn().mockResolvedValue({ result: {} }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("commandExec gateway", () => {
  it("透传 command/exec exact 参数并返回 result", async () => {
    const client = createClient();
    const params = {
      command: ["/bin/sh", "-i"],
      processId: "shell-1",
      tty: true,
      streamStdin: true,
      streamStdoutStderr: true,
      disableOutputCap: true,
      disableTimeout: true,
      cwd: "/tmp/project",
      size: { cols: 120, rows: 14 },
      sandboxPolicy: {
        type: "workspaceWrite" as const,
        writableRoots: ["/workspace/memories"],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
    };

    await expect(execCommand(params, client)).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(client.execCommand).toHaveBeenCalledWith(params);
  });

  it.each([
    ["write", writeCommandExec, "writeCommandExec", { processId: "  " }],
    [
      "terminate",
      terminateCommandExec,
      "terminateCommandExec",
      { processId: "  " },
    ],
  ] as const)(
    "拒绝空白 processId: %s",
    async (_name, call, _method, params) => {
      await expect(call(params as never, createClient())).rejects.toThrow(
        "processId is required",
      );
    },
  );

  it("流式命令在现役事件总线交付尾部输出后才返回真实退出码", async () => {
    const client = createClient();
    const pendingFlush = Promise.withResolvers<void>();
    flushNotifications.mockReturnValueOnce(pendingFlush.promise);
    client.execCommand.mockResolvedValueOnce({
      result: { exitCode: 7, stdout: "", stderr: "" },
    });
    const complete = vi.fn();
    const result = execCommand(
      {
        command: ["sh", "-c", "printf output; exit 7"],
        streamStdoutStderr: true,
      },
      client,
    ).then(complete);
    await Promise.resolve();
    expect(flushNotifications).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    pendingFlush.resolve();
    await result;
    expect(complete).toHaveBeenCalledExactlyOnceWith({
      exitCode: 7,
      stdout: "",
      stderr: "",
    });
    flushNotifications.mockClear();
    await execCommand({ command: ["echo", "output"] }, client);
    expect(flushNotifications).not.toHaveBeenCalled();
  });

  it("要求 resize 使用正数 tty 尺寸并透传", async () => {
    const client = createClient();

    await expect(
      resizeCommandExec(
        { processId: "shell-1", size: { cols: 0, rows: 14 } },
        client,
      ),
    ).rejects.toThrow("greater than 0");
    await expect(
      resizeCommandExec(
        { processId: "shell-1", size: { cols: 120, rows: 14 } },
        client,
      ),
    ).resolves.toEqual({});
    expect(client.resizeCommandExec).toHaveBeenCalledWith({
      processId: "shell-1",
      size: { cols: 120, rows: 14 },
    });
  });

  it("拒绝非绝对 cwd、空 command 和无 tty 的尺寸", async () => {
    const client = createClient();
    await expect(
      execCommand({ command: ["echo", "ok"], cwd: "relative" }, client),
    ).rejects.toThrow("cwd must be an absolute path");
    await expect(execCommand({ command: [] }, client)).rejects.toThrow(
      "command must not be empty",
    );
    await expect(
      execCommand({ command: ["echo"], size: { cols: 1, rows: 1 } }, client),
    ).rejects.toThrow("requires a positive tty size");
  });

  it("只向匹配 processId 的订阅者投递 outputDelta", () => {
    const handler = vi.fn();
    const unsubscribe = vi.fn();
    subscribeAppServerNotifications.mockImplementationOnce((subscription) => {
      subscription.onNotifications?.([
        {
          jsonrpc: "2.0",
          method: "command/exec/outputDelta",
          params: {
            processId: "shell-other",
            stream: "stdout",
            deltaBase64: "b3RoZXI=",
            capReached: false,
          },
        },
        {
          jsonrpc: "2.0",
          method: "command/exec/outputDelta",
          params: {
            processId: "shell-1",
            stream: "stderr",
            deltaBase64: "ZXJyb3I=",
            capReached: false,
          },
        },
      ]);
      return unsubscribe;
    });

    expect(subscribeCommandExecOutput(" shell-1 ", handler)).toBe(unsubscribe);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      processId: "shell-1",
      stream: "stderr",
      deltaBase64: "ZXJyb3I=",
      capReached: false,
    });
    expect(subscribeAppServerNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        getDrainOptions: expect.any(Function),
        onNotifications: expect.any(Function),
      }),
    );
  });
});
