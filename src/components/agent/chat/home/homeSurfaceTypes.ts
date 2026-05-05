export type HomeSkillCategory =
  | "recent"
  | "social"
  | "video"
  | "visual_design"
  | "editor"
  | "audio_music"
  | "other";

export type HomeSkillSourceKind =
  | "curated_task"
  | "service_skill"
  | "installed_skill"
  | "scene_app"
  | "skill_catalog_scene";

export type HomeSkillLaunchKind =
  | "curated_task_launcher"
  | "service_skill"
  | "installed_skill"
  | "scene_app"
  | "skill_catalog_scene"
  | "prefill_prompt"
  | "open_knowledge_hub"
  | "toggle_guide"
  | "open_drawer"
  | "open_manager"
  | "launch_browser"
  | "resume_recent_session"
  | "resume_recent_scene_app";

export interface HomeSkillSurfaceItem {
  id: string;
  title: string;
  summary: string;
  category: HomeSkillCategory;
  sourceKind: HomeSkillSourceKind;
  launchKind: HomeSkillLaunchKind;
  coverToken: string;
  isRecent: boolean;
  isRecommended: boolean;
  usedAt: number | null;
  testId?: string;
  badge?: string;
  linkedSkillId?: string;
  launchPrompt?: string;
  placeholder?: string;
}

export interface HomeStarterChip {
  id: string;
  label: string;
  launchKind: HomeSkillLaunchKind;
  targetItemId?: string;
  category?: HomeSkillCategory;
  primary?: boolean;
  testId?: string;
  prompt?: string;
  groupKey?: string;
  iconToken?: string;
}

export interface HomeSkillSection {
  id: HomeSkillCategory;
  title: string;
  items: HomeSkillSurfaceItem[];
}

export interface HomeGuideCard {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  groupKey?: string;
  iconToken?: string;
  testId?: string;
}

export interface HomeInputSuggestion {
  id: string;
  label: string;
  prompt: string;
  order: number;
  testId?: string;
}
