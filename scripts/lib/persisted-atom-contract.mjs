const commands = ["persisted_atom_read", "persisted_atom_update"];

/** Static ownership checks complement, but never replace, actual IPC evidence. */
export function collectPersistedAtomContractFailures(readSource) {
  const failures = [];
  const sources = new Map();
  const read = (file) => {
    if (!sources.has(file)) sources.set(file, readSource(file));
    return sources.get(file);
  };
  const require = (file, pattern, message) => {
    if (!pattern.test(read(file))) failures.push({ file, message });
  };
  const forbid = (file, pattern, message) => {
    if (pattern.test(read(file))) failures.push({ file, message });
  };
  const catalogFile = "src/lib/governance/agentCommandCatalog.json";
  const catalog = JSON.parse(read(catalogFile));
  if (
    JSON.stringify(catalog.persistedAtomCommands) !== JSON.stringify(commands)
  )
    failures.push({
      file: catalogFile,
      message:
        "Persisted atom catalog must register only the two Desktop UI commands",
    });
  for (const command of commands) {
    for (const section of ["runtimeGatewayCommands", "capabilityDraftCommands"])
      if (catalog[section]?.includes(command))
        failures.push({
          file: catalogFile,
          message:
            "Desktop UI persistence cannot become an Agent runtime command",
        });
    if (Object.hasOwn(catalog.deprecatedCommandReplacements ?? {}, command))
      failures.push({
        file: catalogFile,
        message: "Current persisted atom commands cannot be deprecated aliases",
      });
    require("electron/ipcChannels.ts", new RegExp(
      'export const ELECTRON_HOST_COMMANDS = \\[([^\\]]*"' + command + '")',
    ), "Preload Host allowlist must contain " + command);
    for (const file of [
      "src/lib/dev-bridge/mockPriorityCommands.ts",
      "src/lib/dev-bridge/commandPolicy.ts",
      "src/lib/desktop-host/core.ts",
    ])
      forbid(
        file,
        new RegExp("[\"'\x60]" + command + "[\"'\x60]"),
        "Desktop draft persistence cannot fall back to a mock or legacy command policy",
      );
  }
  const main = "electron/main.ts";
  require(main, /new PersistedAtomHost\(\s*desktopStorageRoots\.appDataRoot,\s*broadcast,?\s*\)/, "Persisted UI files must use the resolved platform AppDataRoot and Main broadcast owner");
  require(main, /if\s*\(command === "persisted_atom_read"\)\s*\{\s*return persistedAtomHost\.sendPersistedAtomState\(args\);\s*\}/, "Read IPC must delegate to the unique persisted atom Host");
  require(main, /if\s*\(command === "persisted_atom_update"\)\s*\{\s*return persistedAtomHost\.updatePersistedAtomState\(args\);\s*\}/, "Update IPC must delegate to the unique persisted atom Host");
  require(main, /registerRendererEventHandler\(\s*ipcMain,\s*broadcast(?:,|\s*\))/, "Main must register the tested renderer event authority");
  forbid(
    main,
    /ipcMain\.on\(\s*IPC_EMIT_CHANNEL/,
    "Generic renderer emission cannot bypass the Main event authority",
  );
  require("electron/rendererEventPolicy.ts", /event !== "persisted-atom-update"/, "Renderer cannot forge persisted-state acknowledgements");
  require("electron/rendererEventPolicy.ts", /if\s*\(canBroadcastRendererEvent\(event\)\s*&&\s*!route\?\.\(sender, event, payload\)\)\s*broadcast\(event, payload\)/, "The actual IPC listener must enforce renderer event authority and isolate routed windows");
  require("electron/preload.ts", /emit:[\s\S]*?canBroadcastRendererEvent\(event\)[\s\S]*?send:[\s\S]*?canBroadcastRendererEvent\(event\)/, "Both preload event entry points must reject Main notifications");
  const gateway = "src/lib/api/persistedAtoms.ts";
  require("eslint.config.js", /agentCommandCatalog\.persistedAtomCommands/, "Persisted Host commands must stay behind their typed API gateway");
  require("eslint.config.js", /\.\.\.persistedAtomGatewayCommandSelectors/, "Business code must enforce the persisted atom gateway restriction");
  require(gateway, /invokePersistedAtom\("persisted_atom_read"/, "Typed read gateway must use the current Host command");
  require(gateway, /invokePersistedAtom\("persisted_atom_update"/, "Typed update gateway must use the current Host command");
  for (const parser of [
    "parsePersistedAtomReadRequest",
    "parsePersistedAtomReadResult",
    "parsePersistedAtomUpdateResult",
    "parsePersistedAtomUpdateEvent",
  ])
    require(gateway, new RegExp(
      parser + "\\(",
    ), "Typed gateway must consume the shared " + parser);
  require(gateway, /query:\s*parsedRequest\.query/, "Read IPC must carry the shared parsed query");
  forbid(
    gateway,
    /scope:\s*request\.scope/,
    "The scope-only read wire has been replaced",
  );
  const types = "src/lib/api/persistedAtomTypes.ts";
  require(types, /readonly query:\s*PersistedAtomReadQuery/, "Read requests must use the discriminated query owner");
  require(types, /kind:\s*"workspace-index"/, "The existing read command must support workspace discovery");
  const fixture = "scripts/electron/lib/persisted-atom-fixture.mjs";
  require(fixture, /protocol\.parseReadRequest/, "IPC observations must validate read requests with the shared owner");
  require(fixture, /query:\s*\{\s*kind:\s*"scope",\s*scope:\s*target/, "Scope fixture reads must use the current query wire");
  require(fixture, /data\?\.queryKind === "scope"/, "Scope readbacks must discriminate ready data");
  forbid(
    fixture,
    /(?:result|promoted)\.view\b/,
    "IPC readbacks cannot consume the removed top-level view",
  );
  require(gateway, /safeInvoke<unknown>\(command, args\)/, "Persisted gateway must preserve real bridge diagnostics and fail closed");
  require("src/lib/dev-bridge/safeInvoke.ts", /event === "persisted-atom-update"/, "Native persisted-state subscriptions must fail closed");
  require("src/lib/dev-bridge/safeInvoke.ts", /args_preview: invokeArgsPreview\(command, args\)/, "Draft diagnostics must use the unique content-free preview owner");
  require("src/lib/dev-bridge/safeInvoke.ts", /error: invokeDiagnosticError\(command, error\)/, "Draft errors must not echo user content into diagnostic storage");
  const http = "src/lib/dev-bridge/http-client.ts";
  require(http, /isPersistedAtomCommand\(cmd\)\s*\? invokeArgsPreview\(cmd, args as Record<string, unknown> \| undefined\)\s*: args/, "HTTP draft logs must preserve the content-free preview boundary");
  require(http, /console\.error\([\s\S]*?invokeConsoleError\(cmd, (?:error|e)\)/, "HTTP draft failures cannot echo content to the console");
  forbid(
    http,
    /console\.(?:debug|error)\(\s*`\[DevBridge\] HTTP [^`]*`\s*,\s*(?:error|e)\s*,?\s*\)/,
    "HTTP invoke diagnostics must use the shared command-aware error owner",
  );
  for (const file of [
    "electron/persistedAtomHost.ts",
    "electron/persistedAtomStore.ts",
    "electron/persistedAtomFile.ts",
    "electron/persistedAtomRecords.ts",
    "src/lib/api/persistedAtomTypes.ts",
    "src/lib/api/persistedAtomProtocol.ts",
  ])
    forbid(
      file,
      /from\s+["'][^"']*(?:react|prosemirror|components\/input-kit)[^"']*["']/,
      "Host transport must remain independent of React and the editor owner",
    );
  const draftRuntime =
    "src/components/agent/chat/workspace/useWorkspaceComposerDraftRuntime.ts";
  require(draftRuntime, /new ComposerDraftCoordinator\(/, "Workspace must assemble the single renderer draft coordinator");
  require(draftRuntime, /\.bindCommitted\(/, "The React editing-target owner must bind committed scopes");
  for (const file of [
    "src/components/agent/chat/components/EmptyState.tsx",
    "src/components/agent/chat/components/Inputbar/hooks/useInputbarSend.ts",
    "src/components/agent/chat/workspace/useWorkspaceResetRuntime.ts",
    "src/components/agent/chat/workspace/useTaskCenterTopicNavigationRuntime.ts",
    "src/components/agent/chat/workspace/useWorkspaceComposerDraftNavigation.ts",
  ]) {
    forbid(
      file,
      /new ComposerDraftCoordinator\(|\.bindCommitted\(/,
      "Presentation and navigation must delegate draft binding to the React editing-target owner",
    );
    forbid(
      file,
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\([\s\S]{0,100}["']composer-drafts/,
      "Draft scopes cannot introduce a parallel browser store",
    );
  }
  forbid(
    "src/components/agent/chat/workspace/useWorkspaceResetRuntime.ts",
    /composerDraftCoordinator\??\.clear\(/,
    "Home and new-task navigation must preserve the source draft instead of discard",
  );
  return failures;
}
