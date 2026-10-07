import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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
    const request = vi
      .fn()
      .mockResolvedValue({
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
    const request = vi
      .fn()
      .mockResolvedValue({
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
