import type { Session, WebContents } from "electron";
import { assertApplicationNetworkRevocationSupported } from "./browserPermissionRequests";
type DomainPermission = "allow" | "deny";
type NetworkPolicy = Readonly<{
  enabled: boolean;
  domains: Readonly<Record<string, DomainPermission>>;
}>;

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const present = (value: unknown) => value !== undefined && value !== null;
const invalid = () =>
  new Error("Invalid managed application network requirements");

// Keep the exact-domain grammar aligned with config/application_requirements.rs.
function domainName(value: string): string | null {
  const normalized = value.replace(/\.$/, "").toLowerCase();
  if (
    Array.from(value).some((character) => character.charCodeAt(0) > 127) ||
    normalized.length > 253 ||
    normalized
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return null;
  return normalized;
}

/** Only configRequirements/read supplies this value; ordinary config is not authority. */
export function readApplicationNetworkRequirements(
  requirements: unknown,
): NetworkPolicy | null {
  if (requirements === null) return null;
  if (!object(requirements)) throw invalid();
  const application = requirements.application;
  if (!present(application)) return null;
  if (
    !object(application) ||
    Object.keys(application).some(
      (key) => !["network", "storage"].includes(key),
    )
  )
    throw invalid();
  // No managed storage setting is accepted before its Desktop enforcement exists.
  if (present(application.storage)) throw invalid();
  const network = application.network;
  if (!present(network)) return null;
  if (
    !object(network) ||
    typeof network.enabled !== "boolean" ||
    !object(network.domains) ||
    Object.keys(network).some((key) => !["enabled", "domains"].includes(key))
  )
    throw invalid();
  const domains: Record<string, DomainPermission> = Object.create(null);
  for (const [raw, permission] of Object.entries(network.domains)) {
    const domain = domainName(raw);
    if (
      !domain ||
      Object.hasOwn(domains, domain) ||
      !["allow", "deny"].includes(String(permission)) ||
      typeof permission !== "string"
    )
      throw invalid();
    domains[domain] = permission as DomainPermission;
  }
  return Object.freeze({
    enabled: network.enabled,
    domains: Object.freeze(domains),
  });
}

/** Session-wide destination gate, separate from per-turn browser operation approval. */
export class ApplicationNetworkPolicy {
  #policy: NetworkPolicy | null | undefined;
  #key: string | undefined;
  #revision = 0;
  #resets: Promise<void> = Promise.resolve();

  allows(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol))
      return false;
    if (this.#policy === undefined) return false;
    if (!this.#policy?.enabled) return true;
    const domain = domainName(parsed.hostname);
    return domain !== null && this.#policy.domains[domain] === "allow";
  }

  async update(
    requirements: unknown,
    resetConnections: () => Promise<void>,
    onChanging: () => void = () => undefined,
  ): Promise<void> {
    let next: NetworkPolicy | null | undefined;
    let validationError: unknown;
    try {
      next =
        requirements === undefined
          ? undefined
          : readApplicationNetworkRequirements(requirements);
    } catch (error) {
      validationError = error;
    }
    const key =
      next === undefined
        ? undefined
        : JSON.stringify(
            next === null
              ? null
              : {
                  enabled: next.enabled,
                  domains: Object.entries(next.domains).sort(([a], [b]) =>
                    a.localeCompare(b),
                  ),
                },
          );
    if (
      this.#policy !== undefined &&
      key === this.#key &&
      validationError === undefined
    )
      return;
    const revision = ++this.#revision;
    this.#policy = undefined;
    this.#key = undefined;
    // Revoke operation receipts and content capabilities before asynchronous reset.
    onChanging();
    // Requests stay denied until every earlier connection reset has settled.
    const resetting = this.#resets
      .catch(() => undefined)
      .then(resetConnections);
    this.#resets = resetting;
    await resetting;
    if (validationError !== undefined) throw validationError;
    if (revision !== this.#revision) return;
    this.#policy = next;
    this.#key = key;
  }
}

/** Stop owned loaders and close the Session's existing transport connections on revocation. */
export async function resetApplicationNetworkConnections(
  session: Session,
  contents: Iterable<WebContents>,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    assertApplicationNetworkRevocationSupported(session);
  } catch (error) {
    failures.push(error);
  }
  for (const content of contents) {
    try {
      if (!content.isDestroyed()) content.stop();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await session.closeAllConnections();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(failures, "Browser network revocation failed");
}
