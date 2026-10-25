import { getConfig, updateConfig } from "./appConfig";

export interface GitPreferences {
  "branch-prefix": string;
  "always-force-push": boolean;
  "create-draft-pull-requests": boolean;
  "pull-request-merge-method": "merge" | "squash";
  "review-delivery": "inline" | "detached";
  "commit-instructions": string;
  "pull-request-instructions": string;
}

export const DEFAULT_GIT_PREFERENCES: Readonly<GitPreferences> = {
  "branch-prefix": "lime/",
  "always-force-push": false,
  "create-draft-pull-requests": true,
  "pull-request-merge-method": "merge",
  "review-delivery": "inline",
  "commit-instructions": "",
  "pull-request-instructions": "",
};

export function effectiveGitPreferences(
  config?: Partial<GitPreferences>,
): GitPreferences {
  return { ...DEFAULT_GIT_PREFERENCES, ...config };
}

export async function getGitPreferences(options?: {
  forceRefresh?: boolean;
}): Promise<GitPreferences> {
  return effectiveGitPreferences((await getConfig(options)).git);
}

export async function updateGitPreference<K extends keyof GitPreferences>(
  key: K,
  value: GitPreferences[K],
): Promise<GitPreferences> {
  const config = await updateConfig((current) => ({
    ...current,
    git: { ...current.git, [key]: value },
  }));
  return effectiveGitPreferences(config.git);
}
