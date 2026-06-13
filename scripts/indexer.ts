/**
 * The ASP indexer entry point.
 *
 *   npm run indexer        # loop forever every ASP_INTERVAL_MS
 *   npm run indexer:once   # a single tick over every selected pool, then exit
 *
 * Each tick scans new finalized deposits per pool, screens them through the configured
 * policy, and — if the resulting association-set root differs from the on-chain root —
 * publishes the opening and posts the new root from the pool's ASP authority key.
 *
 * Requires a funded aspAuthority key per chain (see .env.example). This is the testnet
 * trust point flagged in spec/privacy-pool.md §7: it controls *which* deposits can
 * withdraw, never pool integrity.
 */

import {
  dataDir,
  evmConfig,
  intervalMs,
  selectedChains,
  solanaConfig,
} from "../src/config.js";
import { buildEngineCrypto, runPoolTick, type EngineDeps } from "../src/engine.js";
import { FileStore } from "../src/store.js";
import { approveAll } from "../src/policy.js";
import { pinnerFromEnv } from "../src/publish.js";
import { createEvmAdapter } from "../src/chains/evm.js";
import { createSolanaAdapter } from "../src/chains/solana.js";
import type { ChainAdapter } from "../src/types.js";

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const chains = selectedChains();

  const deps: EngineDeps = {
    store: new FileStore(dataDir()),
    crypto: await buildEngineCrypto(),
    policy: approveAll,
    pinner: pinnerFromEnv(),
    dataDir: dataDir(),
    log,
  };

  const adapters: ChainAdapter[] = [];
  if (chains.evm) adapters.push(createEvmAdapter(evmConfig()));
  if (chains.solana) adapters.push(createSolanaAdapter(solanaConfig(), log));
  if (adapters.length === 0) throw new Error("No chains selected — set ASP_CHAINS (e.g. evm,solana)");

  log(`ASP starting: policy=${deps.policy.name} pinner=${deps.pinner.name} pools=${adapters.map((a) => a.poolId).join(",")} ${once ? "(once)" : `every ${intervalMs()}ms`}`);

  const tick = async (): Promise<void> => {
    for (const adapter of adapters) {
      try {
        const r = await runPoolTick(adapter, deps);
        log(
          `[${r.poolId}] scanned=${r.scanned} approved=${r.approved} rejected=${r.rejected} deferred=${r.deferred} set=${r.setSize} ${r.posted ? `POSTED root=${r.root} cid=${r.cid ?? "none"} tx=${r.txId}` : "no change"}`,
        );
      } catch (err) {
        log(`[${adapter.poolId}] ERROR: ${(err as Error).message ?? err}`);
      }
    }
  };

  if (once) {
    await tick();
    return;
  }
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs()));
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
