import { describe, it, expect } from "vitest";
import { sha1Hex } from "../sha1";

// Reference vectors from RFC 3174 Appendix A and FIPS 180-2.
describe("sha1Hex", () => {
  it("hashes the empty string", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("hashes 'abc' (RFC 3174 vector)", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("hashes 'The quick brown fox...' (classic vector)", () => {
    expect(sha1Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
    );
  });

  it("hashes the 56-byte boundary case (RFC 3174 vector)", () => {
    expect(
      sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });

  it("hashes a multi-block input (1,000,000 'a's)", () => {
    expect(sha1Hex("a".repeat(1_000_000))).toBe(
      "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
    );
  });

  it("handles UTF-8 multi-byte characters", () => {
    // sha1("é") where é = U+00E9 = 0xC3 0xA9 in UTF-8 — verified against
    // Node's `crypto.createHash('sha1')`.
    expect(sha1Hex("é")).toBe("bf15be717ac1b080b4f1c456692825891ff5073d");
  });

  it("is deterministic across calls", () => {
    expect(sha1Hex("hello")).toBe(sha1Hex("hello"));
  });

  it("returns 40 lowercase hex chars", () => {
    expect(sha1Hex("anything")).toMatch(/^[0-9a-f]{40}$/);
  });
});
