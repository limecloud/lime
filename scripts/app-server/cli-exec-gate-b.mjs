// Test-only exec session, stdin and output-file flows through real product binaries.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

export async function runExecSessionGateB({
  repoRoot,
  cliBinaryPath,
  appServerBinaryPath,
  args,
  tempDir,
  backendPath,
  ledgerPath,
  runCliResult,
  terminalEnvironment,
}) {
  const connection = args.slice(2).filter((arg) => arg !== "--json");
  const answer = "CLI_SESSION_FINAL";
  const outputPath = path.join(tempDir, "last-message.txt");
  const backend = (status = "completed") =>
    writeTerminalExternalBackend(backendPath, {
      completedText: answer,
      command: "printf session",
      commandItems: true,
      reasoningParts: ["CLI_SESSION_SUMMARY"],
      reasoningContent: ["CLI_SESSION_RAW"],
      terminalStatus: status,
      completeAgentMessage: true,
    });
  await backend();
  const latestTurn = async () =>
    (await readFile(ledgerPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .findLast((entry) => entry.kind === "turnStart");
  const run = async (argv, options = {}) => {
    const result = await runCliResult(cliBinaryPath, argv, tempDir, options);
    assert.equal(
      result.code,
      0,
      `${argv.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.stderr, "", "machine output has no human diagnostics");
    const events = result.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(events[0].type, "thread.started");
    assert.equal(events.at(-1).type, "turn.completed");
    const turn = await latestTurn();
    assert.equal(events[0].thread_id, turn.threadId);
    return turn;
  };
  const seed = await run([
    "exec",
    "session seed",
    "--json",
    "-o",
    outputPath,
    ...connection,
  ]);
  assert.equal(
    await readFile(outputPath, "utf8"),
    answer,
    "plain final message file",
  );
  const uuid = await run(
    [
      "exec",
      "--json",
      ...connection,
      "resume",
      seed.threadId,
      "UUID follow up",
      "-o",
      outputPath,
    ],
    { input: "ignored resume pipe\n" },
  );
  assert.equal(uuid.threadId, seed.threadId, "UUID resume keeps Thread");
  assert.notEqual(uuid.turnId, seed.turnId, "resume starts a new Turn");
  assert.equal(
    uuid.inputText,
    "UUID follow up",
    "explicit resume prompt ignores piped context",
  );

  const { connectAppServerSidecar, stdioSidecar, PROTOCOL_VERSION } =
    await import(
      pathToFileURL(
        path.join(repoRoot, "packages/app-server-client/dist/index.js"),
      ).href
    );
  const connected = await connectAppServerSidecar(
    stdioSidecar(appServerBinaryPath),
    {
      clientInfo: { name: "cli_exec_session_fixture", version: "1" },
    },
    {
      env: terminalEnvironment,
      expectedProtocolVersion: PROTOCOL_VERSION,
      args: [
        "--stdio",
        ...connection
          .filter((arg) => arg.startsWith("--app-server-arg="))
          .map((arg) => arg.slice("--app-server-arg=".length)),
      ],
    },
  );
  const title = "CLI_RESUME_EXACT_TITLE";
  try {
    await connected.connection.setThreadName({
      threadId: seed.threadId,
      name: title,
    });
  } finally {
    await connected.sidecar.close();
  }
  const named = await run([
    "exec",
    "resume",
    title,
    "named follow up",
    "--json",
    ...connection,
  ]);
  assert.equal(
    named.threadId,
    seed.threadId,
    "exact title resume keeps Thread",
  );
  const cold = await runCliResult(
    cliBinaryPath,
    ["thread", "show", seed.threadId, "--include-turns", ...connection],
    tempDir,
  );
  assert.equal(cold.code, 0, cold.stderr);
  const turns = JSON.parse(cold.stdout).thread.turns;
  for (const expected of [seed, uuid, named]) {
    assert.equal(
      turns.find((turn) => turn.id === expected.turnId)?.status,
      "completed",
      "cold canonical turn retained",
    );
  }
  console.log(
    `CLI_EXEC_RESUME_OK thread=${seed.threadId} original-turn=${seed.turnId} resumed-turn=${uuid.turnId} uuid=ok exact-title=ok cold=ok output-file=plain`,
  );

  const otherCwd = path.join(tempDir, "other-cwd");
  await mkdir(otherCwd);
  const otherConnection = [...connection];
  otherConnection[otherConnection.indexOf("--cd") + 1] = otherCwd;
  const foreign = await run([
    "exec",
    "foreign cwd seed",
    "--json",
    ...otherConnection,
  ]);
  const scoped = await run([
    "exec",
    ...connection,
    "resume",
    "--last",
    "scoped latest",
    "--json",
  ]);
  assert.equal(
    scoped.threadId,
    seed.threadId,
    "last respects cwd despite a newer foreign Thread",
  );
  assert.notEqual(scoped.threadId, foreign.threadId);
  const allSeed = await run([
    "exec",
    "new foreign cwd seed",
    "--json",
    ...otherConnection,
  ]);
  const all = await run([
    "exec",
    "resume",
    "--last",
    "--all",
    "all latest",
    "--json",
    ...connection,
  ]);
  assert.equal(all.threadId, allSeed.threadId, "all disables cwd filtering");
  assert.equal(
    all.runtimeOptions?.runtimeRequest?.workingDir,
    tempDir,
    "resumed Turn receives the requested cwd",
  );
  assert.equal(
    all.runtimeOptions?.runtimeRequest?.workspaceRoot,
    tempDir,
    "resumed Turn receives the requested workspace root",
  );
  const missingName = await run([
    "exec",
    "resume",
    "NO_SUCH_EXACT_TITLE",
    "new session fallback",
    "--json",
    ...connection,
  ]);
  assert.notEqual(
    missingName.threadId,
    seed.threadId,
    "missing title starts a new Thread as Codex does",
  );
  console.log(
    `CLI_EXEC_RESUME_SELECTION_OK cwd=ok last=updated-desc all=ok missing-name=new-thread thread=${all.threadId}`,
  );

  const readThread = async (threadId) => {
    const result = await runCliResult(
      cliBinaryPath,
      ["thread", "show", threadId, "--include-turns", ...connection],
      tempDir,
    );
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout).thread;
  };
  const sourceBefore = await readThread(seed.threadId);
  const namedFork = await run([
    "exec",
    "fork",
    title,
    "named fork follow up",
    "--json",
    ...otherConnection,
  ]);
  assert.notEqual(namedFork.threadId, seed.threadId);
  const namedForkThread = await readThread(namedFork.threadId);
  assert.equal(
    namedForkThread.forkedFromId,
    seed.threadId,
    "name lookup crosses cwd and forks the exact source",
  );
  assert.equal(namedFork.runtimeOptions?.runtimeRequest?.workingDir, otherCwd);

  const ledgerBefore = await readFile(ledgerPath, "utf8");
  const forkOnly = await runCliResult(
    cliBinaryPath,
    ["exec", "--json", ...connection, "fork", seed.threadId],
    tempDir,
    { input: Buffer.from([0xff]) },
  );
  assert.equal(forkOnly.code, 0, forkOnly.stderr);
  assert.equal(forkOnly.stderr, "");
  const forkEvents = forkOnly.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(
    forkEvents.length,
    1,
    "fork-only does not synthesize Turn events",
  );
  assert.equal(forkEvents[0].type, "thread.started");
  const forkId = forkEvents[0].thread_id;
  assert.notEqual(forkId, seed.threadId);
  assert.equal(
    await readFile(ledgerPath, "utf8"),
    ledgerBefore,
    "fork-only ignores piped bytes and never calls the backend",
  );
  const forkThread = await readThread(forkId);
  assert.equal(forkThread.forkedFromId, seed.threadId);
  assert.equal(forkThread.turns.length, sourceBefore.turns.length);
  const historyText = (thread) =>
    thread.turns.map((turn) =>
      turn.items
        .filter((item) => ["userMessage", "agentMessage"].includes(item.type))
        .map((item) =>
          item.type === "agentMessage" ? item.text : item.content,
        ),
    );
  assert.deepEqual(historyText(forkThread), historyText(sourceBefore));
  assert.deepEqual(
    forkThread.turns.map((turn) => turn.id),
    sourceBefore.turns.map((turn) => turn.id),
    "public fork preserves historical Turn ids within the new Thread scope",
  );

  const forked = await run(
    [
      "exec",
      "fork",
      seed.threadId,
      "UUID fork follow up",
      "--json",
      "-o",
      outputPath,
      ...connection,
    ],
    { input: "ignored explicit fork pipe" },
  );
  assert.notEqual(forked.threadId, seed.threadId);
  assert.equal(forked.inputText, "UUID fork follow up");
  const forkedThread = await readThread(forked.threadId);
  assert.equal(forkedThread.forkedFromId, seed.threadId);
  assert.equal(forkedThread.turns.length, sourceBefore.turns.length + 1);
  assert.equal(forkedThread.turns.at(-1).id, forked.turnId);
  assert.equal(await readFile(outputPath, "utf8"), answer);
  const stdinFork = await run(
    ["exec", "fork", forkId, "-", "--json", ...connection],
    { input: Buffer.from("\ufefffork stdin 中文\n") },
  );
  assert.equal(stdinFork.inputText, "fork stdin 中文\n");
  assert.equal((await readThread(stdinFork.threadId)).forkedFromId, forkId);
  assert.deepEqual(
    (await readThread(seed.threadId)).turns,
    sourceBefore.turns,
    "all fork operations leave source canonical Turns untouched",
  );

  for (const [locale, label] of [
    ["zh-CN", "会话 ID"],
    ["zh-TW", "對話 ID"],
    ["en-US", "session id"],
    ["ja-JP", "セッション ID"],
    ["ko-KR", "세션 ID"],
  ]) {
    const human = await runCliResult(
      cliBinaryPath,
      ["exec", "fork", seed.threadId, "--locale", locale, ...connection],
      tempDir,
    );
    assert.equal(human.code, 0, human.stderr);
    assert.equal(human.stdout, "", "fork-only has no final answer");
    assert(human.stderr.startsWith(`${label}: `));
    const id = human.stderr.trim().slice(label.length + 2);
    assert.equal((await readThread(id)).forkedFromId, seed.threadId);
  }
  const noTurnLedger = await readFile(ledgerPath, "utf8");
  for (const extra of [
    ["NO_SUCH_FORK_SOURCE"],
    ["00000000-0000-0000-0000-000000000000"],
    [seed.threadId, "-i", "missing.png"],
    [seed.threadId, "-o", outputPath],
  ]) {
    const failure = await runCliResult(
      cliBinaryPath,
      ["exec", "fork", ...extra, "--json", ...connection],
      tempDir,
    );
    assert.equal(failure.code, 1);
    assert.equal(failure.stderr, "");
    const errors = failure.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(
      errors.length,
      1,
      "fork failure does not create a replacement Thread",
    );
    assert.equal(errors[0].type, "error");
  }
  assert.equal(await readFile(ledgerPath, "utf8"), noTurnLedger);
  console.log(
    `CLI_EXEC_FORK_OK source=${seed.threadId} fork=${forkId} continued-thread=${forked.threadId} turn=${forked.turnId} uuid=ok exact-title=ok cross-cwd=ok fork-only=no-turn stdin=ok cold=ok source=unchanged locales=5 missing=fail-closed`,
  );

  for (const [operation, hint, input, options] of [
    [
      ["review", "--uncommitted"],
      "current changes",
      /staged, unstaged, and untracked/u,
      {},
    ],
    [
      ["review", "--base", "REVIEW_FIXTURE_BRANCH"],
      "changes against 'REVIEW_FIXTURE_BRANCH'",
      /REVIEW_FIXTURE_BRANCH/u,
      {},
    ],
    [
      ["review", "--commit", "0123456789abcdef", "--title", "检查变更"],
      "commit 0123456: 检查变更",
      /0123456789abcdef.*检查变更/u,
      {},
    ],
    [
      ["review", "  检查错误处理  \n"],
      "检查错误处理",
      /^检查错误处理$/u,
      { input: Buffer.from([0xff]) },
    ],
    [
      ["review", "-"],
      "stdin review 中文",
      /^stdin review 中文$/u,
      { input: Buffer.from("\ufeff  stdin review 中文  \n") },
    ],
  ]) {
    const review = await run(
      ["exec", ...operation, "--json", "-o", outputPath, ...connection],
      options,
    );
    assert.match(
      review.inputText,
      input,
      "shared review owner constructs the prompt",
    );
    const canonical = await readThread(review.threadId);
    assert.equal(
      canonical.turns.length,
      1,
      "review starts exactly one canonical Turn",
    );
    const turn = canonical.turns[0];
    assert.equal(turn.id, review.turnId);
    const entered = turn.items.filter(
      (item) => item.type === "enteredReviewMode",
    );
    const exited = turn.items.filter(
      (item) => item.type === "exitedReviewMode",
    );
    assert.equal(
      entered.length,
      1,
      "review/start creates its entered boundary",
    );
    assert.equal(
      exited.length,
      1,
      "review/start closes its canonical boundary",
    );
    assert.equal(entered[0].review, hint);
    assert.equal(exited[0].review, answer);
    assert.equal(
      await readFile(outputPath, "utf8"),
      answer,
      "review reuses the final message file owner",
    );
  }
  const beforeReviewErrors = await readFile(ledgerPath, "utf8");
  for (const operation of [["review"], ["review", " \n"], ["review", "-"]]) {
    const failure = await runCliResult(
      cliBinaryPath,
      ["exec", ...operation, "--json", ...connection],
      tempDir,
      { input: " \n" },
    );
    assert.equal(failure.code, 1);
    assert.equal(failure.stderr, "");
    const errors = failure.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(
      errors.length,
      1,
      "invalid review fails before Thread creation",
    );
    assert.equal(errors[0].type, "error");
  }
  assert.equal(await readFile(ledgerPath, "utf8"), beforeReviewErrors);
  console.log(
    "CLI_EXEC_REVIEW_OK targets=uncommitted-base-commit-custom stdin=bom-trim explicit=ignores-pipe canonical=entered-exited cold=ok output-file=plain errors=fail-closed",
  );

  const imagePath = path.join(tempDir, "exec-image.png");
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoUAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const imageData = `data:image/png;base64,${(await readFile(imagePath)).toString("base64")}`;
  for (const operation of [
    ["exec", "-i", imagePath, "inspect root image"],
    [
      "exec",
      "-i",
      imagePath,
      "resume",
      seed.threadId,
      "inspect resumed images",
      "-i",
      imagePath,
    ],
    [
      "exec",
      "-i",
      imagePath,
      "fork",
      seed.threadId,
      "inspect forked images",
      "-i",
      imagePath,
    ],
  ]) {
    const imageTurn = await run([...operation, "--json", ...connection]);
    const expectedCount =
      operation.includes("resume") || operation.includes("fork") ? 2 : 1;
    assert.equal(imageTurn.inputParts.length, expectedCount + 1);
    for (const part of imageTurn.inputParts.slice(0, -1)) {
      assert.equal(part.Image?.media_type, "image/png");
      assert.equal(
        part.Image?.provider_data,
        imageData,
        "shared runtime preserves image bytes",
      );
      assert(
        part.Image?.uri.startsWith("sidecar://media/"),
        "shared runtime persists the image",
      );
    }
    const canonical = await readThread(imageTurn.threadId);
    const user = canonical.turns
      .find((turn) => turn.id === imageTurn.turnId)
      .items.find((item) => item.type === "userMessage");
    assert.equal(user.content.length, expectedCount + 1);
    assert(user.content.slice(0, -1).every((part) => part.type === "image"));
    for (const [index, part] of user.content.slice(0, -1).entries()) {
      assert.equal(
        part.url,
        imageTurn.inputParts[index].Image.uri,
        "canonical image reference matches runtime input",
      );
    }
    assert.equal(user.content.at(-1).text, imageTurn.inputText);
  }
  console.log(
    "CLI_EXEC_IMAGES_OK root=ok resume=ok fork=ok order=images-before-text backend=lowered cold=canonical",
  );

  const schemaPath = path.join(tempDir, "output-schema.json");
  const schema = {
    type: "object",
    properties: { 结果: { type: "string" } },
    required: ["结果"],
    additionalProperties: false,
  };
  await writeFile(schemaPath, JSON.stringify(schema));
  for (const operation of [
    ["exec", "--output-schema", schemaPath, "structured root"],
    [
      "exec",
      "resume",
      seed.threadId,
      "structured resume",
      "--output-schema",
      schemaPath,
    ],
    ["exec", "--output-schema", schemaPath, "fork", forkId, "structured fork"],
  ]) {
    const structured = await run([...operation, "--json", ...connection]);
    assert.deepEqual(
      structured.outputSchema,
      schema,
      "shared runtime forwards the exact output schema",
    );
    const canonical = await readThread(structured.threadId);
    assert.equal(
      canonical.turns.find((turn) => turn.id === structured.turnId)?.status,
      "completed",
    );
  }
  const noSchema = await run([
    "exec",
    "resume",
    seed.threadId,
    "plain response after schema",
    "--json",
    ...connection,
  ]);
  assert.equal(
    noSchema.outputSchema,
    null,
    "output schema is scoped to one Turn",
  );
  const invalidSchema = path.join(tempDir, "invalid-output-schema.json");
  await writeFile(invalidSchema, "{");
  const beforeSchemaErrors = await readFile(ledgerPath, "utf8");
  for (const [operation, expected] of [
    [
      [
        "exec",
        "prompt",
        "--output-schema",
        path.join(tempDir, "missing-output-schema.json"),
      ],
      "Failed to read output schema file",
    ],
    [
      [
        "exec",
        "resume",
        seed.threadId,
        "prompt",
        "--output-schema",
        invalidSchema,
      ],
      "is not valid JSON",
    ],
    [
      ["exec", "fork", seed.threadId, "--output-schema", invalidSchema],
      "Forking with output options requires a prompt",
    ],
  ]) {
    const failure = await runCliResult(
      cliBinaryPath,
      [...operation, "--json", ...connection],
      tempDir,
    );
    assert.equal(failure.code, 1, failure.stderr);
    assert.equal(failure.stderr, "");
    const events = failure.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(
      events.length,
      1,
      "schema failure occurs before Thread creation",
    );
    assert.equal(events[0].type, "error");
    assert(events[0].message.includes(expected));
  }
  assert.equal(
    await readFile(ledgerPath, "utf8"),
    beforeSchemaErrors,
    "schema errors never reach the backend",
  );
  console.log(
    "CLI_EXEC_OUTPUT_SCHEMA_OK root=ok resume=ok fork=ok backend=exact turn-scoped=ok cold=completed missing=fail-closed malformed=fail-closed fork-only=rejected",
  );

  for (const [argv, input, expected] of [
    [
      ["exec", "root prompt"],
      Buffer.from("\ufeffpiped 中文\n"),
      "root prompt\n\n<stdin>\npiped 中文\n</stdin>",
    ],
    [["exec", "-"], Buffer.from("forced 中文\n"), "forced 中文\n"],
    [
      ["exec"],
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("UTF16 中文\n", "utf16le"),
      ]),
      "UTF16 中文\n",
    ],
    [
      ["exec", "resume", seed.threadId],
      Buffer.from("resume stdin\n"),
      "resume stdin\n",
    ],
  ]) {
    const turn = await run([...argv, "--json", ...connection], { input });
    assert.equal(turn.inputText, expected, "decoded canonical stdin input");
  }
  console.log(
    "CLI_EXEC_STDIN_OK root-append=ok dash=ok absent=ok utf8-bom=ok utf16=ok resume-stdin=ok",
  );

  for (const status of ["failed", "interrupted"]) {
    await backend(status);
    await writeFile(outputPath, "previous successful answer");
    const result = await runCliResult(
      cliBinaryPath,
      [
        "exec",
        "failure output probe",
        "--json",
        "-o",
        outputPath,
        ...connection,
      ],
      tempDir,
    );
    assert.equal(result.code, status === "failed" ? 1 : 130);
    assert.equal(result.stderr, "");
    assert.equal(
      await readFile(outputPath, "utf8"),
      "previous successful answer",
    );
  }
  await backend();
  const invalidId = await runCliResult(
    cliBinaryPath,
    [
      "exec",
      "resume",
      "00000000-0000-0000-0000-000000000000",
      "must fail",
      "--json",
      ...connection,
    ],
    tempDir,
  );
  assert.equal(invalidId.code, 1);
  const invalidEvents = invalidId.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(
    invalidEvents.length,
    1,
    "resume failure does not start a replacement Thread",
  );
  assert.equal(invalidEvents[0].type, "error");
  const invalidBytes = await runCliResult(
    cliBinaryPath,
    ["exec", "--json", ...connection],
    tempDir,
    { input: Buffer.from([0xff]) },
  );
  assert.equal(invalidBytes.code, 1);
  assert.equal(JSON.parse(invalidBytes.stdout).type, "error");
  const writeFailure = await runCliResult(
    cliBinaryPath,
    [
      "exec",
      "file write failure",
      "--json",
      "-o",
      path.join(tempDir, "missing/answer.txt"),
      ...connection,
    ],
    tempDir,
  );
  assert.equal(writeFailure.code, 1);
  assert.equal(writeFailure.stderr, "");
  const error = writeFailure.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .at(-1);
  assert.equal(error.type, "error");
  assert.match(error.message, /failed to write last message file/);
  console.log(
    "CLI_EXEC_OUTPUT_FILE_OK failed=preserved interrupted=preserved invalid-uuid=fail-closed invalid-bytes=fail-closed write-error=visible",
  );
}
