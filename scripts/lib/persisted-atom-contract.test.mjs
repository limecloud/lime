import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { collectPersistedAtomContractFailures } from "./persisted-atom-contract.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, "eslint.config.js"),
});
const businessPath = path.join(
  root,
  "src/components/agent/chat/PersistedAtomLeak.ts",
);
const gatewayPath = path.join(root, "src/lib/api/persistedAtoms.ts");
// Load the repository configuration once; each assertion still runs real lintText.
await lint.calculateConfigForFile(businessPath);
await lint.calculateConfigForFile(gatewayPath);

function mutated(file, edit) {
  const before = source(file);
  const after = edit(before);
  expect(after).not.toBe(before);
  return collectPersistedAtomContractFailures((current) =>
    current === file ? after : source(current),
  );
}

describe("Desktop persisted atom ownership guard", () => {
  it("accepts the current Host/gateway/IPC and renderer draft owners", () => {
    expect(collectPersistedAtomContractFailures(source)).toEqual([]);
  });

  it.each([
    [
      "src/components/agent/chat/components/EmptyState.tsx",
      "new ComposerDraftCoordinator(controller);",
    ],
    [
      "src/components/agent/chat/workspace/useTaskCenterTopicNavigationRuntime.ts",
      "coordinator.bindCommitted(scope);",
    ],
    [
      "src/components/agent/chat/workspace/useWorkspaceComposerDraftNavigation.ts",
      'localStorage.setItem("composer-drafts-v1", JSON.stringify(draft));',
    ],
    [
      "src/components/agent/chat/workspace/useWorkspaceResetRuntime.ts",
      "composerDraftCoordinator.clear();",
    ],
  ])(
    "rejects a parallel draft owner or navigation discard in %s",
    (file, injected) => {
      expect(mutated(file, (text) => text + "\n" + injected + "\n")).toEqual(
        expect.arrayContaining([expect.objectContaining({ file })]),
      );
    },
  );

  it("rejects missing Host registration", () => {
    expect(
      mutated("electron/ipcChannels.ts", (text) =>
        text.replace('  "persisted_atom_update",', ""),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "electron/ipcChannels.ts" }),
      ]),
    );
  });

  it("rejects a command misclassified as an Agent runtime method", () => {
    expect(
      mutated("src/lib/governance/agentCommandCatalog.json", (text) => {
        const catalog = JSON.parse(text);
        catalog.runtimeGatewayCommands.push("persisted_atom_read");
        return JSON.stringify(catalog);
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "Desktop UI persistence cannot become an Agent runtime command",
        }),
      ]),
    );
  });

  it("rejects missing Host delegation and an unresolved platform path", () => {
    for (const edit of [
      (text) =>
        text.replace(
          "persistedAtomHost.updatePersistedAtomState(args)",
          "hostCommands.invoke(command, args)",
        ),
      (text) =>
        text.replace(
          "new PersistedAtomHost(\n  desktopStorageRoots.appDataRoot,",
          'new PersistedAtomHost(\n  "/tmp/drafts",',
        ),
    ])
      expect(mutated("electron/main.ts", edit)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "electron/main.ts" }),
        ]),
      );
  });

  it("rejects Main or preload bypass of the reserved notification", () => {
    expect(
      mutated("electron/main.ts", (text) =>
        text.replace(
          "registerRendererEventHandler(ipcMain, broadcast,",
          "ipcMain.on(IPC_EMIT_CHANNEL, (_sender, event, payload) => broadcast(event, payload))",
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "electron/main.ts" }),
      ]),
    );
    expect(
      mutated("electron/preload.ts", (text) =>
        text.replaceAll("!canBroadcastRendererEvent(event)", "false"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "electron/preload.ts" }),
      ]),
    );
  });

  it("rejects a content-bearing diagnostic or fake successful event subscription", () => {
    for (const edit of [
      (text) => text.replaceAll("invokeArgsPreview(command, args)", "args"),
      (text) => text.replace('event === "persisted-atom-update"', "false"),
    ])
      expect(mutated("src/lib/dev-bridge/safeInvoke.ts", edit)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "src/lib/dev-bridge/safeInvoke.ts" }),
        ]),
      );
  });

  it("rejects schema drift, editor dependency and legacy mock restoration", () => {
    const cases = [
      [
        "src/lib/api/persistedAtoms.ts",
        (text) =>
          text.replaceAll("parsePersistedAtomReadResult", "parseOwnShape"),
      ],
      [
        "electron/persistedAtomHost.ts",
        (text) => text + '\nimport React from "react";\n',
      ],
      [
        "src/lib/dev-bridge/mockPriorityCommands.ts",
        (text) => text + '\nconst fallback = "persisted_atom_update";\n',
      ],
    ];
    for (const [file, edit] of cases)
      expect(mutated(file, edit)).toEqual(
        expect.arrayContaining([expect.objectContaining({ file })]),
      );
  });

  it("rejects HTTP logging that restores full draft arguments or failures", () => {
    for (const edit of [
      (text) =>
        text.replaceAll(
          "invokeArgsPreview(cmd, args as Record<string, unknown> | undefined)",
          "args",
        ),
      (text) => text.replaceAll("invokeConsoleError(cmd, error)", "error"),
    ])
      expect(mutated("src/lib/dev-bridge/http-client.ts", edit)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/lib/dev-bridge/http-client.ts",
          }),
        ]),
      );
  });

  it("rejects restoring a scope-only wire or dropping the shared read request parser", () => {
    for (const edit of [
      (text) =>
        text.replaceAll("parsePersistedAtomReadRequest", "parseOwnRead"),
      (text) =>
        text.replace("query: parsedRequest.query", "scope: request.scope"),
    ])
      expect(mutated("src/lib/api/persistedAtoms.ts", edit)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "src/lib/api/persistedAtoms.ts" }),
        ]),
      );
  });

  it("rejects a fixture that consumes old view data or invents its own request validation", () => {
    for (const edit of [
      (text) => text.replace("return result.data.view", "return result.view"),
      (text) =>
        text.replace("protocol.parseReadRequest", "parseOwnReadRequest"),
    ])
      expect(
        mutated("scripts/electron/lib/persisted-atom-fixture.mjs", edit),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "scripts/electron/lib/persisted-atom-fixture.mjs",
          }),
        ]),
      );
  });

  it("the actual ESLint config rejects business calls and admits the typed gateway", async () => {
    const code =
      'import { safeInvoke } from "@/lib/dev-bridge"; export async function save() { await safeInvoke("persisted_atom_update", {}); }';
    const [business] = await lint.lintText(code, {
      filePath: businessPath,
    });
    expect(business.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "no-restricted-syntax" }),
      ]),
    );
    const [gateway] = await lint.lintText(code, {
      filePath: gatewayPath,
    });
    expect(gateway.messages.filter((entry) => entry.severity === 2)).toEqual(
      [],
    );
  });
});
