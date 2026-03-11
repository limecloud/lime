import { runAutoFixConfiguration, type AutoFixResult } from "@/lib/api/autoFix";

export const useAutoFix = () => {
  const runAutoFix = async (): Promise<AutoFixResult> => {
    return runAutoFixConfiguration();
  };

  return {
    runAutoFix,
  };
};
