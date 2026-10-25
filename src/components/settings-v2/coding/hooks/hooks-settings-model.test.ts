import { expect, it } from "vitest";
import type { HookMetadata, HooksListEntry } from "@/lib/api/hooks";
import {
  hookSourceEntries,
  hooksByEvent,
  needsHookReview,
} from "./hooks-settings-model";

const hook = (
  key: string,
  source: HookMetadata["source"] = "user",
  extra = {},
): HookMetadata => ({
  key,
  source,
  sourcePath: "/config.toml",
  eventName: "preToolUse",
  handlerType: "command",
  command: "echo test",
  displayOrder: 0,
  enabled: true,
  isManaged: false,
  currentHash: "hash",
  timeoutSec: 30,
  trustStatus: "trusted",
  ...extra,
});
const entry = (
  cwd: string,
  hooks: HookMetadata[],
  warnings: string[] = [],
): HooksListEntry => ({ cwd, hooks, warnings, errors: [] });

it("keeps first cross-project keys, project identity, ordered plugins and unique issues", () => {
  const data = [
    entry(
      "/work/a",
      [
        hook("user"),
        hook("p", "plugin", { pluginId: "z@market" }),
        hook("project", "project"),
        hook("admin", "cloudRequirements"),
      ],
      ["warning"],
    ),
    entry(
      "/work/b",
      [
        hook("user", "user", { enabled: false }),
        hook("p", "plugin", { pluginId: "z@market" }),
        hook("p2", "plugin", { pluginId: "a@market" }),
        hook("project", "project"),
      ],
      ["warning"],
    ),
    {
      ...entry("/empty", [], ["empty warning"]),
      errors: [
        { path: "/bad.toml", message: "parse error" },
        { path: "/bad.toml", message: "parse error" },
      ],
    },
  ];
  const result = hookSourceEntries(data);
  expect(result.map(({ source }) => source)).toEqual([
    "user",
    "admin",
    "plugin",
    "plugin",
    "project",
    "project",
    "unknown",
  ]);
  expect(result[0].hooks).toHaveLength(1);
  expect(result[0].hooks[0].enabled).toBe(true);
  expect(result[0].warnings).toEqual(["warning"]);
  expect(
    result.filter(({ source }) => source === "project").map(({ cwd }) => cwd),
  ).toEqual(["/work/a", "/work/b"]);
  expect(
    result
      .filter(({ source }) => source === "plugin")
      .map(({ pluginId }) => pluginId),
  ).toEqual(["a@market", "z@market"]);
  expect(result.at(-1)?.errors).toEqual([
    { path: "/bad.toml", message: "parse error" },
  ]);
});

it("reviews new and modified hooks without treating trusted or managed hooks as pending", () => {
  for (const trustStatus of ["untrusted", "modified"] as const)
    expect(needsHookReview(hook("review", "user", { trustStatus }))).toBe(true);
  for (const trustStatus of ["trusted", "managed"] as const)
    expect(needsHookReview(hook("done", "user", { trustStatus }))).toBe(false);
});

it("retains event order and sorts only that event's handlers", () => {
  const hooks = [
    hook("later", "user", { displayOrder: 4 }),
    hook("other", "user", { eventName: "stop" }),
    hook("first", "user", { displayOrder: 1 }),
  ];
  expect(
    hooksByEvent(hooks).map(({ eventName, hooks }) => [
      eventName,
      hooks.map(({ key }) => key),
    ]),
  ).toEqual([
    ["preToolUse", ["first", "later"]],
    ["stop", ["other"]],
  ]);
  expect(hooks.map(({ key }) => key)).toEqual(["later", "other", "first"]);
});

it("keeps plugin hooks without an optional plugin id visible", () => {
  const entries = hookSourceEntries([
    entry("/work/a", [hook("unknown-plugin", "plugin")]),
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0].pluginId).toBeNull();
  expect(entries[0].hooks[0].key).toBe("unknown-plugin");
});
