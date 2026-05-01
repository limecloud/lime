export type SessionDetailHydrationErrorCategory =
  | "timeout"
  | "abort"
  | "bridge_health"
  | "bridge_cooldown"
  | "connection"
  | "unknown";

export interface SessionDetailHydrationErrorClassification {
  category: SessionDetailHydrationErrorCategory;
  retryable: boolean;
  transient: boolean;
}

export function getSessionDetailHydrationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  return String(error || "Unknown error");
}

export function classifySessionDetailHydrationError(
  error: unknown,
): SessionDetailHydrationErrorClassification {
  const message = getSessionDetailHydrationErrorMessage(error).toLowerCase();

  if (message.includes("timeout")) {
    return {
      category: "timeout",
      retryable: false,
      transient: true,
    };
  }

  if (message.includes("aborterror") || message.includes("err_aborted")) {
    return {
      category: "abort",
      retryable: false,
      transient: true,
    };
  }

  if (message.includes("bridge health check failed")) {
    return {
      category: "bridge_health",
      retryable: true,
      transient: true,
    };
  }

  if (message.includes("bridge cooldown active")) {
    return {
      category: "bridge_cooldown",
      retryable: true,
      transient: true,
    };
  }

  if (
    message.includes("无法连接后端桥接") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("err_connection_refused") ||
    message.includes("load failed") ||
    message.includes("econnrefused")
  ) {
    return {
      category: "connection",
      retryable: true,
      transient: true,
    };
  }

  return {
    category: "unknown",
    retryable: false,
    transient: false,
  };
}
