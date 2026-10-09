import { createContext, useContext } from "react";

export const RawReasoningVisibility = createContext(false);

export function useRawReasoningVisibility(): boolean {
  return useContext(RawReasoningVisibility);
}
