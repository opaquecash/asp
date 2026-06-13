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

export function createSolanaAdapter(cfg: SolanaConfig, log: (msg: string) => void = () => {}): ChainAdapter {
  const programId = new PublicKey(requireSolanaProgramIds(cfg.cluster).opaquePrivacyPool);
  const connection = new Connection(cfg.rpcUrl, "finalized");
  const wallet = new Wallet(cfg.keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "finalized" });
  const program = new Program(idl, provider);
  const poolPda = PublicKey.findProgramAddressSync([Buffer.from("pool")], programId)[0];
  const parser = new EventParser(programId, program.coder);

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

      // Process oldest-first so the cursor advances monotonically.
      const ordered = sigs.slice().reverse();
      const deposits: Deposit[] = [];
      for (const s of ordered) {
        if (s.err) continue;
        const tx = await connection.getTransaction(s.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        const logs = tx?.meta?.logMessages ?? [];
        for (const ev of parser.parseLogs(logs)) {
          if (ev.name.toLowerCase() !== "depositevent") continue;
          const data = ev.data as { label: number[] | Buffer; leafIndex: number | bigint };
          deposits.push({
            label: bytesBE32ToBigInt(data.label),
            leafIndex: Number(data.leafIndex),
            cursor: s.signature,
          });
        }
      }
      const newCursor = ordered[ordered.length - 1]?.signature ?? cursor;
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
