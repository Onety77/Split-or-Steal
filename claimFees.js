/**
 * claimFees.js — Auto-claim pump.fun creator fees
 * ─────────────────────────────────────────────────────────────────────────
 * Drop this file in the same folder as engine.js for both $SOS and LBW.
 * Import and call startAutoClaimFees() once on boot.
 *
 * What it does:
 *   Every CLAIM_INTERVAL_MS it calls collect_creator_fee on the pump.fun
 *   program, which transfers accumulated creator fees from the PDA vault
 *   directly into your creator wallet.
 *
 * Works for tokens still on the bonding curve (pump.fun program).
 * For graduated tokens on PumpSwap, see the note at the bottom.
 */

const {
  Connection, PublicKey, Transaction,
  TransactionInstruction, SystemProgram,
  Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

// ── Constants ────────────────────────────────────────────────────────────────
const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Anchor discriminator for collect_creator_fee
// = sha256("global:collect_creator_fee").slice(0,8)
const COLLECT_CREATOR_FEE_DISCRIMINATOR = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);

// Anchor discriminator for collect_coin_creator_fee (PumpSwap — graduated tokens)
// = sha256("global:collect_coin_creator_fee").slice(0,8)
const COLLECT_COIN_CREATOR_FEE_DISCRIMINATOR = Buffer.from([160, 57, 89, 42, 181, 139, 43, 66]);

const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

// How often to auto-claim (ms)
const CLAIM_INTERVAL_MS = 15 * 1000; // every 60 seconds

// ── Derive the creator vault PDA ─────────────────────────────────────────────
// Seeds: ["creator-vault", creator_pubkey]
function deriveCreatorVault(creatorPubkey) {
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("creator-vault"),
      creatorPubkey.toBuffer(),
    ],
    PUMP_PROGRAM_ID
  );
  return vaultPDA;
}

// ── Derive PumpSwap creator vault ATA (for graduated tokens) ─────────────────
// Seeds for PumpSwap vault authority: ["creator_vault", creator_pubkey]
function derivePumpSwapCreatorVaultAuthority(creatorPubkey) {
  const [authority] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("creator_vault"),
      creatorPubkey.toBuffer(),
    ],
    PUMP_AMM_PROGRAM_ID
  );
  return authority;
}

// ── Get vault SOL balance ─────────────────────────────────────────────────────
async function getVaultBalance(connection, vaultPDA) {
  try {
    const bal = await connection.getBalance(vaultPDA);
    return bal;
  } catch {
    return 0;
  }
}

// ── Build collect_creator_fee instruction ────────────────────────────────────
function buildCollectCreatorFeeInstruction(creatorPubkey, creatorVaultPDA) {
  const keys = [
    { pubkey: creatorPubkey,   isSigner: true,  isWritable: true  },
    { pubkey: creatorVaultPDA, isSigner: false, isWritable: true  },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: PUMP_PROGRAM_ID,
    data: COLLECT_CREATOR_FEE_DISCRIMINATOR,
  });
}

// ── Claim bonding curve creator fees ─────────────────────────────────────────
async function claimBondingCurveFees(connection, creatorKP, log) {
  const creatorPubkey   = creatorKP.publicKey;
  const creatorVaultPDA = deriveCreatorVault(creatorPubkey);

  const vaultBalance = await getVaultBalance(connection, creatorVaultPDA);
  if (vaultBalance <= 5000) {
    // Less than 5000 lamports — not worth claiming (would cost more in gas)
    log("  [claim] Vault balance: " + (vaultBalance/LAMPORTS_PER_SOL).toFixed(6) + " SOL — skipping (too small)");
    return 0;
  }

  log("  [claim] Vault balance: " + (vaultBalance/LAMPORTS_PER_SOL).toFixed(6) + " SOL — claiming...");

  const ix = buildCollectCreatorFeeInstruction(creatorPubkey, creatorVaultPDA);
  const tx = new Transaction().add(ix);

  try {
    const sig = await sendAndConfirmTransaction(
      connection, tx, [creatorKP],
      { commitment: "confirmed" }
    );
    const claimed = vaultBalance / LAMPORTS_PER_SOL;
    log("  [claim] ✅ Claimed ◎" + claimed.toFixed(6) + " | TX: " + sig);
    return claimed;
  } catch (e) {
    // Common error: vault doesn't exist yet (no fees accumulated)
    if (e.message && (e.message.includes("AccountNotFound") || e.message.includes("account does not exist"))) {
      log("  [claim] Vault not initialized yet — no fees to claim.");
    } else {
      log("  [claim] Error: " + e.message);
    }
    return 0;
  }
}

// ── Main export: start the auto-claim loop ───────────────────────────────────
function startAutoClaimFees(connection, creatorKP, log) {
  const creatorVaultPDA = deriveCreatorVault(creatorKP.publicKey);
  log("[AutoClaim] Starting — vault PDA: " + creatorVaultPDA.toBase58());
  log("[AutoClaim] Claiming every " + (CLAIM_INTERVAL_MS/1000) + "s");

  // Claim immediately on start
  claimBondingCurveFees(connection, creatorKP, log).catch(() => {});

  // Then on interval
  setInterval(async () => {
    try {
      await claimBondingCurveFees(connection, creatorKP, log);
    } catch (e) {
      log("[AutoClaim] Interval error: " + (e.message || e));
    }
  }, CLAIM_INTERVAL_MS);
}

module.exports = {
  startAutoClaimFees,
  deriveCreatorVault,
  claimBondingCurveFees,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
};

/*
 * ── NOTE ON GRADUATED TOKENS (PumpSwap) ────────────────────────────────────
 *
 * If your token has graduated from the bonding curve to PumpSwap,
 * the creator fees are held in a WSOL ATA (not a system account).
 * The claim instruction for that is collect_coin_creator_fee on the
 * PumpSwap program (pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA).
 *
 * The current implementation handles bonding curve tokens.
 * If your token graduates, the vault PDA changes and you'd need to
 * unwrap WSOL after claiming. Cross that bridge if/when it happens.
 *
 * You can check if your token has graduated by calling:
 *   const bondingCurvePDA = PublicKey.findProgramAddressSync(
 *     [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
 *     PUMP_PROGRAM_ID
 *   )[0];
 *   const acct = await connection.getAccountInfo(bondingCurvePDA);
 *   // if acct is null — token has graduated to PumpSwap
 */