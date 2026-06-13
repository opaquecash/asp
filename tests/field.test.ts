import { describe, it, expect } from "vitest";
import { bigIntToBytesBE32, bytesBE32ToBigInt } from "../src/field.js";

describe("field BE32 conversions", () => {
  it("round-trips field elements through big-endian 32-byte arrays", () => {
    for (const v of [0n, 1n, 255n, 256n, 0xdeadbeefn, (1n << 200n) + 12345n]) {
      expect(bytesBE32ToBigInt(bigIntToBytesBE32(v))).toBe(v);
    }
  });

  it("encodes big-endian (most significant byte first)", () => {
    const bytes = bigIntToBytesBE32(1n);
    expect(bytes).toHaveLength(32);
    expect(bytes[31]).toBe(1);
    expect(bytes[0]).toBe(0);

    expect(bigIntToBytesBE32(0x0102n).slice(30)).toEqual([1, 2]);
  });

  it("decodes from number[], Uint8Array, and Buffer alike", () => {
    const arr = bigIntToBytesBE32(0xcafen);
    expect(bytesBE32ToBigInt(arr)).toBe(0xcafen);
    expect(bytesBE32ToBigInt(Uint8Array.from(arr))).toBe(0xcafen);
    expect(bytesBE32ToBigInt(Buffer.from(arr))).toBe(0xcafen);
  });

  it("rejects values that do not fit in 32 bytes", () => {
    expect(() => bigIntToBytesBE32(1n << 256n)).toThrow();
    expect(() => bigIntToBytesBE32(-1n)).toThrow();
  });
});
