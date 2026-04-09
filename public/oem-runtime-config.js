window.__LIME_OEM_CLOUD__ = {
  enabled: true,
  baseUrl: "https://user.limeai.run",
  gatewayBaseUrl: "https://gateway-api.limeai.run",
  hubProviderName: "Lime Hub",
  tenantId: "tenant-0001",
  loginPath: "/login",
  desktopClientId: "desktop-client",
  desktopOauthRedirectUrl: "lime://oauth/callback",
  desktopOauthNextPath: "/welcome",
  ...(window.__LIME_OEM_CLOUD__ ?? {}),
};

/*
Replace this file during packaging when you need brand-specific runtime values.

Example:

window.__LIME_OEM_CLOUD__ = {
  enabled: true,
  baseUrl: "https://limehub.example.com",
  gatewayBaseUrl: "https://limehub.example.com/gateway-api",
  hubProviderName: "Lime Hub",
  tenantId: "tenant-demo",
  loginPath: "/login",
  desktopClientId: "desktop-client",
  desktopOauthRedirectUrl: "lime://oauth/callback",
  desktopOauthNextPath: "/welcome",
};

window.__LIME_SESSION_TOKEN__ = "session-token-from-login";
*/
