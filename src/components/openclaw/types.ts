import type { OpenClawSubpage } from "@/types/page";

export type { OpenClawSubpage };

export type OpenClawOperationKind =
  | "install"
  | "uninstall"
  | "restart"
  | "repair"
  | "update";
export type OpenClawScene = "setup" | "sync" | "dashboard";

export interface OpenClawLastSynced {
  providerId: string;
  modelId: string;
}

export interface OpenClawOperationState {
  kind: OpenClawOperationKind | null;
  target: "openclaw" | "node" | "git" | "cleanup" | "environment" | null;
  running: boolean;
  title: string | null;
  description: string | null;
  message: string | null;
  returnSubpage: OpenClawSubpage;
}

export interface OpenClawSceneDefinition {
  id: OpenClawScene;
  title: string;
  description: string;
}

export interface OpenClawSceneStatus {
  label: string;
  tone: string;
}
