/**
 * $SOS — Split or Steal Engine v3
 * ─────────────────────────────────────────────────────────────────────────
 * Key changes from v2:
 *   - SOL balance locked at duel start (not accumulated during duel)
 *   - Cycle timer: after duel ends, next duel fires on remaining cycle time
 *   - Each failed 90s ready check adds 90s to cycle (so always 5min left)
 *   - Duel split into: 3min chat phase → 2min vote phase
 *   - Ready check ejects non-responders and tries next in queue
 */

require("dotenv").config();

const cron  = require("node-cron");
const fetch = require("node-fetch");

const {
  Connection, PublicKey, Transaction,
  SystemProgram, Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const bs58 = require("bs58");
const { initializeApp, cert }    = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CREATOR_WALLET   = process.env.CREATOR_WALLET;
const TOKEN_CA         = process.env.TOKEN_CA;
const ST_API_KEY       = process.env.SOLANATRACKER_API_KEY;
const SOLANA_RPC       = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const GAS_RESERVE_SOL  = parseFloat(process.env.GAS_RESERVE_SOL || "0.002");
const MIN_HOLDER_USD   = parseFloat(process.env.MIN_HOLDER_USD   || "10");

const READY_CHECK_MS   = 90 * 1000;         // 90s to click ready
const CHAT_WINDOW_MS   = 3  * 60 * 1000;    // 3min chat phase
const VOTE_WINDOW_MS   = 2  * 60 * 1000;    // 2min vote phase
const TOTAL_DUEL_MS    = CHAT_WINDOW_MS + VOTE_WINDOW_MS; // 5min total
const CYCLE_MS         = 10 * 60 * 1000;    // base cycle length

// ─── STARTUP CHECKS ────────────────────────────────────────────────────────
const missing = ["CREATOR_PRIVATE_KEY","FIREBASE_SERVICE_ACCOUNT_JSON","CREATOR_WALLET","TOKEN_CA"]
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error("❌  Missing env:", missing.join(", "));
  process.exit(1);
}

// ─── SOLANA ────────────────────────────────────────────────────────────────
const connection = new Connection(SOLANA_RPC, "confirmed");
const creatorKP  = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_PRIVATE_KEY));

if (creatorKP.publicKey.toBase58() !== CREATOR_WALLET) {
  console.error(`❌  Key mismatch!\n   Expected: ${CREATOR_WALLET}\n   Got: ${creatorKP.publicKey.toBase58()}`);
  process.exit(1);
}

// ─── FIREBASE ──────────────────────────────────────────────────────────────
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const db = getFirestore();

// ─── HELPERS ───────────────────────────────────────────────────────────────
const log   = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let isRunning    = false;
let roundCounter = 0;
// Tracks when the current 10-min cycle ends
// After each round, next duel fires on the remaining cycle time
let cycleEndTime = Date.now() + CYCLE_MS;

// ─── SOLANA HELPERS ────────────────────────────────────────────────────────
async function getBalanceLamports() {
  return connection.getBalance(new PublicKey(CREATOR_WALLET));
}

async function sendSOL(to, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creatorKP.publicKey,
      toPubkey:   new PublicKey(to),
      lamports,
    })
  );
  return sendAndConfirmTransaction(connection, tx, [creatorKP], { commitment: "confirmed" });
}

// ─── QUEUE HELPERS ─────────────────────────────────────────────────────────
async function getWaitingPlayers(n = 2) {
  const snap = await db.collection("sos_queue")
    .where("status","==","waiting")
    .orderBy("joinedAt","asc")
    .limit(n)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function ejectPlayer(uid, reason = "no_ready") {
  log(`   ⚡ Ejecting ${uid} (${reason})`);
  try { await db.doc(`sos_queue/${uid}`).delete(); } catch {}
}

async function setPlayerStatus(uid, status, extra = {}) {
  try { await db.doc(`sos_queue/${uid}`).update({ status, ...extra }); } catch {}
}

// ─── READY CHECK ───────────────────────────────────────────────────────────
// Sets two players to ready_check, waits 90s, returns who responded
// Ejects non-responders. Also adds 90s to cycle for each non-responder.
async function readyCheck(p1, p2) {
  const deadline   = Date.now() + READY_CHECK_MS;
  const deadlineTs = Timestamp.fromMillis(deadline);

  log(`   ⏳ Ready check: ${p1.username} vs ${p2.username}`);

  await Promise.all([
    setPlayerStatus(p1.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
    setPlayerStatus(p2.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
  ]);

  await sleep(READY_CHECK_MS + 3000);

  const [s1, s2] = await Promise.all([
    db.doc(`sos_queue/${p1.uid}`).get(),
    db.doc(`sos_queue/${p2.uid}`).get(),
  ]);

  const p1Ready = s1.exists() && s1.data()?.status === "ready";
  const p2Ready = s2.exists() && s2.data()?.status === "ready";

  // Eject non-responders and add 90s to cycle for each
  if (!p1Ready) {
    await ejectPlayer(p1.uid, "no_ready");
    cycleEndTime += READY_CHECK_MS; // compensate
  }
  if (!p2Ready) {
    await ejectPlayer(p2.uid, "no_ready");
    cycleEndTime += READY_CHECK_MS; // compensate
  }

  log(`   P1 ready: ${p1Ready} | P2 ready: ${p2Ready}`);
  return { p1Ready, p2Ready };
}

// ─── WAIT FOR VOTES ────────────────────────────────────────────────────────
async function readVotes(p1, p2, duelId) {
  const [v1, v2] = await Promise.all([
    db.doc(`sos_private_votes/${p1.uid}`).get(),
    db.doc(`sos_private_votes/${p2.uid}`).get(),
  ]);

  const v1ok = v1.exists() && v1.data()?.duelId === duelId;
  const v2ok = v2.exists() && v2.data()?.duelId === duelId;

  return {
    vote1: v1ok ? v1.data().vote : "SPLIT",
    vote2: v2ok ? v2.data().vote : "SPLIT",
  };
}

// ─── RESOLVE ───────────────────────────────────────────────────────────────
function resolveOutcome(vote1, vote2) {
  if (vote1 === "SPLIT" && vote2 === "SPLIT") return "BOTH_SPLIT";
  if (vote1 === "STEAL" && vote2 === "STEAL") return "BOTH_STEAL";
  if (vote1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

// ─── FIRESTORE ─────────────────────────────────────────────────────────────
async function updateGlobal(fields) {
  await db.doc("sos_stats/global").set(fields, { merge: true });
}

async function finaliseDuel({ duelId, p1, p2, vote1, vote2, outcome, lockedAmount, txSig }) {
  const batch = db.batch();

  batch.update(db.doc(`sos_duels/${duelId}`), {
    vote1, vote2, outcome,
    status:      "COMPLETE",
    phase:       "complete",
    txSig:       txSig || null,
    completedAt: Timestamp.now(),
  });

  const statsUp = {
    totalRounds:      FieldValue.increment(1),
    totalDistributed: FieldValue.increment(outcome === "BOTH_STEAL" ? 0 : lockedAmount),
    lastDuelAt:       Timestamp.now(),
    activeDuel:       null,
  };
  if (outcome === "BOTH_SPLIT")  statsUp.totalSplits = FieldValue.increment(1);
  if (outcome !== "BOTH_STEAL" && outcome !== "BOTH_SPLIT")
    statsUp.totalSteals = FieldValue.increment(1);

  batch.set(db.doc("sos_stats/global"), statsUp, { merge: true });

  // Clean up private votes and queue entries
  batch.delete(db.doc(`sos_private_votes/${p1.uid}`));
  batch.delete(db.doc(`sos_private_votes/${p2.uid}`));
  batch.delete(db.doc(`sos_queue/${p1.uid}`));
  batch.delete(db.doc(`sos_queue/${p2.uid}`));

  await batch.commit();
}

// ─── MAIN ROUND ────────────────────────────────────────────────────────────
async function runRound() {
  if (isRunning) { log("⏭️  Already running, skipping."); return; }
  isRunning = true;
  const thisRound = ++roundCounter;
  log(`\n⚔️  Round ${thisRound}`);

  try {
    // ── 1. Check pot ───────────────────────────────────────────────────────
    const balLam   = await getBalanceLamports();
    const balSOL   = balLam / LAMPORTS_PER_SOL;
    const gasLam   = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);

    log(`   Balance: ◎${balSOL.toFixed(6)}`);
    await updateGlobal({ currentPotSOL: balSOL });

    if (balLam - gasLam <= 0) {
      log("   ⏸️  Pot empty. Skipping.");
      scheduleNext(CYCLE_MS);
      isRunning = false;
      return;
    }

    // ── 2. Find 2 ready players (retry up to 5 times) ─────────────────────
    let p1 = null;
    let p2 = null;
    let attempts = 0;

    while (!p1 && attempts < 5) {
      attempts++;

      const waiting = await getWaitingPlayers(4);
      if (waiting.length < 2) {
        log(`   ⚠️  Not enough players (${waiting.length}). Waiting.`);
        break;
      }

      // Try first two available
      const c1 = waiting[0];
      const c2 = waiting[1];

      const { p1Ready, p2Ready } = await readyCheck(c1, c2);

      if (p1Ready && p2Ready) {
        p1 = c1;
        p2 = c2;
      } else {
        log(`   🔄 Attempt ${attempts}: trying next players...`);
        // cycleEndTime was already adjusted inside readyCheck
      }
    }

    if (!p1 || !p2) {
      log("   ❌ Could not pair 2 ready players.");
      scheduleNext(Math.max(cycleEndTime - Date.now(), 30000));
      cycleEndTime = Date.now() + CYCLE_MS;
      isRunning = false;
      return;
    }

    log(`   ✅ Paired: ${p1.username} vs ${p2.username}`);

    // ── 3. Snapshot balance RIGHT NOW — this is the locked amount ──────────
    const snapLam    = await getBalanceLamports();
    const sendLam    = Math.max(0, snapLam - gasLam);
    const lockedSOL  = sendLam / LAMPORTS_PER_SOL;

    log(`   💰 Locked pot: ◎${lockedSOL.toFixed(6)}`);

    // ── 4. Create duel document ────────────────────────────────────────────
    const duelId     = `duel_r${thisRound}_${Date.now()}`;
    const now        = Date.now();
    const chatEndsAt = Timestamp.fromMillis(now + CHAT_WINDOW_MS);
    const voteEndsAt = Timestamp.fromMillis(now + TOTAL_DUEL_MS);

    await db.doc(`sos_duels/${duelId}`).set({
      player1:         p1.wallet,
      player2:         p2.wallet,
      player1Uid:      p1.uid,
      player2Uid:      p2.uid,
      player1Username: p1.username,
      player2Username: p2.username,
      vote1:           null,
      vote2:           null,
      hasVoted1:       false,
      hasVoted2:       false,
      outcome:         null,
      amount:          lockedSOL,    // locked at start, won't change
      lockedLamports:  sendLam,
      status:          "ACTIVE",
      phase:           "chat",       // "chat" → "vote" → "complete"
      startedAt:       Timestamp.now(),
      chatEndsAt,
      voteEndsAt,
      timestamp:       Timestamp.now(),
      round:           thisRound,
    });

    // Set players in_duel
    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);

    // Update global — active duel
    await updateGlobal({
      activeDuel: {
        duelId,
        player1:         p1.wallet,
        player2:         p2.wallet,
        player1Username: p1.username,
        player2Username: p2.username,
        chatEndsAt,
        voteEndsAt,
        amount:          lockedSOL,
        phase:           "chat",
      },
    });

    log(`   🗣️  Chat phase — ${CHAT_WINDOW_MS/60000} min`);

    // ── 5. Wait for chat phase to end ──────────────────────────────────────
    await sleep(CHAT_WINDOW_MS);

    // Transition to vote phase
    await db.doc(`sos_duels/${duelId}`).update({ phase: "vote" });
    await updateGlobal({
      "activeDuel.phase": "vote",
    });

    log(`   🗳️  Vote phase — ${VOTE_WINDOW_MS/60000} min`);

    // ── 6. Wait for vote phase ─────────────────────────────────────────────
    await sleep(VOTE_WINDOW_MS + 5000);

    // ── 7. Read votes ──────────────────────────────────────────────────────
    const { vote1, vote2 } = await readVotes(p1, p2, duelId);
    log(`   Votes — P1: ${vote1} | P2: ${vote2}`);

    const outcome = resolveOutcome(vote1, vote2);
    log(`   ⚡ Outcome: ${outcome}`);

    // ── 8. Send SOL ────────────────────────────────────────────────────────
    let txSig = null;

    if (outcome === "BOTH_STEAL") {
      log("   💀 Both stole — pot carries over.");

    } else if (outcome === "BOTH_SPLIT") {
      const half = Math.floor(sendLam / 2);
      log(`   🤝 Both split — sending ◎${(half/LAMPORTS_PER_SOL).toFixed(6)} each`);
      const [tx1, tx2] = await Promise.all([
        sendSOL(p1.wallet, half),
        sendSOL(p2.wallet, half),
      ]);
      txSig = `${tx1}|${tx2}`;
      log(`   ✅ ${tx1}`);
      log(`   ✅ ${tx2}`);

    } else {
      const winner = outcome === "P1_STEAL" ? p1 : p2;
      log(`   🗡️  ${winner.username} steals ◎${lockedSOL.toFixed(6)}`);
      txSig = await sendSOL(winner.wallet, sendLam);
      log(`   ✅ ${txSig}`);
    }

    // ── 9. Finalise ────────────────────────────────────────────────────────
    await finaliseDuel({
      duelId, p1, p2, vote1, vote2,
      outcome, lockedAmount: lockedSOL, txSig,
    });

    // Update biggest pot record
    const gs = await db.doc("sos_stats/global").get();
    if (lockedSOL > (gs.data()?.biggestPot ?? 0)) {
      await updateGlobal({ biggestPot: lockedSOL });
    }

    log(`   📝 Round ${thisRound} complete.`);

    // ── 10. Schedule next round on remaining cycle time ────────────────────
    const remaining = Math.max(cycleEndTime - Date.now(), 60000); // at least 1 min
    log(`   ⏰ Next round in ${Math.round(remaining/1000)}s`);
    scheduleNext(remaining);

    // Reset cycle for the round after that
    cycleEndTime = Date.now() + remaining + CYCLE_MS;

  } catch (err) {
    console.error(`   ❌ Round ${thisRound} error:`, err.message || err);
    try {
      await updateGlobal({ activeDuel: null });
      scheduleNext(CYCLE_MS);
    } catch {}
  }

  log("   ─────────────────────────────────────────────\n");
  isRunning = false;
}

// ─── SCHEDULER ─────────────────────────────────────────────────────────────
let nextTimer = null;

function scheduleNext(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  const nextAt = Date.now() + ms;
  db.doc("sos_stats/global").set(
    { nextDuelAt: Timestamp.fromMillis(nextAt) },
    { merge: true }
  ).catch(() => {});
  nextTimer = setTimeout(() => {
    runRound();
  }, ms);
  log(`   ⏰ Scheduled next round in ${Math.round(ms/1000)}s`);
}

// ─── BOOT ──────────────────────────────────────────────────────────────────
console.log(`
  ███████╗ ██████╗ ███████╗
  ██╔════╝██╔═══██╗██╔════╝
  ███████╗██║   ██║███████╗
  ╚════██║██║   ██║╚════██║
  ███████║╚██████╔╝███████║
  ╚══════╝ ╚═════╝ ╚══════╝
  Split or Steal v3 — Cycle-Based Engine
`);
log(`Wallet     : ${CREATOR_WALLET}`);
log(`Token      : ${TOKEN_CA}`);
log(`Gas Reserve: ◎${GAS_RESERVE_SOL}`);
log(`Chat Phase : ${CHAT_WINDOW_MS/60000}m`);
log(`Vote Phase : ${VOTE_WINDOW_MS/60000}m`);
log(`Cycle      : ${CYCLE_MS/60000}m`);
log(`────────────────────────────────────────────`);

// Start immediately
runRound();