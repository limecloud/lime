import { describe, expect, it } from "vitest";
import catalog from "../src/lib/governance/agentCommandCatalog.json";
import { BROWSER_TAB_COMMANDS } from "./browserTabCommands";
import { ELECTRON_HOST_COMMANDS } from "./ipcChannels";

describe("Browser command transport boundary", () => {
  it("every canonical native command is available through preload and classified in the catalog", () => {
    expect(new Set(catalog.browserTabHostCommands)).toEqual(
      new Set(BROWSER_TAB_COMMANDS),
    );
    for (const command of BROWSER_TAB_COMMANDS)
      expect(ELECTRON_HOST_COMMANDS).toContain(command);
  });
});
