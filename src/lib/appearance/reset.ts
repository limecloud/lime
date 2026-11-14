import { setAccentColor } from "./accent";
import { setCodeFontFamily } from "./codeFontFamily";
import { CODE_FONT_SIZE_DEFAULT, setCodeFontSize } from "./codeFontSize";
import { setContentFontFamily } from "./contentFontFamily";
import { setFontSmoothingEnabled } from "./fontSmoothing";
import { setPointerCursorsEnabled } from "./pointerCursor";
import { setReducedMotionPreference } from "./reducedMotion";
import { setSmartPunctuationEnabled } from "./smartPunctuation";
import { resetSeparateModes } from "./separateModes";
import { resetThemePresets } from "./themePresets";
import { setUiFontFamily } from "./uiFontFamily";
import { setUiFontSize } from "./uiFontSize";
import { setContentFontSize } from "./typography";

/**
 * Codex's Advanced appearance "Reset to default" restores the advanced
 * preferences but leaves the light/dark/system mode itself alone.  Lime's
 * page-level action keeps that same ownership while covering every control it
 * exposes.
 */
export function resetAppearancePreferences() {
  setUiFontFamily("system");
  setContentFontFamily("ui");
  setUiFontSize(14);
  setContentFontSize(15);
  setCodeFontFamily("system");
  setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
  setPointerCursorsEnabled(false);
  setSmartPunctuationEnabled(false);
  setReducedMotionPreference("system");
  setFontSmoothingEnabled(true);
  setAccentColor("default");
  resetThemePresets();
  resetSeparateModes();
}
