import assert from "node:assert/strict";

const bundleId = "com.kingsoft.wpsoffice.mac";

// Test-only adapter selection. The other channel must remain disabled.
export function wpsFixtureAdapter(kind = "office") {
  assert(["native", "office"].includes(kind), "supported WPS fixture adapter");
  return {
    kind,
    inactiveKind: kind === "native" ? "office" : "native",
    features: {
      computer_use: kind === "native",
      chrome_use: false,
      office_use: kind === "office",
    },
    selectTarget(targets, title) {
      const matches = (targets ?? []).filter((target) =>
        kind === "native"
          ? target.type === "native" &&
            target.appId === bundleId &&
            target.title === title &&
            Number.isSafeInteger(target.processId) &&
            target.processId > 0 &&
            typeof target.windowId === "string" &&
            target.windowId.length > 0
          : target.type === "office" &&
            target.host === "WPS" &&
            target.workbookName === title &&
            typeof target.workbookId === "string" &&
            target.workbookId.length > 0 &&
            typeof target.sessionId === "string" &&
            target.sessionId.length > 0,
      );
      assert(matches.length <= 1, "ambiguous WPS fixture windows");
      return matches[0];
    },
  };
}
