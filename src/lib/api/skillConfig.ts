import { createAppServerClient } from "@/lib/api/appServerClient";
import type { Skill } from "@/lib/api/skills";
import type {
  AppServerSkillsListParams,
  AppServerSkillsListResponse,
} from "./appServerTypes";

export interface ProtocolSkillEnabledState {
  name: string;
  path: string;
  enabled: boolean;
}

type SkillConfigClient = Pick<
  ReturnType<typeof createAppServerClient>,
  "listSkills" | "writeSkillsConfig"
>;

function isAbsoluteSkillPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizeSkillPath(path: string | null | undefined): string {
  return (path ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function skillPathBelongsToDirectory(
  skillFilePath: string,
  directory: string,
): boolean {
  const file = normalizeSkillPath(skillFilePath);
  const root = normalizeSkillPath(directory);
  if (!file || !root) {
    return false;
  }
  if (file === root || file.replace(/\/skill\.md$/i, "") === root) {
    return true;
  }
  return file.startsWith(`${root}/`);
}

export function matchProtocolSkillEnabledState(
  skill: Pick<Skill, "name" | "localDirectoryPath">,
  states: readonly ProtocolSkillEnabledState[],
): ProtocolSkillEnabledState | null {
  const directory = normalizeSkillPath(skill.localDirectoryPath);
  if (directory) {
    const matches = states.filter((state) =>
      skillPathBelongsToDirectory(state.path, directory),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  const name = skill.name.trim();
  if (!name) {
    return null;
  }
  const nameMatches = states.filter((state) => state.name === name);
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export async function listSkills(
  params: AppServerSkillsListParams = {},
  client: Pick<SkillConfigClient, "listSkills"> = createAppServerClient(),
): Promise<AppServerSkillsListResponse> {
  const response = await client.listSkills(params);
  const data = response.result?.data;
  if (!Array.isArray(data)) {
    throw new Error("skills/list did not return data");
  }
  return response.result;
}

export async function listProtocolSkillEnabledStates(
  client: Pick<SkillConfigClient, "listSkills"> = createAppServerClient(),
): Promise<ProtocolSkillEnabledState[]> {
  const { data } = await listSkills({}, client);

  const states: ProtocolSkillEnabledState[] = [];
  for (const entry of data) {
    for (const skill of entry.skills ?? []) {
      const name = skill.name?.trim();
      const path = skill.path?.trim();
      if (!name || !path || typeof skill.enabled !== "boolean") {
        continue;
      }
      if (!isAbsoluteSkillPath(path)) {
        continue;
      }
      states.push({ name, path, enabled: skill.enabled });
    }
  }
  return states;
}

export async function writeProtocolSkillEnabled(
  input: { path: string; enabled: boolean },
  client: Pick<
    SkillConfigClient,
    "writeSkillsConfig"
  > = createAppServerClient(),
): Promise<boolean> {
  const path = input.path.trim();
  if (!isAbsoluteSkillPath(path)) {
    throw new Error("skills/config/write requires an absolute path");
  }
  const response = await client.writeSkillsConfig({
    path,
    enabled: input.enabled,
  });
  if (typeof response.result?.effectiveEnabled !== "boolean") {
    throw new Error("skills/config/write did not return effectiveEnabled");
  }
  return response.result.effectiveEnabled;
}
