/**
 * Curation policies — the ASP's screening logic behind the {@link Policy} seam.
 *
 * v1 ships `approveAll`: every confirmed deposit joins the clean set (matching the
 * existing end-to-end test in ethereum/infra/scripts/e2e-privacy-pool.ts, which approves
 * each deposit). Real deployments drop in a screener or an allow/deny list here with no
 * change to the engine — it only ever sees `approve | reject | defer`.
 */

import type { Deposit, Policy, Screen } from "./types.js";

/** Approve every deposit. The pipeline-exercising default for testnet. */
export const approveAll: Policy = {
  name: "approve-all",
  screen(): Screen {
    return "approve";
  },
};

/**
 * Approve only labels on an explicit allowlist; everything else is rejected. A starting
 * point for real curation — swap `reject` for `defer` to queue unknowns for review.
 */
export function allowlistPolicy(allowed: Iterable<bigint>): Policy {
  const set = new Set([...allowed].map((x) => x.toString()));
  return {
    name: `allowlist(${set.size})`,
    screen(deposit: Deposit): Screen {
      return set.has(deposit.label.toString()) ? "approve" : "reject";
    },
  };
}
