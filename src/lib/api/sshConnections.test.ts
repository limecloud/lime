import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSshConnection,
  ensureSshConfig,
  listSshConnections,
} from "./sshConnections";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

describe("sshConnections", () => {
  beforeEach(() => invoke.mockReset());

  it("返回并校验 SSH 连接列表", async () => {
    const connections = [
      { alias: "prod", hostName: "10.0.0.1", user: "deploy", port: 2222 },
      { alias: "dev", hostName: "dev.example.com", user: null, port: null },
    ];
    invoke.mockResolvedValue(connections);
    await expect(listSshConnections()).resolves.toEqual(connections);
    expect(invoke).toHaveBeenCalledWith("ssh_connections_list");
  });

  it("拒绝非法结构", async () => {
    invoke.mockResolvedValue([
      { alias: "prod", hostName: "", user: null, port: null },
    ]);
    await expect(listSshConnections()).rejects.toThrow("invalid list");
  });
});

it("确保 SSH 配置时校验返回路径", async () => {
  invoke.mockResolvedValue("/Users/test/.ssh/config");
  await expect(ensureSshConfig()).resolves.toBe("/Users/test/.ssh/config");
  expect(invoke).toHaveBeenCalledWith("ssh_config_ensure");

  invoke.mockResolvedValue(null);
  await expect(ensureSshConfig()).rejects.toThrow("invalid path");
});

it("添加 SSH 连接并校验返回结构", async () => {
  const connection = {
    alias: "prod",
    hostName: "10.0.0.1",
    user: "deploy",
    port: 2222,
  };
  invoke.mockResolvedValue(connection);
  await expect(
    addSshConnection({
      alias: "prod",
      hostName: "10.0.0.1",
      user: "deploy",
      port: 2222,
    }),
  ).resolves.toEqual(connection);
  expect(invoke).toHaveBeenCalledWith("ssh_connection_add", {
    alias: "prod",
    hostName: "10.0.0.1",
    user: "deploy",
    port: 2222,
  });

  invoke.mockResolvedValue(null);
  await expect(addSshConnection({ alias: "x", hostName: "y" })).rejects.toThrow(
    "invalid result",
  );
});
