import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodexSettings } from "./codexSettingsImport";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("readCodexSettings", () => {
  it("reads approval, sandbox, and project keys", async () => {
    root = await mkdtemp(path.join(tmpdir(), "lime-codex-settings-"));
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(
      path.join(root, ".codex", "config.toml"),
      'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[projects."/repo/a"]\ntrust_level = "trusted"\n',
      "utf8",
    );
    await expect(readCodexSettings({ home: root })).resolves.toEqual({
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      projects: ["/repo/a"],
    });
  });

  it("returns null without a Codex config", async () => {
    root = await mkdtemp(path.join(tmpdir(), "lime-codex-missing-"));
    await expect(readCodexSettings({ home: root })).resolves.toBeNull();
  });
});
