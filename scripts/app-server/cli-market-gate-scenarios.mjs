import assert from "node:assert/strict";

export async function runMarketCliScenarios({
  scenario,
  marketArtifacts,
  until,
}) {
  await scenario(
    "market",
    async ({ cli, callbackFor, count, marketPosts, recoverMarket, publishNext, setAcquisitionStatus }) => {
      const run = async (args, label) => {
        const result = await cli(args, label).done;
        assert.equal(result.code, 0, `${label}: ${result.stderr}`);
        return JSON.parse(result.stdout);
      };
      const login = cli(["login", "--no-browser", "--json"], "default-login");
      await callbackFor(await login.url());
      assert.equal((await login.done).code, 0);
      const noMarket = await cli(
        ["login", "status", "--resource", "market"],
        "default-is-not-market",
      ).done;
      assert.equal(noMarket.code, 1);
      assert.equal(
        JSON.parse(noMarket.stdout).account.resources.some(
          (r) => r.resource === "market",
        ),
        false,
      );
      let authorization = cli(
        ["login", "--resource", "market", "--no-browser"],
        "market-login",
      );
      const url = await authorization.url();
      assert.equal(new URL(url).searchParams.get("resource"), "market");
      if (process.platform !== "win32") {
        authorization.child.kill("SIGINT");
        const interrupted = await authorization.done;
        assert.equal(interrupted.code, 130);
        assert(interrupted.stderr.includes("lime login --resource market"));
        authorization = cli(
          ["login", "--resource", "market", "--no-browser"],
          "market-resumed",
        );
        await until(
          () =>
            authorization.output.stderr.includes(
              "Waiting for the original sign-in",
            ),
          "market CLI did not resume original authorization",
        );
      }
      await callbackFor(url);
      assert.equal((await authorization.done).code, 0);
      const connected = await run(
        ["login", "status", "--resource", "market"],
        "market-status",
      );
      assert.equal(
        connected.account.resources.find((r) => r.resource === "market").status,
        "connected",
      );
      const page = await run(
        ["market", "list", "--kind", "skill", "--limit", "1"],
        "list",
      );
      assert.equal(page.resources[0].itemId, marketArtifacts[0].item.id);
      for (const artifact of marketArtifacts.slice(0, 3)) {
        const { id, kind, release } = artifact.item;
        const args = [id, "--kind", kind];
        const read = await run(
          ["market", "read", ...args],
          `${kind}-${id}-read`,
        );
        assert.equal(read.resource.release.id, release.id);
        const install = [
          "market",
          "install",
          ...args,
          "--release-id",
          release.id,
          "--manifest-sha256",
          release.manifestSha256,
          "--archive-sha256",
          release.archiveSha256,
        ];
        if (release.id.endsWith("stdio")) {
          const unknown = await cli(
            [...install, "--attempt-id", "cli-original-market-attempt"],
            "unknown-install",
          ).done;
          assert.equal(unknown.code, 1);
          const pending = await run(["market", "pending", "--kind", kind], "pending-original");
          assert.equal(pending.attempts[0].installAttemptId, "cli-original-market-attempt");
          assert.equal(pending.attempts[0].resource.release.id, release.id);
          const cancelled = await cli(["market", "cancel", ...args, "--attempt-id", "cli-original-market-attempt"], "cancel-unknown").done;
          assert.equal(cancelled.code, 1);
          assert(cancelled.stderr.includes("market_install_outcome_unknown"));
          publishNext(artifact.item);
          recoverMarket();
        }
        const installed = await run(
          [...(release.id.endsWith("stdio") ? ["market", "install", ...args] : install), "--attempt-id", "cli-new-market-click"],
          `${kind}-${id}-install`,
        );
        assert.equal(installed.resource.installation.release.id, release.id);
        assert.equal(
          (await run(["market", "disable", ...args], `${kind}-${id}-disable`))
            .resource.installation.enabled,
          false,
        );
        assert.equal(
          (await run(["market", "enable", ...args], `${kind}-${id}-enable`))
            .resource.installation.enabled,
          true,
        );
      }
      const cold = await run(["market", "installed"], "cold-installed");
      assert.equal(cold.resources.length, 3);
      assert.deepEqual(cold.errors, []);
      assert.deepEqual((await run(["market", "pending"], "no-pending")).attempts, []);
      setAcquisitionStatus(marketArtifacts[1].item.release.id, "revoked");
      setAcquisitionStatus(marketArtifacts[2].item.release.id, "unavailable");
      const checks = await run(["market", "reconcile"], "reconcile");
      assert.deepEqual(new Set(checks.resources.map(r => r.acquisitionStatus)), new Set(["active", "revoked", "unavailable"]));
      assert.equal(
        marketPosts.filter((p) => p.route.endsWith("/acquisitions")).length,
        3,
        "unknown acquisition must use GET recovery, never a second POST",
      );
      for (const artifact of marketArtifacts.slice(0, 3)) {
        await run(
          [
            "market",
            "uninstall",
            artifact.item.id,
            "--kind",
            artifact.item.kind,
          ],
          `uninstall-${artifact.item.id}`,
        );
      }
      assert.deepEqual(
        (await run(["market", "installed"], "uninstalled")).resources,
        [],
      );
      assert.equal(count("/auth/token"), 2);
    },
  );

  await scenario(
    "market-authorization-unknown",
    async ({ cli, callbackFor, count }) => {
      const login = cli(["login", "--no-browser"], "default-login");
      await callbackFor(await login.url());
      assert.equal((await login.done).code, 0);
      const market = cli(
        ["login", "--resource", "market", "--no-browser"],
        "unknown-market-login",
      );
      await callbackFor(await market.url());
      const unknown = await market.done;
      assert.equal(unknown.code, 1);
      assert(unknown.stderr.includes("lime login status --resource market"));
      const status = await cli(
        ["login", "status", "--resource", "market"],
        "market-status",
      ).done;
      assert.equal(status.code, 1);
      assert.equal(
        JSON.parse(status.stdout).authorizations.find(
          (a) => a.resource === "market",
        ).status,
        "outcome_unknown",
      );
      const again = await cli(
        ["login", "--resource", "market", "--no-browser"],
        "same-unknown-market",
      ).done;
      assert.equal(again.code, 1);
      assert(again.stderr.includes("lime login status --resource market"));
      assert.equal(
        (
          await cli(["login", "status", "--json"], "default-still-connected")
            .done
        ).code,
        0,
      );
      assert.equal(count("/auth/config"), 2);
      assert.equal(count("/auth/token"), 2);
    },
  );
}
