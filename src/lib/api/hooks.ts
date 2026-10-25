import { createAppServerClient } from "./appServer";
import {
  METHOD_HOOKS_LIST,
  METHOD_CONFIG_BATCH_WRITE,
  type ConfigWriteResponse,
  type HooksListParams,
  type HooksListResponse,
} from "@limecloud/app-server-client";

export type {
  HookMetadata,
  HooksListEntry,
} from "@limecloud/app-server-client";

export interface HookStateUpdate {
  key: string;
  enabled?: boolean;
  trustedHash?: string;
}

export async function updateHookState(
  updates: HookStateUpdate[],
): Promise<ConfigWriteResponse> {
  const edits = updates.flatMap(({ key, enabled, trustedHash }) => {
    const path = `hooks.state.${JSON.stringify(key)}`;
    return [
      ...(enabled == null
        ? []
        : [
            {
              keyPath: `${path}.enabled`,
              value: enabled,
              mergeStrategy: "upsert",
            },
          ]),
      ...(trustedHash == null
        ? []
        : [
            {
              keyPath: `${path}.trusted_hash`,
              value: trustedHash,
              mergeStrategy: "upsert",
            },
          ]),
    ];
  });
  return (
    await createAppServerClient().request<ConfigWriteResponse>(
      METHOD_CONFIG_BATCH_WRITE,
      {
        edits,
        filePath: null,
        expectedVersion: null,
        reloadUserConfig: true,
      },
    )
  ).result;
}

export async function listHooks(
  params: HooksListParams = {},
): Promise<HooksListResponse> {
  return (
    await createAppServerClient().request<HooksListResponse>(
      METHOD_HOOKS_LIST,
      params,
    )
  ).result;
}
