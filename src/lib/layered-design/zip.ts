export interface StoredZipEntry {
  path: string;
  content: Uint8Array;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 33; // 1980-01-01
const ZIP_CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const textEncoder = new TextEncoder();

function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

function crc32(content: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of content) {
    value = ZIP_CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function assertZipUint32(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`ZIP ${label} 超出 32 位范围`);
  }
}

function createLocalZipHeader(
  filename: Uint8Array,
  content: Uint8Array,
  checksum: number,
): Uint8Array {
  assertZipUint32(content.byteLength, "entry size");
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, ZIP_DOS_TIME, true);
  view.setUint16(12, ZIP_DOS_DATE, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, content.byteLength, true);
  view.setUint32(22, content.byteLength, true);
  view.setUint16(26, filename.byteLength, true);
  view.setUint16(28, 0, true);

  return header;
}

function createCentralZipHeader(
  filename: Uint8Array,
  content: Uint8Array,
  checksum: number,
  localHeaderOffset: number,
): Uint8Array {
  assertZipUint32(localHeaderOffset, "local header offset");
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, ZIP_DOS_TIME, true);
  view.setUint16(14, ZIP_DOS_DATE, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, content.byteLength, true);
  view.setUint32(24, content.byteLength, true);
  view.setUint16(28, filename.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);

  return header;
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  assertZipUint32(centralDirectorySize, "central directory size");
  assertZipUint32(centralDirectoryOffset, "central directory offset");
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return header;
}

export function createStoredZipArchive(entries: StoredZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) {
    throw new Error("ZIP 导出文件数量超出限制");
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const filename = encodeUtf8(entry.path);
    const checksum = crc32(entry.content);
    const localHeader = createLocalZipHeader(
      filename,
      entry.content,
      checksum,
    );
    const centralHeader = createCentralZipHeader(
      filename,
      entry.content,
      checksum,
      localOffset,
    );

    localParts.push(localHeader, filename, entry.content);
    centralParts.push(centralHeader, filename);
    localOffset +=
      localHeader.byteLength + filename.byteLength + entry.content.byteLength;
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectorySize = centralParts.reduce(
    (sum, part) => sum + part.byteLength,
    0,
  );
  const endRecord = createEndOfCentralDirectory(
    entries.length,
    centralDirectorySize,
    centralDirectoryOffset,
  );

  return concatBytes([...localParts, ...centralParts, endRecord]);
}
