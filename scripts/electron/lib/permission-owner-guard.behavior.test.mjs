// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import catalog from "../../../src/lib/governance/legacySurfaceCatalog.json" with { type: "json" };
import { findPermissionOwnerViolations } from "./permission-owner-guard.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const retired = catalog.imports.find(
  (entry) => entry.id === "retired-main-window-media-permissions",
);
const mainPath = "electron/main.ts";
const mainOwner = "electron/mainWindowPermissions.ts";
const embeddedOwner = "electron/embeddedBrowserPermissions.ts";
const cloudOwner = "electron/cloudDesktopWindowFactory.ts";
const currentSources = {
  [mainPath]: `
    import { installMainWindowPermissionHandlers as installPermissions } from "./mainWindowPermissions";
    app.whenReady().then(() => installPermissions({ session: session.defaultSession }));
  `,
  [mainOwner]: `
    import type { Session } from "electron";
    type PermissionSession = Pick<Session, "setPermissionRequestHandler" | "setPermissionCheckHandler">;
    export function installMainWindowPermissionHandlers({ session }) {
      session.setPermissionRequestHandler(() => {});
      session.setPermissionCheckHandler(() => false);
    }
  `,
  [embeddedOwner]: `
    export function installEmbeddedBrowserPermissionHandling(browserSession) {
      browserSession.setPermissionRequestHandler(() => {});
    }
  `,
  [cloudOwner]: `
    export function createCloudDesktopWindow() {
      cloudSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      cloudSession.setPermissionCheckHandler(() => false);
    }
  `,
};
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(patch = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-permission-owner-guard-"),
  );
  directories.push(directory);
  for (const [relativePath, source] of Object.entries({
    ...currentSources,
    ...patch,
  })) {
    const destination = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source);
  }
  return findPermissionOwnerViolations(directory, retired.targets);
}

function expectViolation(patch, code, targetPath) {
  expect(fixture(patch)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code, path: targetPath }),
    ]),
  );
}

describe("main-window permission owner regression guard", () => {
  it("uses the current dead catalog entry and accepts the real Electron directory", () => {
    expect(retired).toMatchObject({ classification: "dead", allowedPaths: [] });
    expect(
      findPermissionOwnerViolations(repositoryRoot, retired.targets),
    ).toEqual([]);
  });

  it.each(retired.targets)(
    "rejects restored %s even when empty",
    (targetPath) => {
      expectViolation({ [targetPath]: "" }, "retired-file", targetPath);
    },
  );

  it.each([
    "export function installMainWindowMediaPermissionHandler() {}",
    "export const shouldAllowMainWindowMediaPermission = () => true;",
    'import { installMainWindowMediaPermissionHandler as hidden } from "./other";',
  ])("rejects renamed legacy symbols in actual syntax: %s", (source) => {
    expectViolation(
      { "electron/renamed.ts": source },
      "retired-identifier",
      "electron/renamed.ts",
    );
  });

  it.each([
    'import "./mainWindowMediaPermissions";',
    'export * from "./mainWindowMediaPermissions.js";',
    'const legacy = require("./mainWindowMediaPermissions");',
    'const legacy = import("./mainWindowMediaPermissions.ts");',
  ])("rejects actual old module references: %s", (source) => {
    expectViolation(
      { "electron/renamed.ts": source },
      "retired-import",
      "electron/renamed.ts",
    );
  });

  it.each([
    "session.setPermissionRequestHandler(() => true);",
    "const setter = session.setPermissionCheckHandler;",
    'const setter = session["setPermissionRequestHandler"].bind(session);',
    "const { setPermissionCheckHandler: setter } = session;",
  ])("rejects a second registration owner: %s", (source) => {
    expectViolation(
      { "electron/secondOwner.ts": source },
      "setter-outside-owner",
      "electron/secondOwner.ts",
    );
  });

  it("rejects duplicate installer calls through a legal import alias", () => {
    expectViolation(
      {
        [mainPath]: `${currentSources[mainPath]}\ninstallPermissions({ session: session.defaultSession });`,
      },
      "main-installer-count",
      mainPath,
    );
  });

  it("rejects installation from a second file", () => {
    expectViolation(
      {
        "electron/secondOwner.ts":
          'import { installMainWindowPermissionHandlers as install } from "./mainWindowPermissions"; install({ session });',
      },
      "installer-outside-main",
      "electron/secondOwner.ts",
    );
  });

  it("rejects duplicate setter registration inside the current main owner", () => {
    expectViolation(
      {
        [mainOwner]: `${currentSources[mainOwner]}\nsession.setPermissionRequestHandler(() => false);`,
      },
      "main-setter-count",
      mainOwner,
    );
  });

  it("allows the isolated cloud owner only with both deny-all handlers", () => {
    expect(fixture()).toEqual([]);
  });

  it.each([
    ["callback(false)", "callback(true)"],
    ["callback(false)", 'callback(_permission === "media")'],
    ["callback(false)", "callback()"],
    ["callback(false)", "callback(false, true)"],
    ["callback(false)", "otherCallback(false)"],
    ["() => false", "() => true"],
    ["() => false", '(permission) => permission === "media"'],
    ["() => false", "checkPermission"],
  ])("rejects a cloud policy change from %s to %s", (before, after) => {
    expectViolation(
      { [cloudOwner]: currentSources[cloudOwner].replace(before, after) },
      "cloud-permission-policy",
      cloudOwner,
    );
  });

  it("rejects duplicate cloud setter registrations", () => {
    expectViolation(
      {
        [cloudOwner]: `${currentSources[cloudOwner]}\ncloudSession.setPermissionCheckHandler(() => false);`,
      },
      "cloud-setter-count",
      cloudOwner,
    );
  });

  it("rejects a missing cloud handler", () => {
    expectViolation(
      { [cloudOwner]: "export {};" },
      "cloud-setter-count",
      cloudOwner,
    );
  });

  it("rejects cloud handlers moved outside their registered owner", () => {
    expectViolation(
      { "electron/cloudDesktopWindow.ts": currentSources[cloudOwner] },
      "setter-outside-owner",
      "electron/cloudDesktopWindow.ts",
    );
  });

  it("rejects a missing main installer", () => {
    expectViolation(
      { [mainPath]: "export {};" },
      "main-installer-count",
      mainPath,
    );
  });

  it.each([
    'import { installMainWindowPermissionHandlers } from "./mainWindowPermissions"; installMainWindowPermissionHandlers({ session });',
    'import { installMainWindowPermissionHandlers as renamed } from "./mainWindowPermissions.js"; renamed({ session });',
    'import * as permissions from "./mainWindowPermissions"; permissions.installMainWindowPermissionHandlers({ session });',
  ])("allows one installer under different import forms: %s", (source) => {
    expect(fixture({ [mainPath]: source })).toEqual([]);
  });

  it("ignores comments, unrelated string prose, type strings and ordinary permission tests", () => {
    expect(
      fixture({
        "electron/notes.ts": `
        // installMainWindowMediaPermissionHandler and mainWindowMediaPermissions were removed.
        const prose = "shouldAllowMainWindowMediaPermission session.setPermissionCheckHandler";
        const label = { title: "mainWindowMediaPermissions" };
      `,
        "electron/mainWindowPermissions.test.ts":
          "session.setPermissionRequestHandler(() => false);",
      }),
    ).toEqual([]);
  });
});
