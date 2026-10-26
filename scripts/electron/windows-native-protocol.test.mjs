import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";

it("严格解析 Windows helper 协议并通过真实 stdio 取消阻塞调度", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lime-native-protocol-"));
  try {
    const source = path.resolve(
      "electron/native/windows/tests/windows-native-protocol-test.cpp",
    );
    const output = path.join(
      directory,
      process.platform === "win32" ? "protocol-test.exe" : "protocol-test",
    );
    const compiler =
      process.env.CXX || (process.platform === "win32" ? "cl" : "clang++");
    const msvc = /(?:^|[\\/])(?:cl|clang-cl)(?:\.exe)?$/iu.test(compiler);
    const args = msvc
      ? [
          "/nologo",
          "/std:c++17",
          "/EHsc",
          "/W4",
          "/utf-8",
          source,
          `/Fe:${output}`,
          `/Fo:${directory}${path.sep}`,
        ]
      : [
          "-std=c++17",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-pthread",
          source,
          "-o",
          output,
        ];
    const compiled = spawnSync(compiler, args, {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(compiled.error, compiled.stderr).toBeUndefined();
    expect(compiled.status, `${compiled.stdout}\n${compiled.stderr}`).toBe(0);
    const result = spawnSync(output, [], { encoding: "utf8", timeout: 10_000 });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("RESULT passed=16 failed=0");
    const child = spawn(output, ["--serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const transcript = [];
    let started = 0;
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
      child.stdin.write(
        `${JSON.stringify({ id: "active", method: "computerUse.execute", params: {} })}\n`,
      );
      for await (const line of lines) {
        const response = JSON.parse(line);
        transcript.push(response);
        if (response.event === "started") {
          if (++started === 1) {
            // These requests must keep their old enqueue epoch after cancel.
            for (const [id, method] of [
              ["queued-setup", "computerUse.setup"],
              ["queued-execute", "computerUse.execute"],
              ["cancel", "computerUse.cancel"],
            ])
              child.stdin.write(
                `${JSON.stringify({ id, method, params: {} })}\n`,
              );
          } else child.stdin.end();
        } else if (response.id === "active") {
          expect(response.outcome).toBe("canceled");
        } else if (["queued-setup", "queued-execute"].includes(response.id)) {
          expect(response.error).toBe("canceled");
          // New work after cancel belongs to the new epoch.
          if (response.id === "queued-execute")
            child.stdin.write(
              `${JSON.stringify({ id: "fresh", method: "windows.window.read", params: {} })}\n`,
            );
        } else if (response.id === "fresh") {
          expect(response.outcome).toBe("observed");
          child.stdin.write(
            `${JSON.stringify({ id: "eof-action", method: "computerUse.execute", params: {} })}\n`,
          );
        } else if (response.id === "eof-action") {
          expect(response.outcome).toBe("canceled");
        } else throw new Error(`Unexpected helper response: ${line}`);
      }
      expect(await closed).toBe(0);
      expect(transcript).toEqual([
        { event: "started" },
        { id: "active", outcome: "canceled" },
        { id: "queued-setup", error: "canceled" },
        { id: "queued-execute", error: "canceled" },
        { id: "fresh", outcome: "observed" },
        { event: "started" },
        { id: "eof-action", outcome: "canceled" },
      ]);
    } finally {
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) child.kill();
      await closed;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
