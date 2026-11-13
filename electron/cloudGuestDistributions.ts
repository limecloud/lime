import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type { CloudGuestPreparationStatus } from "../src/lib/desktop-host/cloudDesktopConnection";
import {
  type CloudGuestArtifact,
  type CloudGuestSource,
  validateArtifact,
  validateDownloadUrl,
} from "./cloudGuestArtifact";
import { CloudGuestReleaseCache } from "./cloudGuestReleaseCache";
import {
  ElectronEncryptedStateFile,
  type SafeStorageLike,
} from "./secureCredentialStore";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import { waitForCloudGuestRequest } from "./cloudGuestRequest";

export type CloudDistributionContext = { profile: string; regionId: string };
type RecordState = {
  schemaVersion: 1;
  context: CloudDistributionContext;
  version: string;
  operationId: string;
  artifact: CloudGuestArtifact;
  phase: "pending" | "ready" | "cleanupPending" | "cleaned";
  leases: Record<string, number>;
};
const unavailable = () => new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const contextKey = (context: CloudDistributionContext) => {
  if (
    !context ||
    typeof context.profile !== "string" ||
    typeof context.regionId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(context.profile) ||
    !/^[a-z0-9][a-z0-9-]{0,39}$/u.test(context.regionId) ||
    !context.regionId.includes("-")
  )
    throw unavailable();
  return createHash("sha256")
    .update(JSON.stringify([context.profile, context.regionId]))
    .digest("hex");
};
const leaseKey = (resource: CloudDesktopResource) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        resource.provider,
        resource.regionId,
        resource.resourceId,
      ]),
    )
    .digest("hex");

/** Native-only distribution orchestration. Renderer sees fixed stages and bytes. */
export class CloudGuestDistributions {
  #stopping = false;
  readonly #jobs = new Map<string, Promise<void>>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #statuses = new Map<string, CloudGuestPreparationStatus>();
  readonly #contexts = new Map<string, CloudDistributionContext>();
  readonly #controller = new AbortController();
  constructor(
    readonly root: string,
    readonly safeStorage: SafeStorageLike,
    readonly request: CloudDesktopRequest,
    readonly cache: CloudGuestReleaseCache,
  ) {}

  async #request(
    params: Parameters<CloudDesktopRequest>[0],
    signal = this.#controller.signal,
  ): Promise<{ data: Record<string, unknown> }> {
    signal.throwIfAborted();
    const response = await waitForCloudGuestRequest(
      this.request(params),
      signal,
    );
    if (
      !response.data ||
      typeof response.data !== "object" ||
      Array.isArray(response.data)
    )
      throw unavailable();
    return { data: response.data as Record<string, unknown> };
  }

  #file(context: CloudDistributionContext) {
    return new ElectronEncryptedStateFile(
      path.join(this.root, "cloud-runtime-distribution", contextKey(context)),
      "runtime-distribution.v1",
      this.safeStorage,
    );
  }

  async #read(context: CloudDistributionContext): Promise<RecordState | null> {
    const state = (await this.#file(context).read()) as RecordState | null;
    if (!state) return null;
    if (
      state.schemaVersion !== 1 ||
      contextKey(state.context) !== contextKey(context) ||
      !uuid(state.operationId) ||
      !/^\d+\.\d+\.\d+$/u.test(state.version) ||
      !["pending", "ready", "cleanupPending", "cleaned"].includes(
        state.phase,
      ) ||
      !state.leases ||
      typeof state.leases !== "object" ||
      Array.isArray(state.leases) ||
      Object.entries(state.leases).some(
        ([key, expiry]) =>
          !/^[a-f0-9]{64}$/u.test(key) ||
          !Number.isSafeInteger(expiry) ||
          expiry < 1,
      )
    )
      throw unavailable();
    state.artifact = validateArtifact(state.artifact);
    return state;
  }

  #serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.#queues.set(key, next);
    void next
      .finally(() => {
        if (this.#queues.get(key) === next) this.#queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }

  status(context: CloudDistributionContext): CloudGuestPreparationStatus {
    const key = contextKey(context);
    const own = this.#statuses.get(key);
    if (!own)
      return {
        kind: "guestPreparation",
        version: this.cache.version,
        phase: "idle",
        busy: false,
      };
    // The public cache owns its own exact-byte progress until OSS starts.
    if (own.busy && own.phase === "checking")
      return { ...this.cache.status(), busy: true };
    return { ...own };
  }

  prepare(context: CloudDistributionContext): CloudGuestPreparationStatus {
    if (this.#stopping) throw unavailable();
    context = { profile: context?.profile, regionId: context?.regionId };
    const key = contextKey(context);
    if (this.#jobs.has(key)) return this.status(context);
    this.#contexts.set(key, { ...context });
    this.#file(context).assertAvailable();
    this.#statuses.set(key, {
      kind: "guestPreparation",
      version: this.cache.version,
      phase: "checking",
      busy: true,
    });
    const job = this.#serialize(key, () => this.#prepare(key, context))
      .catch(() => {
        this.#statuses.set(key, {
          kind: "guestPreparation",
          version: this.cache.version,
          phase: "failed",
          busy: false,
          diagnostic: "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
        });
      })
      .finally(() => {
        this.#jobs.delete(key);
        const status = this.#statuses.get(key);
        if (status) status.busy = false;
      });
    this.#jobs.set(key, job);
    return this.status(context);
  }

  async #cleanup(state: RecordState, signal?: AbortSignal): Promise<void> {
    state.leases = Object.fromEntries(
      Object.entries(state.leases).filter(([, expiry]) => expiry > Date.now()),
    );
    if (Object.keys(state.leases).length) throw unavailable();
    state.phase = "cleanupPending";
    await this.#file(state.context).write(state);
    const { data } = await this.#request(
      {
        action: "cleanupRuntimeDistribution",
        ...state.context,
        operationId: state.operationId,
      },
      signal,
    );
    if (
      data.operationId !== state.operationId ||
      !["cleaned", "absent"].includes(String(data.phase))
    )
      throw unavailable();
    state.phase = "cleaned";
    await this.#file(state.context).write(state);
  }

  async #prepare(
    key: string,
    context: CloudDistributionContext,
  ): Promise<void> {
    const source = await this.cache.source();
    if (this.#stopping) throw unavailable();
    this.#statuses.set(key, {
      kind: "guestPreparation",
      version: this.cache.version,
      phase: "distributing",
      busy: true,
    });
    let state = await this.#read(context);
    if (state && state.phase !== "cleaned") {
      if (
        state.version === this.cache.version &&
        JSON.stringify(state.artifact) === JSON.stringify(source.artifact) &&
        state.phase !== "cleanupPending"
      ) {
        let data: Record<string, unknown> = {};
        let cleaned = false;
        try {
          data = (
            await this.#request({
              action: "readRuntimeDistribution",
              ...context,
              operationId: state.operationId,
            })
          ).data as Record<string, unknown>;
        } catch {
          await this.#cleanup(state);
          cleaned = true;
        }
        if (
          data.operationId === state.operationId &&
          data.phase === "ready" &&
          data.archiveBytes === source.artifact.archiveBytes &&
          data.archiveSha256 === source.artifact.archiveSha256
        ) {
          state.phase = "ready";
          await this.#file(context).write(state);
        } else if (!cleaned) await this.#cleanup(state);
      } else await this.#cleanup(state);
    }
    if (!state || state.phase === "cleaned") {
      state = {
        schemaVersion: 1,
        context: { ...context },
        version: this.cache.version,
        operationId: randomUUID(),
        artifact: source.artifact,
        phase: "pending",
        leases: {},
      };
      // Main recovery identity is durable before asking the OSS owner to write.
      await this.#file(context).write(state);
      try {
        const { data } = await this.#request({
          action: "prepareRuntimeDistribution",
          ...context,
          operationId: state.operationId,
          version: state.version,
          archiveBytes: state.artifact.archiveBytes,
          archiveSha256: state.artifact.archiveSha256,
        });
        if (
          data.operationId !== state.operationId ||
          data.phase !== "ready" ||
          data.archiveBytes !== state.artifact.archiveBytes ||
          data.archiveSha256 !== state.artifact.archiveSha256
        )
          throw unavailable();
        state.phase = "ready";
        await this.#file(context).write(state);
      } catch {
        // Cleanup only this exact intent; a lost response never creates a new
        // UUID while the original bucket could still exist.
        await this.#cleanup(state).catch(() => undefined);
        throw unavailable();
      }
    }
    if (state.phase !== "ready") throw unavailable();
    this.#statuses.set(key, {
      kind: "guestPreparation",
      version: this.cache.version,
      phase: "ready",
      busy: false,
    });
  }

  async source(resource: CloudDesktopResource): Promise<CloudGuestSource> {
    const context = { profile: resource.profile, regionId: resource.regionId };
    const key = contextKey(context);
    this.prepare(context);
    await this.#jobs.get(key);
    if (this.status(context).phase !== "ready" || this.#stopping)
      throw unavailable();
    return this.#serialize(key, async () => {
      const state = await this.#read(context);
      if (!state || state.phase !== "ready") throw unavailable();
      const { data } = await this.#request({
        action: "signRuntimeDistribution",
        ...context,
        operationId: state.operationId,
      });
      const downloadUrl = validateDownloadUrl(data.downloadUrl);
      const url = new URL(downloadUrl);
      if (
        data.operationId !== state.operationId ||
        data.archiveBytes !== state.artifact.archiveBytes ||
        data.archiveSha256 !== state.artifact.archiveSha256 ||
        !Number.isSafeInteger(data.expiresAt) ||
        Number(data.expiresAt) < Date.now() + 29 * 60_000 ||
        Number(data.expiresAt) > Date.now() + 2 * 60 * 60_000 ||
        url.hostname !==
          `lime-runtime-${state.operationId.replaceAll("-", "")}.oss-${context.regionId}.aliyuncs.com` ||
        url.pathname !== `/runtime/${state.artifact.archiveSha256}.tar.gz` ||
        !url.searchParams.has("x-oss-signature")
      )
        throw unavailable();
      state.leases[leaseKey(resource)] = Number(data.expiresAt);
      await this.#file(context).write(state);
      return {
        artifact: state.artifact,
        downloadUrl,
        distributionId: state.operationId,
      };
    });
  }

  async release(
    resource: CloudDesktopResource,
    operationId: string,
  ): Promise<void> {
    const context = { profile: resource.profile, regionId: resource.regionId };
    const key = contextKey(context);
    await this.#serialize(key, async () => {
      const state = await this.#read(context);
      if (
        !state ||
        state.operationId !== operationId ||
        state.phase === "cleaned"
      )
        return;
      delete state.leases[leaseKey(resource)];
      await this.#file(context).write(state);
      if (!Object.values(state.leases).some((expiry) => expiry > Date.now()))
        await this.#cleanup(state);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#controller.abort();
    await Promise.allSettled([
      ...this.#jobs.values(),
      ...this.#queues.values(),
    ]);
    // Active installation capabilities keep their original source until expiry.
    await Promise.allSettled(
      [...this.#contexts.values()].map(async (context) => {
        const state = await this.#read(context);
        if (
          state &&
          state.phase !== "cleaned" &&
          !Object.values(state.leases).some((expiry) => expiry > Date.now())
        )
          await this.#cleanup(state, AbortSignal.timeout(20_000));
      }),
    );
  }
}
