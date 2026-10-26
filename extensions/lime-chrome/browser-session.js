import { TabGroups } from "./tab-groups.js";

// Shipped bundle Bf, extracted verbatim; exported locally for lifecycle tests.
export function Bf(e) {
  const t = { close: [], release: [], deliverable: [], handoff: [] };
  for (const r of e)
    t[r.mark ?? (r.origin === "agent" ? "close" : "release")].push(r.tabId);
  return t;
}

function ownerKey(owner) {
  if (
    !owner ||
    ![owner.connection, owner.sessionId, owner.turnId].every(
      (value) =>
        typeof value === "string" && value.length > 0 && value.length <= 512,
    )
  )
    throw new Error("Missing trusted browser task owner");
  return JSON.stringify([owner.connection, owner.sessionId]);
}

function taskUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalidUrl");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("invalidUrl");
  return parsed.href;
}

// Presentation metadata only. Each tab still needs the shared runtime's grant.
export class BrowserSession {
  constructor(groups = TabGroups.getInstance()) {
    this.groups = groups;
    this.queue = Promise.resolve();
  }

  run(action) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  async read() {
    return (await chrome.storage.session.get("TASK_TABS")).TASK_TABS || {};
  }

  async save(sessions) {
    await chrome.storage.session.set({ TASK_TABS: sessions });
  }

  createTask(name, url) {
    return this.run(async () => {
      const href = taskUrl(url);
      const sessionId = crypto.randomUUID();
      const sessions = await this.read();
      const tab = await chrome.tabs.create({ url: href });
      try {
        await this.groups.setSessionGroupTitle(sessionId, name, []);
        await this.groups.ensureAgentTabGroup(sessionId, tab.id, []);
        sessions[sessionId] = { name: name.trim() || "Lime", tabs: [tab.id] };
        await this.save(sessions);
        return { tabId: tab.id, sessionId };
      } catch (error) {
        await chrome.tabs.remove(tab.id).catch(() => {});
        this.groups.sessionGroupTitles.delete(sessionId);
        await this.groups.refreshManagedGroupsFromChrome();
        await this.groups.saveToStorage();
        throw error;
      }
    });
  }

  runTurnMutation(owner, sourceTabId, action, validate = async () => {}) {
    return this.run(async () => {
      const key = ownerKey(owner);
      const ended =
        (await chrome.storage.session.get("ENDED_TURNS")).ENDED_TURNS || {};
      if (ended[JSON.stringify([key, owner.turnId])])
        throw new Error("Browser turn already ended");
      const sessions = await this.read();
      const session = sessions[key] || {
        kind: "runtime",
        tabs: [],
        leases: {},
        turnId: null,
      };
      if (session.turnId && session.turnId !== owner.turnId)
        throw new Error("Another browser turn is still active");
      for (const [id, other] of Object.entries(sessions)) {
        if (
          id !== key &&
          other.kind === "runtime" &&
          other.leases[String(sourceTabId)]
        )
          throw new Error("Tab belongs to another browser task");
      }
      await chrome.tabs.get(sourceTabId);
      if (!session.turnId) {
        for (const lease of Object.values(session.leases)) {
          lease.turnId = owner.turnId;
          delete lease.mark;
        }
      }
      session.turnId = owner.turnId;
      session.leases[String(sourceTabId)] ||= {
        tabId: sourceTabId,
        origin: "user",
        turnId: owner.turnId,
      };
      sessions[key] = session;
      await validate();
      const result = await action(key, session);
      await this.save(sessions);
      return result;
    });
  }

  claimUserTab(owner, tabId, validate) {
    // User tabs keep their original group. This is metadata, not a grant.
    return this.runTurnMutation(owner, tabId, async () => {}, validate);
  }

  nameSession(owner, tabId, name, validate) {
    if (typeof name !== "string" || !name.trim() || [...name].length > 100)
      return Promise.reject(new Error("Invalid browser task name"));
    return this.runTurnMutation(
      owner,
      tabId,
      async (key, session) => {
        await this.groups.setSessionGroupTitle(key, name, session.tabs);
        session.name = name.trim();
        return { status: "named", name: session.name };
      },
      validate,
    );
  }

  createTab(owner, sourceTabId, url, validate) {
    const href = taskUrl(url);
    return this.runTurnMutation(
      owner,
      sourceTabId,
      async (key, session) => {
        const tab = await chrome.tabs.create({ url: href });
        try {
          await this.groups.ensureAgentTabGroup(key, tab.id, session.tabs);
          session.tabs.push(tab.id);
          session.leases[String(tab.id)] = {
            tabId: tab.id,
            origin: "agent",
            turnId: owner.turnId,
          };
          return {
            status: "created",
            tabId: tab.id,
            url: href,
            approvalRequired: true,
          };
        } catch (error) {
          await chrome.tabs.remove(tab.id).catch(() => {});
          await this.groups.refreshManagedGroupsFromChrome();
          throw error;
        }
      },
      validate,
    );
  }

  markTab(owner, sourceTabId, tabId, mark, validate) {
    if (!["deliverable", "handoff"].includes(mark))
      return Promise.reject(new Error("Invalid tab mark"));
    return this.runTurnMutation(
      owner,
      sourceTabId,
      async (_key, session) => {
        const lease = session.leases[String(tabId)];
        if (!lease || lease.turnId !== owner.turnId)
          throw new Error("Tab is not owned by this browser turn");
        await chrome.tabs.get(tabId);
        lease.mark = mark;
        return { status: "marked", tabId, mark };
      },
      validate,
    );
  }

  endTurn(owner) {
    return this.run(async () => {
      const key = ownerKey(owner);
      const ended =
        (await chrome.storage.session.get("ENDED_TURNS")).ENDED_TURNS || {};
      const now = Date.now();
      for (const [id, time] of Object.entries(ended))
        if (now - time > 120000) delete ended[id];
      ended[JSON.stringify([key, owner.turnId])] = now;
      await chrome.storage.session.set({ ENDED_TURNS: ended });
      const sessions = await this.read();
      const session = sessions[key];
      if (!session || session.turnId !== owner.turnId) return;
      const leases = Object.values(session.leases).filter(
        (lease) => lease.turnId === owner.turnId,
      );
      const { close, release, deliverable, handoff } = Bf(leases);
      const delivered = deliverable.filter(
        (id) => session.leases[String(id)].origin === "agent",
      );
      await this.groups.releaseTabsFromManagedGroups(delivered);
      // The copied manager treats Chrome edit errors as best effort. Retain
      // ownership for bounded retries until independent readback confirms it.
      for (const tabId of delivered) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab && this.groups.managedGroupIds.has(tab.groupId))
          throw new Error("Deliverable tab remained in the managed task group");
      }
      // Only agent-created, unmarked pages are closed; never close a user's page.
      for (const tabId of close) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab) await chrome.tabs.remove(tabId);
      }
      for (const tabId of [...close, ...release, ...deliverable])
        delete session.leases[String(tabId)];
      session.tabs = session.tabs.filter((id) => handoff.includes(id));
      session.turnId = null;
      if (!handoff.length) {
        delete sessions[key];
        this.groups.sessionGroupTitles.delete(key);
      }
      await this.save(sessions);
      await this.groups.refreshManagedGroupsFromChrome();
      await this.groups.saveToStorage();
      return { status: "finalized", close, release, deliverable, handoff };
    });
  }

  async disconnect() {
    const sessions = await this.run(() => this.read());
    for (const [key, session] of Object.entries(sessions)) {
      if (session.kind !== "runtime" || !session.turnId) continue;
      const [connection, sessionId] = JSON.parse(key);
      await this.endTurn({ connection, sessionId, turnId: session.turnId });
    }
  }

  claimChildTab(tab) {
    return this.run(async () => {
      if (!Number.isInteger(tab.openerTabId)) return;
      const sessions = await this.read();
      const entries = Object.entries(sessions);
      const entry =
        entries.find(
          ([, session]) =>
            session.kind === "runtime" &&
            session.turnId &&
            session.leases[String(tab.openerTabId)],
        ) ||
        entries.find(
          ([, session]) =>
            session.kind !== "runtime" &&
            session.tabs.includes(tab.openerTabId),
        );
      if (!entry) return;
      const [sessionId, session] = entry;
      await this.groups.ensureAgentTabGroup(sessionId, tab.id, session.tabs);
      session.tabs.push(tab.id);
      if (session.kind === "runtime")
        session.leases[String(tab.id)] = {
          tabId: tab.id,
          origin: "agent",
          turnId: session.turnId,
        };
      await this.save(sessions);
    });
  }

  removeTab(tabId) {
    return this.run(async () => {
      const sessions = await this.read();
      for (const [id, session] of Object.entries(sessions)) {
        session.tabs = session.tabs.filter((tab) => tab !== tabId);
        if (session.leases) delete session.leases[String(tabId)];
        if (!session.tabs.length && !Object.keys(session.leases || {}).length) {
          delete sessions[id];
          this.groups.sessionGroupTitles.delete(id);
        }
      }
      await this.save(sessions);
      await this.groups.refreshManagedGroupsFromChrome();
      await this.groups.saveToStorage();
    });
  }
}
