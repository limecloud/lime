// Test-only MCP peer. Every elicitation passes through the real App Server router.
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const pending = new Map();
const record = (value) =>
  appendFileSync(process.argv[2], `${JSON.stringify(value)}\n`);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = (id, value) => send({ jsonrpc: "2.0", id, result: value });

readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const { id, method, params } = message;
    if (method === "initialize") {
      record({ kind: "initialize", capabilities: params.capabilities });
      result(id, {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "terminal-form-fixture", version: "1" },
      });
    } else if (method === "notifications/initialized") {
      return;
    } else if (method === "tools/list") {
      result(id, {
        tools: [
          {
            name: "form",
            description: "Terminal input fixture",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    } else if (method === "tools/call") {
      record({ kind: "toolCall", name: params.name });
      const requestId = `form-${id}`;
      pending.set(requestId, id);
      send({
        jsonrpc: "2.0",
        id: requestId,
        method: "elicitation/create",
        params: {
          message: "Complete the terminal form",
          requestedSchema: {
            type: "object",
            properties: {
              first: { type: "string" },
              second: { type: "string" },
            },
            required: ["first", "second"],
            additionalProperties: false,
          },
        },
      });
    } else if (pending.has(id)) {
      const toolCallId = pending.get(id);
      pending.delete(id);
      record({
        kind: "elicitationResult",
        result: message.result,
        error: message.error,
      });
      result(toolCallId, {
        content: [{ type: "text", text: "MCP_FORM_COMPLETE" }],
        structuredContent: message.result,
        isError: message.result?.action !== "accept",
      });
    } else if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Unsupported fixture method: ${method}`,
        },
      });
    }
  });
