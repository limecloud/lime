import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SshConnection {
  alias: string;
  hostName: string;
  user: string | null;
  port: number | null;
}

interface HostBlock {
  aliases: string[];
  hostName: string | null;
  user: string | null;
  port: number | null;
}

function isConcreteAlias(alias: string): boolean {
  return Boolean(alias) && !/[*?!]/.test(alias);
}

function splitDirective(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equals = trimmed.indexOf("=");
  if (equals > 0 && !/\s/.test(trimmed.slice(0, equals))) {
    return [
      trimmed.slice(0, equals).trim().toLowerCase(),
      trimmed.slice(equals + 1).trim(),
    ];
  }
  const match = /^(\S+)\s+(.+)$/.exec(trimmed);
  if (!match) return [trimmed.toLowerCase(), ""];
  return [match[1].toLowerCase(), match[2].trim()];
}

export function parseSshConfig(text: string): SshConnection[] {
  const blocks: HostBlock[] = [];
  let current: HostBlock | null = null;
  const flush = () => {
    if (current && current.aliases.length > 0) blocks.push(current);
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const directive = splitDirective(line);
    if (!directive) continue;
    const [key, value] = directive;
    if (key === "host") {
      flush();
      const aliases = value
        .split(/\s+/)
        .map((alias) => alias.trim())
        .filter(isConcreteAlias);
      current = { aliases, hostName: null, user: null, port: null };
      continue;
    }
    if (!current) continue;
    if (key === "hostname" && value) current.hostName = value;
    else if (key === "user" && value) current.user = value;
    else if (key === "port" && value && /^\d+$/.test(value))
      current.port = Number(value);
  }
  flush();

  const seen = new Set<string>();
  const connections: SshConnection[] = [];
  for (const block of blocks) {
    for (const alias of block.aliases) {
      if (seen.has(alias)) continue;
      seen.add(alias);
      connections.push({
        alias,
        hostName: block.hostName ?? alias,
        user: block.user,
        port: block.port,
      });
    }
  }
  return connections;
}

/** 确保 ~/.ssh/config 存在（0700 目录 / 0600 文件），返回绝对路径。 */
export async function ensureSshConfig(homeDir: string): Promise<string> {
  const directory = path.join(homeDir, ".ssh");
  const configPath = path.join(directory, "config");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await access(configPath);
  } catch {
    await writeFile(configPath, "", { mode: 0o600 });
  }
  return configPath;
}

export interface SshConnectionInput {
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
}

const SSH_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;

function validateConnectionInput(
  input: SshConnectionInput,
): SshConnectionInput {
  const alias = input.alias.trim();
  if (!SSH_ALIAS_PATTERN.test(alias) || /[*?!]/.test(alias)) {
    throw new Error("SSH 别名只能包含字母、数字、点、下划线和短横线");
  }
  const hostName = input.hostName.trim();
  if (!hostName || /\s/.test(hostName)) {
    throw new Error("SSH 主机名不能为空且不能包含空白字符");
  }
  const user = input.user?.trim();
  if (user && /\s/.test(user)) {
    throw new Error("SSH 用户名不能包含空白字符");
  }
  if (
    input.port !== undefined &&
    (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
  ) {
    throw new Error("SSH 端口必须在 1-65535 之间");
  }
  return {
    alias,
    hostName,
    ...(user ? { user } : {}),
    ...(input.port !== undefined ? { port: input.port } : {}),
  };
}

export function formatSshConnectionBlock(input: SshConnectionInput): string {
  const lines = [`Host ${input.alias}`, `  HostName ${input.hostName}`];
  if (input.user) lines.push(`  User ${input.user}`);
  if (input.port !== undefined) lines.push(`  Port ${input.port}`);
  return lines.join("\n") + "\n";
}

export async function appendSshConnection(
  homeDir: string,
  input: SshConnectionInput,
): Promise<SshConnection> {
  const record = validateConnectionInput(input);
  const configPath = await ensureSshConfig(homeDir);
  const existing = await readFile(configPath, "utf8");
  if (parseSshConfig(existing).some((item) => item.alias === record.alias)) {
    throw new Error("SSH 别名已存在");
  }
  const separator = !existing || existing.endsWith("\n") ? "" : "\n";
  const addition = `${separator}${existing ? "\n" : ""}${formatSshConnectionBlock(record)}`;
  await writeFile(configPath, existing + addition);
  return {
    alias: record.alias,
    hostName: record.hostName,
    user: record.user ?? null,
    port: record.port ?? null,
  };
}

/** 从配置文本中移除指定别名的 Host 块；多别名块仅移除该别名，返回 null 表示未找到。 */
export function removeSshHostBlock(text: string, alias: string): string | null {
  const lines = text.split("\n");
  const blocks: {
    start: number;
    header: number;
    end: number;
    aliases: string[];
  }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*Host\s+(.+)$/i.exec(lines[index]);
    if (!match) continue;
    blocks.push({
      start: index,
      header: index,
      end: lines.length,
      aliases: match[1].trim().split(/\s+/),
    });
  }
  for (let index = 0; index < blocks.length; index += 1) {
    blocks[index].end =
      index + 1 < blocks.length ? blocks[index + 1].start : lines.length;
  }
  const block = blocks.find((item) => item.aliases.includes(alias));
  if (!block) return null;
  const others = block.aliases.filter((item) => item !== alias);
  if (others.length > 0) {
    const indent = /^\s*/.exec(lines[block.header])?.[0] ?? "";
    lines[block.header] = `${indent}Host ${others.join(" ")}`;
    return lines.join("\n");
  }
  let end = block.end;
  while (
    end > block.header + 1 &&
    (lines[end - 1].trim() === "" || lines[end - 1].trim().startsWith("#"))
  ) {
    end -= 1;
  }
  lines.splice(block.start, end - block.start);
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function removeSshConnection(
  homeDir: string,
  alias: string,
): Promise<boolean> {
  const configPath = path.join(homeDir, ".ssh", "config");
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return false;
  }
  const next = removeSshHostBlock(text, alias);
  if (next === null) return false;
  await writeFile(configPath, next);
  return true;
}

export interface SshConnectionUpdateInput {
  hostName: string;
  user?: string;
  port?: number;
}

function validateUpdateInput(input: SshConnectionUpdateInput) {
  const hostName = input.hostName.trim();
  if (!hostName || /\s/.test(hostName)) {
    throw new Error("SSH 主机名不能为空且不能包含空白字符");
  }
  const user = input.user?.trim();
  if (user && /\s/.test(user)) {
    throw new Error("SSH 用户名不能包含空白字符");
  }
  if (
    input.port !== undefined &&
    (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
  ) {
    throw new Error("SSH 端口必须在 1-65535 之间");
  }
  return { hostName, user, port: input.port };
}

export function updateSshHostBlock(
  text: string,
  alias: string,
  input: SshConnectionUpdateInput,
): string | null {
  const record = validateUpdateInput(input);
  const lines = text.split("\n");
  const blocks: { header: number; end: number; aliases: string[] }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*Host\s+(.+)$/i.exec(lines[index]);
    if (!match) continue;
    blocks.push({
      header: index,
      end: lines.length,
      aliases: match[1].trim().split(/\s+/),
    });
  }
  for (let index = 0; index < blocks.length; index += 1) {
    blocks[index].end =
      index + 1 < blocks.length ? blocks[index + 1].header : lines.length;
  }
  const block = blocks.find((item) => item.aliases.includes(alias));
  if (!block) return null;
  if (block.aliases.length > 1) {
    throw new Error("多别名 Host 块暂不支持编辑");
  }
  const headerLine = lines[block.header];
  const indent = /^\s*/.exec(headerLine)?.[0] ?? "";
  const directives = [
    `${indent}  HostName ${record.hostName}`,
    ...(record.user ? [`${indent}  User ${record.user}`] : []),
    ...(record.port !== undefined ? [`${indent}  Port ${record.port}`] : []),
  ];
  const kept: string[] = [];
  for (let index = block.header + 1; index < block.end; index += 1) {
    if (/^\s*(HostName|User|Port)\s+/i.test(lines[index])) continue;
    kept.push(lines[index]);
  }
  lines.splice(
    block.header + 1,
    block.end - block.header - 1,
    ...directives,
    ...kept,
  );
  return lines.join("\n");
}

export async function updateSshConnection(
  homeDir: string,
  alias: string,
  input: SshConnectionUpdateInput,
): Promise<boolean> {
  const configPath = path.join(homeDir, ".ssh", "config");
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return false;
  }
  const next = updateSshHostBlock(text, alias, input);
  if (next === null) return false;
  await writeFile(configPath, next);
  return true;
}
