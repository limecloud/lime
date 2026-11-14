import { AppServerClient } from "@/lib/api/appServer";
import { METHOD_VOICE_REALTIME_CLIENT_SECRET_CREATE } from "../../../packages/app-server-client/src/protocol";

/** App Server 兑换的短时 OpenAI Realtime 凭证。标准 API key 永不下发。 */
export interface RealtimeVoiceClientSecret {
  clientSecret: string;
  expiresAt?: number;
  model: string;
  voice: string;
  callsUrl: string;
  providerId: string;
}

type RealtimeVoiceAppServerClient = Pick<AppServerClient, "request">;

const OFFICIAL_REALTIME_CALLS_PATH = "/v1/realtime/calls";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Renderer 只能把短时 secret 发往官方 OpenAI Realtime SDP endpoint。
 *
 * 这是对 App Server 响应的防御性校验：即使响应被篡改，也不把短时凭证或
 * SDP 发往第三方 host。
 */
function assertOfficialCallsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("App Server returned an invalid Realtime calls URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "api.openai.com" ||
    parsed.pathname !== OFFICIAL_REALTIME_CALLS_PATH ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("App Server returned a non-official Realtime calls URL");
  }
  return parsed.toString();
}

/** 向 App Server 请求一次短时 Realtime client secret。 */
export async function createRealtimeVoiceClientSecret(
  client: RealtimeVoiceAppServerClient = new AppServerClient(),
): Promise<RealtimeVoiceClientSecret> {
  const { result } = await client.request<unknown>(
    METHOD_VOICE_REALTIME_CLIENT_SECRET_CREATE,
    {},
  );
  const source = recordValue(result);
  const clientSecret = nonEmptyString(source?.clientSecret);
  const model = nonEmptyString(source?.model);
  const voice = nonEmptyString(source?.voice);
  const callsUrl = nonEmptyString(source?.callsUrl);
  const providerId = nonEmptyString(source?.providerId);
  if (!clientSecret || !model || !voice || !callsUrl || !providerId) {
    throw new Error(
      "App Server did not return a usable Realtime client secret",
    );
  }
  const expiresAt =
    typeof source?.expiresAt === "number" && Number.isFinite(source.expiresAt)
      ? source.expiresAt
      : undefined;
  return {
    clientSecret,
    expiresAt,
    model,
    voice,
    callsUrl: assertOfficialCallsUrl(callsUrl),
    providerId,
  };
}
