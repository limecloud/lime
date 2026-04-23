import type {
  SceneAppExecutionPromptAction,
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import type { InputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";
import type { GeneralWorkbenchFollowUpActionPayload } from "../components/generalWorkbenchSidebarContract";

function resolveSceneAppExecutionRuntimeSceneKey(params: {
  summary?: SceneAppExecutionSummaryViewModel | null;
  detailView?: SceneAppRunDetailViewModel | null;
}): string | undefined {
  const linkedSceneKey =
    params.summary?.descriptorSnapshot?.linkedSceneKey?.trim() || "";
  if (linkedSceneKey) {
    return linkedSceneKey;
  }

  const entryAction = params.detailView?.entryAction;
  if (entryAction?.kind === "open_service_scene_session") {
    const sceneKey = entryAction.serviceSceneRuntimeRef.sceneKey?.trim() || "";
    if (sceneKey) {
      return sceneKey;
    }
  }

  const sceneappId = params.summary?.sceneappId?.trim() || "";
  return sceneappId || undefined;
}

function resolveSceneAppExecutionPromptActionCapabilityRoute(params: {
  action: SceneAppExecutionPromptAction;
  summary?: SceneAppExecutionSummaryViewModel | null;
  detailView?: SceneAppRunDetailViewModel | null;
}): InputCapabilitySendRoute | undefined {
  const { action } = params;

  switch (action.key) {
    case "publish_check":
      return {
        kind: "builtin_command",
        commandKey: "publish_compliance",
        commandPrefix: "@发布合规",
      };
    case "publish_prepare":
      return {
        kind: "builtin_command",
        commandKey: "publish_runtime",
        commandPrefix: "@发布",
      };
    case "channel_preview":
      return {
        kind: "builtin_command",
        commandKey: "channel_preview_runtime",
        commandPrefix: "@渠道预览",
      };
    case "upload_prepare":
      return {
        kind: "builtin_command",
        commandKey: "upload_runtime",
        commandPrefix: "@上传",
      };
    case "fill_missing_parts": {
      const sceneKey = resolveSceneAppExecutionRuntimeSceneKey(params);
      if (!sceneKey) {
        return undefined;
      }

      return {
        kind: "runtime_scene",
        sceneKey,
        commandPrefix: `/${sceneKey}`,
      };
    }
    default:
      return undefined;
  }
}

export function buildSceneAppExecutionPromptActionPayload(params: {
  action: SceneAppExecutionPromptAction;
  summary?: SceneAppExecutionSummaryViewModel | null;
  detailView?: SceneAppRunDetailViewModel | null;
}): GeneralWorkbenchFollowUpActionPayload | null {
  const prompt = params.action.prompt.trim();
  if (!prompt) {
    return null;
  }

  const capabilityRoute =
    resolveSceneAppExecutionPromptActionCapabilityRoute(params);

  return {
    prompt,
    bannerMessage: `已切到“${params.action.label}”这条下一步，可继续改写后发送。`,
    ...(capabilityRoute
      ? {
          capabilityRoute,
        }
      : {}),
  };
}
