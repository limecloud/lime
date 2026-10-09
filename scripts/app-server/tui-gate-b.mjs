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
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { localAppServerBinaryPath } from "../lib/electron-dev-sidecar.mjs";
import { buildTerminalGateBinaries } from "./terminal-gate-binaries.mjs";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";
import { runRawReasoningGateB } from "./reasoning-gate-b.mjs";

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
const scenarioPrompt = (scenario) =>
  scenario === "large-paste"
    ? largePastePrompt
    : scenario === "images"
      ? imagePrompt
      : scenario === "skills"
        ? skillPrompt
        : prompt;
const queuePrompt = "queued follow-up for editing";
const completedText = "TUI_GATE_B_COMPLETED";
const reasoningText = "TUI_GATE_B_REASONING_DETAIL";
const rawText = "TUI_GATE_B_RAW_SOURCE";
const scrollableCompletedText = [
  ...Array.from(
    { length: 40 },
    (_, index) => `TUI_EDGE_ROW_${String(index).padStart(2, "0")}`,
  ),
  `**${rawText}**`,
  completedText,
].join("\n");
const scenarios = (
  process.env.LIME_TUI_GATE_B_SCENARIOS ||
  "complete,approval,user-input,interrupt,failure,queue-edit,agents-overview,large-paste,diff-display,images,skills"
)
  .split(",")
  .map((scenario) => scenario.trim())
  .filter(Boolean);

async function main() {
  await buildTerminalGateBinaries({ env: process.env, repoRoot: rootDir });
  const cliBinaryPath = path.resolve(
    process.env.LIME_CLI_BIN || defaultCliBinaryPath,
  );
  const appServerBinaryPath = path.resolve(
    process.env.APP_SERVER_BIN ||
      localAppServerBinaryPath({ repoRoot: rootDir }),
  );
  await Promise.all([
    assertBinaryExists(cliBinaryPath, "lime"),
    assertBinaryExists(appServerBinaryPath, "app-server"),
  ]);
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

  if (scenarios.includes("reasoning-raw")) {
    await runRawReasoningGateB({
      repoRoot: rootDir,
      cliBinaryPath,
      appServerBinaryPath,
    });
    if (scenarios.length === 1) return;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "tui-gate-b-"));
  try {
    const backendPath = path.join(tempDir, "tui-backend.mjs");
    const ledgerPath = path.join(tempDir, "tui-backend.jsonl");
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
    for (const scenario of scenarios.filter(
      (value) => value !== "reasoning-raw",
    )) {
      const scenarioDir = path.join(tempDir, scenario);
      await mkdir(scenarioDir, { recursive: true });
      scenarioDirs.set(scenario, scenarioDir);
      if (scenario === "complete" || scenario === "skills") {
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
      await writeTerminalExternalBackend(backendPath, {
        completedText:
          scenario === "complete" ? scrollableCompletedText : completedText,
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
        taskProgress: scenario === "complete",
        tokenUsage: scenario === "complete",
      });

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
          LIME_TEST_TERMINAL_COMPLETED_TEXT: completedText,
          LIME_TEST_TERMINAL_REASONING_TEXT: reasoningText,
          LIME_TEST_TERMINAL_RAW_TEXT: rawText,
          LIME_CONFIG_PATH:
            scenario === "complete" ? editorConfigPath : permissionConfigPath,
          LIME_TEST_PERMISSION_CONFIG:
            scenario === "complete" ? editorConfigPath : permissionConfigPath,
          LIME_TEST_PERMISSION_PROFILE: "named-fixture",
        },
        maxBuffer: 2 * 1024 * 1024,
        // Complete exercises the full editor/history/status/title flow; predicates stay bounded.
        timeout: scenario === "complete" ? 180_000 : 60_000,
        windowsHide: true,
      };
      const ptyEvidence = await execFileAsync(
        process.env.CARGO || "cargo",
        [
          "test",
          "--manifest-path",
          path.join(rootDir, "lime-rs", "Cargo.toml"),
          "-p",
          "tui",
          "runtime::pty_tests::real_pty_restores_terminal_after_visible_turn_completion",
          "--",
          "--exact",
          "--nocapture",
        ],

        testOptions,
      );
      if (scenario === "diff-display") {
        const marker =
          "TUI_EFFORT_ANIMATION_OK palette=probed ignition=tinted ultra=assembled status=restored frames=shared";
        if (!`${ptyEvidence.stdout}\n${ptyEvidence.stderr}`.includes(marker)) {
          throw new Error(`diff-display PTY evidence missing: ${marker}`);
        }
        console.log(marker);
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
        ]) {
          if (!ptyOutput.includes(marker)) {
            throw new Error(`complete PTY evidence missing: ${marker}`);
          }
          console.log(marker);
        }
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

    const resizeScenarioDir = path.join(tempDir, "resize-reflow");
    await mkdir(resizeScenarioDir, { recursive: true });
    const resizeBackendPath = path.join(tempDir, "resize-reflow-backend.mjs");
    const resizeLedgerPath = path.join(tempDir, "resize-reflow.jsonl");
    await writeTerminalExternalBackend(resizeBackendPath, {
      completedText,
      command: "printf tui-resize-reflow",
      scenario: "resize-reflow",
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
        "suite::resize_reflow::",
        "--",
        "--nocapture",
        "--test-threads=1",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          LIME_TEST_TUI_GATE_B: "1",
          LIME_TEST_CLI_BIN: cliBinaryPath,
          LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
          LIME_TEST_TERMINAL_BACKEND: resizeBackendPath,
          LIME_TEST_TERMINAL_LEDGER: resizeLedgerPath,
          LIME_TEST_TERMINAL_CWD: resizeScenarioDir,
          LIME_TEST_NODE_BIN: process.execPath,
        },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
      },
    );

    const ledger = await readJsonLines(ledgerPath);
    const turnStarts = scenarios.map((scenario) => {
      const expectedPrompt = scenarioPrompt(scenario);
      const entry = ledger.find(
        (candidate) =>
          candidate?.kind === "turnStart" &&
          candidate.scenario === scenario &&
          candidate.inputText === expectedPrompt,
      );
      if (!entry)
        throw new Error(
          `external backend did not record TUI turnStart for ${scenario}`,
        );
      assertEqual(entry.inputText, expectedPrompt, `${scenario} backend input`);
      assertNonEmptyString(entry.threadId, `${scenario} canonical thread id`);
      assertNonEmptyString(entry.turnId, `${scenario} canonical turn id`);
      return entry;
    });
    const expectedSequences = {
      complete:
        "turn.started,turn.plan.updated,message.delta,item.started,item.completed,item.started,item.completed,provider.usage,turn.completed",
      approval: "turn.started,item.started,action.required",
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
    };
    for (const [index, scenario] of scenarios.entries()) {
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
      const userInputResponse = ledger.find(
        (entry) =>
          entry?.kind === "actionRespond" && entry.scenario === "user-input",
      );
      if (!userInputResponse)
        throw new Error(
          "request_user_input response did not reach App Server backend",
        );
      deepStrictEqual(
        userInputResponse.userData,
        { mode: ["Safe", "user_note: PTY_NOTE_ANSWER"] },
        "selected option and notes preserve the canonical question answer",
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
        `thread=${turnStart.threadId}`,
        `turn=${turnStart.turnId}`,
        `events=${turnStart.eventTypes.join(",")}`,
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
        "reconnect=ok",
        "terminal=restored",
      ]
        .filter(Boolean)
        .join(" "),
    );
  } finally {
    if (process.env.LIME_KEEP_TUI_GATE_B_TMP !== "1") {
      await rm(tempDir, { recursive: true, force: true });
    } else {
      console.error(`[smoke:tui-gate-b] kept temp dir ${tempDir}`);
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
