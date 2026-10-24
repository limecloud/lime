import { expect, it } from "vitest";
import {
  effectiveBrowserSettings,
  browserPermissionForUrl,
  browserPreferences,
} from "./browserSettingsTypes";
import {
  assertBrowserRequirements,
  managedBrowserAccessApprovalLifetime,
} from "./browserUseRequirements";
import { browserSitePermissionCell } from "./browserUsePolicySitePermissions";
import type { BrowserPermissionAction } from "./browserSettingsTypes";

const open = {
  approvalMode: "neverAsk",
  downloadApprovalMode: "neverAsk",
  uploadApprovalMode: "neverAsk",
  fullCdpAccessEnabled: true,
  webMcpEnabled: true,
} as const;
const url = "https://docs.example.com:8443/path";

it.each<BrowserPermissionAction>([
  "browse",
  "download",
  "upload",
  "debug",
  "site_tools",
])("global enterprise deny blocks %s despite user grants", (action) => {
  const settings = effectiveBrowserSettings(open, null, {
    allowBrowserAndComputerUse: false,
  });
  expect(browserPermissionForUrl(settings, action, url)).toBe("deny");
  expect(settings.enabled).toBe(true);
  expect(browserPreferences(settings)).not.toHaveProperty("requirements");
});

it("combines independent managed and user origin rules without treating managed allow as approval", () => {
  const settings = effectiveBrowserSettings(
    { allowedOrigins: ["docs.example.com"] },
    {
      origins: { "docs.example.com": { downloads: "deny" } },
    },
    {
      browserUse: {
        defaultOriginPolicy: { access: "deny" },
        origins: { "*.example.com": { access: "allow", uploads: "deny" } },
      },
    },
  );
  expect(browserPermissionForUrl(settings, "browse", url)).toBe("allow");
  expect(
    browserPermissionForUrl(settings, "browse", "https://other.example.com"),
  ).toBe("ask");
  expect(
    browserPermissionForUrl(settings, "browse", "https://elsewhere.com"),
  ).toBe("deny");
  expect(browserPermissionForUrl(settings, "download", url)).toBe("deny");
  expect(browserPermissionForUrl(settings, "upload", url)).toBe("deny");
});

it("matching managed denials beat permissive aliases, user grants and broader exceptions", () => {
  const settings = effectiveBrowserSettings(open, null, {
    browserUse: {
      origins: {
        "*.example.com": { access: "allow" },
        "https://docs.example.com:8443": { access: "deny" },
      },
    },
  });
  expect(browserPermissionForUrl(settings, "debug", url)).toBe("deny");
  expect(
    browserPermissionForUrl(settings, "browse", "http://docs.example.com:8443"),
  ).toBe("allow");
  expect(
    browserPermissionForUrl(settings, "browse", "https://docs.example.com"),
  ).toBe("allow");
  const aliases = effectiveBrowserSettings(open, null, {
    browserUse: {
      defaultOriginPolicy: { access: "deny" },
      origins: {
        "EXAMPLE.com": { access: "allow" },
        "example.com/": { access: "allow" },
      },
    },
  });
  expect(
    browserPermissionForUrl(aliases, "browse", "https://example.com"),
  ).toBe("deny");
});

it("history and WebMCP enterprise restrictions retain the user's saved preferences", () => {
  const settings = effectiveBrowserSettings(
    { ...open, iabHistoryApprovalMode: "neverAsk" },
    null,
    { browserUse: { allowHistoryAccess: false, allowWebmcp: false } },
  );
  expect(settings.history_access).toBe("disabled");
  expect(settings.iabHistoryApprovalMode).toBe("neverAsk");
  expect(settings.webMcpEnabled).toBe(true);
  expect(browserPermissionForUrl(settings, "site_tools", url)).toBe("deny");
});

it("forbids global remembered approval while allowing an explicit site choice where policy permits it", () => {
  const settings = effectiveBrowserSettings(
    { ...open, allowedOrigins: ["docs.example.com"] },
    null,
    { browserUse: { allowGlobalPersistentApproval: false } },
  );
  expect(
    browserPermissionForUrl(settings, "browse", "https://other.example.com"),
  ).toBe("ask");
  expect(browserPermissionForUrl(settings, "browse", url)).toBe("allow");
});

it.each([
  { persistentApproval: false },
  { accessApprovalLifetime: "turn" as const },
  { accessApprovalLifetime: "thread" as const },
])(
  "requires a scoped receipt instead of accepting a saved cross-thread grant: %j",
  (restriction) => {
    const settings = effectiveBrowserSettings(
      { ...open, allowedOrigins: ["docs.example.com"] },
      null,
      { browserUse: { origins: { "*.example.com": restriction } } },
    );
    expect(browserPermissionForUrl(settings, "browse", url)).toBe("ask");
    expect(
      browserSitePermissionCell(settings, null, "browse", "docs.example.com"),
    ).toMatchObject({
      effectiveValue: "ask",
      inheritedRestriction: "organization",
    });
  },
);

it("projects a partial enterprise overlap without fabricating a representative URL", () => {
  const settings = effectiveBrowserSettings(open, null, {
    browserUse: {
      origins: {
        "https://private.example.com": { access: "deny" },
      },
    },
  });
  expect(
    browserSitePermissionCell(settings, null, "browse", "*.example.com"),
  ).toMatchObject({
    effectiveValue: "mixed",
    inheritedRestriction: "organization",
  });
  expect(
    browserSitePermissionCell(
      settings,
      null,
      "upload",
      "https://private.example.com",
    ),
  ).toMatchObject({
    effectiveValue: "deny",
    managed: true,
    disabledReason: "managed",
  });
});

it("resolves explicit thread lifetime with turn restrictions and canonical aliases taking precedence", () => {
  const target = new URL(url);
  expect(managedBrowserAccessApprovalLifetime(null, target)).toBe("thread");
  expect(
    managedBrowserAccessApprovalLifetime(
      {
        browserUse: {
          defaultOriginPolicy: { accessApprovalLifetime: "turn" },
          origins: { "*.example.com": { accessApprovalLifetime: "thread" } },
        },
      },
      target,
    ),
  ).toBe("thread");
  expect(
    managedBrowserAccessApprovalLifetime(
      {
        browserUse: {
          defaultOriginPolicy: { accessApprovalLifetime: "thread" },
          origins: {
            "*.example.com": { accessApprovalLifetime: "turn" },
            "https://docs.example.com:8443": {
              accessApprovalLifetime: "thread",
            },
          },
        },
      },
      target,
    ),
  ).toBe("turn");
  expect(
    managedBrowserAccessApprovalLifetime(
      {
        browserUse: {
          defaultOriginPolicy: { accessApprovalLifetime: "turn" },
          origins: {
            "DOCS.example.com": { accessApprovalLifetime: "thread" },
            "docs.example.com/": { accessApprovalLifetime: "thread" },
          },
        },
      },
      target,
    ),
  ).toBe("turn");
});

it.each([
  undefined,
  [],
  { browserUse: false },
  { allowBrowserAndComputerUse: "false" },
  { browserUse: { allowWebmcp: 1 } },
  { browserUse: { origins: { "https://example.com/path": {} } } },
  { browserUse: { defaultOriginPolicy: { access: "ask" } } },
  {
    browserUse: {
      origins: { "example.com": { accessApprovalLifetime: "session" } },
    },
  },
  {
    browserUse: {
      extension: { requestHeaders: [{ name: "x", value: false }] },
    },
  },
])(
  "rejects malformed browser authority rather than treating it as unrestricted: %j",
  (policy) => {
    expect(() => assertBrowserRequirements(policy)).toThrow();
  },
);
