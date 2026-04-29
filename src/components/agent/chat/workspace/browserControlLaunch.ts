import {
  BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE,
  resolveBrowserControlRuntimeContractBinding,
} from "@/lib/governance/modalityRuntimeContracts";
import type { ParsedBrowserWorkbenchCommand } from "../utils/browserWorkbenchCommand";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function buildBrowserControlLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  parsedCommand: ParsedBrowserWorkbenchCommand,
): Record<string, unknown> {
  const runtimeContract = resolveBrowserControlRuntimeContractBinding();
  const existingHarness = asRecord(existingMetadata?.harness) || {};
  const existingBrowserAssist =
    asRecord(existingHarness.browser_assist) ||
    asRecord(existingHarness.browserAssist) ||
    {};

  return {
    ...(existingMetadata || {}),
    harness: {
      ...existingHarness,
      browser_requirement: parsedCommand.browserRequirement,
      browser_requirement_reason: parsedCommand.browserRequirementReason,
      browser_launch_url: parsedCommand.launchUrl,
      browser_user_step_required:
        parsedCommand.browserRequirement === "required_with_user_step",
      browser_assist: {
        ...existingBrowserAssist,
        enabled: true,
        launch_url: parsedCommand.launchUrl,
        modality_contract_key: runtimeContract.contractKey,
        modality: runtimeContract.modality,
        required_capabilities: runtimeContract.requiredCapabilities,
        routing_slot: runtimeContract.routingSlot,
        runtime_contract: runtimeContract.runtimeContract,
        entry_source: BROWSER_CONTROL_DEFAULT_ENTRY_SOURCE,
        requirement: parsedCommand.browserRequirement,
        requirement_reason: parsedCommand.browserRequirementReason,
        prompt: parsedCommand.prompt || parsedCommand.body,
      },
    },
  };
}
