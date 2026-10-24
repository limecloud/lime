import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseComposerDraftFixtureArgs,
  runComposerDraftGuiFixture,
} from "./lib/composer-draft-fixture-driver.mjs";
import { worktreeSubmissionScenario } from "./lib/composer-worktree-scenario.mjs";

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseComposerDraftFixtureArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Composer staged Worktree real Electron Gate B
--repo <original-repository> --run-id <fresh-id> --evidence-dir <directory>
--verification-packet <current-persisted-atom-packet.json>
Requires current renderer/Main/preload/App Server artifacts; never builds.
Real temporary Git checkout, GUI Send, native IPC/current JSON-RPC and rich
draft promotion; controlled external provider; two strict app.quit exits.`);
  } else {
    runComposerDraftGuiFixture(options, worktreeSubmissionScenario).then(
      ({ summaryPath }) =>
        console.log(`[composer-worktree-gate-b] pass evidence=${summaryPath}`),
      (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
    );
  }
}
