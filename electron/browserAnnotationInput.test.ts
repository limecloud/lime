// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";

describe("Browser annotation picker input state", () => {
  it("publishes only current main-frame input and resets on native blur", async () => {
    const f = fixture();
    const session = await f.start();
    const state = {
      type: "input-state",
      suspended: true,
      addModifierPressed: true,
    };
    for (const payload of [
      { ...state, token: "old" },
      { ...state, documentToken: "old" },
      { ...state, pageRevision: 1 },
      { ...state, suspended: "true" },
      { ...state, addModifierPressed: null },
    ])
      f.message(payload);
    f.message(state, { senderFrame: {} });
    f.message(state, { sender: { id: 999 } });
    expect(f.events).toHaveLength(0);
    f.message(state);
    expect(f.events).toEqual([
      {
        event: "browser-tab-annotation-input-state",
        payload: { ...session, suspended: true, addModifierPressed: true },
      },
    ]);
    f.window.emit("blur");
    expect(f.events.at(-1)?.payload).toEqual({
      ...session,
      suspended: false,
      addModifierPressed: false,
    });
    expect(f.frame.send.mock.calls.at(-1)![1].type).toBe("resume");
    f.message({ type: "selection", selection: selection() });
    const count = f.events.length;
    f.message(state);
    expect(f.events).toHaveLength(count);
  });

  it("does not let saved, hidden or Agent-controlled entries publish picker state", async () => {
    const f = fixture();
    const session = await f.start();
    f.message({ type: "selection", selection: selection() });
    const capture = f.capture(session.annotationId);
    f.ready(selection());
    await capture;
    const count = f.events.length;
    f.message({
      type: "input-state",
      suspended: true,
      addModifierPressed: true,
    });
    expect(f.events).toHaveLength(count);
    await f.start();
    f.target.annotationAllowed = false;
    f.message({
      type: "input-state",
      suspended: true,
      addModifierPressed: true,
    });
    expect(
      f.events.filter((e) => e.event.endsWith("input-state")),
    ).toHaveLength(0);
  });
});

describe("Browser annotation Composer native focus", () => {
  it("hands focus to the exact renderer without selecting a page or claiming Agent control", async () => {
    const f = fixture();
    f.target.annotationAllowed = false;
    const identity = { ...f.target.identity };
    expect(
      await f.invoke("browser_tab_focus_annotation_composer", {
        tabId: "tab-1",
        identity,
      }),
    ).toEqual({ ...identity, focused: true });
    expect(f.owner.focus).toHaveBeenCalledOnce();
    expect(f.webContents.focus).not.toHaveBeenCalled();
    expect(f.frame.send).not.toHaveBeenCalled();
    expect(f.target.annotationAllowed).toBe(false);
  });

  it("rejects stale identities, nonselected or detached pages and foreign windows", async () => {
    const f = fixture();
    const identity = { ...f.target.identity };
    for (const key of Object.keys(identity)) {
      await expect(
        f.invoke("browser_tab_focus_annotation_composer", {
          tabId: "tab-1",
          identity: { ...identity, [key]: "old" },
        }),
      ).rejects.toThrow("changed");
    }
    f.target.selected = false;
    await expect(
      f.invoke("browser_tab_focus_annotation_composer", {
        tabId: "tab-1",
        identity,
      }),
    ).rejects.toThrow("changed");
    f.target.selected = true;
    f.hide();
    await expect(
      f.invoke("browser_tab_focus_annotation_composer", {
        tabId: "tab-1",
        identity,
      }),
    ).rejects.toThrow("changed");
    f.show();
    f.window.contentView.children = [];
    await expect(
      f.invoke("browser_tab_focus_annotation_composer", {
        tabId: "tab-1",
        identity,
      }),
    ).rejects.toThrow("changed");
    await expect(
      f.host.invoke(
        { ...f.window, id: 12 } as never,
        "browser_tab_focus_annotation_composer",
        { tabId: "tab-1", identity },
      ),
    ).rejects.toThrow("owner mismatch");
    expect(f.owner.focus).not.toHaveBeenCalled();
  });
});
