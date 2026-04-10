import { createAgentClient } from "./agentClient";
import { createExportClient } from "./exportClient";
import { createInventoryClient } from "./inventoryClient";
import { createMediaClient } from "./mediaClient";
import { createSessionClient } from "./sessionClient";
import { createSiteClient } from "./siteClient";
import { createSubagentClient } from "./subagentClient";
import { createThreadClient } from "./threadClient";
import {
  createAgentRuntimeBridgeInvoke,
  createAgentRuntimeCommandInvoke,
  type AgentRuntimeBridgeInvoke,
  type AgentRuntimeCommandInvoke,
  type AgentRuntimeTransportDeps,
} from "./transport";

export interface AgentRuntimeClientDeps extends AgentRuntimeTransportDeps {
  bridgeInvoke?: AgentRuntimeBridgeInvoke;
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createAgentRuntimeClient({
  bridgeInvoke,
  invoke,
  invokeCommand,
}: AgentRuntimeClientDeps = {}) {
  const resolvedBridgeInvoke =
    bridgeInvoke ?? createAgentRuntimeBridgeInvoke({ invoke });
  const resolvedInvokeCommand =
    invokeCommand ??
    createAgentRuntimeCommandInvoke({
      bridgeInvoke: resolvedBridgeInvoke,
    });

  return {
    ...createAgentClient({ bridgeInvoke: resolvedBridgeInvoke }),
    ...createExportClient({ invokeCommand: resolvedInvokeCommand }),
    ...createInventoryClient({ invokeCommand: resolvedInvokeCommand }),
    ...createMediaClient({ bridgeInvoke: resolvedBridgeInvoke }),
    ...createSessionClient({ invokeCommand: resolvedInvokeCommand }),
    ...createSiteClient({ bridgeInvoke: resolvedBridgeInvoke }),
    ...createSubagentClient({ invokeCommand: resolvedInvokeCommand }),
    ...createThreadClient({ invokeCommand: resolvedInvokeCommand }),
  };
}

export type AgentRuntimeClient = ReturnType<typeof createAgentRuntimeClient>;
