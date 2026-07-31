/**
 * Browser zip reader/writer for the Lambda Code tab.
 *
 * The AWS console edits a function's deployment package in place: it downloads the zip,
 * lets you edit the files, and re-uploads a rebuilt zip on Deploy. LCS serves the real
 * package at GetFunction's Code.Location and accepts a new one through UpdateFunctionCode,
 * so the same loop works here — the only piece missing was zip handling in the browser,
 * which is this file. No external library: read handles stored + deflate, write emits
 * stored (which Lambda accepts).
 */

export interface ZipEntry {
  name: string;
  /** Decoded UTF-8 text. Binary entries are flagged so the editor can refuse them. */
  text: string;
  isBinary: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** A file looks binary if it has NUL bytes — good enough to keep the editor honest. */
function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // deflate-raw is method 8 without the zlib wrapper, which is what zip uses.
  const stream = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
  );
  return new Uint8Array(await stream.arrayBuffer());
}

/**
 * Reads the central directory of a zip and returns each file's bytes.
 *
 * The central directory is authoritative for entry names and offsets, so it is walked
 * rather than the local headers — local headers can carry a data descriptor that makes
 * their sizes unreliable.
 */
export async function unzip(zipBytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  // Find the End Of Central Directory record by scanning back for its signature.
  let eocd = -1;
  for (let i = zipBytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Not a valid zip archive.");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(zipBytes.subarray(pointer + 46, pointer + 46 + nameLength));

    // The local header's name and extra fields vary in length, so the data start is read
    // from the local header itself rather than assumed.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zipBytes.subarray(dataStart, dataStart + compressedSize);

    // Directory entries end in "/" and carry no data — skip them.
    if (!name.endsWith("/")) {
      const bytes = method === 8 ? await inflateRaw(raw) : raw;
      const isBinary = looksBinary(bytes);
      entries.push({ name, text: isBinary ? "" : decoder.decode(bytes), isBinary });
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a zip from text files, stored uncompressed (method 0).
 *
 * Stored needs no compression library and Lambda accepts it, same as the create flow's
 * single-file builder. Binary entries the editor could not show are preserved by passing
 * their original bytes through {@link ZipEntry} is not supported here — the Code tab only
 * offers Deploy when every entry is text.
 */
export function buildZip(files: { name: string; contents: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.contents);
    const crc = crc32(dataBytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true);
    local.setUint32(22, dataBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    const localBytes = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    localBytes.set(new Uint8Array(local.buffer), 0);
    localBytes.set(nameBytes, 30);
    localBytes.set(dataBytes, 30 + nameBytes.length);
    locals.push(localBytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dataBytes.length, true);
    central.setUint32(24, dataBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    const centralBytes = new Uint8Array(46 + nameBytes.length);
    centralBytes.set(new Uint8Array(central.buffer), 0);
    centralBytes.set(nameBytes, 46);
    centrals.push(centralBytes);

    offset += localBytes.length;
  }

  const centralSize = centrals.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const bytes of locals) {
    out.set(bytes, cursor);
    cursor += bytes.length;
  }
  for (const bytes of centrals) {
    out.set(bytes, cursor);
    cursor += bytes.length;
  }
  out.set(new Uint8Array(end.buffer), cursor);
  return out;
}
