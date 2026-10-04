import { gunzipSync } from "node:zlib";

export function isGzip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
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
