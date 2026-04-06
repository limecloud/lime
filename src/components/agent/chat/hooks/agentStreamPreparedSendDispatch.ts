import type { PreparedAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
import { maybeHandleSlashSkillBeforeSend } from "./agentStreamSlashSkillPreflight";
import { submitAgentStreamUserInput } from "./agentStreamUserInputSubmission";

interface DispatchPreparedAgentStreamSendOptions {
  preparedSend: PreparedAgentStreamUserInputSend;
  env: AgentStreamPreparedSendEnv;
}

export async function dispatchPreparedAgentStreamSend(
  options: DispatchPreparedAgentStreamSendOptions,
) {
  const { preparedSend, env } = options;

  if (
    await maybeHandleSlashSkillBeforeSend({
      preparedSend,
      env,
    })
  ) {
    return;
  }

  await env.runPreparedSubmit(() =>
    submitAgentStreamUserInput({
      preparedSend,
      env,
    }),
  );
}
