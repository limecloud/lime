import { describe, expect, it } from "vitest";
import {
  appendSshConnection,
  ensureSshConfig,
  parseSshConfig,
  removeSshConnection,
  updateSshConnection,
} from "./sshConnectionsHost";

describe("parseSshConfig", () => {
  it("解析 Host/HostName/User/Port 并保留多个别名", () => {
    expect(
      parseSshConfig(`
# comment
Host prod prod-alias
  HostName 10.0.0.1
  User deploy
  Port 2222

Host dev
  HostName=dev.example.com
  User=root
`),
    ).toEqual([
      { alias: "prod", hostName: "10.0.0.1", user: "deploy", port: 2222 },
      { alias: "prod-alias", hostName: "10.0.0.1", user: "deploy", port: 2222 },
      { alias: "dev", hostName: "dev.example.com", user: "root", port: null },
    ]);
  });

  it("忽略通配块与重复别名，缺省 HostName 使用别名", () => {
    expect(
      parseSshConfig(`
Host *
  User fallback
Host app
Host app extra
  HostName 1.2.3.4
Host app
  User other
`),
    ).toEqual([
      { alias: "app", hostName: "app", user: null, port: null },
      { alias: "extra", hostName: "1.2.3.4", user: null, port: null },
    ]);
  });

  it("忽略非法端口与空内容", () => {
    expect(parseSshConfig("")).toEqual([]);
    expect(
      parseSshConfig("Host box\n  Port not-a-port\n  HostName 9.9.9.9\n"),
    ).toEqual([{ alias: "box", hostName: "9.9.9.9", user: null, port: null }]);
  });
});

describe("ensureSshConfig", () => {
  it("创建缺失的 ~/.ssh/config 并保留已有内容", async () => {
    const { mkdtemp, readFile, stat, writeFile } =
      await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-home-"));
    const configPath = await ensureSshConfig(home);
    expect(configPath).toBe(path.join(home, ".ssh", "config"));
    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);

    await writeFile(configPath, "Host box\n");
    await ensureSshConfig(home);
    expect(await readFile(configPath, "utf8")).toBe("Host box\n");
  });
});

describe("appendSshConnection", () => {
  it("追加 Host 块并保留已有配置", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-append-"));
    const configPath = path.join(home, ".ssh", "config");
    await ensureSshConfig(home);
    await writeFile(configPath, "Host existing\n  HostName 1.1.1.1\n");

    await expect(
      appendSshConnection(home, {
        alias: "newbox",
        hostName: "10.0.0.2",
        user: "deploy",
        port: 2222,
      }),
    ).resolves.toEqual({
      alias: "newbox",
      hostName: "10.0.0.2",
      user: "deploy",
      port: 2222,
    });
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("Host existing");
    expect(text).toContain("Host newbox");
    expect(text).toContain("  HostName 10.0.0.2");
    expect(text).toContain("  User deploy");
    expect(text).toContain("  Port 2222");
  });

  it("拒绝重复别名与非法输入", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-append-"));
    await appendSshConnection(home, { alias: "box", hostName: "1.1.1.1" });
    await expect(
      appendSshConnection(home, { alias: "box", hostName: "2.2.2.2" }),
    ).rejects.toThrow("别名已存在");
    await expect(
      appendSshConnection(home, { alias: "bad alias", hostName: "2.2.2.2" }),
    ).rejects.toThrow("别名");
    await expect(
      appendSshConnection(home, {
        alias: "ok",
        hostName: "2.2.2.2",
        port: 70000,
      }),
    ).rejects.toThrow("端口");
  });
});

describe("removeSshConnection", () => {
  it("移除指定 Host 块并保留其他块与注释", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-remove-"));
    await ensureSshConfig(home);
    const configPath = path.join(home, ".ssh", "config");
    await writeFile(
      configPath,
      "Host first\n  HostName 1.1.1.1\n\n# keep me\nHost second\n  HostName 2.2.2.2\n",
    );
    await expect(removeSshConnection(home, "first")).resolves.toBe(true);
    const text = await readFile(configPath, "utf8");
    expect(text).not.toContain("Host first");
    expect(text).toContain("# keep me");
    expect(text).toContain("Host second");
  });

  it("多别名块只移除目标别名", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-remove-"));
    await ensureSshConfig(home);
    const configPath = path.join(home, ".ssh", "config");
    await writeFile(
      configPath,
      "Host prod prod-alias\n  HostName 10.0.0.1\n  User deploy\n",
    );
    await removeSshConnection(home, "prod");
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("Host prod-alias");
    expect(text).toContain("HostName 10.0.0.1");
    expect(text).toContain("User deploy");
  });

  it("未找到别名返回 false 且不写入", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-remove-"));
    await ensureSshConfig(home);
    const configPath = path.join(home, ".ssh", "config");
    const original = "Host other\n  HostName 1.1.1.1\n";
    await writeFile(configPath, original);
    await expect(removeSshConnection(home, "missing")).resolves.toBe(false);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("updateSshConnection", () => {
  it("替换 HostName/User/Port 并保留其他指令与块", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-update-"));
    await ensureSshConfig(home);
    const configPath = path.join(home, ".ssh", "config");
    await writeFile(
      configPath,
      "Host prod\n  HostName 1.1.1.1\n  User old\n  Port 22\n  ForwardAgent yes\n\nHost other\n  HostName 2.2.2.2\n",
    );
    await expect(
      updateSshConnection(home, "prod", {
        hostName: "10.0.0.1",
        user: "deploy",
        port: 2222,
      }),
    ).resolves.toBe(true);
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("HostName 10.0.0.1");
    expect(text).toContain("User deploy");
    expect(text).toContain("Port 2222");
    expect(text).toContain("ForwardAgent yes");
    expect(text).toContain("Host other");
    expect(text).not.toContain("1.1.1.1");
    expect(text).not.toContain("User old");
  });

  it("多别名块与缺失别名/非法输入", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = await mkdtemp(path.join(os.tmpdir(), "lime-ssh-update-"));
    await ensureSshConfig(home);
    const configPath = path.join(home, ".ssh", "config");
    await writeFile(configPath, "Host a b\n  HostName 1.1.1.1\n");
    await expect(
      updateSshConnection(home, "a", { hostName: "2.2.2.2" }),
    ).rejects.toThrow("多别名");
    await expect(
      updateSshConnection(home, "missing", { hostName: "2.2.2.2" }),
    ).resolves.toBe(false);
    await expect(
      updateSshConnection(home, "a", { hostName: "bad host" }),
    ).rejects.toThrow("主机名");
  });
});
