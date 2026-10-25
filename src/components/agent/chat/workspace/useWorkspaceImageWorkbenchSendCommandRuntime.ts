import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { readGlobalMediaGenerationDefaults } from "@/hooks/useGlobalMediaGenerationDefaults";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  resolveMediaGenerationPreference,
  type MediaGenerationDefaults,
} from "@/lib/mediaGeneration";
import type { WorkspaceMediaGenerationSettings } from "@/types/workspace";
import type { MessageImage } from "../types";
import type { ParsedImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  buildImageCommandIntentRequestMetadata,
  resolveImageWorkbenchCommandRequest,
  type ImageWorkbenchCommandRequest,
} from "./imageCommandIntent";
import { ensureImageWorkbenchProviderSelectionCommitted } from "./imageWorkbenchProviderReadiness";
import {
  applyImagePreferenceToSendRouteSelection,
  type ImageWorkbenchSendRouteSelection,
} from "./imageWorkbenchSendRoute";
import type {
  ImageWorkbenchApplyTarget,
  SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import type { SubmitImageWorkbenchAgentCommandParams } from "./imageWorkbenchAgentCommand";

interface UseWorkspaceImageWorkbenchSendCommandRuntimeParams {
  contentId?: string | null;
  currentImageWorkbenchState: SessionImageWorkbenchState;
  ensureImageWorkbenchProvidersLoaded?: () => void | Promise<void>;
  imageWorkbenchPreferredModelId?: string;
  imageWorkbenchPreferredProviderId?: string;
  imageWorkbenchPreferredProviderUnavailable: boolean;
  imageWorkbenchProvidersLoading: boolean;
  imageWorkbenchSelectedModelId?: string;
  imageWorkbenchSelectedProviderId?: string;
  imageWorkbenchSelectedSize: string;
  imageWorkbenchSessionKey: string;
  projectId?: string | null;
  projectImageGenerationPreference?: WorkspaceMediaGenerationSettings | null;
  projectRootPath?: string | null;
  setOnDemandMediaDefaults: Dispatch<SetStateAction<MediaGenerationDefaults>>;
}

interface ResolveImageWorkbenchSendCommandRequestParams {
  rawText: string;
  parsedCommand: ParsedImageWorkbenchCommand;
  images: MessageImage[];
  sessionIdOverride?: string | null;
  applyTarget?: ImageWorkbenchApplyTarget | null;
  entrySource?: string;
  projectId?: string | null;
  projectRootPath?: string | null;
}

function resolveImageWorkbenchSendRouteSelection({
  preferredModelId,
  preferredProviderId,
  preferredProviderUnavailable,
  providersLoading,
  selectedModelId,
  selectedProviderId,
}: {
  preferredModelId?: string;
  preferredProviderId?: string;
  preferredProviderUnavailable: boolean;
  providersLoading: boolean;
  selectedModelId?: string;
  selectedProviderId?: string;
}): ImageWorkbenchSendRouteSelection {
  const requestProviderId =
    selectedProviderId ||
    (!preferredProviderUnavailable ? preferredProviderId : undefined);
  const requestModelId =
    selectedModelId ||
    (requestProviderId &&
    (!preferredProviderId || preferredProviderId === requestProviderId)
      ? preferredModelId
      : undefined);

  return {
    preferredProviderUnavailable,
    providersLoading,
    requestModelId,
    requestProviderId,
  };
}

export function useWorkspaceImageWorkbenchSendCommandRuntime({
  contentId,
  currentImageWorkbenchState,
  ensureImageWorkbenchProvidersLoaded,
  imageWorkbenchPreferredModelId,
  imageWorkbenchPreferredProviderId,
  imageWorkbenchPreferredProviderUnavailable,
  imageWorkbenchProvidersLoading,
  imageWorkbenchSelectedModelId,
  imageWorkbenchSelectedProviderId,
  imageWorkbenchSelectedSize,
  imageWorkbenchSessionKey,
  projectId,
  projectImageGenerationPreference,
  projectRootPath,
  setOnDemandMediaDefaults,
}: UseWorkspaceImageWorkbenchSendCommandRuntimeParams) {
  const { t } = useTranslation("agent");
  const workspaceHandleSendRef =
    useRef<MutableRefObject<WorkspaceHandleSend> | null>(null);
  const imageWorkbenchSelectionRef = useRef<ImageWorkbenchSendRouteSelection>(
    resolveImageWorkbenchSendRouteSelection({
      preferredModelId: imageWorkbenchPreferredModelId,
      preferredProviderId: imageWorkbenchPreferredProviderId,
      preferredProviderUnavailable: imageWorkbenchPreferredProviderUnavailable,
      providersLoading: imageWorkbenchProvidersLoading,
      selectedModelId: imageWorkbenchSelectedModelId,
      selectedProviderId: imageWorkbenchSelectedProviderId,
    }),
  );

  useEffect(() => {
    imageWorkbenchSelectionRef.current =
      resolveImageWorkbenchSendRouteSelection({
        preferredModelId: imageWorkbenchPreferredModelId,
        preferredProviderId: imageWorkbenchPreferredProviderId,
        preferredProviderUnavailable:
          imageWorkbenchPreferredProviderUnavailable,
        providersLoading: imageWorkbenchProvidersLoading,
        selectedModelId: imageWorkbenchSelectedModelId,
        selectedProviderId: imageWorkbenchSelectedProviderId,
      });
  }, [
    imageWorkbenchPreferredModelId,
    imageWorkbenchPreferredProviderId,
    imageWorkbenchPreferredProviderUnavailable,
    imageWorkbenchProvidersLoading,
    imageWorkbenchSelectedModelId,
    imageWorkbenchSelectedProviderId,
  ]);

  const bindWorkspaceHandleSendRef = useCallback(
    (handleSendRef: MutableRefObject<WorkspaceHandleSend>) => {
      workspaceHandleSendRef.current = handleSendRef;
    },
    [],
  );

  const refreshImageWorkbenchSendRoute = useCallback(async () => {
    try {
      const latestMediaDefaults = await readGlobalMediaGenerationDefaults({
        forceRefresh: true,
      });
      setOnDemandMediaDefaults(latestMediaDefaults);
      const latestPreference = resolveMediaGenerationPreference(
        projectImageGenerationPreference,
        latestMediaDefaults.image,
      );
      imageWorkbenchSelectionRef.current =
        applyImagePreferenceToSendRouteSelection({
          preference: latestPreference,
          selection: imageWorkbenchSelectionRef.current,
        });
    } catch (error) {
      logAgentDebug(
        "LocalConversationPage",
        "imageWorkbench.sendRoute.refresh.failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }, [projectImageGenerationPreference, setOnDemandMediaDefaults]);

  const prepareImageWorkbenchSkillSend = useCallback(async () => {
    await refreshImageWorkbenchSendRoute();
    const selectionBeforeProviderLoad = imageWorkbenchSelectionRef.current;
    await ensureImageWorkbenchProviderSelectionCommitted(
      selectionBeforeProviderLoad.requestProviderId &&
        selectionBeforeProviderLoad.requestModelId
        ? undefined
        : ensureImageWorkbenchProvidersLoaded,
      () => {
        const selection = imageWorkbenchSelectionRef.current;
        return Boolean(selection.requestProviderId && selection.requestModelId);
      },
    );

    const selection = imageWorkbenchSelectionRef.current;
    if (selection.preferredProviderUnavailable) {
      toast.error(t("agentChat.imageWorkbench.selection.preferredUnavailable"));
      return false;
    }
    if (selection.requestProviderId && selection.requestModelId) {
      return true;
    }
    if (selection.providersLoading) {
      toast.error(t("agentChat.imageWorkbench.selection.loading"));
      return false;
    }
    toast.error(t("agentChat.imageWorkbench.selection.missing"));
    return false;
  }, [ensureImageWorkbenchProvidersLoaded, refreshImageWorkbenchSendRoute, t]);

  const resolveImageWorkbenchSendCommandRequest = useCallback(
    ({
      applyTarget,
      images,
      parsedCommand,
      projectId: requestProjectId,
      projectRootPath: requestProjectRootPath,
      rawText,
      sessionIdOverride,
      entrySource,
    }: ResolveImageWorkbenchSendCommandRequestParams): ImageWorkbenchCommandRequest | null =>
      resolveImageWorkbenchCommandRequest({
        rawText,
        parsedCommand,
        images,
        currentImageWorkbenchState,
        imageWorkbenchSelectedModelId:
          imageWorkbenchSelectionRef.current.requestModelId,
        imageWorkbenchSelectedProviderId:
          imageWorkbenchSelectionRef.current.requestProviderId,
        imageWorkbenchSelectedSize,
        imageWorkbenchSessionKey,
        sessionIdOverride,
        projectId: requestProjectId ?? projectId,
        projectRootPath: requestProjectRootPath ?? projectRootPath,
        contentId,
        applyTarget,
        entrySource,
        requireProjectContext: applyTarget != null,
      }),
    [
      contentId,
      currentImageWorkbenchState,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      projectId,
      projectRootPath,
    ],
  );

  const submitImageWorkbenchAgentCommand = useCallback(
    async (params: SubmitImageWorkbenchAgentCommandParams) => {
      const handleSend = workspaceHandleSendRef.current?.current;
      if (!handleSend) {
        return { kind: "rejected" as const };
      }

      return await handleSend(
        params.images,
        undefined,
        undefined,
        params.rawText,
        undefined,
        undefined,
        {
          displayContent: params.displayContent,
          requestMetadata: buildImageCommandIntentRequestMetadata(
            undefined,
            params.requestContext,
          ),
        },
      );
    },
    [],
  );

  return {
    bindWorkspaceHandleSendRef,
    prepareImageWorkbenchSkillSend,
    resolveImageWorkbenchCommandRequest:
      resolveImageWorkbenchSendCommandRequest,
    submitImageWorkbenchAgentCommand,
  };
}
