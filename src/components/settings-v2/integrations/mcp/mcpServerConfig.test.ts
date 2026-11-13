import { expect, it } from "vitest";
import type { McpServerConfig } from "@/lib/api/mcp";
import {
  createMcpServerDraft,
  mcpServerConfig,
  mcpServerDraftValid,
} from "./mcpServerConfig";

it("preserves unknown fields, exact STDIO arguments and environment values", () => {
  const config = {
    command: "node",
    args: [" a b ", ""],
    env: { TOKEN: "  token  " },
    cwd: "/old",
    enabled_tools: ["read"],
    tool_timeout: 85,
    environment_id: "local",
  };
  const draft = createMcpServerDraft({
    id: "alpha",
    name: "alpha",
    server_config: config,
    enabled_lime: true,
  });
  draft.cwd = "";
  expect(mcpServerConfig(draft, config)).toEqual({
    ...config,
    type: "stdio",
    cwd: undefined,
  });
  expect(mcpServerDraftValid(draft)).toBe(true);
});

it("normalizes supported HTTP aliases and removes cleared fields without losing OAuth settings", () => {
  const config: McpServerConfig = {
    type: "streamable_http",
    url: "https://test.invalid/mcp",
    bearerTokenEnvVar: "TOKEN",
    httpHeaders: { Header: "value" },
    envHttpHeaders: { Authorization: "AUTH_TOKEN" },
    oauth: { client_id: "client" },
    scopes: ["read"],
  };
  const draft = createMcpServerDraft({
    id: "alpha",
    name: "alpha",
    server_config: config,
    enabled_lime: true,
  });
  draft.bearerTokenEnvVar = "";
  expect(mcpServerConfig(draft, config)).toEqual({
    type: "streamable_http",
    url: config.url,
    http_headers: { Header: "value" },
    env_http_headers: { Authorization: "AUTH_TOKEN" },
    oauth: config.oauth,
    scopes: ["read"],
  });
});

it("rejects empty commands, unsafe URLs and duplicate or missing record keys", () => {
  const draft = createMcpServerDraft();
  draft.name = "alpha";
  expect(mcpServerDraftValid(draft)).toBe(false);
  draft.command = "node";
  draft.env = [
    { key: "X", value: "1" },
    { key: " X ", value: "2" },
  ];
  expect(mcpServerDraftValid(draft)).toBe(false);
  draft.env = [{ key: "", value: "token" }];
  expect(mcpServerDraftValid(draft)).toBe(false);
  draft.transport = "streamable_http";
  draft.url = "javascript:alert(1)";
  expect(mcpServerDraftValid(draft)).toBe(false);
  draft.url = "https://test.invalid/mcp";
  expect(mcpServerDraftValid(draft)).toBe(true);
});

it("trims HTTP values and omits empty values, while STDIO env values stay exact", () => {
  const draft = createMcpServerDraft();
  draft.transport = "streamable_http";
  draft.headers = [
    { key: " X-Key ", value: " value " },
    { key: "Blank", value: "  " },
  ];
  draft.envHeaders = [{ key: " Authorization ", value: " TOKEN " }];
  expect(mcpServerConfig(draft)).toMatchObject({
    http_headers: { "X-Key": "value" },
    env_http_headers: { Authorization: "TOKEN" },
  });
  draft.transport = "stdio";
  draft.env = [{ key: " TOKEN ", value: "  " }];
  expect(mcpServerConfig(draft)).toMatchObject({ env: { TOKEN: "  " } });
});

it("round-trips passthrough names separately from exact explicit environment values", () => {
  const previous = {
    command: "node",
    env_vars: ["TOKEN"],
    env: { TOKEN: " literal value " },
  };
  const draft = createMcpServerDraft({
    id: "alpha",
    name: "alpha",
    enabled_lime: true,
    server_config: previous,
  });
  expect(draft.envVars).toEqual(["TOKEN"]);
  draft.envVars = [" TOKEN ", " ", "WORKSPACE"];
  expect(mcpServerConfig(draft, previous)).toMatchObject({
    env_vars: ["TOKEN", "WORKSPACE"],
    env: { TOKEN: " literal value " },
  });
  draft.envVars = [" "];
  expect(mcpServerConfig(draft, previous)).not.toHaveProperty("env_vars");
  draft.envVars = ["A=B"];
  expect(mcpServerDraftValid(draft)).toBe(false);
  draft.envVars = ["A\0B"];
  expect(mcpServerDraftValid(draft)).toBe(false);
});

it("matches shipped STDIO omission rules without trimming command or argument values", () => {
  const draft = createMcpServerDraft();
  draft.name = "alpha";
  draft.command = " /path with spaces/server ";
  expect(
    mcpServerConfig(draft, {
      command: "old",
      args: ["old"],
      env: { OLD: "old" },
      env_vars: ["OLD"],
    }),
  ).toEqual({ type: "stdio", command: draft.command });
  draft.args = [" ", ""];
  draft.env = [{ key: " TOKEN ", value: "" }];
  expect(mcpServerConfig(draft)).toMatchObject({
    command: draft.command,
    args: [" ", ""],
    env: { TOKEN: "" },
  });
});
