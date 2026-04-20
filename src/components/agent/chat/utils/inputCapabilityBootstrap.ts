import type { AgentInitialInputCapabilityParams } from "@/types/page";
import type { GeneralWorkbenchFollowUpActionPayload } from "../components/generalWorkbenchSidebarContract";
import type { InputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";

function normalizeFollowUpCapabilityRoute(params: {
  capabilityRoute: InputCapabilitySendRoute;
  prompt: string;
}): InputCapabilitySendRoute {
  const { capabilityRoute, prompt } = params;
  if (capabilityRoute.kind !== "curated_task") {
    return capabilityRoute;
  }

  return {
    ...capabilityRoute,
    prompt,
  };
}

function getInitialInputCapabilityRequestKey(
  capability?: AgentInitialInputCapabilityParams,
): number {
  return capability?.requestKey ?? 0;
}

export function resolveEffectiveInitialInputCapability(params: {
  bootstrap?: AgentInitialInputCapabilityParams;
  runtime?: AgentInitialInputCapabilityParams;
}): AgentInitialInputCapabilityParams | undefined {
  const { bootstrap, runtime } = params;
  if (!bootstrap) {
    return runtime;
  }
  if (!runtime) {
    return bootstrap;
  }

  return getInitialInputCapabilityRequestKey(runtime) >=
    getInitialInputCapabilityRequestKey(bootstrap)
    ? runtime
    : bootstrap;
}

export function buildRuntimeInitialInputCapabilityFromFollowUpAction(params: {
  payload: GeneralWorkbenchFollowUpActionPayload;
  requestKey: number;
}): AgentInitialInputCapabilityParams | undefined {
  const prompt = params.payload.prompt.trim();
  const capabilityRoute = params.payload.capabilityRoute;
  if (!prompt || !capabilityRoute) {
    return undefined;
  }

  return {
    capabilityRoute: normalizeFollowUpCapabilityRoute({
      capabilityRoute,
      prompt,
    }),
    requestKey: params.requestKey,
  };
}
