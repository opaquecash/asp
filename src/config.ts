/**
 * Environment-driven configuration, mirroring relayer/src/config.ts: direct `process.env`
 * reads, fail-fast on missing required vars, sensible testnet defaults.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { Keypair } from "@solana/web3.js";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in asp/.env`);
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${v}"`);
  return n;
}

/** Which pools to service this run. */
export function selectedChains(): { evm: boolean; solana: boolean } {
  const raw = (process.env.ASP_CHAINS ?? "evm,solana").toLowerCase();
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return { evm: set.has("evm"), solana: set.has("solana") };
}

export function intervalMs(): number {
  return intEnv("ASP_INTERVAL_MS", 60_000);
}

export function dataDir(): string {
  return process.env.ASP_DATA_DIR ? resolve(process.env.ASP_DATA_DIR) : resolve(root, "data");
}

// ── EVM ──────────────────────────────────────────────────────────────────────
export interface EvmConfig {
  chainId: number;
  rpcUrl: string;
  privateKey: string;
  /** First block to scan on a fresh pool; undefined -> adapter uses the deployment lower bound. */
  fromBlock?: number;
  confirmations: number;
  maxBlockSpan: number;
}

export function evmConfig(): EvmConfig {
  const fromBlock = process.env.ASP_EVM_FROM_BLOCK;
  return {
    chainId: intEnv("ASP_EVM_CHAIN_ID", 11155111),
    rpcUrl: env("SEPOLIA_RPC_URL"),
    privateKey: env("SEPOLIA_PRIVATE_KEY"),
    fromBlock: fromBlock ? Number(fromBlock) : undefined,
    confirmations: intEnv("ASP_EVM_CONFIRMATIONS", 5),
    maxBlockSpan: intEnv("ASP_EVM_MAX_BLOCK_SPAN", 10_000),
  };
}

// ── Solana ─────────────────────────────────────────────────────────────────
export interface SolanaConfig {
  cluster: string;
  rpcUrl: string;
  keypair: Keypair;
}

export function solanaConfig(): SolanaConfig {
  const p = (process.env.SOLANA_KEYPAIR || "~/.config/solana/id.json").replace(/^~/, homedir());
  const secret = JSON.parse(readFileSync(p, "utf-8")) as number[];
  return {
    cluster: process.env.ASP_SOLANA_CLUSTER || "devnet",
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    keypair: Keypair.fromSecretKey(Uint8Array.from(secret)),
  };
}

// ── ENS pointer (optional) ───────────────────────────────────────────────────
export interface EnsConfig {
  name: string;
  resolver: string;
  textKey: string;
  poolId: string;
  rpcUrl: string;
  privateKey: string;
}

/**
 * ENS pointer config, or null when `ASP_ENS_NAME` is unset (pointer disabled). Reuses the
 * Sepolia RPC + key (ENS lives on Ethereum); the key must control the name on the resolver.
 * One name tracks one pool's manifest (default the EVM pool).
 */
export function ensConfig(): EnsConfig | null {
  const name = process.env.ASP_ENS_NAME;
  if (!name) return null;
  return {
    name,
    resolver: env("ASP_ENS_RESOLVER"),
    textKey: process.env.ASP_ENS_TEXT_KEY || "com.opaque.aspset",
    poolId: process.env.ASP_ENS_POOL_ID || `evm:${intEnv("ASP_EVM_CHAIN_ID", 11155111)}`,
    rpcUrl: env("SEPOLIA_RPC_URL"),
    privateKey: env("SEPOLIA_PRIVATE_KEY"),
  };
}
