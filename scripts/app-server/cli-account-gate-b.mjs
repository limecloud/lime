// Test-only: real CLI and App Server processes with a signed identity HTTP fixture.
import assert from "node:assert/strict";
import { runMarketCliScenarios } from "./cli-market-gate-scenarios.mjs";
import { spawn } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({ options: { output: { type: "string" } } });
const directory = path.resolve(
  repo,
  values.output ?? `.lime/qc/cli-account-${Date.now()}`,
);
await mkdir(directory, { recursive: true });
const artifact = await snapshotTerminalGateBinaries({
  cliBinaryPath: path.resolve(
    repo,
    process.env.LIME_CLI_BIN || "lime-rs/target/debug/lime",
  ),
  appServerBinaryPath: path.resolve(
    repo,
    process.env.APP_SERVER_BIN || "lime-rs/target/debug/app-server",
  ),
  directory: path.join(directory, "artifact"),
});
const runtimeEnv = terminalGateRuntimeEnvironment({
  appServerBinaryPath: artifact.appServerBinaryPath,
});
const key = await readFile(
  path.join(
    repo,
    "lime-rs/crates/app-server/src/account/testdata/signing-key.pem",
  ),
);
const keys = JSON.parse(
  await readFile(
    path.join(
      repo,
      "lime-rs/crates/app-server/src/account/testdata/signing-keys.json",
    ),
    "utf8",
  ),
);
const marketArtifacts = JSON.parse(
  await readFile(
    path.join(
      repo,
      "lime-rs/crates/app-server/src/market/testdata/cloud-market-runtime.json",
    ),
    "utf8",
  ),
);
const scopeFor = (resource) =>
  resource === "market"
    ? "openid ecosystem.catalog.read ecosystem.acquire"
    : "openid profile offline_access";
const audienceFor = (resource) => `urn:lime:api:app:sandbox:${resource}`;
const results = [];
const children = new Set();
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );
const stop = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const sha256 = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function until(predicate, message) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(10);
  }
  throw new Error(message);
}

function start(args, root, label) {
  const connection = [
    "--locale",
    "en-US",
    "--app-server",
    artifact.appServerBinaryPath,
    "--app-server-arg=--app-data-dir",
    `--app-server-arg=${path.join(root, "app")}`,
    "--app-server-arg=--data-dir",
    `--app-server-arg=${path.join(root, "agent")}`,
  ];
  const child = spawn(artifact.cliBinaryPath, [...connection, ...args], {
    cwd: repo,
    env: {
      ...runtimeEnv,
      LIME_CONFIG_PATH: path.join(root, "config.yaml"),
      LIME_HOME: path.join(root, "home"),
      LIME_CREDENTIALS_STORE: "file",
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const output = { stdout: "", stderr: "", ended: false };
  child.stdout.on("data", (data) => {
    output.stdout += data;
  });
  child.stderr.on("data", (data) => {
    output.stderr += data;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      output.ended = true;
      try {
        // No one-time code, verifier, token or signed token is written to evidence.
        const combined = `${output.stdout}\n${output.stderr}`;
        assert(
          !/access-cli|refresh-cli|one-time-cli|codeVerifier|"id_token"|"access_token"/u.test(
            combined,
          ),
        );
        await writeFile(path.join(root, `${label}.stdout.log`), output.stdout);
        await writeFile(path.join(root, `${label}.stderr.log`), output.stderr);
        resolve({ code, signal, ...output });
      } catch (error) {
        reject(error);
      }
    });
  });
  // A failed startup must also end URL/pending waits promptly.
  const url = () =>
    until(() => {
      const match = output.stderr.match(
        /^https?:\/\/[^\s]+\/api\/v1\/client\/auth\/authorize\?[^\s]+$/mu,
      );
      if (!match && output.ended)
        throw new Error(`CLI exited before sign-in URL: ${output.stderr}`);
      return match?.[0];
    }, "original authorization URL was not printed");
  return { child, output, done, url };
}

async function scenario(name, exercise) {
  const root = await mkdtemp(path.join(directory, `${name}-`));
  const reserve = createNetServer();
  const callback = `${await listen(reserve)}/oauth/callback`;
  await new Promise((resolve) => reserve.close(resolve));
  const calls = [],
    codes = new Map(),
    marketPosts = [],
    operations = new Map();
  const publications = new Map();
  const acquisitionStatuses = new Map();
  let recoverMarket = false,
    productRegistered = false;
  let origin, fixtureError;
  const server = createServer(async (req, res) => {
    try {
      const route = new URL(req.url, origin).pathname;
      calls.push(route);
      let raw = "";
      for await (const block of req) raw += block;
      const body = raw ? JSON.parse(raw) : null;
      const audience = audienceFor("default"),
        scope = scopeFor("default");
      if (route === "/api/v1/client/auth/config")
        return json(res, 200, {
          issuer: origin,
          applicationId: "app",
          clientId: "native",
          environment: "sandbox",
          redirectUris: [callback],
          audience,
          scope,
          resources: {
            market: {
              audience: audienceFor("market"),
              scope: scopeFor("market"),
            },
          },
        });
      if (route === "/api/v1/client/auth/keys") return json(res, 200, keys);
      if (route === "/api/v1/client/auth/token") {
        const authorization = codes.get(body.code);
        assert(
          authorization,
          "only the original one-time code may be submitted",
        );
        assert.equal(body.redirectUri, callback);
        assert.equal(
          createHash("sha256").update(body.codeVerifier).digest("base64url"),
          authorization.challenge,
        );
        codes.delete(body.code);
        if (
          name === "unknown" ||
          (name === "market-authorization-unknown" &&
            authorization.resource === "market")
        )
          return json(res, 502, { error: "unavailable" });
        const header = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "native-test-key", typ: "JWT" }),
        ).toString("base64url");
        const claims = Buffer.from(
          JSON.stringify({
            iss: origin,
            aud: "native",
            sub: "person-a",
            nonce: authorization.nonce,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url");
        const input = `${header}.${claims}`;
        return json(res, 200, {
          access_token:
            authorization.resource === "market"
              ? "access-cli-market"
              : "access-cli",
          refresh_token: "refresh-cli",
          token_type: "Bearer",
          expires_in: 3600,
          scope: scopeFor(authorization.resource),
          id_token: `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`,
        });
      }
      if (route === "/api/v1/client/account") {
        const resource =
          req.headers.authorization === "Bearer access-cli-market"
            ? "market"
            : "default";
        assert.equal(
          req.headers.authorization,
          resource === "market"
            ? "Bearer access-cli-market"
            : "Bearer access-cli",
        );
        return json(res, 200, {
          issuer: origin,
          applicationId: "app",
          clientId: "native",
          environment: "sandbox",
          audience: audienceFor(resource),
          user: {
            id: "person-a",
            displayName: "CLI test user",
            email: "",
            emailVerified: false,
          },
        });
      }
      if (
        name === "market" &&
        [
          "/api/v1/client/product-users",
          "/api/v1/client/product-users/self",
        ].includes(route)
      ) {
        assert.equal(req.headers.authorization, "Bearer access-cli");
        if (req.method === "POST") {
          assert.equal(route, "/api/v1/client/product-users");
          assert.deepEqual(body, {});
          productRegistered = true;
        }
        return json(
          res,
          productRegistered ? 200 : 404,
          productRegistered
            ? {
                id: "pusr_cli",
                status: "active",
                revision: 1,
                createdAt: "2026-11-13T00:00:00Z",
              }
            : { error: "product_user_not_found" },
        );
      }
      if (name === "market" && route.startsWith("/bundle/")) {
        assert.equal(
          req.headers.authorization,
          undefined,
          "download must not carry the account bearer",
        );
        const artifact = marketArtifacts.find(
          (a) => a.item.release.id === route.slice("/bundle/".length),
        );
        assert(artifact, "unknown archive");
        res.writeHead(200, { "content-type": "application/zip" });
        return res.end(Buffer.from(artifact.archiveHex, "hex"));
      }
      if (name === "market" && route.startsWith("/api/v1/client/market/")) {
        assert.equal(req.headers.authorization, "Bearer access-cli-market");
        if (req.method === "POST") marketPosts.push({ route, body });
        const prefix = "/api/v1/client/market";
        if (route === `${prefix}/items`) {
          const kind = new URL(req.url, origin).searchParams.get("kind");
          return json(res, 200, {
            items: marketArtifacts
              .map((a) => a.item)
              .filter((i) => i.kind === kind),
            nextCursor: "",
          });
        }
        if (route.startsWith(`${prefix}/items/`)) {
          const artifact = marketArtifacts.find(
            (a) => a.item.id === route.slice(`${prefix}/items/`.length),
          );
          assert(artifact);
          return json(res, 200, publications.get(artifact.item.id) ?? artifact.item);
        }
        if (route.startsWith(`${prefix}/releases/`)) {
          const artifact = marketArtifacts.find(
            (a) =>
              a.item.release.id === route.slice(`${prefix}/releases/`.length),
          );
          assert(artifact);
          return json(res, 200, artifact.item.release);
        }
        if (route.startsWith(`${prefix}/operations/`)) {
          const result = operations.get(
            route.slice(`${prefix}/operations/`.length),
          );
          return json(
            res,
            result && recoverMarket ? 200 : 404,
            result && recoverMarket ? result : { error: "not_found" },
          );
        }
        if (route === `${prefix}/acquisitions`) {
          assert.equal(body.expectedItemRevision, 1);
          const result = {
            id: `acq_${body.releaseId}`,
            releaseId: body.releaseId,
            status: "active",
            revision: 1,
          };
          assert.equal(typeof req.headers["idempotency-key"], "string");
          operations.set(req.headers["idempotency-key"], { command: "acquisition.create", resourceId: body.releaseId, result, createdAt: new Date().toISOString() });
          return json(
            res,
            body.releaseId.endsWith("stdio") && !recoverMarket ? 503 : 200,
            body.releaseId.endsWith("stdio") && !recoverMarket
              ? { error: "outcome_unknown" }
              : result,
          );
        }
        if (route.endsWith("/download-tickets")) {
          assert.equal(body.revision, 1);
          const id = route.slice(
            `${prefix}/acquisitions/acq_`.length,
            -"/download-tickets".length,
          );
          const artifact = marketArtifacts.find(
            (a) => a.item.release.id === id,
          );
          assert(artifact);
          return json(res, 200, {
            sha256: artifact.item.release.archiveSha256,
            size: artifact.item.release.archiveSize,
            download: {
              url: `${origin}/bundle/${id}`,
              method: "GET",
              headers: {},
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
          });
        }
        if (req.method === "GET" && route.startsWith(`${prefix}/acquisitions/acq_`)) {
          const releaseId = route.slice(`${prefix}/acquisitions/acq_`.length);
          assert(marketArtifacts.some(a => a.item.release.id === releaseId));
          const status = acquisitionStatuses.get(releaseId) ?? "active";
          return json(res, status === "unavailable" ? 503 : 200, status === "unavailable" ? { error: "unavailable" } : { id: `acq_${releaseId}`, releaseId, status, revision: status === "revoked" ? 2 : 1 });
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      fixtureError = String(error);
      json(res, 500, { error: "fixture_error" });
    }
  });
  origin = await listen(server);
  await writeFile(
    path.join(root, "config.yaml"),
    JSON.stringify({ cloud: { base_url: origin } }),
    { mode: 0o600 },
  );
  const count = (suffix) =>
    calls.filter((route) => route.endsWith(suffix)).length;
  const callbackFor = async (authUrl, denied = false) => {
    const url = new URL(authUrl);
    assert.equal(url.origin, origin);
    const resource = url.searchParams.get("resource") ?? "default";
    assert(["default", "market"].includes(resource));
    if (!name.startsWith("market")) assert.equal(resource, "default");
    assert.equal(url.searchParams.get("redirect_uri"), callback);
    const code = `one-time-cli-${codes.size}`;
    codes.set(code, {
      nonce: url.searchParams.get("nonce"),
      challenge: url.searchParams.get("code_challenge"),
      resource,
    });
    const target = new URL(callback);
    target.searchParams.set("state", url.searchParams.get("state"));
    target.searchParams.set(
      denied ? "error" : "code",
      denied ? "access_denied" : code,
    );
    assert.equal((await fetch(target)).status, 204);
  };
  const cli = (args, label) => start(args, root, label);
  try {
    await exercise({
      cli,
      callbackFor,
      count,
      marketPosts,
      recoverMarket: () => {
        recoverMarket = true;
      },
      publishNext: (item) => publications.set(item.id, { ...item, revision: item.revision + 1, publishedReleaseId: `${item.release.id}_next`, release: { ...item.release, id: `${item.release.id}_next` } }),
      setAcquisitionStatus: (releaseId, status) => acquisitionStatuses.set(releaseId, status),
    });
    assert(!fixtureError, fixtureError);
    assert.equal(count("/product-users"), name === "market" ? 1 : 0);
    if (name !== "market") assert.equal(count("/product-users/self"), 0);
    assert(
      calls.every(
        (route) =>
          route.startsWith("/api/v1/client/auth/") ||
          route === "/api/v1/client/account" ||
          (name === "market" &&
            (route.startsWith("/api/v1/client/market/") ||
              route.startsWith("/bundle/") ||
              route.startsWith("/api/v1/client/product-users"))),
      ),
    );
    results.push({
      name,
      status: "passed",
      calls: {
        config: count("/auth/config"),
        exchange: count("/auth/token"),
        productRegistration: count("/product-users"),
        marketWrites: marketPosts.length,
      },
      root,
    });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      error: String(error),
      fixtureError,
      root,
    });
    throw error;
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await stop(server);
  }
}

try {
  await runMarketCliScenarios({ scenario, marketArtifacts, until });
  await scenario("remote-refused", async ({ cli, count }) => {
    const result = await cli(
      ["--remote", "ws://127.0.0.1:1", "login", "--no-browser"],
      "remote-refused",
    ).done;
    assert.equal(result.code, 1);
    assert(result.stderr.includes("account_local_host_required"));
    assert.equal(count("/auth/config"), 0);
  });
  await scenario("localization", async ({ cli, count }) => {
    for (const [locale, label] of [
      ["zh-CN", "未登录"],
      ["zh-TW", "未登入"],
      ["en-US", "Signed out"],
      ["ja-JP", "未ログイン"],
      ["ko-KR", "로그아웃됨"],
    ]) {
      const result = await cli(["login", "status", "--locale", locale], locale)
        .done;
      assert.equal(result.code, 1);
      assert.equal(result.stdout.trim(), label);
    }
    assert.equal(count("/auth/config"), 0);
  });
  await scenario("success", async ({ cli, callbackFor, count }) => {
    const initial = await cli(["login", "status", "--json"], "signed-out").done;
    assert.equal(initial.code, 1);
    assert.equal(JSON.parse(initial.stdout).account, null);
    const login = cli(["login", "--no-browser"], "login");
    const url = await login.url();
    assert.equal(count("/auth/token"), 0);
    await callbackFor(url);
    assert.equal((await login.done).code, 0);
    const status = await cli(["login", "status", "--json"], "status").done;
    assert.equal(status.code, 0);
    assert.equal(JSON.parse(status.stdout).account.userId, "person-a");
    assert.equal(
      (await cli(["login", "--no-browser"], "already-signed-in").done).code,
      0,
    );
    assert.equal(count("/auth/config"), 1);
    assert.equal(count("/auth/token"), 1);
    assert.equal((await cli(["logout"], "logout").done).code, 0);
    assert.equal(
      (await cli(["login", "status", "--json"], "after-logout").done).code,
      1,
    );
  });
  await scenario("denied", async ({ cli, callbackFor, count }) => {
    const login = cli(["login", "--no-browser"], "denied");
    await callbackFor(await login.url(), true);
    const result = await login.done;
    assert.equal(result.code, 1);
    assert(result.stderr.includes("authorization_rejected"));
    assert.equal(count("/auth/token"), 0);
  });
  await scenario("unknown", async ({ cli, callbackFor, count }) => {
    const login = cli(["login", "--no-browser"], "unknown");
    await callbackFor(await login.url());
    assert.equal((await login.done).code, 1);
    const status = await cli(["login", "status", "--json"], "status").done;
    assert.equal(status.code, 1);
    assert.equal(
      JSON.parse(status.stdout).authorizations[0].status,
      "outcome_unknown",
    );
    const again = await cli(["login", "--no-browser"], "same-unknown").done;
    assert.equal(again.code, 1);
    assert(again.stderr.includes("lime login status"));
    assert.equal(count("/auth/config"), 1);
    assert.equal(count("/auth/token"), 1);
  });
  if (process.platform !== "win32") {
    await scenario("interrupt-resume", async ({ cli, callbackFor, count }) => {
      const first = cli(["login", "--no-browser"], "interrupted");
      const url = await first.url();
      first.child.kill("SIGINT");
      assert.equal((await first.done).code, 130);
      const pending = await cli(["login", "status", "--json"], "pending").done;
      assert.equal(pending.code, 1);
      assert.equal(
        JSON.parse(pending.stdout).authorizations[0].status,
        "pending",
      );
      const resumed = cli(["login", "--no-browser"], "resumed");
      await until(
        () =>
          resumed.output.stderr.includes("Waiting for the original sign-in"),
        "CLI did not resume original login",
      );
      await callbackFor(url);
      assert.equal((await resumed.done).code, 0);
      assert.equal(count("/auth/config"), 1);
      assert.equal(count("/auth/token"), 1);
    });
  }
  await scenario("logout-during-wait", async ({ cli, count }) => {
    const login = cli(["login", "--no-browser"], "pending-login");
    await login.url();
    assert.equal((await cli(["logout"], "logout").done).code, 0);
    assert.equal((await login.done).code, 1);
    assert.equal(count("/auth/token"), 0);
  });
  await scenario("concurrent-resume", async ({ cli, callbackFor, count }) => {
    const first = cli(["login", "--no-browser"], "first");
    const url = await first.url();
    const second = cli(["login", "--no-browser"], "second");
    await until(
      () => second.output.stderr.includes("Waiting for the original sign-in"),
      "second CLI did not join original login",
    );
    await callbackFor(url);
    assert.equal((await first.done).code, 0);
    assert.equal((await second.done).code, 0);
    assert.equal(count("/auth/config"), 1);
    assert.equal(count("/auth/token"), 1);
  });
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGTERM");
  const summary = {
    createdAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    boundary:
      "Real lime CLI and App Server stdio; signed identity HTTP fixture; no Electron, actual browser, Cloud/Core public Client or model request.",
    artifacts: {
      cliSha256: await sha256(artifact.cliBinaryPath),
      appServerSha256: await sha256(artifact.appServerBinaryPath),
    },
    notRun:
      process.platform === "win32" ? ["Unix SIGINT interrupt-resume"] : [],
    results,
  };
  await writeFile(
    path.join(directory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      output: directory,
      results: results.map(({ name, status }) => ({ name, status })),
    }),
  );
}
