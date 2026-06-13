/**
 * BN254 field-element <-> 32-byte big-endian conversions.
 *
 * The privacy pool represents roots/labels as field elements. EVM uses `uint256`
 * (a bigint) directly; the Solana program stores them as `[u8; 32]` big-endian
 * (matching `set_asp_root`'s `be32` encoding in solana/scripts/e2e-privacy-pool.mjs).
 * This module keeps both adapters on one round-trippable representation.
 */

/** Bytes a Solana account/event may carry a 32-byte field element as. */
export type Bytes32Like = Uint8Array | number[] | Buffer;

/** Decode a big-endian 32-byte field element to a bigint. */
export function bytesBE32ToBigInt(bytes: Bytes32Like): bigint {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = 0n;
  for (const b of arr) out = (out << 8n) | BigInt(b);
  return out;
}

/** Encode a bigint field element as a big-endian 32-byte array (for `set_asp_root`). */
export function bigIntToBytesBE32(value: bigint): number[] {
  if (value < 0n) throw new Error(`field element must be non-negative: ${value}`);
  const out = new Array<number>(32).fill(0);
  let v = value;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v > 0n) throw new Error(`field element does not fit in 32 bytes: ${value}`);
  return out;
}
