import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseLinuxGuestBuildArgs } from "./linux-guest-build.mjs";

const output = path.resolve("new guest output");

test("manual builds default to dev and explicitly select release", () => {
  assert.deepEqual(parseLinuxGuestBuildArgs(["--out", output]), {
    output,
    profileName: "dev",
    downloadUrl: undefined,
  });
  assert.deepEqual(
    parseLinuxGuestBuildArgs([
      "--profile",
      "release",
      "--download-url",
      "https://assets.example.com/guest.tar.gz",
      "--out",
      output,
    ]),
    {
      output,
      profileName: "release",
      downloadUrl: "https://assets.example.com/guest.tar.gz",
    },
  );
});

test("invalid, duplicate and incomplete build options cannot silently fall back to dev", () => {
  for (const args of [
    [],
    ["--out"],
    ["--out", "relative"],
    ["--out", output, "--profile", "debug"],
    ["--out", output, "--profile", "release", "--profile", "dev"],
    ["--out", output, "--unknown", "value"],
    ["--out", output, "--download-url"],
    ["--out", output, "--profile", ""],
    ["--out", output, "--profile", "--release"],
  ])
    assert.throws(() => parseLinuxGuestBuildArgs(args));
});
