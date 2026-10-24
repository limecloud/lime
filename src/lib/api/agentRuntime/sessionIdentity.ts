const NON_USER_FACING_AGENT_SESSION_ID_PREFIXES = [
  "title-gen-",
  "persona-gen-",
  "__lime_theme_context_search__-",
  "persisted-usage-",
];

export function isAuxiliaryAgentSessionId(sessionId?: string | null): boolean {
  const normalizedSessionId = sessionId?.trim().toLowerCase() || "";
  if (!normalizedSessionId) {
    return false;
  }

  return NON_USER_FACING_AGENT_SESSION_ID_PREFIXES.some((prefix) =>
    normalizedSessionId.startsWith(prefix),
  );
}
