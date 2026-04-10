import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(
  projectRoot,
  "src/lib/governance/agentRuntimeCommandSchema.json",
);
const catalogPath = path.join(
  projectRoot,
  "src/lib/governance/agentCommandCatalog.json",
);
const outputPath = path.join(
  projectRoot,
  "src/lib/api/agentRuntime/commandManifest.generated.ts",
);

const allowedDomains = new Set([
  "thread",
  "session",
  "export",
  "inventory",
  "subagent",
]);
const allowedLifecycles = new Set(["current", "compat", "deprecated"]);
const allowedMockStrategies = new Set([
  "default-mock",
  "mock-priority",
  "bridge-only",
]);

function toCommandKey(command) {
  return command
    .replace(/^agent_runtime_/, "")
    .split("_")
    .map((segment, index) =>
      index === 0
        ? segment
        : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
}

async function readJson(jsonPath) {
  const raw = await fs.readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

function validateSchema(schema) {
  const commands = Array.isArray(schema?.commands) ? schema.commands : [];
  if (commands.length === 0) {
    throw new Error("agentRuntimeCommandSchema.json 不能为空");
  }

  const seenCommands = new Set();
  const seenKeys = new Set();

  for (const entry of commands) {
    const command = String(entry?.command ?? "").trim();
    const domain = String(entry?.domain ?? "").trim();
    const requestType = String(entry?.requestType ?? "").trim();
    const responseType = String(entry?.responseType ?? "").trim();
    const lifecycle = String(entry?.lifecycle ?? "").trim();
    const mockStrategy = String(entry?.mockStrategy ?? "").trim();
    const docsSection = String(entry?.docsSection ?? "").trim();
    const key = toCommandKey(command);

    if (!command.startsWith("agent_runtime_")) {
      throw new Error(`schema 命令必须以 agent_runtime_ 开头: ${command}`);
    }
    if (seenCommands.has(command)) {
      throw new Error(`schema 命令重复: ${command}`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`schema 命令 key 重复: ${key}`);
    }
    if (!allowedDomains.has(domain)) {
      throw new Error(`schema domain 非法: ${domain}`);
    }
    if (!requestType) {
      throw new Error(`schema 缺少 requestType: ${command}`);
    }
    if (!responseType) {
      throw new Error(`schema 缺少 responseType: ${command}`);
    }
    if (!allowedLifecycles.has(lifecycle)) {
      throw new Error(`schema lifecycle 非法: ${command} -> ${lifecycle}`);
    }
    if (!allowedMockStrategies.has(mockStrategy)) {
      throw new Error(
        `schema mockStrategy 非法: ${command} -> ${mockStrategy}`,
      );
    }
    if (!docsSection) {
      throw new Error(`schema 缺少 docsSection: ${command}`);
    }

    seenCommands.add(command);
    seenKeys.add(key);
  }

  return commands.map((entry) => ({
    command: String(entry.command),
    key: toCommandKey(String(entry.command)),
    domain: String(entry.domain),
    requestType: String(entry.requestType),
    responseType: String(entry.responseType),
    lifecycle: String(entry.lifecycle),
    mockStrategy: String(entry.mockStrategy),
    docsSection: String(entry.docsSection),
  }));
}

function assertCatalogMatchesSchema(schemaEntries, catalog) {
  const schemaCommands = schemaEntries.map((entry) => entry.command);
  const catalogCommands = Array.isArray(catalog?.runtimeGatewayCommands)
    ? catalog.runtimeGatewayCommands.filter((command) =>
        String(command).startsWith("agent_runtime_"),
      )
    : [];

  const schemaSet = new Set(schemaCommands);
  const catalogSet = new Set(catalogCommands);
  const missingFromCatalog = schemaCommands.filter(
    (command) => !catalogSet.has(command),
  );
  const extraInCatalog = catalogCommands.filter(
    (command) => !schemaSet.has(command),
  );

  if (missingFromCatalog.length === 0 && extraInCatalog.length === 0) {
    return;
  }

  const lines = [];
  if (missingFromCatalog.length > 0) {
    lines.push("catalog 缺少以下 agent_runtime 命令：");
    for (const command of missingFromCatalog) {
      lines.push(`- ${command}`);
    }
  }
  if (extraInCatalog.length > 0) {
    lines.push("catalog 多出以下未进入 schema 的 agent_runtime 命令：");
    for (const command of extraInCatalog) {
      lines.push(`- ${command}`);
    }
  }
  throw new Error(lines.join("\n"));
}

function buildGeneratedOutput(schemaEntries) {
  const domains = [...allowedDomains];
  const lifecycles = [...allowedLifecycles];
  const mockStrategies = [...allowedMockStrategies];

  const commandObjectBody = schemaEntries
    .map((entry) => `  ${entry.key}: ${JSON.stringify(entry.command)},`)
    .join("\n");

  const descriptorBody = schemaEntries
    .map(
      (entry) => `  {
    key: ${JSON.stringify(entry.key)},
    command: AGENT_RUNTIME_COMMANDS.${entry.key},
    domain: ${JSON.stringify(entry.domain)},
    requestType: ${JSON.stringify(entry.requestType)},
    responseType: ${JSON.stringify(entry.responseType)},
    lifecycle: ${JSON.stringify(entry.lifecycle)},
    mockStrategy: ${JSON.stringify(entry.mockStrategy)},
    docsSection: ${JSON.stringify(entry.docsSection)},
  },`,
    )
    .join("\n");

  const namesBody = schemaEntries
    .map((entry) => `  AGENT_RUNTIME_COMMANDS.${entry.key},`)
    .join("\n");

  const byDomainBody = domains
    .map((domain) => {
      const entries = schemaEntries.filter((entry) => entry.domain === domain);
      const lines = entries.map(
        (entry) => `    AGENT_RUNTIME_COMMANDS.${entry.key},`,
      );
      return `  ${JSON.stringify(domain)}: [\n${lines.join("\n")}\n  ],`;
    })
    .join("\n");

  return `/**
 * 由 scripts/generate-agent-runtime-clients.mjs 自动生成，请勿手改。
 */

export const AGENT_RUNTIME_COMMANDS = {
${commandObjectBody}
} as const;

export type AgentRuntimeCommandKey = keyof typeof AGENT_RUNTIME_COMMANDS;
export type AgentRuntimeCommandName =
  (typeof AGENT_RUNTIME_COMMANDS)[AgentRuntimeCommandKey];
export type AgentRuntimeCommandDomain = ${domains
    .map((value) => JSON.stringify(value))
    .join(" | ")};
export type AgentRuntimeCommandLifecycle = ${lifecycles
    .map((value) => JSON.stringify(value))
    .join(" | ")};
export type AgentRuntimeCommandMockStrategy = ${mockStrategies
    .map((value) => JSON.stringify(value))
    .join(" | ")};

export interface AgentRuntimeCommandDescriptor {
  readonly key: AgentRuntimeCommandKey;
  readonly command: AgentRuntimeCommandName;
  readonly domain: AgentRuntimeCommandDomain;
  readonly requestType: string;
  readonly responseType: string;
  readonly lifecycle: AgentRuntimeCommandLifecycle;
  readonly mockStrategy: AgentRuntimeCommandMockStrategy;
  readonly docsSection: string;
}

export const AGENT_RUNTIME_COMMAND_DESCRIPTORS = [
${descriptorBody}
] as const satisfies readonly AgentRuntimeCommandDescriptor[];

export const AGENT_RUNTIME_COMMAND_NAMES = [
${namesBody}
] as const satisfies readonly AgentRuntimeCommandName[];

export const AGENT_RUNTIME_COMMANDS_BY_DOMAIN = {
${byDomainBody}
} as const satisfies Record<
  AgentRuntimeCommandDomain,
  readonly AgentRuntimeCommandName[]
>;
`;
}

async function main() {
  const schema = await readJson(schemaPath);
  const catalog = await readJson(catalogPath);
  const schemaEntries = validateSchema(schema);
  assertCatalogMatchesSchema(schemaEntries, catalog);

  const output = buildGeneratedOutput(schemaEntries);
  const checkOnly = process.argv.includes("--check");

  let current = "";
  try {
    current = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (checkOnly) {
    if (current !== output) {
      throw new Error(
        "agent runtime generated manifest 已过期，请先运行 npm run generate:agent-runtime-clients",
      );
    }
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, "utf8");
}

main().catch((error) => {
  console.error(
    `[generate-agent-runtime-clients] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
