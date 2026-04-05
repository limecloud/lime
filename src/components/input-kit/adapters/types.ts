import type {
  ComposerActions,
  ComposerState,
  ModelSelectionState,
} from "../types";

export interface ChatInputAdapter {
  state: ComposerState;
  model?: ModelSelectionState;
  actions: ComposerActions;
  ui: {
    showModelSelector: boolean;
    showToolBar: boolean;
  };
}
