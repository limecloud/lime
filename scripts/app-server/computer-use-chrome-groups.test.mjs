import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserSession } from "../../extensions/lime-chrome/browser-session.js";
import { TabGroups } from "../../extensions/lime-chrome/tab-groups.js";

function fixture() {
  const tabs = new Map(),
    groups = new Map(),
    local = {},
    session = {};
  let tabId = 0,
    groupId = 0;
  const removed = [];
  const storage = (values) => ({
    async get(key) {
      return structuredClone({ [key]: values[key] });
    },
    async set(value) {
      Object.assign(values, structuredClone(value));
    },
  });
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      async create({ url, openerTabId }) {
        const tab = { id: ++tabId, url, openerTabId, groupId: -1, windowId: 1 };
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("missing tab");
        return { ...tabs.get(id) };
      },
      async group({ groupId: existing, tabIds }) {
        const id = existing ?? ++groupId;
        if (!groups.has(id)) groups.set(id, { id, windowId: 1 });
        for (const idTab of [tabIds].flat()) tabs.get(idTab).groupId = id;
        return id;
      },
      async ungroup(id) {
        tabs.get(id).groupId = -1;
      },
      async query({ groupId }) {
        return [...tabs.values()].filter((tab) => tab.groupId === groupId);
      },
      async remove(id) {
        tabs.delete(id);
      },
    },
    tabGroups: {
      async update(id, props) {
        Object.assign(groups.get(id), props);
      },
      async get(id) {
        if (!groups.has(id)) throw new Error("missing group");
        return { ...groups.get(id) };
      },
      onRemoved: {
        addListener(fn) {
          removed.push(fn);
        },
      },
    },
  };
  const manager = new TabGroups();
  return {
    tabs,
    groups,
    manager,
    browser: new BrowserSession(manager),
    local,
    session,
    removed,
  };
}

test("native task groups preserve emoji names and group child tabs without controlling user tabs", async () => {
  const f = fixture();
  const user = await chrome.tabs.create({ url: "https://example.org/user" });
  const userGroup = await chrome.tabs.group({ tabIds: user.id });
  await chrome.tabGroups.update(userGroup, { title: "User", color: "grey" });
  const first = await f.browser.createTask(
    " 🧪 测试环境发布验收 ",
    "https://example.org/task",
  );
  const task = f.tabs.get(first.tabId);
  assert.equal(f.groups.get(task.groupId).title, "🧪 测试环境发布验收");
  assert.notEqual(task.groupId, userGroup);
  const child = await chrome.tabs.create({
    url: "https://example.org/child",
    openerTabId: task.id,
  });
  await f.browser.claimChildTab(child);
  assert.equal(f.tabs.get(child.id).groupId, task.groupId);
  const userChild = await chrome.tabs.create({
    url: "https://example.org/personal",
    openerTabId: user.id,
  });
  await f.browser.claimChildTab(userChild);
  assert.equal(f.tabs.get(userChild.id).groupId, -1);
  assert.deepEqual(f.groups.get(userGroup), {
    id: userGroup,
    windowId: 1,
    title: "User",
    color: "grey",
  });
  assert.deepEqual(Object.keys(f.session), ["TASK_TABS"]);
});

test("two task sessions are isolated and serialized child creation shares one group", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.browser.createTask("A", "https://example.org/a"),
    f.browser.createTask("B", "https://example.org/b"),
  ]);
  assert.notEqual(f.tabs.get(a.tabId).groupId, f.tabs.get(b.tabId).groupId);
  const children = await Promise.all(
    [1, 2].map(() =>
      chrome.tabs.create({
        url: "https://example.org/child",
        openerTabId: a.tabId,
      }),
    ),
  );
  await Promise.all(children.map((tab) => f.browser.claimChildTab(tab)));
  assert(
    children.every(
      (tab) => f.tabs.get(tab.id).groupId === f.tabs.get(a.tabId).groupId,
    ),
  );
  assert.equal(f.session.TASK_TABS[a.sessionId].tabs.length, 3);
});

test("new worker instances restore groups and task ownership from Chrome storage", async () => {
  const f = fixture();
  const a = await f.browser.createTask("🧪 Resume", "https://example.org/task");
  const restored = new BrowserSession(new TabGroups());
  const child = await chrome.tabs.create({
    url: "https://example.org/child",
    openerTabId: a.tabId,
  });
  await restored.claimChildTab(child);
  assert.equal(f.tabs.get(child.id).groupId, f.tabs.get(a.tabId).groupId);
  assert.equal(f.groups.size, 1);
});

test("invalid URLs are rejected before a tab is created; grouping failure rolls back only the new tab", async () => {
  const f = fixture();
  for (const url of [
    "chrome://settings",
    "javascript:alert(1)",
    "file:///private",
    "invalid",
  ])
    await assert.rejects(f.browser.createTask("bad", url), /invalidUrl/);
  assert.equal(f.tabs.size, 0);
  const user = await chrome.tabs.create({ url: "https://example.org/user" });
  chrome.tabs.group = async () => {
    throw new Error("group denied");
  };
  await assert.rejects(
    f.browser.createTask("bad", "https://example.org/task"),
    /group denied/,
  );
  assert.deepEqual([...f.tabs.keys()], [user.id]);
  assert.deepEqual(f.session.TASK_TABS, undefined);
  assert.equal(f.manager.sessionGroupTitles.size, 0);
});

test("removed groups are pruned and closing the last task tab clears its metadata", async () => {
  const f = fixture();
  const task = await f.browser.createTask("Task", "https://example.org/task");
  const id = f.tabs.get(task.tabId).groupId;
  await chrome.tabs.remove(task.tabId);
  f.groups.delete(id);
  f.removed.forEach((fn) => fn({ id }));
  await f.browser.removeTab(task.tabId);
  assert.deepEqual(f.session.TASK_TABS, {});
  assert.equal(f.manager.managedGroupIds.size, 0);
  assert.deepEqual(f.local.TAB_GROUPS, { groups: [], sessionGroupTitles: {} });
});

const owner = { connection: "host-a", sessionId: "thread-a", turnId: "turn-a" };

test("runtime finalization closes temporary tabs, releases deliverables and preserves user groups and handoffs", async () => {
  const f = fixture();
  const user = await chrome.tabs.create({ url: "https://example.org/user" });
  const groupId = await chrome.tabs.group({ tabIds: user.id });
  await f.browser.nameSession(owner, user.id, "🧪 Model task");
  const created = [];
  for (const name of ["temporary", "deliverable", "handoff"])
    created.push(
      await f.browser.createTab(owner, user.id, `https://example.org/${name}`),
    );
  const [temp, final, next] = created;
  assert(created.every((tab) => tab.approvalRequired));
  const managed = f.tabs.get(temp.tabId).groupId;
  assert(created.every((tab) => f.tabs.get(tab.tabId).groupId === managed));
  assert.equal(f.groups.get(managed).title, "🧪 Model task");
  await f.browser.markTab(owner, user.id, final.tabId, "deliverable");
  await f.browser.markTab(owner, user.id, next.tabId, "handoff");
  const result = await f.browser.endTurn(owner);
  assert.deepEqual(result.close, [temp.tabId]);
  assert(!f.tabs.has(temp.tabId));
  assert.equal(f.tabs.get(final.tabId).groupId, -1);
  assert.equal(f.tabs.get(next.tabId).groupId, managed);
  assert.equal(f.tabs.get(user.id).groupId, groupId);
  await assert.rejects(
    f.browser.createTab(owner, user.id, "https://example.org/late"),
    /already ended/,
  );
  // A new MV3 instance resumes a handoff without retaining last turn's mark.
  const restored = new BrowserSession(new TabGroups());
  const nextOwner = { ...owner, turnId: "turn-b" };
  await restored.nameSession(nextOwner, user.id, "🟢 Continued");
  await restored.endTurn(owner); // A stale terminal must not affect turn-b.
  assert(f.tabs.has(next.tabId));
  await restored.endTurn(nextOwner);
  assert(!f.tabs.has(next.tabId));
  assert(f.tabs.has(final.tabId));
  assert(f.tabs.has(user.id));
});

test("cross-session marks and claims are rejected; controlled user children join the runtime group", async () => {
  const f = fixture();
  const user = await chrome.tabs.create({ url: "https://example.org/user" });
  const other = await chrome.tabs.create({ url: "https://example.org/other" });
  await f.browser.claimUserTab(owner, user.id);
  const child = await chrome.tabs.create({
    url: "https://example.org/child",
    openerTabId: user.id,
  });
  await f.browser.claimChildTab(child);
  assert(f.tabs.get(child.id).groupId >= 0);
  const different = { ...owner, sessionId: "thread-b" };
  await assert.rejects(
    f.browser.claimUserTab(different, user.id),
    /another browser task/,
  );
  await assert.rejects(
    f.browser.markTab(different, other.id, child.id, "deliverable"),
    /not owned/,
  );
  await assert.rejects(
    f.browser.markTab(owner, user.id, child.id, "close"),
    /Invalid tab mark/,
  );
  await new BrowserSession(new TabGroups()).disconnect();
  assert(!f.tabs.has(child.id));
  assert(f.tabs.has(user.id));
  assert(f.tabs.has(other.id));
});

test("a terminal arriving before a queued action prevents tab creation and popup tasks remain user-owned", async () => {
  const f = fixture();
  const popup = await f.browser.createTask(
    "User initiated",
    "https://example.org/popup",
  );
  await f.browser.endTurn(owner);
  await assert.rejects(
    f.browser.createTab(owner, popup.tabId, "https://example.org/late"),
    /already ended/,
  );
  await f.browser.disconnect();
  assert(f.tabs.has(popup.tabId));
  assert.equal(
    f.groups.get(f.tabs.get(popup.tabId).groupId).title,
    "User initiated",
  );
  const next = { ...owner, turnId: "popup-as-user" };
  const originalGroup = f.tabs.get(popup.tabId).groupId;
  await f.browser.markTab(next, popup.tabId, popup.tabId, "deliverable");
  await f.browser.endTurn(next);
  assert.equal(f.tabs.get(popup.tabId).groupId, originalGroup);
});

test("a queued creation revalidates authority immediately before its side effect", async () => {
  const f = fixture();
  const user = await chrome.tabs.create({ url: "https://example.org/user" });
  await assert.rejects(
    f.browser.createTab(
      owner,
      user.id,
      "https://example.org/task",
      async () => {
        throw new Error("Control fence changed");
      },
    ),
    /Control fence changed/,
  );
  assert.deepEqual([...f.tabs.keys()], [user.id]);
});
