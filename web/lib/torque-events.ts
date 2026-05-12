export const TORQUE_EVENT_NAMES = [
  "lendguard_wallet_connected",
  "lendguard_sol_vault_registered",
  "lendguard_btc_vault_registered",
  "lendguard_custody_proof_verified",
  "lendguard_btc_attestation_posted",
  "lendguard_lgusd_borrow_opened",
  "lendguard_lgusd_repaid",
  "lendguard_attack_demo_completed",
] as const;

export type TorqueEventName = (typeof TORQUE_EVENT_NAMES)[number];

export interface TorqueEventRecord {
  eventName: TorqueEventName;
  userPubkey: string;
  timestamp: number;
  data: Record<string, string | number | boolean | null>;
}

export interface GuardianStep {
  id: string;
  title: string;
  description: string;
  eventName: TorqueEventName;
  category: "onboarding" | "security" | "lending" | "btc";
}

export const TORQUE_GUARDIAN_STEPS: GuardianStep[] = [
  {
    id: "connect",
    title: "Connect wallet",
    description: "Start the LendGuard flow with a Solana wallet.",
    eventName: "lendguard_wallet_connected",
    category: "onboarding",
  },
  {
    id: "proof",
    title: "Verify custody proof",
    description: "Register a vault and prove collateral provenance.",
    eventName: "lendguard_custody_proof_verified",
    category: "security",
  },
  {
    id: "borrow",
    title: "Borrow LGUSD",
    description: "Open a real borrow position against verified collateral.",
    eventName: "lendguard_lgusd_borrow_opened",
    category: "lending",
  },
  {
    id: "repay",
    title: "Repay safely",
    description: "Close or reduce debt without leaving dust positions.",
    eventName: "lendguard_lgusd_repaid",
    category: "lending",
  },
  {
    id: "btc",
    title: "Register BTC testnet collateral",
    description: "Exercise the Ika Secp256k1-shaped Bitcoin collateral path.",
    eventName: "lendguard_btc_vault_registered",
    category: "btc",
  },
  {
    id: "attack-demo",
    title: "Complete attack demo",
    description: "Show fake collateral prevention and private risk response.",
    eventName: "lendguard_attack_demo_completed",
    category: "security",
  },
];

export const TORQUE_CUSTOM_EVENT_SCHEMAS = [
  {
    eventName: "lendguard_wallet_connected",
    name: "LendGuard Wallet Connected",
    fields: [
      { fieldName: "cluster", type: "string" },
      { fieldName: "source", type: "string" },
    ],
  },
  {
    eventName: "lendguard_sol_vault_registered",
    name: "LendGuard SOL Vault Registered",
    fields: [
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "collateral_type", type: "string" },
    ],
  },
  {
    eventName: "lendguard_btc_vault_registered",
    name: "LendGuard BTC Vault Registered",
    fields: [
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "collateral_type", type: "string" },
      { fieldName: "bitcoin_address", type: "string" },
      { fieldName: "ika_mode", type: "string" },
    ],
  },
  {
    eventName: "lendguard_custody_proof_verified",
    name: "LendGuard Custody Proof Verified",
    fields: [
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "collateral_type", type: "string" },
      { fieldName: "proof_source", type: "string" },
    ],
  },
  {
    eventName: "lendguard_btc_attestation_posted",
    name: "LendGuard BTC Balance Attested",
    fields: [
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "satoshis", type: "number" },
      { fieldName: "bitcoin_block_height", type: "number" },
    ],
  },
  {
    eventName: "lendguard_lgusd_borrow_opened",
    name: "LendGuard LGUSD Borrow Opened",
    fields: [
      { fieldName: "position", type: "string" },
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "amount_lgusd", type: "number" },
      { fieldName: "collateral_type", type: "string" },
    ],
  },
  {
    eventName: "lendguard_lgusd_repaid",
    name: "LendGuard LGUSD Repaid",
    fields: [
      { fieldName: "position", type: "string" },
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "amount_lgusd", type: "number" },
      { fieldName: "repay_all", type: "boolean" },
      { fieldName: "collateral_type", type: "string" },
    ],
  },
  {
    eventName: "lendguard_attack_demo_completed",
    name: "LendGuard Attack Demo Completed",
    fields: [
      { fieldName: "vault", type: "string" },
      { fieldName: "tx", type: "string" },
      { fieldName: "attack_type", type: "string" },
      { fieldName: "blocked", type: "boolean" },
    ],
  },
] as const;

export function isTorqueEventName(value: string): value is TorqueEventName {
  return (TORQUE_EVENT_NAMES as readonly string[]).includes(value);
}
