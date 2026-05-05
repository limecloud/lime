import type {
  KnowledgePackDetail,
  KnowledgePackSummary,
} from "@/lib/api/knowledge";
import { KNOWLEDGE_BUILDER_SKILL_NAME } from "./knowledgePromptBuilder";

export function buildKnowledgeRequestMetadata(params: {
  workingDir: string;
  packName: string;
  pack?: KnowledgePackSummary | KnowledgePackDetail | null;
  source?: "knowledge_page" | "inputbar";
}) {
  return {
    knowledge_pack: {
      pack_name: params.packName,
      working_dir: params.workingDir,
      source: params.source ?? "knowledge_page",
      status: params.pack?.metadata.status,
      grounding: params.pack?.metadata.grounding ?? "recommended",
    },
  };
}

export function buildKnowledgeBuilderMetadata(params: {
  workingDir: string;
  packName: string;
  source: "knowledge_page" | "inputbar";
}) {
  return {
    knowledge_builder: {
      skill_name: KNOWLEDGE_BUILDER_SKILL_NAME,
      pack_name: params.packName,
      working_dir: params.workingDir,
      source: params.source,
    },
  };
}
