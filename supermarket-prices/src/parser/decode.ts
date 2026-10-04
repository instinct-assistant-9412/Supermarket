import { gunzipSync, inflateRawSync } from "node:zlib";

export function isGzip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

export function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/**
 * Reads the first entry of a ZIP archive. Rami Levy serves ZIP archives under a ".gz" name.
 * Sizes come from the central directory because the local header may defer them to a data descriptor.
 */
export function unzipFirstEntry(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP: end of central directory not found");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("ZIP: bad central directory");
  const method = buf.readUInt16LE(cd + 10);
  const compSize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("ZIP: bad local header");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`ZIP: unsupported compression method ${method}`);
}

/**
 * Turns a downloaded file into text. Handles gzip, and the encodings seen in the
 * wild: UTF-8 (with/without BOM), UTF-16 LE/BE (BOM or NUL bytes), and windows-1255
 * when the XML declaration says so. Some chains publish an XML file that is not gzipped
 * at all, so every step is detected from the bytes and not from the file name.
 */
export function decodeXmlBuffer(input: Buffer): string {
  let buf = input;
  if (isGzip(buf)) buf = gunzipSync(buf);
  else if (isZip(buf)) buf = unzipFirstEntry(buf);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 4 && buf[0] === 0x3c && buf[1] === 0x00) return buf.toString("utf16le");
  const head = buf.subarray(0, 200).toString("latin1");
  const m = head.match(/encoding\s*=\s*["']([\w-]+)["']/i);
  const enc = m?.[1]?.toLowerCase();
  if (enc && (enc === "windows-1255" || enc === "iso-8859-8" || enc === "cp1255")) {
    return new TextDecoder(enc === "cp1255" ? "windows-1255" : enc).decode(buf);
  }
  return buf.toString("utf8");
}
