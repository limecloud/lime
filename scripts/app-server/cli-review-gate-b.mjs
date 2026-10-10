// Test-only review entry points over the real shared App Server and canonical cold reads.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reviewCases = [
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
];
const invalidTargets = [["review"], ["review", " \n"], ["review", "-"]];

export async function runReviewGateB({
  run,
  runCliResult,
  cliBinaryPath,
  tempDir,
  connection,
  readThread,
  outputPath,
  ledgerPath,
  answer,
  latestTurn,
}) {
  const assertReview = async (review, hint, input) => {
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
  };
  for (const [operation, hint, input, options] of reviewCases) {
    const review = await run(
      ["exec", ...operation, "--json", "-o", outputPath, ...connection],
      options,
    );
    await assertReview(review, hint, input);
    assert.equal(
      await readFile(outputPath, "utf8"),
      answer,
      "review reuses the final message file owner",
    );
  }
  const beforeErrors = await readFile(ledgerPath, "utf8");
  for (const operation of invalidTargets) {
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
  assert.equal(await readFile(ledgerPath, "utf8"), beforeErrors);
  console.log(
    "CLI_EXEC_REVIEW_OK targets=uncommitted-base-commit-custom stdin=bom-trim explicit=ignores-pipe canonical=entered-exited cold=ok output-file=plain errors=fail-closed",
  );

  for (const [operation, hint, input, options] of reviewCases) {
    const result = await runCliResult(
      cliBinaryPath,
      ["--locale", "zh-CN", ...connection, ...operation],
      tempDir,
      options,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `${answer}\n`,
      "top-level review uses plain final stdout",
    );
    assert.match(
      result.stderr,
      /执行/u,
      "top-level review inherits the root locale",
    );
    await assertReview(await latestTurn(), hint, input);
  }
  const beforeRootErrors = await readFile(ledgerPath, "utf8");
  for (const operation of invalidTargets) {
    const failure = await runCliResult(
      cliBinaryPath,
      [...connection, ...operation],
      tempDir,
      { input: " \n" },
    );
    assert.equal(failure.code, 1);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /review|prompt/iu);
  }
  assert.equal(await readFile(ledgerPath, "utf8"), beforeRootErrors);
  console.log(
    "CLI_REVIEW_ROOT_OK targets=shared stdin=bom-trim explicit=ignores-pipe root-connection=ok locale=zh-CN stdout=plain canonical=entered-exited cold=ok errors=fail-closed",
  );
}
