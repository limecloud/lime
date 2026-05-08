export interface InputbarKnowledgePackOption {
  packName: string;
  label?: string;
  status?: string;
  defaultForWorkspace?: boolean;
  runtimeMode?: "persona" | "data";
}

export interface InputbarKnowledgePackSelection {
  enabled: boolean;
  packName: string;
  workingDir: string;
  label?: string;
  status?: string;
  companionPacks?: Array<{
    name: string;
    activation?: "explicit" | "implicit" | "resolver-driven";
  }>;
}
