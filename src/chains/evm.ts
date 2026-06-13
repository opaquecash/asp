/**
 * EVM (Sepolia) chain adapter for the privacy pool's `Deposit` events and ASP root.
 *
 * Pool address + a safe lower-bound scan block come from @opaquecash/deployments, so a
 * redeploy is a registry bump, not a code change. Deposits are only returned once they are
 * `confirmations` blocks deep (reorg safety): a label that has been published in a root and
 * withdrawn against cannot be cleanly retracted, so eligibility waits for finality.
 */

import { ethers } from "ethers";
import { requireEvmDeployment } from "@opaquecash/deployments";
import type { ChainAdapter, Deposit } from "../types.js";
import type { EvmConfig } from "../config.js";

const POOL_ABI = [
  "event Deposit(bytes32 indexed commitment, uint256 label, uint256 value, uint32 leafIndex)",
  "function aspRoot() view returns (uint256)",
  "function setAspRoot(uint256 newRoot)",
];

export function createEvmAdapter(cfg: EvmConfig): ChainAdapter {
  const deployment = requireEvmDeployment(cfg.chainId);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const signer = new ethers.Wallet(cfg.privateKey, provider);
  const pool = new ethers.Contract(deployment.contracts.opaquePrivacyPool, POOL_ABI, signer);

  // No pool-specific deploy block in the registry; uabFromBlock is a safe lower bound
  // (the pool shipped after the UAB stack). Override with ASP_EVM_FROM_BLOCK to scan less.
  const defaultFrom = Number(deployment.uabFromBlock);
  const fromBlock = cfg.fromBlock ?? defaultFrom;

  return {
    poolId: `evm:${cfg.chainId}`,
    chainLabel: `${deployment.name} (chainId ${cfg.chainId})`,

    async readDeposits(cursor: string | null): Promise<{ deposits: Deposit[]; cursor: string | null }> {
      const latest = await provider.getBlockNumber();
      const head = latest - cfg.confirmations; // finality buffer
      const start = cursor !== null ? Number(cursor) + 1 : fromBlock;
      if (head < start) return { deposits: [], cursor }; // nothing newly finalized

      const deposits: Deposit[] = [];
      const depositFilter = pool.filters.Deposit();
      for (let from = start; from <= head; from += cfg.maxBlockSpan) {
        const to = Math.min(from + cfg.maxBlockSpan - 1, head);
        const logs = await pool.queryFilter(depositFilter, from, to);
        for (const log of logs) {
          const args = (log as ethers.EventLog).args;
          if (!args) continue;
          deposits.push({
            label: BigInt(args.label),
            leafIndex: Number(args.leafIndex),
            cursor: String(log.blockNumber),
          });
        }
      }
      return { deposits, cursor: String(head) };
    },

    async currentAspRoot(): Promise<bigint> {
      return BigInt(await pool.aspRoot());
    },

    async postAspRoot(root: bigint): Promise<string> {
      const tx = await pool.setAspRoot(root);
      const receipt = await tx.wait();
      return receipt?.hash ?? tx.hash;
    },
  };
}
