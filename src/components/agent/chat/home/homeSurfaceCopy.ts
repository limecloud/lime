export type HomeSurfaceCopyKey =
  | "agentChat.inputbar.suggestions.planMode"
  | "agentChat.inputbar.suggestions.goal"
  | "agentChat.home.composer.placeholder"
  | "agentChat.home.composer.pathReferenceFallbackPrompt";

type HomeSurfaceCopyValue = number | string;

export type HomeSurfaceCopyTranslate = (
  key: HomeSurfaceCopyKey,
  values?: Record<string, HomeSurfaceCopyValue>,
) => string;

export interface HomeSurfaceComposerCopy {
  contextCommands: {
    planMode: string;
    goal: string;
  };
}

export interface HomeSurfaceCopy {
  composerPlaceholder: string;
  composerPathReferenceFallbackPrompt: string;
  composer: HomeSurfaceComposerCopy;
}

export function buildHomeSurfaceCopy(
  translate: HomeSurfaceCopyTranslate,
): HomeSurfaceCopy {
  return {
    composerPlaceholder: translate("agentChat.home.composer.placeholder"),
    composerPathReferenceFallbackPrompt: translate(
      "agentChat.home.composer.pathReferenceFallbackPrompt",
    ),
    composer: {
      contextCommands: {
        planMode: translate("agentChat.inputbar.suggestions.planMode"),
        goal: translate("agentChat.inputbar.suggestions.goal"),
      },
    },
  };
}
