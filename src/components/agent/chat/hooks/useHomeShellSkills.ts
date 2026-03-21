import { useLimeSkills } from "./useLimeSkills";

export function useHomeShellSkills() {
  return useLimeSkills({
    autoLoad: "deferred",
    logScope: "useHomeShellSkills",
  });
}
