import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type {
  CloudGuestInstallationRequest,
  CloudGuestInstallationStatus,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import {
  ElectronEncryptedStateFile,
  type SafeStorageLike,
} from "./secureCredentialStore";
import {
  openCloudGuestArtifact,
  validateArtifact,
  type CloudGuestArtifact,
} from "./cloudGuestArtifact";
import {
  requestCloudGuestUpload,
  type CloudGuestUpload,
} from "./cloudGuestUpload";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

type Phase = NonNullable<CloudGuestInstallationStatus["phase"]>;
type RecordState = {
  version: 1;
  resource: CloudDesktopResource;
  operationId: string;
  artifactPath: string;
  artifact: CloudGuestArtifact;
  capability: string;
  createdAt: number;
  phase: Phase;
  uploadAttempted: boolean;
  credentialsSaved: boolean;
  upload?: CloudGuestUpload;
  viewerPassword?: string;
  diagnostic?: string;
};
const phases: Phase[] = [
  "launching",
  "uploading",
  "saving",
  "finishPending",
  "complete",
  "needsAttention",
  "expired",
  "failed",
];
const terminal = (phase: Phase) =>
  ["complete", "expired", "failed"].includes(phase);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const sameResource = (
  left: CloudDesktopResource | undefined,
  right: CloudDesktopResource,
) =>
  Boolean(
    left &&
    (["provider", "profile", "regionId", "resourceId"] as const).every(
      (key) => left[key] === right[key],
    ),
  );

/** Main-only orchestration. Status reads never launch, upload, or resume a mutation. */
export class CloudGuestInstallations {
  readonly #jobs = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  #stopping = false;
  constructor(
    readonly root: string,
    readonly safeStorage: SafeStorageLike,
    readonly request: CloudDesktopRequest,
    readonly selectArtifact: () => Promise<string | undefined>,
    readonly saveCredential: (
      resource: CloudDesktopResource,
      token: string,
    ) => Promise<void>,
    readonly transport = requestCloudGuestUpload,
    readonly pollMs = 2000,
    readonly showDesktopPassword?: (password: string) => Promise<void>,
  ) {}

  #file(key: string) {
    return new ElectronEncryptedStateFile(
      path.join(this.root, "cloud-desktop-connections", key),
      "runtime-installation.v1",
      this.safeStorage,
    );
  }

  async #read(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<RecordState | null> {
    const value = (await this.#file(key).read()) as RecordState | null;
    if (!value) return null;
    if (
      value.version !== 1 ||
      !sameResource(value.resource, resource) ||
      !uuid(value.operationId) ||
      !phases.includes(value.phase) ||
      typeof value.artifactPath !== "string" ||
      !path.isAbsolute(value.artifactPath) ||
      !/^[a-f0-9]{64}$/u.test(value.capability) ||
      !Number.isSafeInteger(value.createdAt) ||
      typeof value.uploadAttempted !== "boolean" ||
      typeof value.credentialsSaved !== "boolean"
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
    validateArtifact(value.artifact);
    if (
      value.upload &&
      (value.upload.operationId !== value.operationId ||
        typeof value.upload.certificate !== "string" ||
        typeof value.upload.publicAddress !== "string" ||
        !Number.isSafeInteger(value.upload.expiresAt))
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
    return value;
  }

  async blocksConnectionChange(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<boolean> {
    const state = await this.#read(key, resource);
    return this.#jobs.has(key) || Boolean(state && !terminal(state.phase));
  }

  async status(
    key: string,
    resource: CloudDesktopResource,
  ): Promise<CloudGuestInstallationStatus> {
    const available = this.#file(key).available;
    if (!available)
      return { kind: "installation", available, exists: false, busy: false };
    const state = await this.#read(key, resource);
    return {
      kind: "installation",
      available,
      exists: Boolean(state),
      busy: this.#jobs.has(key),
      ...(state
        ? {
            operationId: state.operationId,
            phase: state.phase,
            connectionSaved: state.credentialsSaved,
            expiresAt: state.upload?.expiresAt,
            ...(state.diagnostic ? { diagnostic: state.diagnostic } : {}),
          }
        : {}),
    };
  }

  async invoke(
    key: string,
    resource: CloudDesktopResource,
    request: CloudGuestInstallationRequest,
  ): Promise<CloudGuestInstallationStatus> {
    if (resource.provider !== "ecs" || this.#stopping)
      throw new Error("CLOUD_INSTALL_UNAVAILABLE");
    if (request.action === "installationStatus")
      return this.status(key, resource);
    this.#file(key).assertAvailable();
    let state = await this.#read(key, resource);
    if (request.action === "showDesktopPassword") {
      if (
        !state?.credentialsSaved ||
        !this.showDesktopPassword ||
        !/^[A-Za-z0-9_-]{8}$/u.test(state.viewerPassword ?? "")
      )
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      await this.showDesktopPassword(state.viewerPassword!);
      return this.status(key, resource);
    }
    if (request.action === "installRuntime") {
      if (
        request.confirmation !==
          `installRuntime:${resource.regionId}:${resource.resourceId}` ||
        request.trustArtifact !== true ||
        request.createDesktopUser !== true
      )
        throw new Error("CLOUD_INSTALL_CONSENT_REQUIRED");
      if (this.#jobs.has(key)) return this.status(key, resource);
      if (state && !terminal(state.phase))
        throw new Error("CLOUD_INSTALL_UNRESOLVED");
      const selected = await this.selectArtifact();
      if (!selected) return this.status(key, resource);
      const opened = await openCloudGuestArtifact(selected);
      await opened.file.close();
      state = {
        version: 1,
        resource,
        operationId: randomUUID(),
        artifactPath: selected,
        artifact: opened.artifact,
        capability: randomBytes(32).toString("hex"),
        createdAt: Date.now(),
        phase: "launching",
        uploadAttempted: false,
        credentialsSaved: false,
      };
      // Durable recovery identity precedes the first supplier-side submission.
      await this.#file(key).write(state);
      this.#start(key, state, true);
    } else {
      if (!state || request.operationId !== state.operationId)
        throw new Error("CLOUD_INSTALL_STATE_INVALID");
      if (this.#jobs.has(key)) return this.status(key, resource);
      if (!terminal(state.phase)) this.#start(key, state, false);
    }
    return this.status(key, resource);
  }

  #start(key: string, state: RecordState, submit: boolean): void {
    const controller = new AbortController();
    const done = this.#run(key, state, submit, controller.signal)
      .catch(async () => {
        state.phase = "needsAttention";
        state.diagnostic = "CLOUD_INSTALL_RECOVERY_REQUIRED";
        await this.#file(key)
          .write(state)
          .catch(() => undefined);
      })
      .finally(() => {
        this.#jobs.delete(key);
      });
    this.#jobs.set(key, { controller, done });
  }

  async #persist(
    key: string,
    state: RecordState,
    phase: Phase,
    diagnostic?: string,
  ) {
    state.phase = phase;
    state.diagnostic = diagnostic;
    await this.#file(key).write(state);
  }

  async #run(
    key: string,
    state: RecordState,
    submit: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const request = {
        action: "startEcsRuntimeInstallation" as const,
        resource: state.resource,
        operationId: state.operationId,
        ...state.artifact,
        capabilitySha256: createHash("sha256")
          .update(state.capability)
          .digest("hex"),
        confirmation: `installRuntime:${state.resource.regionId}:${state.resource.resourceId}`,
        createDesktopUser: true,
      };
      let receipt = (
        submit ? (await this.request(request)).data : undefined
      ) as Record<string, unknown> | undefined;
      while (!state.upload) {
        signal.throwIfAborted();
        if (Date.now() - state.createdAt > 30 * 60_000) {
          await this.#persist(key, state, "expired", "CLOUD_INSTALL_EXPIRED");
          return;
        }
        receipt ??= (
          await this.request({
            action: "readOperation",
            operationId: state.operationId,
          })
        ).data as Record<string, unknown>;
        this.#validateReceipt(state, receipt);
        if (
          ["notSubmitted", "runtimeLaunchFailed"].includes(
            String(receipt.outcome),
          )
        ) {
          await this.#persist(
            key,
            state,
            "failed",
            receipt.failureCode === "dependenciesNotReady"
              ? "CLOUD_INSTALL_DEPENDENCIES_REQUIRED"
              : "CLOUD_INSTALL_LAUNCH_FAILED",
          );
          return;
        }
        if (receipt.outcome === "runtimeUploadReady") {
          const upload = receipt.upload as CloudGuestUpload;
          if (
            !upload ||
            upload.operationId !== state.operationId ||
            typeof upload.certificate !== "string" ||
            upload.publicAddress !== receipt.publicAddress ||
            upload.expiresAt !== receipt.expiresAt ||
            !Number.isSafeInteger(upload.expiresAt) ||
            upload.expiresAt * 1000 > state.createdAt + 31 * 60_000
          )
            throw new Error("CLOUD_INSTALL_STATE_INVALID");
          state.upload = {
            operationId: upload.operationId,
            publicAddress: upload.publicAddress,
            certificate: upload.certificate,
            expiresAt: upload.expiresAt,
          };
          await this.#persist(key, state, "uploading");
          break;
        }
        await delay(this.pollMs, undefined, { signal });
        receipt = undefined;
      }
      const target = state.upload!;
      while (true) {
        signal.throwIfAborted();
        if (target.expiresAt * 1000 <= Date.now()) {
          await this.#persist(key, state, "expired", "CLOUD_INSTALL_EXPIRED");
          return;
        }
        // A lost finish response is harmless after credentials are durable. Never
        // retrieve or overwrite credentials again during finish-only recovery.
        if (state.credentialsSaved) {
          await this.#persist(key, state, "finishPending");
          const result = await this.transport(
            target,
            state.capability,
            "/finish",
            signal,
          );
          if (result.phase !== "finished")
            throw new Error("CLOUD_INSTALL_STATE_INVALID");
          await this.#persist(key, state, "complete");
          return;
        }
        const status = await this.transport(
          target,
          state.capability,
          "/status",
          signal,
        );
        if (
          status.operationId !== state.operationId ||
          status.expiresAt !== target.expiresAt
        )
          throw new Error("CLOUD_INSTALL_STATE_INVALID");
        if (status.phase === "waiting") {
          if (state.uploadAttempted) {
            await this.#persist(
              key,
              state,
              "needsAttention",
              "CLOUD_INSTALL_UPLOAD_UNKNOWN",
            );
            return;
          }
          const artifact = await openCloudGuestArtifact(
            state.artifactPath,
            state.artifact,
          );
          try {
            state.uploadAttempted = true;
            await this.#persist(key, state, "uploading");
            await this.transport(target, state.capability, "/runtime", signal, {
              file: artifact.file,
              bytes: artifact.artifact.archiveBytes,
            });
          } finally {
            await artifact.file.close();
          }
          continue;
        }
        if (["receiving", "installing"].includes(String(status.phase))) {
          await delay(this.pollMs, undefined, { signal });
          continue;
        }
        if (status.phase === "failed") {
          await this.#persist(key, state, "failed", "CLOUD_INSTALL_FAILED");
          return;
        }
        if (status.phase !== "installed")
          throw new Error("CLOUD_INSTALL_STATE_INVALID");
        await this.#persist(key, state, "saving");
        const credential = await this.transport(
          target,
          state.capability,
          "/credentials",
          signal,
        );
        if (
          credential.operationId !== state.operationId ||
          typeof credential.token !== "string" ||
          !/^[A-Za-z0-9_-]{32,256}$/u.test(credential.token) ||
          typeof credential.viewerPassword !== "string" ||
          !/^[A-Za-z0-9_-]{8}$/u.test(credential.viewerPassword)
        )
          throw new Error("CLOUD_INSTALL_STATE_INVALID");
        // Viewer secret remains in this encrypted private record, never metadata.
        state.viewerPassword = credential.viewerPassword;
        await this.saveCredential(state.resource, credential.token);
        state.credentialsSaved = true;
        await this.#persist(key, state, "finishPending");
      }
    } catch {
      await this.#persist(
        key,
        state,
        state.upload && state.upload.expiresAt * 1000 <= Date.now()
          ? "expired"
          : "needsAttention",
        "CLOUD_INSTALL_RECOVERY_REQUIRED",
      );
    }
  }

  #validateReceipt(state: RecordState, receipt: Record<string, unknown>) {
    const request = receipt?.request as Record<string, unknown> | undefined;
    if (
      receipt?.operationId !== state.operationId ||
      request?.operationId !== state.operationId ||
      request.action !== "startEcsRuntimeInstallation" ||
      !sameResource(request.resource as CloudDesktopResource, state.resource) ||
      request.capabilitySha256 !==
        createHash("sha256").update(state.capability).digest("hex") ||
      JSON.stringify(validateArtifact(request.artifact)) !==
        JSON.stringify(state.artifact) ||
      ![
        "unknown",
        "accepted",
        "runtimeStarting",
        "runtimeUploadReady",
        "notSubmitted",
        "runtimeLaunchFailed",
      ].includes(String(receipt.outcome))
    )
      throw new Error("CLOUD_INSTALL_STATE_INVALID");
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const jobs = [...this.#jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }
}
