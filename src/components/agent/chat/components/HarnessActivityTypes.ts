import type {
  HarnessFileKind,
  HarnessSessionState,
} from "../utils/harnessState";

export type TranslationFunction = (key: never, options?: never) => unknown;
export type FileFilterValue = "all" | HarnessFileKind;
export type FileDisplayMode = "timeline" | "grouped";

export interface HarnessEnvironmentSummary {
  skillsCount: number;
  skillNames: string[];
  memorySignals: string[];
}

export interface FileEventGroup {
  key: string;
  path: string;
  displayName: string;
  kind: HarnessFileKind;
  latestEvent: HarnessSessionState["recentFileEvents"][number];
  count: number;
  events: HarnessSessionState["recentFileEvents"];
  actionSummary: string;
}

export interface FilePreviewRequest {
  title: string;
  description?: string;
  path?: string;
  content?: string;
  preview?: string;
}
