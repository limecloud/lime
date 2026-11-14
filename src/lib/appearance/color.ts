/**
 * Small color helper used by the Codex theme preset projection.
 *
 * The preset data stores opaque hex anchors. Lime derives its semantic palette
 * from those anchors instead of inventing literal preset colors.
 */

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

export function parseHexColor(value: string): RgbColor | null {
  const match = HEX_COLOR_PATTERN.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  };
}

export function toHexColor(color: RgbColor): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

export function mixHexColor(
  base: string,
  tint: string,
  amount: number,
): string {
  const from = parseHexColor(base);
  const to = parseHexColor(tint);
  if (!from || !to) return base;
  const weight = Math.max(0, Math.min(1, amount));
  return toHexColor({
    red: from.red + (to.red - from.red) * weight,
    green: from.green + (to.green - from.green) * weight,
    blue: from.blue + (to.blue - from.blue) * weight,
    alpha: 1,
  });
}

export function hexToHslTriplet(value: string): string {
  const color = parseHexColor(value);
  if (!color) return "0 0% 0%";
  const red = color.red / 255;
  const green = color.green / 255;
  const blue = color.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
  return `${Math.round(hue * 10) / 10} ${percent(saturation)} ${percent(lightness)}`;
}

export function relativeLuminance(value: string): number {
  const color = parseHexColor(value);
  if (!color) return 0;
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    channel(color.red) * 0.2126 +
    channel(color.green) * 0.7152 +
    channel(color.blue) * 0.0722
  );
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextColor(background: string): "#000000" | "#ffffff" {
  const blackContrast = contrastRatio(background, "#000000");
  const whiteContrast = contrastRatio(background, "#ffffff");
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}
