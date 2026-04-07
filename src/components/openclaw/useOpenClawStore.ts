import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  OpenClawLastSynced,
  OpenClawOperationHistoryEntry,
} from "./types";

interface OpenClawStoreState {
  selectedProviderId: string | null;
  selectedModelId: string;
  gatewayPort: number;
  preferredRuntimeId: string | null;
  lastSynced: OpenClawLastSynced | null;
  recentOperation: OpenClawOperationHistoryEntry | null;
  setSelectedProviderId: (providerId: string | null) => void;
  setSelectedModelId: (modelId: string) => void;
  setGatewayPort: (port: number) => void;
  setPreferredRuntimeId: (runtimeId: string | null) => void;
  setLastSynced: (lastSynced: OpenClawLastSynced | null) => void;
  setRecentOperation: (
    recentOperation: OpenClawOperationHistoryEntry | null,
  ) => void;
  clearLastSynced: () => void;
  clearRecentOperation: () => void;
}

export const useOpenClawStore = create<OpenClawStoreState>()(
  persist(
    (set) => ({
      selectedProviderId: null,
      selectedModelId: "",
      gatewayPort: 18790,
      preferredRuntimeId: null,
      lastSynced: null,
      recentOperation: null,
      setSelectedProviderId: (selectedProviderId) =>
        set({ selectedProviderId }),
      setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
      setGatewayPort: (gatewayPort) => set({ gatewayPort }),
      setPreferredRuntimeId: (preferredRuntimeId) =>
        set({ preferredRuntimeId }),
      setLastSynced: (lastSynced) => set({ lastSynced }),
      setRecentOperation: (recentOperation) => set({ recentOperation }),
      clearLastSynced: () => set({ lastSynced: null }),
      clearRecentOperation: () => set({ recentOperation: null }),
    }),
    {
      name: "lime:openclaw-module",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export default useOpenClawStore;
