// Extracted from the shipped browser extension; provenance and adaptations:
// internal/exec-plans/native-computer-use-chrome-groups-20261025.md
// Bundle symbols are minified; TabGroups is the local export name.
const _a = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];
function Wb() {
  return _a[Math.floor(Math.random() * _a.length)] ?? _a[0];
}
function va(e) {
  if (typeof e != "string") return;
  const t = e.trim();
  return t.length > 0 ? t : void 0;
}
export const TabGroups = class on {
  static instance = null;
  defaultSessionGroupTitle = "Lime";
  managedGroupIds = new Set();
  sessionGroupTitles = new Map();
  initializePromise = null;
  listenersRegistered = !1;
  storageKey = "TAB_GROUPS";
  static getInstance() {
    return (on.instance || (on.instance = new on()), on.instance);
  }
  async ensureInit() {
    (this.initializePromise ||
      (this.registerEventListeners(),
      (this.initializePromise = this.loadFromStorage())),
      await this.initializePromise);
  }
  async ensureAgentTabGroup(t, r, n) {
    await this.ensureInit();
    const i = await this.findManagedGroupContainingTabs(n);
    if (i != null) {
      await this.addTabToGroup(i, r);
      return;
    }
    (await this.createGroup(r, this.sessionGroupTitles.get(t)),
      await this.saveToStorage());
  }
  async releaseTabsFromManagedGroups(t) {
    await this.ensureInit();
    const r = new Set(t);
    if (r.size === 0) return;
    const n = await Promise.all(
        [...r].map(async (o) => {
          try {
            const c = await chrome.tabs.get(o);
            return typeof c.groupId != "number" ||
              !this.managedGroupIds.has(c.groupId)
              ? null
              : { groupId: c.groupId, tabId: o };
          } catch {
            return null;
          }
        }),
      ),
      i = [],
      s = new Set();
    for (const o of n) o != null && (i.push(o.tabId), s.add(o.groupId));
    i.length > 0 &&
      chrome.tabs.ungroup &&
      (await Promise.allSettled(
        i.map(async (o) => await chrome.tabs.ungroup(o)),
      ));
    let a = !1;
    for (const o of s) a = (await this.removeManagedGroupIfEmpty(o)) || a;
    a && (await this.saveToStorage());
  }
  async refreshManagedGroupsFromChrome() {
    await this.ensureInit();
    let t = !1;
    for (const r of Array.from(this.managedGroupIds))
      t = (await this.removeManagedGroupIfEmpty(r)) || t;
    t && (await this.saveToStorage());
  }
  async setSessionGroupTitle(t, r, n) {
    await this.ensureInit();
    const i = va(r),
      s = this.sessionGroupTitles.get(t) !== i;
    i ? this.sessionGroupTitles.set(t, i) : this.sessionGroupTitles.delete(t);
    const a = await this.findManagedGroupContainingTabs(n);
    if (a != null && chrome.tabGroups?.update)
      try {
        await chrome.tabGroups.update(a, {
          title: i ?? this.defaultSessionGroupTitle,
        });
      } catch {}
    s && (await this.saveToStorage());
  }
  async loadFromStorage() {
    const t = (await chrome.storage.local.get(this.storageKey))[
      this.storageKey
    ];
    if (t) {
      if (Array.isArray(t)) {
        for (const r of t)
          !r ||
            typeof r.chromeGroupId != "number" ||
            this.managedGroupIds.add(r.chromeGroupId);
        return;
      }
      for (const r of t.groups ?? [])
        !r ||
          typeof r.chromeGroupId != "number" ||
          this.managedGroupIds.add(r.chromeGroupId);
      for (const [r, n] of Object.entries(t.sessionGroupTitles ?? {})) {
        const i = va(n);
        i && this.sessionGroupTitles.set(r, i);
      }
    }
  }
  async saveToStorage() {
    const t = {
      groups: Array.from(this.managedGroupIds, (r) => ({
        chromeGroupId: r,
      })),
      sessionGroupTitles: Object.fromEntries(this.sessionGroupTitles.entries()),
    };
    await chrome.storage.local.set({ [this.storageKey]: t });
  }
  async createGroup(t, r) {
    const { windowId: n } = await chrome.tabs.get(t),
      i = await chrome.tabs.group({
        createProperties: { windowId: n },
        tabIds: [t],
      });
    if ((this.managedGroupIds.add(i), chrome.tabGroups?.update))
      try {
        await chrome.tabGroups.update(i, {
          color: Wb(),
          title: va(r) ?? this.defaultSessionGroupTitle,
        });
      } catch {}
  }
  async addTabToGroup(t, r) {
    (await chrome.tabs.get(r)).groupId !== t &&
      (await chrome.tabs.group({ groupId: t, tabIds: r }));
  }
  registerEventListeners() {
    this.listenersRegistered ||
      !chrome.tabGroups ||
      ((this.listenersRegistered = !0),
      chrome.tabGroups.onRemoved?.addListener((t) => {
        this.handleRemovedGroup(t.id);
      }));
  }
  handleRemovedGroup(t) {
    this.managedGroupIds.delete(t) && this.saveToStorage();
  }
  async readGroup(t) {
    if (!chrome.tabGroups?.get) return null;
    try {
      return await chrome.tabGroups.get(t);
    } catch {
      return null;
    }
  }
  async removeManagedGroupIfEmpty(t) {
    return (await this.groupTabIds(t)).length > 0
      ? !1
      : (this.managedGroupIds.delete(t), !0);
  }
  async groupTabIds(t) {
    return (await chrome.tabs.query({ groupId: t }))
      .map((r) => r.id)
      .filter((r) => typeof r == "number");
  }
  async findManagedGroupContainingTabs(t) {
    for (const r of t)
      try {
        const n = await chrome.tabs.get(r);
        if (typeof n.groupId != "number") continue;
        if (
          this.managedGroupIds.has(n.groupId) &&
          (await this.readGroup(n.groupId))
        )
          return n.groupId;
      } catch {}
    return null;
  }
};
