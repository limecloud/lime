import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { withElectronFixtureSystemPath } from "./electron-fixture-runtime-env.mjs";

describe("electron fixture runtime env", () => {
  it("应复用 native executable PATH owner", () => {
    expect(
      withElectronFixtureSystemPath(
        { PATH: "/usr/local/bin:/usr/bin" },
        {
          platform: "darwin",
          arch: "arm64",
          delimiter: ":",
        },
      ).PATH,
    ).toBe("/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin");
    expect(
      withElectronFixtureSystemPath(
        { PATH: "/custom/bin:/usr/local/bin" },
        {
          platform: "linux",
          arch: "arm64",
          delimiter: ":",
        },
      ).PATH,
    ).toBe("/custom/bin:/usr/local/bin");
  });

  it("不修改调用方 env", () => {
    const env = { PATH: "/usr/local/bin:/usr/bin" };
    withElectronFixtureSystemPath(env, {
      platform: "darwin",
      arch: "arm64",
      delimiter: ":",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("三条 current Gate B fixture 应共享同一 PATH owner", () => {
    const fixtureSources = [
      "scripts/lib/chat-fixture/backend-file.mjs",
      "scripts/electron/session-history-fixture-smoke.mjs",
      "scripts/electron/code-artifact-workbench-fixture-smoke.mjs",
    ].map((filePath) => fs.readFileSync(filePath, "utf8"));

    for (const source of fixtureSources) {
      expect(source).toContain("withElectronFixtureSystemPath");
    }
  });
});
