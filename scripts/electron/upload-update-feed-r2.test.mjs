import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import {
  resolveR2Credentials,
  uploadUpdateFeedPlan,
} from "./upload-update-feed-r2.mjs";

const accountId = "1".repeat(32);
const accessKeyId = "2".repeat(32);
const credentials = {
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  accessKeyId,
  secretAccessKey: "test-secret",
};

describe("updater recovery source gates", () => {
  it.each([
    {
      name: "matching source and successful builds",
      sha: "candidate",
      failed: false,
      expected: 0,
    },
    {
      name: "different tag commit",
      sha: "different",
      failed: false,
      expected: 1,
    },
    {
      name: "failed original build",
      sha: "candidate",
      failed: true,
      expected: 1,
    },
  ])(
    "executes the actual workflow shell: $name",
    ({ sha, failed, expected }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "updater-recovery-"));
      const names = [
        "Build Electron Windows-x64",
        "Build Electron macOS-arm64",
        "Build Electron macOS-x64",
        "Publish Electron release assets",
      ];
      const jobsFile = path.join(root, "jobs.json");
      const runFile = path.join(root, "run.json");
      fs.writeFileSync(
        jobsFile,
        JSON.stringify({
          jobs: names.map((name, index) => ({
            name,
            conclusion: failed && index === 0 ? "failure" : "success",
          })),
        }),
      );
      fs.writeFileSync(
        runFile,
        JSON.stringify({
          head_sha: sha,
          path: ".github/workflows/release.yml",
          repository: { full_name: "limecloud/lime" },
        }),
      );
      fs.writeFileSync(
        path.join(root, "gh"),
        '#!/bin/sh\ncase "$2" in\n  */jobs\\?*) cat "$RECOVERY_TEST_JOBS" ;;\n  *) cat "$RECOVERY_TEST_RUN" ;;\nesac\n',
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(root, "git"),
        '#!/bin/sh\nprintf "%s\\n" "$RECOVERY_TEST_TAG_SHA"\n',
        { mode: 0o755 },
      );
      const workflow = YAML.parse(
        fs.readFileSync(".github/workflows/publish-updater.yml", "utf8"),
      );
      const step = workflow.jobs.publish_updater.steps.find(
        (item) => item.name === "Validate original release identity and gates",
      );
      const result = spawnSync("bash", ["-e", "-o", "pipefail"], {
        input: step.run,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH}`,
          RUNNER_TEMP: root,
          GITHUB_REPOSITORY: "limecloud/lime",
          RELEASE_TAG: "v1.151.0",
          RELEASE_RUN_ID: "37610907191",
          RECOVERY_TEST_TAG_SHA: "candidate",
          RECOVERY_TEST_JOBS: jobsFile,
          RECOVERY_TEST_RUN: runFile,
        },
      });
      expect(result.status, result.stderr).toBe(expected);
    },
  );
});

function fixture({ large = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "updater-r2-"));
  const binary = path.join(root, "package.zip");
  fs.writeFileSync(binary, "payload");
  if (large) fs.truncateSync(binary, 301 * 1024 * 1024);
  const feed = path.join(root, "RELEASES.json");
  fs.writeFileSync(feed, "{}");
  const plan = [feed, binary].map((file) => ({
    file,
    bucket: "release-test",
    key: `stable/${path.basename(file)}`,
    contentType:
      file === feed ? "application/json" : "application/octet-stream",
    cacheControl:
      file === feed
        ? "public, max-age=60"
        : "public, max-age=31536000, immutable",
  }));
  const remote = new Map();
  const calls = [];
  const execute = (args, env) => {
    calls.push({ args, env });
    if (args.includes("cp")) {
      const entry = plan.find((item) =>
        args.includes(`s3://${item.bucket}/${item.key}`),
      );
      remote.set(entry.key, {
        ContentLength: fs.statSync(entry.file).size,
        ContentType: entry.contentType,
        CacheControl: entry.cacheControl,
        Metadata: {
          sha256: args[args.indexOf("--metadata") + 1].slice("sha256=".length),
        },
      });
      return "";
    }
    if (args.includes("head-object"))
      return JSON.stringify(remote.get(args[args.indexOf("--key") + 1]));
    return "aws-cli/2";
  };
  return { plan, calls, execute };
}

describe("R2 S3 credentials", () => {
  it("derives credentials from an active account token without creating a token", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { id: accessKeyId, status: "active" },
      }),
    });
    const result = await resolveR2Credentials(
      { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: "token-value" },
      request,
    );
    expect(result.secretAccessKey).toBe(
      createHash("sha256").update("token-value").digest("hex"),
    );
    expect(result.accessKeyId).toBe(accessKeyId);
    expect(request.mock.calls[0][0]).toContain(
      `/accounts/${accountId}/tokens/verify`,
    );
    expect(request.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer token-value",
    );
  });

  it("supports existing user tokens when account verification rejects the token", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: { id: accessKeyId, status: "active" },
        }),
      });
    expect(
      (
        await resolveR2Credentials(
          {
            CLOUDFLARE_ACCOUNT_ID: accountId,
            CLOUDFLARE_API_TOKEN: "user-token",
          },
          request,
        )
      ).accessKeyId,
    ).toBe(accessKeyId);
    expect(request.mock.calls[1][0]).toContain("/user/tokens/verify");
  });

  it("rejects inactive or unverified tokens", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { id: accessKeyId, status: "expired" },
      }),
    });
    await expect(
      resolveR2Credentials(
        {
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: "expired-token",
        },
        request,
      ),
    ).rejects.toThrow("could not be verified");
  });
});

describe("R2 verified publishing", () => {
  it("accepts payloads above 300 MiB through S3, verifies them, then publishes feed", async () => {
    const { plan, calls, execute } = fixture({ large: true });
    const verified = await uploadUpdateFeedPlan(plan, credentials, {
      execute,
      report: () => {},
    });
    expect(verified.map((item) => item.key)).toEqual([
      "stable/package.zip",
      "stable/RELEASES.json",
    ]);
    expect(verified[0].size).toBe(301 * 1024 * 1024);
    expect(calls.filter((call) => call.args.includes("cp"))).toHaveLength(2);
    expect(
      calls.filter((call) => call.args.includes("head-object")),
    ).toHaveLength(2);
    expect(calls[1].env.AWS_SECRET_ACCESS_KEY).toBe("test-secret");
    expect(calls[1].args).not.toContain("test-secret");
  });

  it("stops at a payload failure without advancing the feed", async () => {
    const { plan, calls, execute } = fixture();
    await expect(
      uploadUpdateFeedPlan(plan, credentials, {
        report: () => {},
        execute: (args, env) => {
          if (args.includes("cp")) throw new Error("upload failed");
          return execute(args, env);
        },
      }),
    ).rejects.toThrow("upload failed");
    expect(
      calls.some((call) =>
        call.args.some((arg) => arg.includes("RELEASES.json")),
      ),
    ).toBe(false);
  });

  it.each(["ContentLength", "ContentType", "CacheControl", "Metadata"])(
    "rejects mismatched remote %s before feed publishing",
    async (field) => {
      const { plan, calls, execute } = fixture();
      await expect(
        uploadUpdateFeedPlan(plan, credentials, {
          report: () => {},
          execute: (args, env) => {
            const output = execute(args, env);
            if (!args.includes("head-object")) return output;
            return JSON.stringify({
              ...JSON.parse(output),
              [field]: field === "Metadata" ? {} : "wrong",
            });
          },
        }),
      ).rejects.toThrow("R2 object verification failed");
      expect(
        calls.some((call) =>
          call.args.some((arg) => arg.includes("RELEASES.json")),
        ),
      ).toBe(false);
    },
  );
});
