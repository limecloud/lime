export interface InputbarKnowledgePackOption {
  packName: string;
  label?: string;
  status?: string;
  defaultForWorkspace?: boolean;
}

export interface InputbarKnowledgePackSelection {
  enabled: boolean;
  packName: string;
  workingDir: string;
  label?: string;
  status?: string;
}
