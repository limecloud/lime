// @vitest-environment node
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { EmbeddedBrowserSiteAudio } from "./embeddedBrowserSiteAudio";
import type { BrowserSitePermissionSetting } from "../src/lib/api/browserSiteSettingsTypes";

function fixture(siteRulesApply: () => boolean = () => true) {
  const events = new EventEmitter();
  let url = "https://example.com/";
  let muted = false;
  let destroyed = false;
  const rules = new Map<string, BrowserSitePermissionSetting>();
  const decision = vi.fn((origin: string) => rules.get(origin) ?? "allow");
  const changed = vi.fn();
  const webContents = Object.assign(events, {
    getURL: () => url,
    isDestroyed: () => destroyed,
    isAudioMuted: () => muted,
    setAudioMuted: vi.fn((value: boolean) => {
      muted = value;
    }),
  }) as unknown as WebContents;
  const audio = new EmbeddedBrowserSiteAudio(decision);
  audio.attach(webContents, changed, siteRulesApply);
  return {
    audio,
    webContents,
    events,
    rules,
    decision,
    changed,
    setURL: (value: string) => {
      url = value;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

describe("embedded site sound rules", () => {
  it("keeps MCP App HTML outside website rules and still respects manual mute", () => {
    const f = fixture(() => false);
    f.setURL("data:text/html,<h1>MCP App</h1>");
    f.rules.set("https://example.com", "block");
    f.events.emit("did-start-navigation", {}, "data:text/html,x", false, true);
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(false);
    expect(f.decision).not.toHaveBeenCalled();
    f.audio.setMuted(f.webContents, true);
    expect(f.webContents.isAudioMuted()).toBe(true);
  });
  it("applies rule changes immediately without navigation", () => {
    const f = fixture();
    expect(f.webContents.isAudioMuted()).toBe(false);
    f.rules.set("https://example.com", "block");
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(true);
    expect(f.changed).toHaveBeenCalledOnce();
    f.rules.delete("https://example.com");
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(false);
  });

  it("never cancels manual tab mute when a rule or origin changes", () => {
    const f = fixture();
    f.audio.setMuted(f.webContents, true);
    f.rules.set("https://example.com", "block");
    f.audio.refresh(f.webContents);
    f.rules.clear();
    f.audio.refresh(f.webContents);
    f.setURL("https://other.example/");
    f.events.emit("did-navigate");
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.audio.setMuted(f.webContents, false);
    expect(f.webContents.isAudioMuted()).toBe(false);
  });

  it("does not let unmute bypass a blocked site", () => {
    const f = fixture();
    f.rules.set("https://example.com", "block");
    f.audio.setMuted(f.webContents, false);
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.rules.clear();
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(false);
  });

  it("mutes cross-document navigation before commit and reevaluates the actual final origin", () => {
    const f = fixture();
    f.events.emit(
      "did-start-navigation",
      {},
      "https://redirect.example",
      false,
      true,
    );
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.rules.set("https://final.example", "block");
    f.setURL("https://final.example/path");
    f.events.emit("did-navigate");
    expect(f.decision).toHaveBeenLastCalledWith("https://final.example");
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.setURL("https://example.com/");
    f.events.emit("did-navigate");
    expect(f.webContents.isAudioMuted()).toBe(false);
  });

  it("restores the surviving document after cancelled navigation and ignores iframe/hash starts", () => {
    const f = fixture();
    f.events.emit(
      "did-start-navigation",
      {},
      "https://foreign.example",
      false,
      false,
    );
    f.events.emit(
      "did-start-navigation",
      {},
      "https://example.com/#anchor",
      true,
      true,
    );
    expect(f.webContents.isAudioMuted()).toBe(false);
    f.events.emit(
      "did-start-navigation",
      {},
      "https://failed.example",
      false,
      true,
    );
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.events.emit("did-stop-loading");
    expect(f.webContents.isAudioMuted()).toBe(false);
  });

  it("fails closed for opaque documents and unavailable rules, and ignores destroyed contents", () => {
    const f = fixture();
    f.setURL("data:text/html,content");
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.setURL("https://example.com/");
    f.decision.mockImplementation(() => {
      throw new Error("unavailable");
    });
    f.audio.refresh(f.webContents);
    expect(f.webContents.isAudioMuted()).toBe(true);
    f.webContents.setAudioMuted = vi.fn();
    f.destroy();
    f.audio.refresh(f.webContents);
    expect(f.webContents.setAudioMuted).not.toHaveBeenCalled();
  });
});
