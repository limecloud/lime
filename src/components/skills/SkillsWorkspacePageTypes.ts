import type { TFunction } from "i18next";
import type { LocalSkillPackageFileEntry } from "@/lib/api/skills";
import type { SkillsWorkspaceView } from "./SkillsWorkspacePageViewModel";

export type MarketplaceSkillActionState =
  | "not_installed"
  | "installing"
  | "installed"
  | "builtin"
  | "uninstalling"
  | "local_fallback";

export type MarketplaceSkillDetailContentState =
  | {
      skillName: string;
      status: "loading";
    }
  | {
      skillName: string;
      status: "ready";
      content: string;
    }
  | {
      skillName: string;
      status: "error";
      message: string;
    };

export type InstalledSkillDetailContentState =
  | {
      directory: string;
      status: "loading";
    }
  | {
      directory: string;
      status: "ready";
      content: string;
      files: LocalSkillPackageFileEntry[];
    }
  | {
      directory: string;
      status: "error";
      message: string;
    };

export type SkillsWorkspaceTranslate = TFunction<"agent">;

export interface SkillsWorkspaceProjectState {
  id: string | null;
  name?: string | null;
  rootPath: string | null;
  pending: boolean;
  error: string | null;
}

export interface SkillsWorkspaceViewTab {
  key: SkillsWorkspaceView;
  label: string;
  count?: number;
}
