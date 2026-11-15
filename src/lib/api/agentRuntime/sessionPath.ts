import { AppServerClient } from "@/lib/api/appServer";
import { getAgentRuntimeSession } from "./sessionClient";

type SessionPathClient = Pick<AppServerClient, "readThread">;

export async function readAgentRuntimeSessionRolloutPath(
  sessionId: string,
  client: SessionPathClient = new AppServerClient(),
): Promise<string | null> {
  const normalized = sessionId.trim();
  if (!normalized) return null;
  const session = await getAgentRuntimeSession(normalized);
  const threadId = session?.thread_id?.trim();
  if (!threadId) return null;
  const { result } = await client.readThread({ threadId });
  return result.thread.path?.trim() || null;
}
