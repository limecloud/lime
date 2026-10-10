// Test-only exec output matrix using real CLI/stdin/stdout/stdio and cold canonical reads.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

export async function runExecReasoningGateB({
  cliBinaryPath,
  appServerBinaryPath,
  args,
  tempDir,
  backendPath,
  ledgerPath,
  runCliResult,
  terminalEnvironment,
}) {
  const summary = ["CLI_SUMMARY one", "CLI_SUMMARY two"];
  const content = ["CLI_RAW one", "CLI_RAW two"];
  const answer = "CLI_FINAL_ONLY";
  const command = "printf CLI_COMMAND_OUTPUT";
  const plan =
    "Canonical task progress fixture\n  ✓ PTY_PLAN_COMPLETED_STEP\n  → PTY_PLAN_ACTIVE_STEP\n  • PTY_PLAN_PENDING_STEP\n";
  const connection = args.slice(2).filter((arg) => arg !== "--json");
  const configPath = path.join(tempDir, "exec-config.yaml");
  const cases = [
    {
      name: "default",
      raw: false,
      hide: false,
      expected: summary.join("\n") + "\n",
    },
    {
      name: "raw",
      raw: true,
      hide: false,
      expected: content.join("\n") + "\n",
    },
    { name: "hidden", raw: false, hide: true, expected: "" },
    { name: "hidden-raw", raw: true, hide: true, expected: "" },
    {
      name: "raw-empty",
      raw: true,
      hide: false,
      content: [],
      expected: summary.join("\n") + "\n",
    },
    {
      name: "failed",
      raw: false,
      hide: true,
      status: "failed",
      expected: "",
      exit: 1,
    },
    {
      name: "interrupted",
      raw: false,
      hide: true,
      status: "interrupted",
      expected: "",
      exit: 130,
    },
  ];
  for (const scenario of cases) {
    const rawParts = scenario.content ?? content;
    await writeFile(
      configPath,
      `show_raw_agent_reasoning: ${scenario.raw}\nhide_agent_reasoning: ${scenario.hide}\n`,
    );
    await writeTerminalExternalBackend(backendPath, {
      completedText: answer,
      command,
      commandItems: true,
      commandStatus: scenario.status === "failed" ? "failed" : "completed",
      taskProgress: true,
      tokenUsage: true,
      reasoningParts: summary,
      reasoningContent: rawParts,
      terminalStatus: scenario.status ?? "completed",
    });
    const env = { LIME_CONFIG_PATH: configPath };
    const result = await runCliResult(
      cliBinaryPath,
      ["exec", "--locale", "en-US", "--color", "never", ...connection],
      tempDir,
      {
        input: "exec reasoning stdin probe\n",
        env,
      },
    );
    assert.equal(result.code, scenario.exit ?? 0, `${scenario.name}: exit`);
    assert.equal(
      result.stdout,
      scenario.status ? "" : `${answer}\n`,
      `${scenario.name}: final stdout`,
    );
    assert.equal(
      result.stderr,
      plan +
        scenario.expected +
        `exec\n${command} in /tmp\n ${scenario.status === "failed" ? "exited 7" : "succeeded"} in 42ms:\nterminal-gate-b\n` +
        (scenario.status === "failed"
          ? "ERROR: CLI_TEST_FAILURE\nERROR: CLI_TEST_FAILURE\n"
          : scenario.status === "interrupted"
            ? "turn interrupted\n"
            : `lime\n${answer}\n`) +
        "tokens used\n31,000\n",
      `${scenario.name}: human stderr`,
    );
    const ledger = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const turn = ledger.findLast((entry) => entry.kind === "turnStart");
    assert.equal(
      turn.inputText,
      "exec reasoning stdin probe\n",
      `${scenario.name}: stdin`,
    );
    const cold = await runCliResult(
      cliBinaryPath,
      ["thread", "show", turn.threadId, "--include-turns", ...connection],
      tempDir,
      { env },
    );
    assert.equal(
      cold.code,
      0,
      `${scenario.name}: cold thread/read ${cold.stderr}`,
    );
    assert.equal(cold.stderr, "", `${scenario.name}: read stderr`);
    const thread = JSON.parse(cold.stdout).thread;
    assert.equal(thread.id, turn.threadId);
    const canonicalTurn = thread.turns.find((item) => item.id === turn.turnId);
    assert.equal(canonicalTurn.status, scenario.status ?? "completed");
    const reasoning = canonicalTurn.items.filter(
      (item) => item.type === "reasoning",
    );
    assert.equal(
      reasoning.length,
      1,
      `${scenario.name}: unique canonical reasoning`,
    );
    assert.equal(reasoning[0].id, `item_terminal-reasoning-${turn.turnId}`);
    assert.deepEqual(reasoning[0].summary, summary);
    assert.deepEqual(reasoning[0].content, rawParts);
    const commands = canonicalTurn.items.filter(
      (item) => item.type === "commandExecution",
    );
    assert.equal(
      commands.length,
      1,
      `${scenario.name}: unique canonical command`,
    );
    assert.equal(commands[0].id, `item_terminal-command-${turn.turnId}`);
    assert.equal(commands[0].command, command);
    assert.equal(commands[0].cwd, "/tmp");
    assert.equal(
      commands[0].status,
      scenario.status === "failed" ? "failed" : "completed",
    );
    assert.equal(commands[0].aggregatedOutput, "terminal-gate-b");
    assert.equal(commands[0].exitCode, scenario.status === "failed" ? 7 : 0);
    assert.equal(commands[0].durationMs, 42);
    console.log(
      `CLI_REASONING_OK scenario=${scenario.name} thread=${turn.threadId} turn=${turn.turnId} item=${reasoning[0].id} stdin=ok stdout=ok stderr=ok cold=ok canonical=ok tools=ok plan=ok usage=ok exit=${result.code}`,
    );
  }
  for (const scenario of [
    { name: "raw", raw: true, hide: false },
    { name: "hidden-raw", raw: true, hide: true },
    { name: "failed", raw: false, hide: true, status: "failed", exit: 1 },
    {
      name: "interrupted",
      raw: false,
      hide: true,
      status: "interrupted",
      exit: 130,
    },
  ]) {
    await writeFile(
      configPath,
      `show_raw_agent_reasoning: ${scenario.raw}\nhide_agent_reasoning: ${scenario.hide}\n`,
    );
    await writeTerminalExternalBackend(backendPath, {
      completedText: answer,
      command,
      commandItems: true,
      commandStatus: scenario.status === "failed" ? "failed" : "completed",
      taskProgress: true,
      tokenUsage: true,
      reasoningParts: summary,
      reasoningContent: content,
      terminalStatus: scenario.status ?? "completed",
    });
    const result = await runCliResult(
      cliBinaryPath,
      [
        "exec",
        "exec reasoning json probe",
        "--json",
        "--color",
        "always",
        ...connection,
      ],
      tempDir,
      { env: { LIME_CONFIG_PATH: configPath } },
    );
    assert.equal(result.code, scenario.exit ?? 0);
    assert.equal(result.stderr, "", `${scenario.name}: no human stderr`);
    const events = result.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(events[0].type, "thread.started");
    assert.equal(events[1].type, "turn.started");
    const reasoning = events.filter(
      (event) => event.item?.type === "reasoning",
    );
    assert.equal(reasoning.length, 1, "single completed reasoning summary");
    assert.equal(reasoning[0].type, "item.completed");
    assert.equal(reasoning[0].item.text, summary.join("\n"));
    assert.ok(
      !result.stdout.includes("CLI_RAW") && !result.stdout.includes("\x1b["),
    );
    const answers = events.filter(
      (event) => event.item?.type === "agent_message",
    );
    if (scenario.status) {
      assert.equal(answers.length, 0, "no partial answer");
      assert.equal(
        events.some((event) => event.type === "turn.completed"),
        false,
      );
      if (scenario.status === "failed") {
        assert.equal(
          events.some((event) => event.type === "error"),
          true,
        );
        assert.equal(events.at(-1).type, "turn.failed");
        assert.equal(events.at(-1).error.message, "CLI_TEST_FAILURE");
      } else
        assert.equal(
          events.some((event) => event.type === "turn.failed"),
          false,
        );
    } else {
      assert.equal(answers.length, 1);
      assert.equal(answers[0].item.text, answer);
      assert.equal(events.at(-1).type, "turn.completed");
      assert.deepEqual(events.at(-1).usage, {
        input_tokens: 155000,
        cached_input_tokens: 130000,
        cache_write_input_tokens: 500,
        output_tokens: 6000,
        reasoning_output_tokens: 2000,
      });
    }
    const ledger = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const turn = ledger.findLast((entry) => entry.kind === "turnStart");
    assert.equal(events[0].thread_id, turn.threadId);
    const cold = await runCliResult(
      cliBinaryPath,
      ["thread", "show", turn.threadId, "--include-turns", ...connection],
      tempDir,
      { env: { LIME_CONFIG_PATH: configPath } },
    );
    assert.equal(cold.code, 0, cold.stderr);
    const canonical = JSON.parse(cold.stdout).thread.turns.find(
      (item) => item.id === turn.turnId,
    );
    assert.equal(canonical.status, scenario.status ?? "completed");
    assert.deepEqual(
      canonical.items.find((item) => item.type === "reasoning").content,
      content,
    );
    console.log(
      `CLI_REASONING_JSON_OK format=--json scenario=${scenario.name} thread=${turn.threadId} turn=${turn.turnId} summary=visible raw=absent canonical=ok stderr=empty exit=${result.code}`,
    );
  }
  await writeFile(configPath, "hide_agent_reasoning: true\n");
  await writeTerminalExternalBackend(backendPath, {
    completedText: answer,
    command,
    commandItems: true,
    reasoningParts: [],
    tokenUsage: true,
    terminalStatus: "interrupted",
  });
  for (const [locale, exec, interrupted, tokens] of [
    ["zh-CN", "执行", "回合已中断", "已用 token"],
    ["zh-TW", "執行", "回合已中斷", "已用 token"],
    ["en-US", "exec", "turn interrupted", "tokens used"],
    ["ja-JP", "実行", "ターン中断", "使用トークン"],
    ["ko-KR", "실행", "턴 중단됨", "사용 토큰"],
  ]) {
    // Root locale must reach exec; environment and an explicit color mode cannot override it.
    const result = await runCliResult(
      cliBinaryPath,
      [
        "--locale",
        locale,
        "exec",
        "localized output",
        "--color",
        "never",
        ...connection,
      ],
      tempDir,
      {
        env: { LIME_CONFIG_PATH: configPath, LIME_LOCALE: "en-US" },
      },
    );
    assert.equal(result.code, 130, `${locale}: interrupted exit`);
    assert.equal(result.stdout, "", `${locale}: no partial stdout`);
    assert.ok(
      result.stderr.startsWith(`${exec}\n`),
      `${locale}: command label`,
    );
    assert.ok(result.stderr.includes(command), `${locale}: original command`);
    assert.ok(
      result.stderr.endsWith(`${interrupted}\n${tokens}\n31,000\n`),
      `${locale}: terminal labels`,
    );
    assert.ok(!result.stderr.includes("\x1b["), `${locale}: never color`);
    console.log(
      `CLI_HUMAN_LOCALE_OK locale=${locale} root-inheritance=ok tools=ok interruption=ok usage=ok stdout=empty`,
    );
  }
  await writeTerminalExternalBackend(backendPath, {
    completedText: answer,
    command,
    commandItems: true,
    reasoningParts: [],
  });
  for (const color of ["auto", "always", "never"]) {
    const result = await runCliResult(
      cliBinaryPath,
      [
        "exec",
        "color output",
        "--locale",
        "en-US",
        "--color",
        color,
        ...connection,
      ],
      tempDir,
      {
        env: { LIME_CONFIG_PATH: configPath, NO_COLOR: "1" },
      },
    );
    assert.equal(
      result.code,
      0,
      `${color}: exit\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.stdout, `${answer}\n`, `${color}: plain stdout`);
    assert.equal(
      result.stderr.includes("\x1b["),
      color === "always",
      `${color}: ANSI policy`,
    );
    console.log(
      `CLI_HUMAN_COLOR_OK color=${color} pipe=ok no-color-override=ok stdout=plain`,
    );
  }
  if (process.platform === "darwin" && process.stdin.isTTY) {
    // Native script attaches both child streams to the same real PTY without a shell command.
    const tty = await runCliResult(
      "/usr/bin/script",
      [
        "-q",
        path.join(tempDir, "exec-tty.log"),
        "/usr/bin/env",
        `DYLD_LIBRARY_PATH=${terminalEnvironment.DYLD_LIBRARY_PATH ?? ""}`,
        cliBinaryPath,
        "exec",
        "tty output",
        "--locale",
        "en-US",
        "--color",
        "never",
        ...connection,
      ],
      tempDir,
      { inheritStdin: true, env: { LIME_CONFIG_PATH: configPath } },
    );
    assert.equal(tty.code, 0, `native PTY exit\n${tty.stdout}\n${tty.stderr}`);
    assert.equal(tty.stderr, "", "native PTY outer stderr");
    const output = tty.stdout.replace(/\r\n/gu, "\n");
    assert.equal(
      output.split(answer).length - 1,
      1,
      "both-TTY final answer appears once",
    );
    assert.ok(
      output.includes(`lime\n${answer}\n`),
      "both-TTY answer stays visible",
    );
    assert.ok(
      output.includes(`${command} in /tmp`),
      "both-TTY tools stay visible",
    );
    console.log(
      "CLI_HUMAN_TTY_OK platform=darwin real-pty=ok both-streams=tty final-answer=once tools=visible",
    );
  } else {
    console.log(
      `CLI_HUMAN_TTY_NOT_RUN platform=${process.platform} outer-stdin-tty=${Boolean(process.stdin.isTTY)}`,
    );
  }
  const unavailable = await runCliResult(
    cliBinaryPath,
    [
      "exec",
      "fail closed probe",
      "--json",
      ...(connection.includes("--app-server")
        ? ["--app-server", appServerBinaryPath]
        : []),
      "--app-server-arg=--backend",
      "--app-server-arg=unavailable",
      "--app-server-arg=--data-dir",
      `--app-server-arg=${path.join(tempDir, "unavailable-data")}`,
    ],
    tempDir,
    { env: { LIME_CONFIG_PATH: configPath } },
  );
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.stderr, "");
  const unavailableEvents = unavailable.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(unavailableEvents.at(-1).type, "error");
  assert.equal(
    unavailableEvents.some((event) => event.type === "turn.completed"),
    false,
  );
  assert.match(
    unavailableEvents.at(-1).message,
    /runtime model route is not executable/,
  );
  console.log("CLI_EXEC_UNAVAILABLE_OK fail-closed=ok exit=1");
}
