export interface BuildEntry {
  name: string;
  source: string;
  output: string;
}

export const RENDERER_BUILD_ENTRIES: BuildEntry[];
export const HOST_PRELOAD_BUILD_ENTRIES: BuildEntry[];
export const HOST_CLIENT_BUILD_ENTRIES: BuildEntry[];
