import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  createEnvironmentAction,
  createLocalEnvironmentDraft,
  defaultEnvironmentConfigPath,
  effectiveEnvironmentScript,
  partitionLocalEnvironments,
  nextEnvironmentConfigPath,
  serializeLocalEnvironment,
  validateLocalEnvironmentDraft,
} from "./localEnvironments";

describe("local environment editor", () => {
  it("preserves multiline scripts, Windows paths and TOML delimiters", () => {
    const draft = createLocalEnvironmentDraft(null, ' App "one" ');
    draft.setupScript = "printf 'hello'\nprintf '\"\"\" and ''''\n";
    draft.setupPlatformScripts.win32 = "Write-Host C:\\repo\\新目录\r\n";
    draft.cleanupScript = "rm -f .worktree-cache";
    const action = createEnvironmentAction();
    draft.actions = [
      { ...action, name: " Test ", command: " npm test ", platform: "linux" },
    ];
    expect(parse(serializeLocalEnvironment(draft))).toEqual({
      version: 1,
      name: 'App "one"',
      setup: {
        script: draft.setupScript,
        win32: { script: draft.setupPlatformScripts.win32 },
      },
      cleanup: { script: draft.cleanupScript },
      actions: [
        { name: "Test", command: "npm test", platform: "linux", icon: "tool" },
      ],
    });
  });

  it("requires a name and complete actions while allowing empty draft rows", () => {
    const draft = createLocalEnvironmentDraft();
    const action = createEnvironmentAction();
    draft.actions.push(action);
    expect(validateLocalEnvironmentDraft(draft)).toEqual({
      missingName: true,
      incompleteActionIds: [],
    });
    expect(() => serializeLocalEnvironment(draft)).toThrow();
    draft.name = "App";
    expect(parse(serializeLocalEnvironment(draft))).toEqual({
      version: 1,
      name: "App",
      setup: { script: "" },
      actions: [],
    });
    action.command = "npm test";
    expect(validateLocalEnvironmentDraft(draft).incompleteActionIds).toEqual([
      action.id,
    ]);
    expect(() => serializeLocalEnvironment(draft)).toThrow();
  });

  it("keeps platform-only cleanup and falls back to the default script", () => {
    const draft = createLocalEnvironmentDraft(null, "App");
    draft.setupScript = "npm ci";
    draft.setupPlatformScripts.win32 = "npm.cmd ci";
    draft.cleanupPlatformScripts.darwin = "rm cache";
    expect(effectiveEnvironmentScript(draft, "setup", "linux")).toBe("npm ci");
    expect(effectiveEnvironmentScript(draft, "setup", "win32")).toBe(
      "npm.cmd ci",
    );
    expect(parse(serializeLocalEnvironment(draft)).cleanup).toEqual({
      script: "",
      darwin: { script: "rm cache" },
    });
  });

  it.each([
    ["/work/repo/", "/work/repo/.lime/environments/environment.toml"],
    [
      "C:\\work\\repo\\",
      "C:\\work\\repo\\.lime\\environments\\environment.toml",
    ],
    [
      "\\\\host\\share",
      "\\\\host\\share\\.lime\\environments\\environment.toml",
    ],
  ])("uses the reference directory under %s", (root, expected) => {
    expect(defaultEnvironmentConfigPath(root)).toBe(expected);
  });

  it.each([
    [
      "/work/repo/",
      "/work/repo/.lime/environments/local.toml",
      "/work/.lime/environments/shared.toml",
    ],
    [
      "C:\\Work\\Repo\\",
      "c:\\work\\repo\\.lime\\environments\\local.toml",
      "C:\\Work\\.lime\\environments\\shared.toml",
    ],
    [
      "\\\\host\\Share\\Repo",
      "\\\\HOST\\share\\repo\\.lime\\environments\\local.toml",
      "\\\\host\\share\\.lime\\environments\\shared.toml",
    ],
  ])("separates inherited environments for %s", (root, local, inherited) => {
    const entry = (configPath: string) => ({
      type: "success" as const,
      configPath,
      cwdRelativeToGitRoot: ".",
      environment: {
        version: 1,
        name: configPath,
        setup: { script: "" },
        actions: [],
      },
    });
    const entries = [entry(local), entry(inherited)];
    expect(partitionLocalEnvironments(entries, root)).toEqual({
      projectEnvironments: [entries[0]],
      inheritedEnvironments: [entries[1]],
    });
  });

  it("creates the first available environment filename without replacing another file", () => {
    const entry = (file: string) => ({
      type: "error" as const,
      configPath: `/repo/.lime/environments/${file}`,
      cwdRelativeToGitRoot: ".",
      error: { message: "invalid" },
    });
    expect(nextEnvironmentConfigPath([], "/repo")).toBe(
      defaultEnvironmentConfigPath("/repo"),
    );
    expect(
      nextEnvironmentConfigPath(
        [
          entry("environment.toml"),
          entry("environment-2.toml"),
          entry("environment-4.toml"),
        ],
        "/repo",
      ),
    ).toBe("/repo/.lime/environments/environment-3.toml");
  });
});
