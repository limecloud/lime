#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function resolveR2Credentials(env, request = fetch) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/i.test(accountId || "") || !token) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required",
    );
  }
  for (const route of [
    `accounts/${accountId}/tokens/verify`,
    "user/tokens/verify",
  ]) {
    const response = await request(
      `https://api.cloudflare.com/client/v4/${route}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = await response.json();
    if (response.ok && result.success && result.result?.status === "active") {
      const accessKeyId = result.result.id;
      if (!/^[a-f0-9]{32}$/i.test(accessKeyId || "")) {
        throw new Error(
          "Cloudflare token verification returned an invalid token ID",
        );
      }
      return {
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        accessKeyId,
        secretAccessKey: createHash("sha256").update(token).digest("hex"),
      };
    }
  }
  throw new Error(
    "Cloudflare API token could not be verified for R2 S3 access",
  );
}

function runAws(args, env) {
  const result = spawnSync("aws", args, {
    env,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `AWS CLI failed: ${result.error?.message || result.stderr || result.status}`,
    );
  }
  return result.stdout;
}

async function digestFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function uploadUpdateFeedPlan(
  plan,
  credentials,
  { env = process.env, execute = runAws, report = console.log } = {},
) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error("R2 upload plan must contain assets");
  }
  const awsEnv = {
    ...env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_REGION: "auto",
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_PAGER: "",
    AWS_MAX_ATTEMPTS: "5",
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
  };
  delete awsEnv.AWS_SESSION_TOKEN;
  delete awsEnv.AWS_PROFILE;
  delete awsEnv.AWS_DEFAULT_PROFILE;
  execute(["--version"], awsEnv);
  const files = new Map();
  for (const item of plan) {
    if (!item.bucket || !item.key || !item.contentType || !item.cacheControl) {
      throw new Error("Invalid R2 upload plan entry");
    }
    if (!files.has(item.file)) {
      files.set(item.file, {
        size: fs.statSync(item.file).size,
        sha256: await digestFile(item.file),
      });
    }
  }
  const isFeed = (item) =>
    /^RELEASES(?:\.json)?$/.test(path.basename(item.file));
  const ordered = [
    ...plan.filter((item) => !isFeed(item)),
    ...plan.filter(isFeed),
  ];
  const verified = [];
  for (const item of ordered) {
    const source = files.get(item.file);
    const endpointArgs = ["--endpoint-url", credentials.endpoint];
    execute(
      [
        ...endpointArgs,
        "s3",
        "cp",
        item.file,
        `s3://${item.bucket}/${item.key}`,
        "--content-type",
        item.contentType,
        "--cache-control",
        item.cacheControl,
        "--metadata",
        `sha256=${source.sha256}`,
        "--no-progress",
        "--only-show-errors",
      ],
      awsEnv,
    );
    const remote = JSON.parse(
      execute(
        [
          ...endpointArgs,
          "s3api",
          "head-object",
          "--bucket",
          item.bucket,
          "--key",
          item.key,
          "--output",
          "json",
        ],
        awsEnv,
      ),
    );
    if (
      remote.ContentLength !== source.size ||
      remote.Metadata?.sha256 !== source.sha256 ||
      remote.ContentType !== item.contentType ||
      remote.CacheControl !== item.cacheControl
    ) {
      throw new Error(`R2 object verification failed: ${item.key}`);
    }
    verified.push({ key: item.key, size: source.size, sha256: source.sha256 });
    report(
      `Verified R2 object: ${item.key} (${source.size} bytes, sha256=${source.sha256})`,
    );
  }
  return verified;
}

async function main() {
  const planPath = process.argv[2];
  if (!planPath)
    throw new Error("Usage: upload-update-feed-r2.mjs <upload-plan.json>");
  const credentials = await resolveR2Credentials(process.env);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${credentials.accessKeyId}`);
    console.log(`::add-mask::${credentials.secretAccessKey}`);
  }
  const verified = await uploadUpdateFeedPlan(
    JSON.parse(fs.readFileSync(planPath, "utf8")),
    credentials,
  );
  console.log(
    `R2 updater publish complete: ${verified.length} verified objects`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { resolveR2Credentials, uploadUpdateFeedPlan };
