import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { readAppServerApiSources } from "../../test/appServerApiSources";

const RETIRED_FRONTEND_SESSION_MANAGEMENT_COMMANDS = [
  "session_files_create",
  "session_files_exists",
  "session_files_delete",
  "session_files_list",
  "session_files_get_detail",
  "session_files_cleanup_expired",
  "session_files_cleanup_empty",
];

const RETIRED_FRONTEND_SESSION_MANAGEMENT_EXPORTS = [
  "createSession",
  "sessionExists",
  "deleteSession",
  "listSessions",
  "getSessionDetail",
  "cleanupExpired",
  "cleanupEmpty",
];

const RETIRED_SESSION_FILE_COMMANDS = [
  "session_files_get_or_create",
  "session_files_update_meta",
  "session_files_save_file",
  "session_files_read_file",
  "session_files_resolve_file_path",
  "session_files_delete_file",
  "session_files_list_files",
];

const CURRENT_SESSION_FILE_METHODS = [
  "sessionFile/getOrCreate",
  "sessionFile/updateMeta",
  "sessionFile/save",
  "sessionFile/read",
  "sessionFile/resolvePath",
  "sessionFile/delete",
  "sessionFile/list",
];

const RETIRED_SESSION_FILE_SURFACE_COMMANDS = [
  ...RETIRED_FRONTEND_SESSION_MANAGEMENT_COMMANDS,
  ...RETIRED_SESSION_FILE_COMMANDS,
];

function readRepoFile(path: string): string {
  return readFileSync(resolve(cwd(), path), "utf8");
}

function readOptionalRepoFile(path: string): string {
  const absolutePath = resolve(cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

function expectStringLiteralAbsent(source: string, literal: string): void {
  expect(source).not.toContain(`"${literal}"`);
  expect(source).not.toContain(`'${literal}'`);
}

describe("Session files frontend boundary", () => {
  it("零生产调用的 session 管理 / 清理旧命令不再暴露为前端 API", () => {
    const source = readRepoFile("src/lib/api/session-files.ts");

    for (const exportName of RETIRED_FRONTEND_SESSION_MANAGEMENT_EXPORTS) {
      expect(source).not.toContain(`function ${exportName}`);
      expect(source).not.toContain(`async function ${exportName}`);
    }
    for (const command of RETIRED_FRONTEND_SESSION_MANAGEMENT_COMMANDS) {
      expectStringLiteralAbsent(source, command);
    }
  });

  it("工作台 session file 写读链不再从前端生产 safeInvoke 旧命令", () => {
    const source = readRepoFile("src/lib/api/session-files.ts");

    for (const command of RETIRED_SESSION_FILE_COMMANDS) {
      expect(source).not.toContain(`safeInvoke("${command}"`);
      expect(source).not.toContain(`safeInvoke<unknown>("${command}"`);
      expectStringLiteralAbsent(source, command);
    }
    expect(source).toContain("createAppServerClient().getOrCreateSessionFile");
    expect(source).toContain("createAppServerClient().updateSessionFileMeta");
    expect(source).toContain("createAppServerClient().saveSessionFile");
    expect(source).toContain("createAppServerClient().readSessionFile");
    expect(source).toContain("createAppServerClient().resolveSessionFilePath");
    expect(source).toContain("createAppServerClient().deleteSessionFile");
    expect(source).toContain("createAppServerClient().listSessionFiles");
    expect(source).toContain("export async function getOrCreateSession");
    expect(source).toContain("export async function updateSessionMeta");
    expect(source).toContain("export async function saveFile");
    expect(source).toContain("export async function readFile");
    expect(source).toContain("export async function resolveFilePath");
    expect(source).toContain("export async function deleteFile");
    expect(source).toContain("export async function listFiles");
  });

  it("Session files current 方法只落在 App Server protocol / client / frontend facade", () => {
    const protocolSource = [
      readRepoFile(
        "lime-rs/crates/app-server-protocol/src/protocol/v0/method_names.rs",
      ),
      readRepoFile(
        "lime-rs/crates/app-server-protocol/src/protocol/v0/session_files.rs",
      ),
    ].join("\n");
    const processorSource = [
      readRepoFile("lime-rs/crates/app-server/src/processor/mod.rs"),
      readRepoFile("lime-rs/crates/app-server/src/processor/dispatch.rs"),
      readRepoFile("lime-rs/crates/app-server/src/processor/dispatch/requests.rs"),
      readRepoFile("lime-rs/crates/app-server/src/processor/workspace.rs"),
    ].join("\n");
    const generatedClientProtocolSource = readRepoFile(
      "packages/app-server-client/src/generated/protocol-types.ts",
    );
    const appServerFacadeSource = readAppServerApiSources();

    for (const method of CURRENT_SESSION_FILE_METHODS) {
      expect(protocolSource).toContain(`"${method}"`);
      expect(processorSource).toContain(
        method
          .replace("sessionFile/", "METHOD_SESSION_FILE_")
          .replace("getOrCreate", "GET_OR_CREATE")
          .replace("updateMeta", "UPDATE_META")
          .replace("resolvePath", "RESOLVE_PATH")
          .replace("save", "SAVE")
          .replace("read", "READ")
          .replace("delete", "DELETE")
          .replace("list", "LIST"),
      );
      expect(generatedClientProtocolSource).toContain(`"${method}"`);
      expect(appServerFacadeSource).toContain(
        `METHOD_SESSION_FILE_${method
          .replace("sessionFile/", "")
          .replace("getOrCreate", "GET_OR_CREATE")
          .replace("updateMeta", "UPDATE_META")
          .replace("resolvePath", "RESOLVE_PATH")
          .replace("save", "SAVE")
          .replace("read", "READ")
          .replace("delete", "DELETE")
          .replace("list", "LIST")}`,
      );
    }
  });

  it("Session files 旧 Rust Tauri wrapper / runner / DevBridge command surface 不得回流", () => {
    expect(
      existsSync(resolve(cwd(), "lime-rs/src/commands/session_files_cmd.rs")),
    ).toBe(false);

    const commandsModSource = readOptionalRepoFile("lime-rs/src/commands/mod.rs");
    expect(commandsModSource).not.toContain("session_files_cmd");
    expect(existsSync(resolve(cwd(), "lime-rs/src/commands/mod.rs"))).toBe(
      false,
    );

    const runnerSource = readOptionalRepoFile("lime-rs/src/app/runner.rs");
    const dispatcherSource = readOptionalRepoFile(
      "lime-rs/src/dev_bridge/dispatcher/files.rs",
    );
    expect(existsSync(resolve(cwd(), "lime-rs/src/app/runner.rs"))).toBe(
      false,
    );
    expect(
      existsSync(resolve(cwd(), "lime-rs/src/dev_bridge/dispatcher/files.rs")),
    ).toBe(false);

    for (const command of RETIRED_SESSION_FILE_SURFACE_COMMANDS) {
      expect(runnerSource).not.toContain(
        `commands::session_files_cmd::${command}`,
      );
      expect(dispatcherSource).not.toContain(`"${command}"`);
    }
  });
});
