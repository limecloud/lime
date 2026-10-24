// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const generator = path.join(repository, "scripts/generate-protocol-types.mjs");
const protocol = "lime-rs/crates/app-server-protocol";
const output = "packages/app-server-client/src/generated/protocol-types.ts";
const expected = fs.readFileSync(path.join(repository, output));

function snapshot(filePath) {
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    bytes: fs.readFileSync(filePath),
    // 只读访问可能更新 atime；内容、文件身份和写入时间必须完全不变。
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs,
  };
}

describe("协议类型生成器的只读漂移检查", () => {
  let directory, canonical;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lime-protocol-check-"));
    canonical = path.join(directory, output);
    // 使用当前真实协议输入和已签入生成物，不复制转换器逻辑或伪造 formatter。
    fs.cpSync(
      path.join(repository, protocol, "schema/json"),
      path.join(directory, protocol, "schema/json"),
      { recursive: true },
    );
    for (const relative of [
      "src/protocol/v2/methods.rs",
      "src/protocol/v0/method_names.rs",
    ]) {
      const target = path.join(directory, protocol, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(repository, protocol, relative), target);
    }
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "protocol-generator-fixture", private: true }),
    );
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.writeFileSync(canonical, expected);
  });
  afterEach(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  const run = (args = ["--check"]) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [generator, ...args],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const exited = error && typeof error.code === "number";
          resolve({
            status: error ? (exited ? error.code : null) : 0,
            error: error && !exited ? error : undefined,
            stdout,
            stderr,
          });
        },
      );
    });
  const diagnostics = (result) => `${result.stdout}\n${result.stderr}`;

  it("检查成功不改 canonical 字节、mtime、ctime 或 inode", async () => {
    const before = snapshot(canonical);
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).toBe(0);
    expect(result.stdout).toContain("生成文件无漂移");
    expect(snapshot(canonical)).toEqual(before);
  });

  it("协议漂移失败仍不写 canonical 或改其文件状态", async () => {
    fs.appendFileSync(canonical, "\n// stale generated fixture\n");
    const before = snapshot(canonical);
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).toBe(1);
    expect(result.stderr).toContain("存在协议漂移");
    expect(snapshot(canonical)).toEqual(before);
  });

  it("真实 formatter 解析失败不留下未格式化内容或触碰 canonical", async () => {
    const bundlePath = path.join(
      directory,
      protocol,
      "schema/json/app_server_protocol.schemas.json",
    );
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    bundle.$defs.ProtocolFormatterFailure = {
      type: "object",
      properties: { "invalid-property-name": { type: "string" } },
    };
    fs.writeFileSync(bundlePath, JSON.stringify(bundle));
    const before = snapshot(canonical);
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).not.toBe(0);
    expect(result.stderr).toContain("协议类型格式化失败");
    expect(result.stderr).not.toContain("存在协议漂移");
    expect(snapshot(canonical)).toEqual(before);
  });

  it("缺少 canonical 时失败且不创建输出目录或文件", async () => {
    fs.rmSync(path.dirname(canonical), { recursive: true });
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).toBe(1);
    expect(result.stderr).toContain("生成文件不存在");
    expect(fs.existsSync(path.dirname(canonical))).toBe(false);
  });

  it("缺少协议输入时失败并保留 canonical 字节与文件状态", async () => {
    fs.unlinkSync(path.join(directory, protocol, "schema/json/manifest.json"));
    const before = snapshot(canonical);
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
    expect(snapshot(canonical)).toEqual(before);
  });

  it("正常生成仍输出与当前真实生成物逐字节相同的内容", async () => {
    fs.rmSync(path.dirname(canonical), { recursive: true });
    const result = await run([]);
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).toBe(0);
    expect(result.stdout).toContain("已写入");
    expect(fs.readFileSync(canonical)).toEqual(expected);
  });

  it("保留网站策略和嵌套字典的值类型及可空边界", async () => {
    const bundlePath = path.join(
      directory,
      protocol,
      "schema/json/app_server_protocol.schemas.json",
    );
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    bundle.$defs.ProtocolTypedMaps = {
      type: "object",
      properties: {
        labels: { type: "object", additionalProperties: { type: "string" } },
        nested: {
          type: "object",
          additionalProperties: {
            type: ["object", "null"],
            additionalProperties: { type: "boolean" },
          },
        },
      },
    };
    fs.writeFileSync(bundlePath, JSON.stringify(bundle));
    const result = await run([]);
    expect(result.error).toBeUndefined();
    expect(result.status, diagnostics(result)).toBe(0);
    const generated = fs.readFileSync(canonical, "utf8");
    expect(generated).toContain(
      "origins?: null | Record<string, BrowserUseOriginPolicyConfig>;",
    );
    expect(generated).toContain("labels?: Record<string, string>;");
    expect(generated).toContain(
      "nested?: Record<string, Record<string, boolean> | null>;",
    );
  });
});
