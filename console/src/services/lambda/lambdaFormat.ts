/** Lambda returns LastModified as an ISO-8601 string, not a Date. */
export function formatLambdaDate(value: string | Date | undefined): string {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function dash(value: string | number | undefined | null): string {
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

/**
 * A minimal zip containing a single `index.js`, built in the browser.
 *
 * The AWS console uploads real deployment packages; LCS's create flow needs a working
 * package without a build step, so the console produces one. Stored uncompressed
 * (method 0) because that needs no compression library and Lambda accepts it.
 */
export function buildSingleFileZip(fileName: string, contents: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(fileName);
  const dataBytes = encoder.encode(contents);
  const crc = crc32(dataBytes);

  const localHeader = new DataView(new ArrayBuffer(30));
  localHeader.setUint32(0, 0x04034b50, true); // local file header signature
  localHeader.setUint16(4, 20, true); // version needed
  localHeader.setUint16(6, 0, true); // flags
  localHeader.setUint16(8, 0, true); // method: stored
  localHeader.setUint16(10, 0, true); // mod time
  localHeader.setUint16(12, 0, true); // mod date
  localHeader.setUint32(14, crc, true);
  localHeader.setUint32(18, dataBytes.length, true);
  localHeader.setUint32(22, dataBytes.length, true);
  localHeader.setUint16(26, nameBytes.length, true);
  localHeader.setUint16(28, 0, true); // extra length

  const centralHeader = new DataView(new ArrayBuffer(46));
  centralHeader.setUint32(0, 0x02014b50, true); // central directory signature
  centralHeader.setUint16(4, 20, true); // version made by
  centralHeader.setUint16(6, 20, true); // version needed
  centralHeader.setUint16(8, 0, true);
  centralHeader.setUint16(10, 0, true);
  centralHeader.setUint16(12, 0, true);
  centralHeader.setUint16(14, 0, true);
  centralHeader.setUint32(16, crc, true);
  centralHeader.setUint32(20, dataBytes.length, true);
  centralHeader.setUint32(24, dataBytes.length, true);
  centralHeader.setUint16(28, nameBytes.length, true);
  centralHeader.setUint16(30, 0, true);
  centralHeader.setUint16(32, 0, true);
  centralHeader.setUint16(34, 0, true);
  centralHeader.setUint16(36, 0, true);
  centralHeader.setUint32(38, 0, true); // external attributes
  centralHeader.setUint32(42, 0, true); // offset of local header

  const localSize = 30 + nameBytes.length + dataBytes.length;
  const centralSize = 46 + nameBytes.length;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, 1, true); // entries on this disk
  end.setUint16(10, 1, true); // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, localSize, true);
  end.setUint16(20, 0, true);

  const out = new Uint8Array(localSize + centralSize + 22);
  let offset = 0;
  const put = (bytes: Uint8Array) => {
    out.set(bytes, offset);
    offset += bytes.length;
  };
  put(new Uint8Array(localHeader.buffer));
  put(nameBytes);
  put(dataBytes);
  put(new Uint8Array(centralHeader.buffer));
  put(nameBytes);
  put(new Uint8Array(end.buffer));
  return out;
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
