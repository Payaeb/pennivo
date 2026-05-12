// Tiny pure-JS sha1 implementation.
//
// Used as a content-addressed identifier — NOT for any security purpose.
// We pick sha1 here because the desktop layout already encodes paths via
// `sha1(absolutePath)`; switching to sha256 later would invalidate every
// existing snapshot directory. Keeping the implementation in `core` (rather
// than depending on Node's `crypto` or a third-party package) is a hard
// requirement: this module is shared by the desktop renderer, the eventual
// Android / iOS hosts (no Node), and the future cloud client.
//
// Algorithm follows RFC 3174 / FIPS 180-4. ~80 lines, O(n) over the input.

function rotl(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function utf8Encode(input: string): Uint8Array {
  // Browser + Node both expose TextEncoder; lib.dom + lib.es2022 cover this.
  return new TextEncoder().encode(input);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * sha1 of a UTF-8 string, returned as a 40-char lowercase hex digest.
 * Pure function; deterministic across all OSes and runtimes that supply
 * `TextEncoder` (every modern browser, Node 16+, all React Native runtimes
 * on a recent JSI).
 */
export function sha1Hex(input: string): string {
  const msg = utf8Encode(input);
  const ml = msg.length * 8;

  // Padded length is a multiple of 64 bytes, with at least 9 bytes of
  // padding (1 byte 0x80 + 8 bytes length).
  const paddedLen = Math.ceil((msg.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;

  // Append message length in bits as 64-bit big-endian. We split into two
  // 32-bit halves to avoid exceeding Number.MAX_SAFE_INTEGER on
  // pathologically long inputs (>= 2^32 bits ~ 512MB string).
  const hi = Math.floor(ml / 0x100000000);
  const lo = ml >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunkStart + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(
        (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0),
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);

  return toHex(out);
}
