import {
  METHOD_LOCAL_ENVIRONMENTS_LIST,
  METHOD_LOCAL_ENVIRONMENTS_READ_CONFIG,
  METHOD_LOCAL_ENVIRONMENTS_SAVE_CONFIG,
  type LocalEnvironmentsListResponse,
  type LocalEnvironmentsReadConfigResponse,
  type LocalEnvironmentsSaveConfigResponse,
} from "../../../packages/app-server-client/src/protocol";
import { AppServerClient } from "./appServer";

export const localEnvironments = {
  async list(workspaceRoot: string): Promise<LocalEnvironmentsListResponse> {
    const { result } =
      await new AppServerClient().request<LocalEnvironmentsListResponse>(
        METHOD_LOCAL_ENVIRONMENTS_LIST,
        { workspaceRoot, hostId: "local" },
      );
    return result;
  },
  async readConfig(
    configPath: string,
  ): Promise<LocalEnvironmentsReadConfigResponse> {
    const { result } =
      await new AppServerClient().request<LocalEnvironmentsReadConfigResponse>(
        METHOD_LOCAL_ENVIRONMENTS_READ_CONFIG,
        { configPath, hostId: "local" },
      );
    return result;
  },
  async saveConfig(params: {
    configPath: string;
    expectedRevision: string | null;
    raw: string;
  }): Promise<LocalEnvironmentsSaveConfigResponse> {
    const { result } =
      await new AppServerClient().request<LocalEnvironmentsSaveConfigResponse>(
        METHOD_LOCAL_ENVIRONMENTS_SAVE_CONFIG,
        { ...params, hostId: "local" },
      );
    return result;
  },
};
