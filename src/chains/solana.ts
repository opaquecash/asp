/**
 * Solana (devnet) chain adapter for the privacy pool's `DepositEvent` and ASP root.
 *
 * Deposits are read by polling `getSignaturesForAddress` on the pool PDA at `finalized`
 * commitment (the finality buffer — Solana finality is the reorg-safety guarantee here),
 * then decoding events from each transaction's logs with Anchor's EventParser. Cursor is
 * the last finalized signature processed. The root is stored on the pool account as
 * big-endian `[u8; 32]` and posted via `set_asp_root` (matching e2e-privacy-pool.mjs).
 */

import { createRequire } from "node:module";
import { Connection, PublicKey } from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
import { requireSolanaProgramIds } from "@opaquecash/deployments";
import { bigIntToBytesBE32, bytesBE32ToBigInt } from "../field.js";
import type { ChainAdapter, Deposit } from "../types.js";
import type { SolanaConfig } from "../config.js";

const { AnchorProvider, Program, Wallet, EventParser } = anchorPkg;
const require = createRequire(import.meta.url);
const idl = require("../../idl/opaque_privacy_pool.json");

/** getSignaturesForAddress page size. The set is small on testnet; we log if a page fills. */
const SIG_PAGE_LIMIT = 1000;

/**
 * `getTransaction` retry policy. A finalized signature whose transaction transiently
 * returns null on a public RPC must NOT be mistaken for "carries no deposit": treating it
 * as empty and advancing the cursor drops the deposit's label forever, gapping the set and
 * locking withdrawals pool-wide (OPQ-005). We retry a bounded number of times, then halt
 * the tick at the last fully-decoded signature so the deposit is re-read next tick.
 */
const GET_TX_ATTEMPTS = 4;
const GET_TX_RETRY_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSolanaAdapter(cfg: SolanaConfig, log: (msg: string) => void = () => {}): ChainAdapter {
  const programId = new PublicKey(requireSolanaProgramIds(cfg.cluster).opaquePrivacyPool);
  const connection = new Connection(cfg.rpcUrl, "finalized");
  const wallet = new Wallet(cfg.keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "finalized" });
  const program = new Program(idl, provider);
  const poolPda = PublicKey.findProgramAddressSync([Buffer.from("pool")], programId)[0];
  const parser = new EventParser(programId, program.coder);

  /** Fetch a finalized transaction, retrying transient nulls; null only after all attempts miss. */
  async function getTransactionWithRetry(signature: string) {
    for (let attempt = 0; attempt < GET_TX_ATTEMPTS; attempt++) {
      const tx = await connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (tx !== null) return tx;
      if (attempt < GET_TX_ATTEMPTS - 1) await sleep(GET_TX_RETRY_MS * (attempt + 1));
    }
    return null;
  }

  return {
    poolId: `solana:${cfg.cluster}`,
    chainLabel: `Solana ${cfg.cluster}`,

    async readDeposits(cursor: string | null): Promise<{ deposits: Deposit[]; cursor: string | null }> {
      // Newest-first signatures touching the pool, stopping at the last one we processed.
      const sigs = await connection.getSignaturesForAddress(
        poolPda,
        { until: cursor ?? undefined, limit: SIG_PAGE_LIMIT },
        "finalized",
      );
      if (sigs.length === SIG_PAGE_LIMIT) {
        log(`[solana:${cfg.cluster}] signature page full (${SIG_PAGE_LIMIT}); will catch up next tick`);
      }
      if (sigs.length === 0) return { deposits: [], cursor };

      // Process oldest-first, advancing the cursor ONLY over signatures we have fully
      // decoded. The instant a transaction cannot be fetched (transient RPC miss), we stop
      // and leave the cursor at the last decoded signature, so that deposit is re-read next
      // tick instead of being silently skipped (OPQ-005). A skipped deposit is in the
      // on-chain tree but not the ASP set, which makes the posted root non-reconstructable.
      const ordered = sigs.slice().reverse();
      const deposits: Deposit[] = [];
      let newCursor = cursor;
      for (const s of ordered) {
        // A failed transaction can never carry a successful DepositEvent, so it is safe to
        // advance past it without decoding.
        if (s.err) {
          newCursor = s.signature;
          continue;
        }
        const tx = await getTransactionWithRetry(s.signature);
        if (tx === null) {
          // Could not fetch after retries. We cannot tell whether it carried a deposit, so
          // halt here: the cursor stays at the last decoded signature (`newCursor`) and the
          // engine posts a root only for the gap-free prefix we did decode.
          log(
            `[solana:${cfg.cluster}] getTransaction returned null for ${s.signature} after ` +
              `${GET_TX_ATTEMPTS} attempts; halting tick at last decoded signature to avoid a gapped set`,
          );
          break;
        }
        const logs = tx.meta?.logMessages ?? [];
        for (const ev of parser.parseLogs(logs)) {
          if (ev.name.toLowerCase() !== "depositevent") continue;
          const data = ev.data as { label: number[] | Buffer; leafIndex: number | bigint };
          deposits.push({
            label: bytesBE32ToBigInt(data.label),
            leafIndex: Number(data.leafIndex),
            cursor: s.signature,
          });
        }
        newCursor = s.signature;
      }
      return { deposits, cursor: newCursor };
    },

    async currentAspRoot(): Promise<bigint> {
      const pool = await (program.account as any).pool.fetch(poolPda);
      return bytesBE32ToBigInt(pool.aspRoot as number[]);
    },

    async postAspRoot(root: bigint): Promise<string> {
      return (program.methods as any)
        .setAspRoot(bigIntToBytesBE32(root))
        .accountsPartial({ pool: poolPda, aspAuthority: wallet.publicKey })
        .rpc();
    },
  };
}
