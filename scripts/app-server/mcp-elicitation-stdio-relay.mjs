// Test-only driver: forward product stdio unchanged and invoke the real thread-scoped MCP API.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const child = spawn(
  process.env.LIME_TEST_APP_SERVER_BIN,
  process.argv.slice(2),
  { stdio: ["pipe", "pipe", "pipe"] },
);
const toolRequestId = "mcp-pty-tool-call";
const threadRequests = new Set();
let called = false;
const record = (direction, message) =>
  appendFileSync(
    process.env.LIME_TEST_MCP_RELAY_LEDGER,
    `${JSON.stringify({ direction, message })}\n`,
  );
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
child.stderr.on("data", (bytes) => record("stderr", bytes.toString("utf8")));
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
input.on("line", (line) => {
  const message = JSON.parse(line);
  record("client", message);
  if (message.method === "thread/start") threadRequests.add(message.id);
  send(message);
});
input.on("close", () => child.stdin.end());
readline
  .createInterface({ input: child.stdout, crlfDelay: Infinity })
  .on("line", (line) => {
    const message = JSON.parse(line);
    record("server", message);
    if (message.id === toolRequestId) {
      if (message.error)
        process.stderr.write(
          `MCP relay call failed: ${JSON.stringify(message.error)}\n`,
        );
      return;
    }
    process.stdout.write(`${line}\n`);
    if (
      !called &&
      threadRequests.has(message.id) &&
      message.result?.thread?.id
    ) {
      called = true;
      const request = {
        jsonrpc: "2.0",
        id: toolRequestId,
        method: "mcpServer/tool/call",
        params: {
          threadId: message.result.thread.id,
          server: "terminal-form",
          tool: "form",
          arguments: {},
        },
      };
      record("driver", request);
      send(request);
    }
  });
child.on("error", (error) => {
  record("driverError", { message: error.message });
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
  input.close();
});
child.on("exit", (code, signal) => {
  record("driverExit", { code, signal });
  process.exitCode = code ?? 1;
  input.close();
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
