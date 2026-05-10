/**
 * $SOS — Split or Steal Engine v2
 * ─────────────────────────────────────────────────────────────────────────
 * Run: node engine.js
 *
 * Every 10 minutes:
 *   1. Gets top 2 players from the queue (ordered by joinedAt)
 *   2. Sends them a ready check — 90 second window to click READY
 *   3. If someone doesn't ready up, ejects them, tries next in queue
 *   4. When both ready, opens 5-minute duel window with live chat
 *   5. After 5 minutes, reads both private votes, resolves outcome
 *   6. Sends SOL based on outcome, logs everything to Firestore
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
const GAS_RESERVE_SOL  = parseFloat(process.env.GAS_RESERVE_SOL  || "0.005");
const MIN_HOLDER_USD   = parseFloat(process.env.MIN_HOLDER_USD   || "10");

const READY_CHECK_MS   = 90 * 1000;         // 90 seconds to click ready
const VOTE_WINDOW_MS   = 5  * 60 * 1000;    // 5 minutes to vote

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

// ─── STATE ─────────────────────────────────────────────────────────────────
const log         = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
let   isRunning   = false;
let   roundCounter = 0;

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

// ─── TOKEN PRICE ───────────────────────────────────────────────────────────
async function getTokenPrice() {
  try {
    await new Promise(r => setTimeout(r, 2000));
    const res  = await fetch(`https://data.solanatracker.io/tokens/${TOKEN_CA}`, {
      headers: { "x-api-key": ST_API_KEY }
    });
    const data = await res.json();
    return data?.price?.usd ?? data?.price ?? data?.pools?.[0]?.price?.usd ?? 0;
  } catch { return 0; }
}

// ─── QUEUE HELPERS ─────────────────────────────────────────────────────────

// Get next N waiting players from queue (ordered by joinedAt)
async function getWaitingPlayers(n = 2) {
  const snap = await db.collection("sos_queue")
    .where("status", "==", "waiting")
    .orderBy("joinedAt", "asc")
    .limit(n)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Eject a player from the queue
async function ejectPlayer(uid, reason = "no_ready") {
  log(`   ⚡ Ejecting ${uid} (${reason})`);
  try {
    await db.doc(`sos_queue/${uid}`).delete();
  } catch {}
}

// Set player status
async function setPlayerStatus(uid, status, extra = {}) {
  await db.doc(`sos_queue/${uid}`).update({ status, ...extra });
}

// ─── READY CHECK ───────────────────────────────────────────────────────────
// Returns true if both players readied up, false if either didn't
async function readyCheck(p1, p2) {
  const deadline    = Date.now() + READY_CHECK_MS;
  const deadlineTs  = Timestamp.fromMillis(deadline);

  log(`   ⏳ Ready check — ${p1.username} vs ${p2.username} — 90s`);

  // Set both to ready_check
  await Promise.all([
    setPlayerStatus(p1.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
    setPlayerStatus(p2.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
  ]);

  // Wait 90 seconds
  await new Promise(r => setTimeout(r, READY_CHECK_MS + 3000));

  // Check who responded
  const [s1, s2] = await Promise.all([
    db.doc(`sos_queue/${p1.uid}`).get(),
    db.doc(`sos_queue/${p2.uid}`).get(),
  ]);

  const p1Ready = s1.exists() && s1.data()?.status === "ready";
  const p2Ready = s2.exists() && s2.data()?.status === "ready";

  log(`   P1 ready: ${p1Ready} | P2 ready: ${p2Ready}`);

  if (!p1Ready) await ejectPlayer(p1.uid, "no_ready");
  if (!p2Ready) await ejectPlayer(p2.uid, "no_ready");

  return p1Ready && p2Ready;
}

// ─── WAIT FOR VOTES ────────────────────────────────────────────────────────
// Waits up to VOTE_WINDOW_MS for both private votes to be submitted
// Returns { vote1, vote2 }
async function waitForVotes(p1, p2, duelId) {
  log(`   ⏳ Voting window open — ${VOTE_WINDOW_MS/60000} minutes`);
  await new Promise(r => setTimeout(r, VOTE_WINDOW_MS + 5000));

  // Read private votes (only Admin SDK can access this collection)
  const [v1snap, v2snap] = await Promise.all([
    db.doc(`sos_private_votes/${p1.uid}`).get(),
    db.doc(`sos_private_votes/${p2.uid}`).get(),
  ]);

  // Validate the votes are for THIS duel (prevent replay)
  const v1data = v1snap.exists() && v1snap.data()?.duelId === duelId ? v1snap.data() : null;
  const v2data = v2snap.exists() && v2snap.data()?.duelId === duelId ? v2snap.data() : null;

  const vote1 = v1data?.vote || "SPLIT"; // default to SPLIT on no vote
  const vote2 = v2data?.vote || "SPLIT";

  log(`   🗳️  Votes — P1: ${vote1} | P2: ${vote2}`);
  return { vote1, vote2 };
}

// ─── RESOLVE OUTCOME ───────────────────────────────────────────────────────
function resolveOutcome(vote1, vote2) {
  if (vote1 === "SPLIT" && vote2 === "SPLIT") return "BOTH_SPLIT";
  if (vote1 === "STEAL" && vote2 === "STEAL") return "BOTH_STEAL";
  if (vote1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

// ─── LOG DUEL TO FIRESTORE ─────────────────────────────────────────────────
async function logDuelResult({ duelId, p1, p2, vote1, vote2, outcome, amount, txSig }) {
  const batch = db.batch();

  // Update duel doc
  batch.update(db.doc(`sos_duels/${duelId}`), {
    vote1, vote2, outcome,
    status:      "COMPLETE",
    txSig:       txSig || null,
    completedAt: Timestamp.now(),
  });

  // Global stats update
  const statsUpdate = {
    totalRounds:      FieldValue.increment(1),
    totalDistributed: FieldValue.increment(outcome === "BOTH_STEAL" ? 0 : amount),
    lastDuelAt:       Timestamp.now(),
    activeDuel:       null,
    nextDuelAt:       Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
  };
  if (outcome === "BOTH_SPLIT")  statsUpdate.totalSplits  = FieldValue.increment(1);
  if (outcome.includes("STEAL") && outcome !== "BOTH_STEAL")
    statsUpdate.totalSteals = FieldValue.increment(1);

  batch.set(db.doc("sos_stats/global"), statsUpdate, { merge: true });

  // Clean up private votes
  batch.delete(db.doc(`sos_private_votes/${p1.uid}`));
  batch.delete(db.doc(`sos_private_votes/${p2.uid}`));

  // Remove both from queue
  batch.delete(db.doc(`sos_queue/${p1.uid}`));
  batch.delete(db.doc(`sos_queue/${p2.uid}`));

  await batch.commit();
}

// ─── MAIN DUEL LOOP ────────────────────────────────────────────────────────
async function runRound() {
  if (isRunning) {
    log("⏭️  Round already in progress, skipping.");
    return;
  }
  isRunning = true;
  const thisRound = ++roundCounter;
  log(`\n⚔️  Round ${thisRound} starting...`);

  try {
    // 1. Check pot
    const balLam   = await getBalanceLamports();
    const balSOL   = balLam / LAMPORTS_PER_SOL;
    const gasLam   = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);
    const sendLam  = balLam - gasLam;
    const sendSOLAmt = sendLam / LAMPORTS_PER_SOL;

    log(`   Balance: ◎${balSOL.toFixed(6)} | Sendable: ◎${sendSOLAmt.toFixed(6)}`);

    // Update global pot
    await db.doc("sos_stats/global").set({
      currentPotSOL: balSOL,
      nextDuelAt:    Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    }, { merge: true });

    if (sendSOLAmt < 0.001 || sendLam <= 0) {
      log("   ⏸️  Pot too small. Skipping.");
      isRunning = false;
      return;
    }

    // 2. Get waiting players — try until we have 2 ready
    let p1 = null;
    let p2 = null;
    let attempts = 0;

    while ((!p1 || !p2) && attempts < 5) {
      attempts++;
      const players = await getWaitingPlayers(4); // get 4 in case some fail

      if (players.length < 2) {
        log(`   ⚠️  Only ${players.length} player(s) in queue. Need 2. Waiting for next round.`);
        await db.doc("sos_stats/global").set({ activeDuel: null }, { merge: true });
        isRunning = false;
        return;
      }

      // Try the first two
      const candidate1 = players[0];
      const candidate2 = players[1];

      log(`   Trying: ${candidate1.username} vs ${candidate2.username}`);

      // Verify both still hold $10+ (price check)
      // (simplified: if price is 0 we skip the check)
      const price = await getTokenPrice();
      if (price > 0) {
        // We'd need to refetch holder data to check USD value
        // For now we trust the queue entry's last-known value
        // A more robust implementation would re-verify wallets here
        log(`   Token price: $${parseFloat(price).toFixed(6)}`);
      }

      // Run ready check
      const bothReady = await readyCheck(candidate1, candidate2);

      if (bothReady) {
        p1 = candidate1;
        p2 = candidate2;
      } else {
        log(`   🔄 Ready check failed — trying next players...`);
        // Get fresh queue to find new candidates
        // (ejected players are already removed from queue above)
      }
    }

    if (!p1 || !p2) {
      log("   ❌ Could not find 2 ready players after multiple attempts.");
      isRunning = false;
      return;
    }

    log(`   ✅ Both ready: ${p1.username} vs ${p2.username}`);

    // 3. Create duel document
    const duelId    = `duel_r${thisRound}_${Date.now()}`;
    const duelStart = Timestamp.now();
    const duelEnd   = Timestamp.fromMillis(Date.now() + VOTE_WINDOW_MS);

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
      amount:          sendSOLAmt,
      status:          "ACTIVE",
      startedAt:       duelStart,
      endsAt:          duelEnd,
      round:           thisRound,
      timestamp:       duelStart,
    });

    // 4. Update both queue entries → in_duel
    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);

    // 5. Update global stats — show active duel
    await db.doc("sos_stats/global").set({
      activeDuel: {
        duelId,
        player1:         p1.wallet,
        player2:         p2.wallet,
        player1Username: p1.username,
        player2Username: p2.username,
        endsAt:          duelEnd,
        amount:          sendSOLAmt,
      },
      nextDuelAt: Timestamp.fromMillis(Date.now() + VOTE_WINDOW_MS + 5 * 60 * 1000),
    }, { merge: true });

    log(`   🎮 Duel ${duelId} LIVE — waiting ${VOTE_WINDOW_MS/60000} min for votes`);

    // 6. Wait for votes
    const { vote1, vote2 } = await waitForVotes(p1, p2, duelId);

    // 7. Resolve outcome
    const outcome = resolveOutcome(vote1, vote2);
    log(`   ⚡ Outcome: ${outcome}`);

    // 8. Send SOL
    let txSig    = null;
    let winnerSOL = 0;

    if (outcome === "BOTH_STEAL") {
      log("   💀 Both stole — nobody wins. Pot carries over.");

    } else if (outcome === "BOTH_SPLIT") {
      const half = Math.floor(sendLam / 2);
      winnerSOL  = half / LAMPORTS_PER_SOL;
      log(`   ✅ Both split — sending ◎${winnerSOL.toFixed(6)} to each...`);
      const tx1 = await sendSOL(p1.wallet, half);
      const tx2 = await sendSOL(p2.wallet, half);
      txSig = `${tx1}|${tx2}`;
      log(`   ✅ TX1: ${tx1}`);
      log(`   ✅ TX2: ${tx2}`);

    } else {
      const winner = outcome === "P1_STEAL" ? p1 : p2;
      winnerSOL    = sendSOLAmt;
      log(`   🗡️  ${winner.username} wins ◎${sendSOLAmt.toFixed(6)}...`);
      txSig = await sendSOL(winner.wallet, sendLam);
      log(`   ✅ TX: ${txSig}`);
      log(`   🔍 https://solscan.io/tx/${txSig}`);
    }

    // 9. Log to Firestore + clean up
    await logDuelResult({
      duelId, p1, p2, vote1, vote2, outcome,
      amount: winnerSOL,
      txSig,
    });

    // Update biggest pot record
    const globalSnap = await db.doc("sos_stats/global").get();
    if (sendSOLAmt > (globalSnap.data()?.biggestPot ?? 0)) {
      await db.doc("sos_stats/global").update({ biggestPot: sendSOLAmt });
    }

    log(`   📝 Round ${thisRound} complete.`);

  } catch (err) {
    console.error(`   ❌ Round ${thisRound} error:`, err.message || err);
    try {
      await db.doc("sos_stats/global").set({
        activeDuel: null,
        nextDuelAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      }, { merge: true });
    } catch {}
  }

  log("   ─────────────────────────────────────────────\n");
  isRunning = false;
}

// ─── BOOT ──────────────────────────────────────────────────────────────────
console.log(`
  ███████╗ ██████╗ ███████╗
  ██╔════╝██╔═══██╗██╔════╝
  ███████╗██║   ██║███████╗
  ╚════██║██║   ██║╚════██║
  ███████║╚██████╔╝███████║
  ╚══════╝ ╚═════╝ ╚══════╝
  Split or Steal v2 — Queue-Based Engine
`);
log(`Wallet      : ${CREATOR_WALLET}`);
log(`Token       : ${TOKEN_CA}`);
log(`Ready Check : ${READY_CHECK_MS/1000}s`);
log(`Vote Window : ${VOTE_WINDOW_MS/60000}m`);
log(`Gas Reserve : ◎${GAS_RESERVE_SOL}`);
log(`────────────────────────────────────────────`);

runRound();
cron.schedule("*/10 * * * *", runRound);
