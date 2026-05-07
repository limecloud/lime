import { isImageDesignLayer, sortDesignLayers } from "./document";
import type {
  DesignBlendMode,
  DesignLayer,
  LayeredDesignDocument,
  TextLayer,
} from "./types";

export const LAYERED_DESIGN_TRIAL_PSD_WRITER_VERSION =
  "2026-05-07.trial-psd.p2";

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface PsdLayerRecord {
  layer: DesignLayer;
  bounds: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  };
  color: RgbColor;
  alpha: number;
}

class BinaryWriter {
  private readonly chunks: Uint8Array[] = [];

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  writeAscii(value: string): void {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      bytes[index] = value.charCodeAt(index) & 0xff;
    }
    this.writeBytes(bytes);
  }

  writeUInt8(value: number): void {
    this.writeBytes(Uint8Array.of(value & 0xff));
  }

  writeUInt16(value: number): void {
    this.writeBytes(Uint8Array.of((value >>> 8) & 0xff, value & 0xff));
  }

  writeInt16(value: number): void {
    this.writeUInt16(value < 0 ? 0x10000 + value : value);
  }

  writeUInt32(value: number): void {
    this.writeBytes(
      Uint8Array.of(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ),
    );
  }

  writeInt32(value: number): void {
    this.writeUInt32(value < 0 ? 0x100000000 + value : value);
  }

  toUint8Array(): Uint8Array {
    const totalLength = this.chunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0,
    );
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizePositiveInteger(value: number, fallback = 1): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : fallback));
}

function normalizeLayerOpacity(layer: DesignLayer): number {
  return Math.max(
    0,
    Math.min(1, Number.isFinite(layer.opacity) ? layer.opacity : 1),
  );
}

function parseHexColor(value: string | undefined, fallback: RgbColor): RgbColor {
  const normalized = value?.trim().replace(/^#/, "");
  if (!normalized) {
    return fallback;
  }

  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    return fallback;
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function resolveLayerColor(layer: DesignLayer): RgbColor {
  if (layer.type === "text") {
    return parseHexColor(layer.color, { red: 15, green: 23, blue: 42 });
  }
  if (layer.type === "shape") {
    return parseHexColor(layer.fill, { red: 250, green: 204, blue: 21 });
  }
  if (isImageDesignLayer(layer)) {
    return { red: 96, green: 165, blue: 250 };
  }
  return { red: 148, green: 163, blue: 184 };
}

function resolveBlendModeKey(blendMode: DesignBlendMode | undefined): string {
  switch (blendMode) {
    case "multiply":
      return "mul ";
    case "screen":
      return "scrn";
    case "overlay":
      return "over";
    case "lighten":
      return "lite";
    case "normal":
    default:
      return "norm";
  }
}

function createLayerBounds(layer: DesignLayer): PsdLayerRecord["bounds"] {
  const left = Math.round(Number.isFinite(layer.x) ? layer.x : 0);
  const top = Math.round(Number.isFinite(layer.y) ? layer.y : 0);
  const width = normalizePositiveInteger(layer.width);
  const height = normalizePositiveInteger(layer.height);

  return {
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
  };
}

function createPsdLayerRecord(layer: DesignLayer): PsdLayerRecord {
  return {
    layer,
    bounds: createLayerBounds(layer),
    color: resolveLayerColor(layer),
    alpha:
      layer.type === "group" ? 0 : clampByte(normalizeLayerOpacity(layer) * 255),
  };
}

function createFilledPlane(length: number, value: number): Uint8Array {
  const output = new Uint8Array(length);
  output.fill(clampByte(value));
  return output;
}

function writeLengthPrefixedSection(
  writer: BinaryWriter,
  byteLength: number,
  content: Uint8Array,
): void {
  writer.writeUInt32(byteLength);
  writer.writeBytes(content);
}

function createPascalLayerName(name: string): Uint8Array {
  const asciiName = name.replace(/[^\x20-\x7e]+/g, "?").slice(0, 255);
  const rawLength = 1 + asciiName.length;
  const paddedLength = Math.ceil(rawLength / 4) * 4;
  const output = new Uint8Array(paddedLength);
  output[0] = asciiName.length;
  for (let index = 0; index < asciiName.length; index += 1) {
    output[index + 1] = asciiName.charCodeAt(index) & 0xff;
  }
  return output;
}

function createUnicodeLayerNameBlock(name: string): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeUInt32(name.length);
  for (const char of name) {
    const codePoint = char.codePointAt(0) ?? 0x003f;
    if (codePoint > 0xffff) {
      const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
      const low = ((codePoint - 0x10000) % 0x400) + 0xdc00;
      writer.writeUInt16(high);
      writer.writeUInt16(low);
    } else {
      writer.writeUInt16(codePoint);
    }
  }
  const data = writer.toUint8Array();
  const block = new BinaryWriter();
  block.writeAscii("8BIM");
  block.writeAscii("luni");
  block.writeUInt32(data.byteLength);
  block.writeBytes(data);
  if (data.byteLength % 2 === 1) {
    block.writeUInt8(0);
  }
  return block.toUint8Array();
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function createAdditionalLayerInfoBlock(key: string, data: Uint8Array): Uint8Array {
  const normalizedKey = key.replace(/[^\x20-\x7e]/g, "?").padEnd(4, " ").slice(0, 4);
  const block = new BinaryWriter();
  block.writeAscii("8BIM");
  block.writeAscii(normalizedKey);
  block.writeUInt32(data.byteLength);
  block.writeBytes(data);
  if (data.byteLength % 2 === 1) {
    block.writeUInt8(0);
  }
  return block.toUint8Array();
}

function truncateTextForLayerName(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function resolvePsdLayerName(layer: DesignLayer): string {
  if (layer.type !== "text") {
    return layer.name;
  }

  const textPreview = truncateTextForLayerName(layer.text);
  if (!textPreview || layer.name.includes(textPreview)) {
    return layer.name;
  }

  return `${layer.name} · ${textPreview}`;
}

function createTextLayerSemanticBlock(layer: TextLayer): Uint8Array {
  return createAdditionalLayerInfoBlock(
    "LmTx",
    encodeUtf8(
      JSON.stringify({
        kind: "lime.layered-design.text-layer",
        writerVersion: LAYERED_DESIGN_TRIAL_PSD_WRITER_VERSION,
        id: layer.id,
        name: layer.name,
        text: layer.text,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        color: layer.color,
        align: layer.align,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        fallback: "rasterized_placeholder_layer",
      }),
    ),
  );
}

function createLayerExtraData(layer: DesignLayer): Uint8Array {
  const writer = new BinaryWriter();
  const layerName = resolvePsdLayerName(layer);
  writer.writeUInt32(0);
  writer.writeUInt32(0);
  writer.writeBytes(createPascalLayerName(layerName));
  writer.writeBytes(createUnicodeLayerNameBlock(layerName));
  if (layer.type === "text") {
    writer.writeBytes(createTextLayerSemanticBlock(layer));
  }
  return writer.toUint8Array();
}

function writeLayerRecord(writer: BinaryWriter, record: PsdLayerRecord): void {
  const pixelCount = record.bounds.width * record.bounds.height;
  const channelLength = 2 + pixelCount;
  const extraData = createLayerExtraData(record.layer);

  writer.writeInt32(record.bounds.top);
  writer.writeInt32(record.bounds.left);
  writer.writeInt32(record.bounds.bottom);
  writer.writeInt32(record.bounds.right);
  writer.writeUInt16(4);
  for (const channelId of [0, 1, 2, -1]) {
    writer.writeInt16(channelId);
    writer.writeUInt32(channelLength);
  }
  writer.writeAscii("8BIM");
  writer.writeAscii(resolveBlendModeKey(record.layer.blendMode));
  writer.writeUInt8(clampByte(normalizeLayerOpacity(record.layer) * 255));
  writer.writeUInt8(0);
  writer.writeUInt8(record.layer.visible ? 0 : 2);
  writer.writeUInt8(0);
  writeLengthPrefixedSection(writer, extraData.byteLength, extraData);
}

function writeLayerChannelImageData(
  writer: BinaryWriter,
  record: PsdLayerRecord,
): void {
  const pixelCount = record.bounds.width * record.bounds.height;
  for (const value of [
    record.color.red,
    record.color.green,
    record.color.blue,
    record.alpha,
  ]) {
    writer.writeUInt16(0);
    writer.writeBytes(createFilledPlane(pixelCount, value));
  }
}

function createLayerInfoSection(records: PsdLayerRecord[]): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeInt16(records.length);
  for (const record of records) {
    writeLayerRecord(writer, record);
  }
  for (const record of records) {
    writeLayerChannelImageData(writer, record);
  }
  if (writer.toUint8Array().byteLength % 2 === 1) {
    writer.writeUInt8(0);
  }
  return writer.toUint8Array();
}

function createLayerAndMaskInfoSection(records: PsdLayerRecord[]): Uint8Array {
  const layerInfo = createLayerInfoSection(records);
  const writer = new BinaryWriter();
  writeLengthPrefixedSection(writer, layerInfo.byteLength, layerInfo);
  writer.writeUInt32(0);
  return writer.toUint8Array();
}

function writePsdHeader(
  writer: BinaryWriter,
  width: number,
  height: number,
): void {
  writer.writeAscii("8BPS");
  writer.writeUInt16(1);
  writer.writeBytes(new Uint8Array(6));
  writer.writeUInt16(3);
  writer.writeUInt32(height);
  writer.writeUInt32(width);
  writer.writeUInt16(8);
  writer.writeUInt16(3);
}

function writeCompositeImageData(
  writer: BinaryWriter,
  width: number,
  height: number,
  background: RgbColor,
): void {
  const pixelCount = width * height;
  writer.writeUInt16(0);
  writer.writeBytes(createFilledPlane(pixelCount, background.red));
  writer.writeBytes(createFilledPlane(pixelCount, background.green));
  writer.writeBytes(createFilledPlane(pixelCount, background.blue));
}

export function createLayeredDesignTrialPsdFile(
  document: LayeredDesignDocument,
): Uint8Array {
  const width = normalizePositiveInteger(document.canvas.width);
  const height = normalizePositiveInteger(document.canvas.height);
  const background = parseHexColor(document.canvas.backgroundColor, {
    red: 255,
    green: 255,
    blue: 255,
  });
  const layerRecords = sortDesignLayers(document.layers).map(createPsdLayerRecord);
  const writer = new BinaryWriter();
  const layerAndMaskInfo = createLayerAndMaskInfoSection(layerRecords);

  writePsdHeader(writer, width, height);
  writer.writeUInt32(0);
  writer.writeUInt32(0);
  writeLengthPrefixedSection(
    writer,
    layerAndMaskInfo.byteLength,
    layerAndMaskInfo,
  );
  writeCompositeImageData(writer, width, height, background);

  return writer.toUint8Array();
}
