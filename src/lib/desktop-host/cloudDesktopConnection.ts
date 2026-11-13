import type {
  CloudDesktopResource,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";

export type CloudDesktopConnectionTransport = "direct" | "ecsTunnel";

export type CloudGuestReleaseStatus = {
  kind: "guestRelease";
  available: true;
  version: string;
};

/** Software preparation and user-owned distribution precede a billed computer. */
export type CloudGuestPreparationStatus = {
  kind: "guestPreparation";
  version: string;
  phase:
    | "idle"
    | "checking"
    | "downloading"
    | "verifying"
    | "distributing"
    | "ready"
    | "failed";
  busy: boolean;
  receivedBytes?: number;
  totalBytes?: number;
  diagnostic?:
    | "CLOUD_INSTALL_RELEASE_UNAVAILABLE"
    | "CLOUD_INSTALL_PACKAGE_INVALID";
};

export type CloudGuestInstallationRequest =
  | { action: "installationStatus"; resource: CloudDesktopResource }
  | { action: "showDesktopPassword"; resource: CloudDesktopResource }
  | {
      action: "reconnectRuntime";
      resource: CloudDesktopResource;
      confirmation: string;
      workSaved: boolean;
    }
  | {
      action: "installRuntime";
      source: "release" | "file";
      resource: CloudDesktopResource;
      confirmation: string;
      trustArtifact: boolean;
      createDesktopUser: boolean;
      installSystemPackages: boolean;
    }
  | {
      action: "resumeInstallation";
      resource: CloudDesktopResource;
      operationId: string;
    };

/** Fixed transport diagnostics; never contains endpoints, headers or response data. */
export type CloudGuestUploadFailure = {
  route:
    | "/status"
    | "/runtime"
    | "/credentials"
    | "/finish"
    | "/reconnect"
    | "/download";
  reason:
    | "invalidTarget"
    | "cancelled"
    | "expired"
    | "timeout"
    | "tls"
    | "connection"
    | "httpStatus"
    | "responseType"
    | "responseSize"
    | "responseJson"
    | "responseShape"
    | "unexpected";
  httpStatus?: number;
};

export type CloudGuestInstallationStatus = {
  kind: "installation";
  available: boolean;
  exists: boolean;
  busy: boolean;
  mode?: "install" | "reconnect";
  operationId?: string;
  createdAt?: number;
  phase?:
    | "waitingForAgent"
    | "preparing"
    | "launching"
    | "uploading"
    | "downloading"
    | "installing"
    | "saving"
    | "finishPending"
    | "complete"
    | "needsAttention"
    | "expired"
    | "failed";
  expiresAt?: number;
  diagnostic?: string;
  transportFailure?: CloudGuestUploadFailure;
  transfer?: { receivedBytes: number; totalBytes: number };
  connectionSaved?: boolean;
};

export type CloudDesktopConnectionRequest =
  | { action: "modelConnectionStatus"; resource: CloudDesktopResource }
  | {
      action: "resumeModelConnection";
      resource: CloudDesktopResource;
      operationId: string;
    }
  | {
      action: "shareModelConnection";
      resource: CloudDesktopResource;
      providerId: string;
      keyId: string;
      confirmation: string;
    }
  | { action: "checkRuntimeRelease" }
  | { action: "prepareRuntimeRelease"; profile: string; regionId: string }
  | { action: "runtimeReleaseStatus"; profile: string; regionId: string }
  | CloudGuestInstallationRequest
  | ({
      action: "downloadArchive";
      resource: CloudDesktopResource;
    } & CloudArchiveSelection)
  | ({
      action: "restoreArchiveToCloud";
      resource: CloudDesktopResource;
      backupSource?: CloudDesktopResource;
    } & CloudArchiveRestoreSelection)
  | { action: "readReleaseBackup"; resource: CloudDesktopResource }
  | {
      action: "releaseWithBackup";
      resource: CloudDesktopResource;
      operationId: string;
      confirmation: string;
      archiveSha256: string;
      restoredTo: CloudDesktopResource;
      workSaved: boolean;
      discardData: boolean;
      applicationsValidated: boolean;
    }
  | { action: "status" | "open" | "delete"; resource: CloudDesktopResource }
  | {
      action: "save";
      resource: CloudDesktopResource;
      endpoint: string;
      token: string;
    }
  | {
      action: "saveEcsTunnel";
      resource: CloudDesktopResource;
      token: string;
    };

/** Local progress contains no key, ciphertext, recipient, endpoint or server error. */
export type CloudModelConnectionStatus = {
  kind: "modelConnection";
  phase:
    | "idle"
    | "preparing"
    | "sealing"
    | "ready"
    | "unknown"
    | "complete"
    | "expired";
  operationId?: string;
  providerId?: string;
  keyId?: string;
};

export type CloudArchiveSelection = {
  sourceRoot: string;
  paths: string[];
  recipient: string;
  workSaved: boolean;
  includeCredentials: boolean;
};

export type CloudArchiveDownloadResult =
  | { kind: "archiveDownload"; canceled: true }
  | {
      kind: "archiveDownload";
      canceled: false;
      localPath: string;
      bytes: number;
      sha256: string;
      backupRecorded?: boolean;
    };

export type CloudArchiveRestoreSelection = {
  archivePath: string;
  identityFile: string;
  expectedSha256: string;
  folderName: string;
  confirmed: boolean;
};

export type CloudArchiveRestoreResult = {
  kind: "archiveRestore";
  destination: string;
  files: number;
  requiresApplicationValidation: true;
  releaseBackupRecorded?: boolean;
};

export type CloudReleaseBackup = {
  sha256: string;
  savedAt: string;
  restoredTo?: CloudDesktopResource;
};

export type CloudReleaseBackupResult = {
  kind: "releaseBackup";
  backup: CloudReleaseBackup | null;
};

export type CloudReleaseWithBackupResult = {
  kind: "releaseWithBackup";
  data: CloudDesktopResponse["data"];
};

export function sameCloudDesktop(
  a: CloudDesktopResource,
  b: CloudDesktopResource,
): boolean {
  return (
    a.provider === b.provider &&
    a.regionId === b.regionId &&
    a.resourceId === b.resourceId
  );
}

export type CloudDesktopConnectionMetadata = {
  available: boolean;
  exists: boolean;
  endpoint?: string;
  updatedAt?: string;
  transport?: CloudDesktopConnectionTransport;
};

export type CloudDesktopWindowContext = {
  kind: "cloud";
  resource: CloudDesktopResource;
  endpoint: string;
};

export type CloudDesktopWindowStatus = CloudDesktopWindowContext & {
  connected: boolean;
  generation: number;
};

export type CloudDesktopViewConnection = { endpoint: string };

/** Only the fixed local desktop listener may be embedded; never a supplier URL. */
export function validateCloudDesktopViewEndpoint(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid desktop endpoint");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) === 0 ||
    url.pathname !== "/vnc.html" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("invalid desktop endpoint");
  return url.toString();
}

export const CLOUD_DESKTOP_WINDOW_ARGUMENT = "--lime-cloud-desktop=";

export function readCloudDesktopWindowArgument(
  args: readonly string[],
): CloudDesktopWindowContext | undefined {
  const argument = args.find((value) =>
    value.startsWith(CLOUD_DESKTOP_WINDOW_ARGUMENT),
  );
  if (!argument) return undefined;
  const value = JSON.parse(
    decodeURIComponent(argument.slice(CLOUD_DESKTOP_WINDOW_ARGUMENT.length)),
  ) as CloudDesktopWindowContext;
  if (
    value.kind !== "cloud" ||
    typeof value.endpoint !== "string" ||
    !value.resource
  )
    throw new Error("invalid cloud desktop window context");
  return value;
}
