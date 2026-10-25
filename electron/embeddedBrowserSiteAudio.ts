import type { WebContents } from "electron";
import type { BrowserSitePermissionSetting } from "../src/lib/api/browserSiteSettingsTypes";

interface AudioState {
  muted: boolean;
  navigating: boolean;
  changed: () => void;
  siteRulesApply: () => boolean;
}

/** Combines the user's tab mute with the current document's site sound rule. */
export class EmbeddedBrowserSiteAudio {
  readonly #states = new WeakMap<WebContents, AudioState>();

  constructor(
    private readonly decision: (origin: string) => BrowserSitePermissionSetting,
  ) {}

  attach(
    webContents: WebContents,
    changed: () => void,
    siteRulesApply: () => boolean = () => true,
  ): void {
    this.#states.set(webContents, {
      muted: webContents.isAudioMuted(),
      navigating: false,
      changed,
      siteRulesApply,
    });
    webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        this.#states.get(webContents)!.navigating = true;
        this.refresh(webContents);
      },
    );
    const committed = () => {
      this.#states.get(webContents)!.navigating = false;
      this.refresh(webContents);
    };
    webContents.on("did-navigate", committed);
    webContents.on("did-stop-loading", committed);
    this.refresh(webContents);
  }

  setMuted(webContents: WebContents, muted: boolean): void {
    const state = this.#states.get(webContents);
    if (!state) throw new Error("Browser audio state is unavailable");
    state.muted = muted;
    this.refresh(webContents);
  }

  refresh(webContents: WebContents): void {
    const state = this.#states.get(webContents);
    if (!state || webContents.isDestroyed()) return;
    const applies = state.siteRulesApply();
    let allowed = !applies;
    try {
      if (applies) {
        const url = new URL(webContents.getURL());
        allowed =
          ["http:", "https:"].includes(url.protocol) &&
          this.decision(url.origin) === "allow";
      }
    } catch {
      // An unavailable site rule or document must not enable playback.
    }
    const muted = state.muted || (applies && state.navigating) || !allowed;
    if (webContents.isAudioMuted() === muted) return;
    webContents.setAudioMuted(muted);
    state.changed();
  }
}
