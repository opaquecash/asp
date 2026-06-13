/**
 * Optional ENS pointer: publish the latest association-set manifest CID as an ENS text
 * record, so withdrawers can discover the current opening through decentralized naming
 * (resolved client-side by @opaquecash/privacy-pool's resolveAspSetViaEns) without
 * depending on the ASP's own server.
 *
 * It writes `com.opaque.aspset = ipfs://<cid>` via a standard ENS resolver's
 * `setText(node, key, value)`. The ASP authority key must control `name` on the resolver.
 * Discovery via ENS is decentralized; the manifest itself stays self-authenticating against
 * the on-chain aspRoot, so this pointer is a convenience/availability layer, never trust.
 */

import { ethers } from "ethers";

/** ENS text-record key the client (resolveAspSetViaEns) reads. Keep in sync with the SDK. */
export const ASP_SET_RECORD_KEY = "com.opaque.aspset";

const RESOLVER_ABI = ["function setText(bytes32 node, string key, string value)"];

export interface EnsPointerConfig {
  /** ENS name the ASP controls, e.g. "evm-asp.opqtest.eth". */
  name: string;
  /** ENS resolver address that holds the text record. */
  resolver: string;
  /** Text-record key (default {@link ASP_SET_RECORD_KEY}). */
  textKey: string;
  /** The poolId whose manifest this name tracks (one name per pool). */
  poolId: string;
  rpcUrl: string;
  privateKey: string;
}

export interface EnsPointer {
  readonly poolId: string;
  readonly name: string;
  readonly textKey: string;
  /** Point the record at `ipfs://<cid>`. Returns the tx hash. */
  publishCid(cid: string): Promise<string>;
}

/** Wrap an IPFS CID as the `ipfs://` URI the client expects in the text record. */
export function aspSetUri(cid: string): string {
  return cid.startsWith("ipfs://") ? cid : `ipfs://${cid}`;
}

export function createEnsPointer(cfg: EnsPointerConfig): EnsPointer {
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const signer = new ethers.Wallet(cfg.privateKey, provider);
  const resolver = new ethers.Contract(cfg.resolver, RESOLVER_ABI, signer);
  const node = ethers.namehash(cfg.name);

  return {
    poolId: cfg.poolId,
    name: cfg.name,
    textKey: cfg.textKey,
    async publishCid(cid: string): Promise<string> {
      const tx = await resolver.setText(node, cfg.textKey, aspSetUri(cid));
      const receipt = await tx.wait();
      return receipt?.hash ?? tx.hash;
    },
  };
}
