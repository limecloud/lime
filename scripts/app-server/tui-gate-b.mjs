#!/usr/bin/env node

import { deepStrictEqual } from "node:assert";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { localAppServerBinaryPath } from "../lib/electron-dev-sidecar.mjs";
import {
  buildTerminalGateBinaries,
  snapshotTerminalGateBinaries,
} from "./terminal-gate-binaries.mjs";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";
import { runRawReasoningGateB } from "./reasoning-gate-b.mjs";
import { runMcpElicitationFixture } from "./mcp-elicitation-gate-b.mjs";
import { runTerminalResizeGateB } from "./terminal-resize-gate-b.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const cliBinaryName = process.platform === "win32" ? "lime.exe" : "lime";
const defaultCliBinaryPath = path.join(
  rootDir,
  "lime-rs",
  "target",
  "debug",
  cliBinaryName,
);
const prompt = "tui gate b prompt";
const largePastePrompt = `PTY_LARGE_PASTE_BODY\n${"界🙂".repeat(501)}\nPTY_LARGE_PASTE_END`;
const imagePrompt = "PTY_IMAGE_EDIT [Image #1] literal [Image #2]";
const skillPrompt = "PTY_SKILL $gate-skill-09";
const notesAnswer = [
  "PTY_NOTE_ANSWER",
  "/model\t@parser $gate-skill",
  "界🙂".repeat(501),
].join("\n");
const followupAnswer = "PTY_FOLLOWUP_ANSWER";
const scenarioPrompt = (scenario) =>
  scenario === "large-paste"
    ? largePastePrompt
    : scenario === "images"
      ? imagePrompt
      : scenario === "skills"
        ? skillPrompt
        : scenario === "init-command"
          ? "/init"
          : scenario === "review-command"
            ? "/review focus on runtime errors"
            : prompt;
const queuePrompt = "queued follow-up for editing";
const fileChangePatch = [
  "*** Begin Patch",
  "*** Add File: gate/fixture-approved.rs",
  "+fn approved() {}",
  "*** Update File: gate/existing.rs",
  "*** Move to: gate/moved.rs",
  "@@",
  "-old",
  "+new",
  "*** End Patch",
].join("\n");
const completedText = "TUI_GATE_B_COMPLETED";
const reasoningText = "TUI_GATE_B_REASONING_DETAIL";
const rawText = "TUI_GATE_B_RAW_SOURCE";
const copyModeCompletedText = [
  "```rust",
  'let PTY_COPY_CODE = "中文😀";',
  "```",
  "",
  "> **PTY_COPY_QUOTE**",
  "",
  "```md",
  "| Name | Value |",
  "| --- | --- |",
  "| **PTY_COPY_TABLE** | exact |",
  "```",
  completedText,
].join("\n");
const scrollableCompletedText = [
  ...Array.from(
    { length: 40 },
    (_, index) => `TUI_EDGE_ROW_${String(index).padStart(2, "0")}`,
  ),
  `**${rawText}**`,
  completedText,
].join("\n");
const selectedScenarios = (
  process.env.LIME_TUI_GATE_B_SCENARIOS ||
  "complete,approval,file-change-approval,permissions-approval,init-command,config-command,hooks-command,effort-picker,permissions-picker,skills-command,keymap-command,memory-command,memory-reset-command,usage-command,stop-command,warnings-command,diff-command,cd-command,plugins-command,plugins-search-command,ps-command,recap-command,side-command,mention-command,goal-command,memories-command,review-command,review-picker,review-branch,review-commit,experimental-command,quit-command,clear-command,new-command,rename-command,compact-command,archive-command,delete-command,fork-command,user-input,interrupt,failure,queue-edit,agents-overview,agents-command,large-paste,diff-display,images,skills,copy-mode"
)
  .split(",")
  .map((scenario) => scenario.trim())
  .filter(Boolean);
const scenarios = selectedScenarios.filter(
  (scenario) =>
    !["reasoning-raw", "mcp-stdio", "mcp-elicitation"].includes(scenario),
);

async function main() {
  await buildTerminalGateBinaries({ env: process.env, repoRoot: rootDir });
  let cliBinaryPath = path.resolve(
    process.env.LIME_CLI_BIN || defaultCliBinaryPath,
  );
  let appServerBinaryPath = path.resolve(
    process.env.APP_SERVER_BIN ||
      localAppServerBinaryPath({ repoRoot: rootDir }),
  );
  await Promise.all([
    assertBinaryExists(cliBinaryPath, "lime"),
    assertBinaryExists(appServerBinaryPath, "app-server"),
  ]);
  const tempDir = await mkdtemp(path.join(tmpdir(), "tui-gate-b-"));
  let failed = false;
  try {
    ({ cliBinaryPath, appServerBinaryPath } =
      await snapshotTerminalGateBinaries({
        env: process.env,
        cliBinaryPath,
        appServerBinaryPath,
        directory: path.join(tempDir, "binaries"),
      }));
    // Compile before timing PTY scenarios so Cargo lock waits cannot consume interaction deadlines.
    await execFileAsync(
      process.env.CARGO || "cargo",
      [
        "test",
        "--manifest-path",
        path.join(rootDir, "lime-rs", "Cargo.toml"),
        "-p",
        "tui",
        "--no-run",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 2 * 1024 * 1024,
      },
    );

    if (
      selectedScenarios.includes("mcp-stdio") ||
      selectedScenarios.includes("mcp-elicitation")
    ) {
      await runMcpElicitationFixture({
        repoRoot: rootDir,
        cliBinaryPath,
        appServerBinaryPath,
        pty: selectedScenarios.includes("mcp-elicitation"),
      });
    }
    if (selectedScenarios.includes("reasoning-raw")) {
      await runRawReasoningGateB({
        repoRoot: rootDir,
        cliBinaryPath,
        appServerBinaryPath,
      });
    }
    if (scenarios.length === 0) return;

    const backendPath = path.join(tempDir, "tui-backend.mjs");
    const retryTimeoutMs = Number(
      process.env.LIME_TUI_GATE_RETRY_TIMEOUT_MS ?? 1_800_000,
    );
    let ledgerPath = path.join(tempDir, "tui-backend.jsonl");
    const permissionConfigPath = path.join(tempDir, "permission-profile.yaml");
    const editorConfigPath = path.join(tempDir, "editor-keymap.yaml");
    const configLines = [
      "default_permissions: named-fixture",
      "permissions:",
      "  named-fixture:",
      "    extends: ':workspace'",
      "    description: TUI Gate B named permission profile",
      "tui:",
      "  keymap:",
      "    global:",
      "      find_transcript: ctrl-x f",
      "      open_agents: ctrl-n",
      "    list:",
      "      accept: f9",
      "      cancel: ctrl-x q",
      "      page_down: [page-down, ctrl-d]",
      "      page_up: [page-up, ctrl-u]",
      "    editor:",
      "      move_down: down",
      "      move_word_left: [alt-b, alt-left, ctrl-left, f10]",
      "      insert_newline: [ctrl-j, ctrl-m, enter, shift-enter, alt-enter, f11]",
      "      kill_whole_line: ctrl-q k",
      "",
    ];
    await writeFile(permissionConfigPath, configLines.join("\n"));
    await writeFile(
      editorConfigPath,
      [
        ...configLines.slice(0, -1),
        "      delete_forward: []",
        "    vim_normal:",
        "      start_delete_operator: [d, 'z d']",
        "      delete_char: f12",
        "      undo: [u, 'z u']",
        "      redo: [ctrl-r, 'z r']",
        "      repeat_last_change: ['.', 'z .']",
        "    vim_operator:",
        "      motion_word_forward: [w, 'z w']",
        "    vim_text_object:",
        "      word: [w, f12]",
        "    vim_search:",
        "      forward: ['/', 'z /']",
        "",
      ].join("\n"),
    );
    const scenarioDirs = new Map();
    let typedInputEvidence = null;
    let backtrackEvidence = null;
    let backtrackStdioEvidence = null;
    let threadInputEvidence = null;
    const reviewCommitShas = new Map();
    for (const scenario of scenarios) {
      const scenarioDir = path.join(tempDir, scenario);
      await mkdir(scenarioDir, { recursive: true });
      scenarioDirs.set(scenario, scenarioDir);
      if (
        scenario === "complete" ||
        scenario === "skills" ||
        scenario === "skills-command"
      ) {
        const suggestionDir = path.join(
          scenarioDir,
          "long_directory_for_filename_identity_".repeat(3),
        );
        await mkdir(suggestionDir, { recursive: true });
        for (const name of ["parser_alpha.rs", "parser_beta.rs"]) {
          await writeFile(
            path.join(suggestionDir, name),
            "// PTY search fixture\n",
          );
        }
        for (let index = 0; index < 10; index += 1) {
          const name = `gate-skill-${String(index).padStart(2, "0")}`;
          const skillDir = path.join(scenarioDir, ".agents", "skills", name);
          await mkdir(skillDir, { recursive: true });
          await writeFile(
            path.join(skillDir, "SKILL.md"),
            `---\nname: ${name}\ndescription: PTY completion fixture\n---\nTest-only skill.\n`,
          );
        }
      }
      let reviewCommitSha = null;
      if (scenario === "review-branch" || scenario === "review-commit") {
        await execFileAsync("git", ["-C", scenarioDir, "init", "-b", "main"], {
          encoding: "utf8",
        });
        await execFileAsync(
          "git",
          ["-C", scenarioDir, "config", "user.email", "gate@example.com"],
          { encoding: "utf8" },
        );
        await execFileAsync(
          "git",
          ["-C", scenarioDir, "config", "user.name", "Gate Fixture"],
          { encoding: "utf8" },
        );
        await writeFile(
          path.join(scenarioDir, "review-fixture.txt"),
          "review fixture\n",
        );
        await execFileAsync("git", ["-C", scenarioDir, "add", "."], {
          encoding: "utf8",
        });
        await execFileAsync(
          "git",
          ["-C", scenarioDir, "commit", "-m", "review fixture"],
          { encoding: "utf8" },
        );
        const head = await execFileAsync(
          "git",
          ["-C", scenarioDir, "rev-parse", "HEAD"],
          { encoding: "utf8" },
        );
        reviewCommitSha = head.stdout.trim();
        reviewCommitShas.set(scenario, reviewCommitSha);
      }

      const backendOptions = {
        completedText:
          scenario === "complete"
            ? scrollableCompletedText
            : scenario === "copy-mode"
              ? copyModeCompletedText
              : completedText,
        command: "printf tui-gate-b",
        reasoningText,
        ...(scenario === "complete"
          ? {
              reasoningParts: [
                "**PTY_EMPTY_STATUS**\n\n<!-- -->",
                `**PTY_BODY_HEADER**\n\n${reasoningText}`,
                "PTY_SECOND_PARAGRAPH use `<!-- -->`.",
                "**PTY_EMPTY_TAIL**\n<!-- -->",
              ],
              reasoningContent: ["PTY_RAW_REASONING_MUST_STAY_HIDDEN"],
            }
          : {}),
        scenario,
        fileChangePatch:
          scenario === "file-change-approval" ? fileChangePatch : null,
        taskProgress: scenario === "complete",
        tokenUsage: scenario === "complete",
        followupQuestion: scenario === "user-input",
      };
      await writeTerminalExternalBackend(backendPath, backendOptions);

      const testOptions = {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          LIME_TEST_TUI_GATE_B: "1",
          LIME_TEST_TERMINAL_SCENARIO: scenario,
          LIME_TEST_CLI_BIN: cliBinaryPath,
          LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
          LIME_TEST_TERMINAL_BACKEND: backendPath,
          LIME_TEST_TERMINAL_LEDGER: ledgerPath,
          LIME_TEST_TERMINAL_CWD: scenarioDir,
          LIME_TEST_NODE_BIN: process.execPath,
          LIME_TEST_TERMINAL_PROMPT: scenarioPrompt(scenario),
          LIME_TEST_TERMINAL_QUEUE_PROMPT: queuePrompt,
          LIME_TEST_TERMINAL_NOTES_ANSWER: notesAnswer,
          LIME_TEST_TERMINAL_FOLLOWUP_ANSWER: followupAnswer,
          LIME_TEST_TERMINAL_COMPLETED_TEXT: completedText,
          LIME_TEST_TERMINAL_REASONING_TEXT: reasoningText,
          LIME_TEST_TERMINAL_RAW_TEXT: rawText,
          LIME_CONFIG_PATH:
            scenario === "complete" ? editorConfigPath : permissionConfigPath,
          LIME_TEST_PERMISSION_CONFIG:
            scenario === "complete" ? editorConfigPath : permissionConfigPath,
          LIME_TEST_PERMISSION_PROFILE: "named-fixture",
          LIME_TEST_REVIEW_COMMIT: reviewCommitSha ?? "",
        },
        maxBuffer: 2 * 1024 * 1024,
        // Complete exercises the full editor/history/status/title flow; predicates stay bounded.
        timeout:
          scenario === "complete"
            ? 180_000
            : scenario === "recap-command"
              ? 120_000
              : 60_000,
        windowsHide: true,
      };
      const cargoArgs = [
        "test",
        "--manifest-path",
        path.join(rootDir, "lime-rs", "Cargo.toml"),
        "-p",
        "tui",
        "runtime::pty_tests::real_pty_restores_terminal_after_visible_turn_completion",
        "--",
        "--exact",
        "--nocapture",
      ];
      let ptyEvidence;
      for (let attempt = 1; ; attempt += 1) {
        // A retried attempt must not inherit the failed attempt's ledger or cwd: stale turn
        // rows would break the scenario's own assertions. Keep the shared options untouched so
        // later scenarios keep writing the primary ledger.
        const retryLedgerPath = `${ledgerPath}.retry${attempt}`;
        // Keep the scenario directory basename stable: terminal-title and prompt facts derive
        // from the cwd name, and a suffixed directory would change those canonical assertions.
        const retryCwd = path.join(
          path.dirname(scenarioDir),
          `.retry${attempt}`,
          path.basename(scenarioDir),
        );
        if (attempt > 1) {
          await mkdir(retryCwd, { recursive: true });
        }
        const attemptEnv =
          attempt === 1
            ? testOptions.env
            : {
                ...testOptions.env,
                LIME_TEST_TERMINAL_LEDGER: retryLedgerPath,
                LIME_TEST_TERMINAL_CWD: retryCwd,
              };
        try {
          ptyEvidence = await execFileAsync(
            process.env.CARGO || "cargo",
            cargoArgs,
            {
              ...testOptions,
              env: attemptEnv,
              // A contended artifact lock needs a longer budget than the scenario itself.
              timeout:
                attempt === 1
                  ? testOptions.timeout
                  : Math.max(testOptions.timeout ?? 0, retryTimeoutMs),
            },
          );
          if (attempt > 1 && existsSync(retryLedgerPath)) {
            appendFileSync(ledgerPath, readFileSync(retryLedgerPath));
          }
          break;
        } catch (error) {
          const text = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
          const lockBusy =
            /Blocking waiting for file lock/u.test(text) ||
            /TUI_GATE_COMMAND_TIMEOUT/u.test(text);
          if (attempt >= 2 || !lockBusy) {
            throw error;
          }
          console.warn(
            `[smoke:tui-gate-b] artifact lock busy; retrying ${scenario} (${attempt}/2)`,
          );
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
      if (scenario === "approval") {
        const marker = "TUI_EXEC_APPROVAL_REASON_OK label=localized";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`approval PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "new-command") {
        const marker = "TUI_NEW_COMMAND_OK thread=changed";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`new-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "rename-command") {
        const marker = "TUI_RENAME_COMMAND_OK name=Gate Renamed";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`rename-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "fork-command") {
        const marker = "TUI_FORK_COMMAND_OK thread=forked turn=new";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`fork-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "delete-command") {
        const marker = "TUI_DELETE_COMMAND_OK thread=deleted turn=new";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`delete-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "archive-command") {
        const marker = "TUI_ARCHIVE_COMMAND_OK thread=archived turn=new";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`archive-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "compact-command") {
        const marker = "TUI_COMPACT_COMMAND_OK";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`compact-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "memories-command") {
        const marker = "TUI_MEMORIES_COMMAND_OK mode=off";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`memories-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "goal-command") {
        const marker = "TUI_GOAL_COMMAND_OK goal=none";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`goal-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "mention-command") {
        const marker = "TUI_MENTION_COMMAND_OK composer=at";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`mention-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "side-command") {
        const marker = "TUI_SIDE_COMMAND_OK panel=side";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`side-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "recap-command") {
        const marker = "TUI_RECAP_COMMAND_OK panel=recap";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`recap-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "ps-command") {
        const marker = "TUI_PS_COMMAND_OK panel=ps";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`ps-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "plugins-search-command") {
        const marker = "TUI_PLUGINS_SEARCH_OK panel=search";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`plugins-search-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "plugins-command") {
        const marker = "TUI_PLUGINS_COMMAND_OK panel=plugins";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`plugins-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "cd-command") {
        const marker = "TUI_CD_COMMAND_OK status=reported";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`cd-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "diff-command") {
        const marker = "TUI_DIFF_COMMAND_OK panel=diff repo=none";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`diff-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "warnings-command") {
        const marker = "TUI_WARNINGS_COMMAND_OK panel=warnings";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`warnings-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "usage-command") {
        const marker = "TUI_USAGE_COMMAND_OK panel=usage";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`usage-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "stop-command") {
        const marker = "TUI_STOP_COMMAND_OK idle=reported";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`stop-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "memory-reset-command") {
        const marker = "TUI_MEMORY_RESET_OK reset=confirmed";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`memory-reset-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "memory-command") {
        const marker = "TUI_MEMORY_COMMAND_OK panel=memory";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`memory-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "keymap-command") {
        const marker = "TUI_KEYMAP_COMMAND_OK panel=keymap";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`keymap-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "skills-command") {
        const marker = "TUI_SKILLS_COMMAND_OK panel=skills";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`skills-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "permissions-picker") {
        const marker = "TUI_PERMISSIONS_PICKER_OK profile=accepted";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`permissions-picker PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "effort-picker") {
        const marker = "TUI_EFFORT_PICKER_OK option=accepted";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`effort-picker PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "hooks-command") {
        const marker = "TUI_HOOKS_COMMAND_OK panel=hooks";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`hooks-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "config-command") {
        const marker = "TUI_CONFIG_COMMAND_OK menu=model";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`config-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "clear-command") {
        const marker = "TUI_CLEAR_COMMAND_OK status=cleared turn=new";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`clear-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "quit-command") {
        const marker = "TUI_QUIT_COMMAND_OK exit=clean terminal=restored";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`quit-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "experimental-command") {
        const marker = "TUI_EXPERIMENTAL_COMMAND_OK list=ok toggle=off";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`experimental-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "review-branch") {
        const marker = "TUI_REVIEW_BRANCH_OK target=base-branch turn=started";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`review-branch PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "review-commit") {
        const marker = "TUI_REVIEW_COMMIT_OK target=commit turn=started";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`review-commit PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "review-picker") {
        const marker = "TUI_REVIEW_PICKER_OK preset=uncommitted turn=started";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`review-picker PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "review-command") {
        const marker = "TUI_REVIEW_COMMAND_OK prompt=review turn=started";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`review-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "permissions-approval") {
        const marker =
          "TUI_PERMISSIONS_APPROVAL_OK reason=localized scope=filesystem";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`permissions-approval PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "init-command") {
        const marker = "TUI_INIT_COMMAND_OK prompt=contributor-guide";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`init-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "file-change-approval") {
        const marker =
          "TUI_FILE_CHANGE_APPROVAL_OK title=localized description=ok destinations=add,move";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`file-change-approval PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "agents-overview") {
        const marker = "TUI_AGENTS_LOADING_OK label=localized";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`agents-overview PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "agents-command") {
        const marker = "TUI_AGENTS_COMMAND_OK screen=overview back=composer";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`agents-command PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "diff-display") {
        const marker =
          "TUI_EFFORT_ANIMATION_OK palette=probed ignition=tinted ultra=assembled status=restored frames=shared";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`diff-display PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "user-input") {
        for (const marker of [
          "TUI_NOTES_PASTE_OK compact=atomic unicode=preserved answer=expanded commands=literal submit=explicit",
          "TUI_NOTES_REVISIT_OK accepted=rich cursor=restored revision=exact followup=preserved response=once",
          "TUI_NOTES_UNANSWERED_OK edited=uncommitted confirm=explicit return=first draft=rich cursor=restored response=once",
          "TUI_NOTES_IME_ORDER_OK ascii-prefix=preserved unicode=immediate cancel=explicit",
          "TUI_NOTES_IME_TAB_OK prefix=immediate tab=literal draft=preserved cancel=explicit response=none",
          "TUI_NOTES_BURST_OK framing=raw enter-tab=draft idle=atomic cancel=explicit response=none",
        ]) {
          if (
            !`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)
          ) {
            throw new Error(`user-input PTY evidence missing: ${marker}`);
          }
          console.log(marker);
        }
      }
      if (scenario === "complete" || scenario === "images") {
        const marker =
          "TUI_EDITOR_KEEP_SCREEN_OK alternate=preserved composer=visible stdin=foreground editor-exit=main";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`${scenario} PTY evidence missing: ${marker}`);
        }
        console.log(marker);
      }
      if (scenario === "copy-mode") {
        for (const marker of [
          "TUI_COPY_MODE_OK whole=source blocks=code,quote,table user=literal resize=frozen cancel=restored turns=once",
          "TUI_STATUS_COPY_OK source=canonical-snapshot fields=model,directory,session navigation=shared resize=preserved cancel=restored turns=none",
        ]) {
          if (
            !`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)
          ) {
            throw new Error(`copy-mode PTY evidence missing: ${marker}`);
          }
          console.log(marker);
        }
      }
      if (scenario === "complete") {
        const ptyOutput = `${ptyEvidence.stdout}\n${ptyEvidence.stderr}`;
        for (const marker of [
          "TUI_EFFORT_PROMPT_OK ultra=double-arrow max=single-arrow status=preserved keyboard=ok",
          "TUI_POPUP_ENTER_OK slash=ok file=ok skill=ok shift-alt=newline turns=none",
          "TUI_SLASH_COMPLETION_OK tab=ok slash=ok enter=ok args=preserved turns=none",
          "TUI_EMPTY_COMPLETION_OK file-tab=closed skill-tab-enter=closed draft=preserved turns=none",
          "TUI_POPUP_KEYBOARD_OK repeat=navigation-completion release=ignored modifiers=exact-control ctrl-j=newline ctrl-k=editor turns=none",
          "TUI_EMPTY_NAVIGATION_OK left=press-only repeat=editor release=ignored overview=cancelled turns=none",
          "TUI_VIM_EMPTY_SLASH_OK empty=command nonempty=search chord=search completion=draft turns=none",
        ]) {
          if (!ptyOutput.includes(marker)) {
            throw new Error(`complete PTY evidence missing: ${marker}`);
          }
          console.log(marker);
        }
        const editorCwdEvidence = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "runtime::pty_tests::external_editor::real_pty_external_editor_uses_resumed_thread_cwd",
            "--",
            "--exact",
            "--nocapture",
          ],
          { ...testOptions, timeout: 60_000 },
        );
        const editorCwdMarker =
          `${editorCwdEvidence.stdout}\n${editorCwdEvidence.stderr}`.match(
            /TUI_EDITOR_CWD_OK thread=\S+ resume=canonical launch=different buffer=canonical draft=unicode first-arrow=preserved cold-read=exact terminal=restored/u,
          )?.[0];
        if (!editorCwdMarker) {
          throw new Error(
            "editor PTY fixture did not prove canonical cwd after cross-directory resume",
          );
        }
        console.log(editorCwdMarker);
        if (!ptyOutput.includes("TUI_REASONING_PARTS_OK")) {
          throw new Error(
            "reasoning PTY fixture did not prove body, paragraph and placeholder rendering",
          );
        }
        const reasoningStdio = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "projection::reasoning::stdio_tests::real_stdio_reasoning_snapshot_matches_notifications_and_cold_read",
            "--",
            "--exact",
            "--nocapture",
          ],
          testOptions,
        );
        if (
          !`${reasoningStdio.stdout}\n${reasoningStdio.stderr}`.includes(
            "STDIO_REASONING_PARTS_OK",
          )
        ) {
          throw new Error(
            "reasoning stdio fixture did not prove notification and cold canonical parts",
          );
        }
        console.log(
          reasoningStdio.stdout.match(/STDIO_REASONING_PARTS_OK[^\n]+/u)?.[0],
        );
        const resumeBackendPath = path.join(
          tempDir,
          "reasoning-resume-backend.mjs",
        );
        await writeTerminalExternalBackend(resumeBackendPath, {
          completedText,
          command: "printf reasoning-resume",
          scenario: "reasoning-resume",
          reasoningParts: [
            "**Body**\n\nSTDIO_RESUMED_BODY",
            "**STDIO_RESUMED_STATUS**\n<!-- -->",
          ],
          reasoningContent: ["STDIO_RAW_MUST_STAY_HIDDEN"],
        });
        const resumedReasoning = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "projection::reasoning::stdio_tests::real_stdio_running_reasoning_resumes_indexed_parts_without_started",
            "--",
            "--exact",
            "--nocapture",
          ],
          {
            ...testOptions,
            env: {
              ...testOptions.env,
              LIME_TEST_TERMINAL_SCENARIO: "reasoning-resume",
              LIME_TEST_TERMINAL_BACKEND: resumeBackendPath,
            },
          },
        );
        const resumedMarker = resumedReasoning.stdout.match(
          /STDIO_REASONING_RESUME_OK[^\n]+/u,
        )?.[0];
        if (!resumedMarker)
          throw new Error(
            "reasoning resume stdio fixture did not prove a live delta without started",
          );
        console.log(resumedMarker);
        backtrackEvidence =
          `${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.match(
            /TUI_BACKTRACK_OK thread=(\S+) removed-turn=(\S+) cold-resume=ok new-turns=0/u,
          );
        if (!backtrackEvidence) {
          throw new Error(
            "backtrack PTY fixture did not prove canonical revert and cold resume",
          );
        }
        const evidence = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "app_backtrack::stdio_tests::real_stdio_backtrack_retains_prefix_and_replays_live_refresh",
            "--",
            "--exact",
            "--nocapture",
          ],
          testOptions,
        );
        backtrackStdioEvidence = evidence.stdout.match(
          /STDIO_BACKTRACK_OK thread=(\S+) preserved-turn=(\S+) removed-turns=(\S+),(\S+) metadata=ok files=unchanged cold-resume=ok live-replay=ok retry=ok/u,
        );
        if (!backtrackStdioEvidence) {
          throw new Error(
            "backtrack stdio fixture did not prove prefix, typed input, files and live refresh",
          );
        }
      }
      if (scenario === "queue-edit") {
        const evidence = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "runtime::input_submission::tests::real_stdio_queue_and_rejected_submission_preserve_typed_metadata",
            "--",
            "--exact",
            "--nocapture",
          ],
          testOptions,
        );
        typedInputEvidence = evidence.stdout.match(
          /STDIO_TYPED_INPUT_OK thread=(\S+) turn=(\S+) queue=(\S+) failures=queue,steer,start/u,
        );
        if (!typedInputEvidence) {
          throw new Error(
            "typed input stdio fixture did not execute its full canonical assertions",
          );
        }
      }
      if (scenario === "user-input") {
        await writeTerminalExternalBackend(backendPath, {
          ...backendOptions,
          followupQuestion: false,
        });
        const evidence = await execFileAsync(
          process.env.CARGO || "cargo",
          [
            "test",
            "--manifest-path",
            path.join(rootDir, "lime-rs", "Cargo.toml"),
            "-p",
            "tui",
            "app::session_lifecycle::tests::real_stdio_thread_handoff_preserves_pending_input",
            "--",
            "--exact",
            "--nocapture",
          ],
          testOptions,
        );
        threadInputEvidence = evidence.stdout.match(
          /STDIO_THREAD_INPUT_OK root=(\S+) child=(\S+) turns=(\S+),(\S+) responses=2/u,
        );
        if (!threadInputEvidence) {
          throw new Error(
            "thread input stdio fixture did not execute its full resume and lifecycle assertions",
          );
        }
      }
    }

    const focusScenarioDir = path.join(tempDir, "focus-palette");
    await mkdir(focusScenarioDir, { recursive: true });
    const focusBackendPath = path.join(tempDir, "focus-palette-backend.mjs");
    const focusLedgerPath = path.join(tempDir, "focus-palette.jsonl");
    await writeTerminalExternalBackend(focusBackendPath, {
      completedText,
      command: "printf tui-focus-palette",
      scenario: "focus-palette",
    });
    await execFileAsync(
      process.env.CARGO || "cargo",
      [
        "test",
        "--manifest-path",
        path.join(rootDir, "lime-rs", "Cargo.toml"),
        "-p",
        "tui",
        "--test",
        "all",
        "suite::focus_palette::focus_gained_with_unanswered_palette_queries_preserves_immediate_input",
        "--",
        "--exact",
        "--nocapture",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          LIME_TEST_TUI_GATE_B: "1",
          LIME_TEST_CLI_BIN: cliBinaryPath,
          LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
          LIME_TEST_TERMINAL_BACKEND: focusBackendPath,
          LIME_TEST_TERMINAL_LEDGER: focusLedgerPath,
          LIME_TEST_TERMINAL_CWD: focusScenarioDir,
          LIME_TEST_NODE_BIN: process.execPath,
        },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
      },
    );

    const reconnectScenarioDir = path.join(tempDir, "reconnect");
    await mkdir(reconnectScenarioDir, { recursive: true });
    const reconnectEvidence = await execFileAsync(
      process.env.CARGO || "cargo",
      [
        "test",
        "--manifest-path",
        path.join(rootDir, "lime-rs", "Cargo.toml"),
        "-p",
        "tui",
        "--test",
        "all",
        "suite::reconnect::automatic_reconnect_restores_draft_and_routes_new_notifications",
        "--",
        "--exact",
        "--nocapture",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          LIME_TEST_TUI_GATE_B: "1",
          LIME_TEST_CLI_BIN: cliBinaryPath,
          LIME_TEST_TUI_REMOTE_CWD: reconnectScenarioDir,
        },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
      },
    );
    const reconnectMarker = reconnectEvidence.stdout.match(
      /TUI_REASONING_RESUME_OK[^\n]+/u,
    )?.[0];
    if (!reconnectMarker)
      throw new Error(
        "reconnect PTY fixture did not prove resumed reasoning status and detail",
      );
    console.log(reconnectMarker);
    const restrictedPasteMarker =
      "TUI_RESTRICTED_PASTE_OK framing=bracketed edit=single-grapheme draft=resumed turns=none terminal=restored transport=websocket-fixture";
    if (!reconnectEvidence.stdout.includes(restrictedPasteMarker)) {
      throw new Error(
        "reconnect PTY fixture did not prove restricted paste editing",
      );
    }
    console.log(restrictedPasteMarker);

    const tmuxResizeEvidence = await runTerminalResizeGateB({
      repoRoot: rootDir,
      tempDir,
      cliBinaryPath,
      appServerBinaryPath,
      completedText,
    });

    const ledger = (await access(ledgerPath).then(
      () => true,
      () => false,
    ))
      ? await readJsonLines(ledgerPath)
      : [];
    const turnScenarios = scenarios.filter(
      (scenario) =>
        scenario !== "agents-command" &&
        scenario !== "rename-command" &&
        scenario !== "compact-command" &&
        scenario !== "experimental-command" &&
        scenario !== "quit-command" &&
        scenario !== "config-command" &&
        scenario !== "hooks-command" &&
        scenario !== "effort-picker" &&
        scenario !== "permissions-picker" &&
        scenario !== "skills-command" &&
        scenario !== "keymap-command" &&
        scenario !== "memory-command" &&
        scenario !== "memory-reset-command" &&
        scenario !== "usage-command" &&
        scenario !== "stop-command" &&
        scenario !== "warnings-command" &&
        scenario !== "diff-command" &&
        scenario !== "cd-command" &&
        scenario !== "plugins-command" &&
        scenario !== "plugins-search-command" &&
        scenario !== "ps-command" &&
        scenario !== "recap-command" &&
        scenario !== "side-command" &&
        scenario !== "mention-command" &&
        scenario !== "goal-command" &&
        scenario !== "memories-command",
    );
    const turnStarts = turnScenarios.map((scenario) => {
      const expectedPrompt = scenarioPrompt(scenario);
      const entry = ledger.find(
        (candidate) =>
          candidate?.kind === "turnStart" && candidate.scenario === scenario,
      );
      if (!entry)
        throw new Error(
          `external backend did not record TUI turnStart for ${scenario}`,
        );
      if (scenario === "init-command") {
        assertEqual(
          entry.inputText.startsWith(
            "Generate a file named AGENTS.md that serves as a contributor guide",
          ),
          true,
          "init backend input",
        );
      } else if (scenario === "review-picker") {
        assertEqual(
          entry.inputText.toLowerCase().includes("review"),
          true,
          "review-picker backend input",
        );
      } else if (scenario === "review-branch") {
        assertEqual(
          entry.inputText.includes("main"),
          true,
          "review-branch backend input",
        );
      } else if (scenario === "review-commit") {
        assertEqual(
          entry.inputText.includes(reviewCommitShas.get(scenario) ?? ""),
          true,
          "review-commit backend input",
        );
      } else if (scenario === "review-command") {
        assertEqual(
          entry.inputText.startsWith(
            "Review the current repository changes. Focus on the following instructions: focus on runtime errors",
          ),
          true,
          "review backend input",
        );
      } else {
        assertEqual(entry.inputText, expectedPrompt, `${scenario} backend input`);
      }
      assertNonEmptyString(entry.threadId, `${scenario} canonical thread id`);
      assertNonEmptyString(entry.turnId, `${scenario} canonical turn id`);
      return entry;
    });
    const expectedSequences = {
      complete:
        "turn.started,turn.plan.updated,message.delta,item.started,item.completed,item.started,item.completed,provider.usage,turn.completed",
      approval: "turn.started,item.started,action.required",
      "file-change-approval": "turn.started,item.started,action.required",
      "permissions-approval": "turn.started,item.started,action.required",
      "new-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "review-picker":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "clear-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "review-branch":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "review-commit":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "review-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "init-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "archive-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "delete-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "fork-command":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "user-input": "turn.started,item.started,action.required",
      interrupt: "turn.started,message.delta",
      failure: "turn.started,runtime.error,turn.failed",
      "queue-edit": "turn.started,message.delta",
      "agents-overview": "turn.started,message.delta",
      "large-paste":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "diff-display":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,item.started,item.completed,turn.completed",
      images:
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      skills:
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
      "copy-mode":
        "turn.started,message.delta,item.started,item.completed,item.started,item.completed,turn.completed",
    };
    if (scenarios.includes("new-command")) {
      const starts = ledger.filter(
        (entry) =>
          entry?.kind === "turnStart" && entry.scenario === "new-command",
      );
      assertEqual(starts.length, 2, "new-command turns");
      assertEqual(
        starts[0].threadId !== starts[1].threadId,
        true,
        "new-command thread changed",
      );
    }
    for (const [index, scenario] of turnScenarios.entries()) {
      if (!(scenario in expectedSequences)) {
        throw new Error(
          `missing expectedSequences entry for ${scenario}; add one or exclude it from turnScenarios`,
        );
      }
      assertEqual(
        turnStarts[index].eventTypes.join(","),
        expectedSequences[scenario],
        `${scenario} runtime event sequence`,
      );
    }
    if (scenarios.includes("images")) {
      const imageStart = turnStarts.find(
        (entry) => entry.scenario === "images",
      );
      const [image, text] = imageStart.inputParts;
      assertEqual(
        imageStart.inputParts.length,
        2,
        "one retained image and structured text",
      );
      assertEqual(
        image.Image?.media_type,
        "image/png",
        "decoded image media type",
      );
      assertNonEmptyString(
        image.Image?.uri,
        "persisted image sidecar identity",
      );
      if (!image.Image?.provider_data?.startsWith("data:image/png;base64,"))
        throw new Error("image bytes did not reach current runtime lowering");
      deepStrictEqual(
        text,
        {
          Text: {
            text: imagePrompt,
            text_elements: [
              { byteRange: { start: 15, end: 25 }, placeholder: "[Image #1]" },
            ],
          },
        },
        "image TextElement survives stdio/runtime request lowering",
      );
    }
    if (scenarios.includes("approval")) {
      const approvalResponse = ledger.find(
        (entry) =>
          entry?.kind === "actionRespond" && entry.scenario === "approval",
      );
      if (!approvalResponse)
        throw new Error("approval response did not reach App Server backend");
      assertEqual(
        approvalResponse.decision,
        "allow_once",
        "command approval decision",
      );
    }
    if (scenarios.includes("user-input")) {
      const userInputResponses = ledger.filter(
        (entry) =>
          entry?.kind === "actionRespond" && entry.scenario === "user-input",
      );
      assertEqual(
        userInputResponses.length,
        1,
        "request_user_input must resolve exactly once through App Server backend",
      );
      const [userInputResponse] = userInputResponses;
      deepStrictEqual(
        userInputResponse.userData,
        {
          mode: ["Safe", `user_note: ${notesAnswer} REVISED`],
          followup: `user_note: ${followupAnswer}`,
        },
        "selected option and notes preserve the canonical question answer",
      );
      const notesTurn = turnStarts.find(
        (entry) => entry.scenario === "user-input",
      );
      console.log(
        `TUI_NOTES_RESPONSE_OK thread=${notesTurn.threadId} turn=${notesTurn.turnId} encoding=user_note response=complete exactly-once=true`,
      );
    }
    if (scenarios.includes("interrupt")) {
      const interruptResponse = ledger.find(
        (entry) =>
          entry?.kind === "turnCancel" && entry.scenario === "interrupt",
      );
      if (!interruptResponse)
        throw new Error("interrupt did not reach App Server backend");
    }
    if (scenarios.includes("queue-edit")) {
      const queueEditTurnStart = turnStarts.find(
        (entry) => entry.scenario === "queue-edit",
      );
      const queueEditCancel = ledger.find(
        (entry) =>
          entry?.kind === "turnCancel" && entry.scenario === "queue-edit",
      );
      if (!queueEditCancel) {
        throw new Error(
          "queue-edit cleanup interrupt did not reach App Server backend",
        );
      }
      const runtimeEvents = await readRuntimeEvents(
        scenarioDirs.get("queue-edit"),
      );
      const queueAdded = runtimeEvents.find(
        (event) =>
          event?.type === "queue.added" &&
          event.payload?.source === "thread/queue/add" &&
          event.payload?.content?.text === queuePrompt,
      );
      if (!queueAdded) {
        throw new Error(
          "thread/queue/add was not recorded in the canonical event log",
        );
      }
      const queuedSubmissionId = queueAdded.payload?.queuedSubmissionId;
      assertNonEmptyString(queuedSubmissionId, "queued submission id");
      assertEqual(
        queueAdded.threadId,
        queueEditTurnStart.threadId,
        "queue edit canonical thread identity",
      );
      const queueRemoved = runtimeEvents.find(
        (event) =>
          event?.type === "queue.removed" &&
          event.payload?.source === "thread/queue/delete" &&
          event.payload?.queuedSubmissionId === queuedSubmissionId,
      );
      if (!queueRemoved) {
        throw new Error(
          "thread/queue/delete was not recorded in the canonical event log",
        );
      }
      assertEqual(
        queueRemoved.threadId,
        queueAdded.threadId,
        "queue edit thread identity",
      );
      if (!(queueRemoved.sequence > queueAdded.sequence)) {
        throw new Error(
          `queue removal must follow queue addition: add=${queueAdded.sequence}, remove=${queueRemoved.sequence}`,
        );
      }
    }
    if (scenarios.includes("agents-overview")) {
      const overviewTurnStart = turnStarts.find(
        (entry) => entry.scenario === "agents-overview",
      );
      const overviewCancel = ledger.find(
        (entry) =>
          entry?.kind === "turnCancel" &&
          entry.scenario === "agents-overview" &&
          entry.threadId === overviewTurnStart.threadId &&
          entry.turnId === overviewTurnStart.turnId,
      );
      if (!overviewCancel) {
        throw new Error(
          "agents overview stop did not reach the same App Server thread and turn",
        );
      }
      const overviewStarts = turnStarts.filter(
        (entry) => entry.scenario === "agents-overview",
      );
      assertEqual(
        overviewStarts.length,
        1,
        "root/child draft handoff does not submit extra turns",
      );
    }
    const turnStart = turnStarts.find(Boolean);

    console.log(
      [
        "[smoke:tui-gate-b] ok",
        `cli=${cliBinaryPath}`,
        `appServer=${appServerBinaryPath}`,
        turnStart ? `thread=${turnStart.threadId}` : "thread=none",
        turnStart ? `turn=${turnStart.turnId}` : "turn=none",
        turnStart ? `events=${turnStart.eventTypes.join(",")}` : "events=none",
        threadInputEvidence
          ? `thread-input-stdio=ok input-root=${threadInputEvidence[1]} input-child=${threadInputEvidence[2]} input-turns=${threadInputEvidence[3]},${threadInputEvidence[4]}`
          : null,
        typedInputEvidence
          ? `typed-input-stdio=ok typed-thread=${typedInputEvidence[1]} typed-turn=${typedInputEvidence[2]} typed-queue=${typedInputEvidence[3]}`
          : null,
        backtrackEvidence
          ? `backtrack=ok backtrack-thread=${backtrackEvidence[1]} removed-turn=${backtrackEvidence[2]} cold-revert-resume=ok`
          : null,
        backtrackStdioEvidence
          ? `backtrack-stdio=ok backtrack-prefix-thread=${backtrackStdioEvidence[1]} preserved-turn=${backtrackStdioEvidence[2]} typed-revert=ok files=unchanged live-refresh=ok refresh-retry=ok`
          : null,
        scenarios.includes("queue-edit") ? "queue-edit=ok" : null,
        scenarios.includes("agents-overview") ? "agents-overview=ok" : null,
        scenarios.includes("agents-overview") ? "thread-draft=ok" : null,
        scenarios.includes("agents-overview")
          ? "thread-edit-lifetime=ok session-register=ok"
          : null,
        scenarios.includes("complete") ? "sticky-prompt=ok" : null,
        scenarios.includes("complete") ? "main-find=ok" : null,
        scenarios.includes("copy-mode") ? "copy-mode=ok" : null,
        scenarios.includes("complete") ? "history-search=ok" : null,
        scenarios.includes("complete") ? "persistent-history=ok" : null,
        scenarios.includes("complete")
          ? "vim-repeat=ok vim-search-state=ok vim-paste-burst=ok"
          : null,
        scenarios.includes("complete")
          ? "editor-keymap=ok editor-unbind=ok editor-chord=ok"
          : null,
        scenarios.includes("complete")
          ? "vim-keymap=ok vim-linewise=ok vim-modal-chord=ok"
          : null,
        scenarios.includes("user-input") ? "notes-keymap=ok" : null,
        scenarios.includes("complete") ? "task-progress=ok" : null,
        scenarios.includes("complete") ? "token-usage=ok" : null,
        scenarios.includes("complete") ? "reasoning-parts=ok" : null,
        scenarios.includes("complete")
          ? "context-footer=ok canonical-status-ids=ok"
          : null,
        scenarios.includes("images") ? "images=ok" : null,
        scenarios.includes("skills") ? "skill-mentions=ok" : null,
        scenarios.includes("images") && scenarios.includes("large-paste")
          ? "structured-history=ok"
          : null,
        scenarios.includes("large-paste")
          ? "submission-prepare=ok rejected-draft=ok"
          : null,
        "focus-palette=ok",
        "resize-reflow=ok",
        tmuxResizeEvidence,
        "reconnect=ok",
        "terminal=restored",
      ]
        .filter(Boolean)
        .join(" "),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (process.env.LIME_KEEP_TUI_GATE_B_TMP === "1") {
      console.error(`[smoke:tui-gate-b] kept temp dir ${tempDir}`);
    } else if (failed) {
      // The binary snapshot is a full CLI/App Server copy (~600MB); failure
      // evidence lives in the backend script, ledger, scenario dirs and PTY output.
      await rm(path.join(tempDir, "binaries"), {
        recursive: true,
        force: true,
      });
      console.error(
        `[smoke:tui-gate-b] kept temp dir ${tempDir} (failure evidence: tui-backend.mjs, tui-backend.jsonl, scenario dirs, PTY output)`,
      );
    } else {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function assertBinaryExists(targetPath, label) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(
      `${label} binary not found: ${targetPath}\n` +
        '先构建：cargo build --manifest-path "lime-rs/Cargo.toml" -p cli -p app-server',
    );
  }
}

async function readJsonLines(filePath) {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readRuntimeEvents(tempDir) {
  const sessionsDir = path.join(
    tempDir,
    "data",
    "runtime",
    "events",
    "sessions",
  );
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(
    () => [],
  );
  const eventFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(sessionsDir, entry.name));
  const eventGroups = await Promise.all(eventFiles.map(readJsonLines));
  return eventGroups.flat();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `unexpected ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${label}: ${JSON.stringify(value)}`);
  }
}

main().catch((error) => {
  console.error(
    `[smoke:tui-gate-b] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (error?.stdout) console.error(error.stdout);
  if (error?.killed) console.error("TUI_GATE_COMMAND_TIMEOUT killed=true");
  process.exitCode = 1;
});
