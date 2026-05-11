require("dotenv").config();

const fetch = require("node-fetch");

const {
  Connection, PublicKey, Transaction,
  SystemProgram, Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const bs58 = require("bs58");
const { initializeApp, cert }    = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CREATOR_WALLET  = process.env.CREATOR_WALLET;
const TOKEN_CA        = process.env.TOKEN_CA;
const ST_API_KEY      = process.env.SOLANATRACKER_API_KEY;
const SOLANA_RPC      = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const GAS_RESERVE_SOL = parseFloat(process.env.GAS_RESERVE_SOL || "0.002");

const READY_CHECK_MS = 90 * 1000;
const CHAT_MS        =  3 * 60 * 1000;
const VOTE_MS        =  2 * 60 * 1000;
const CYCLE_MS       = 10 * 60 * 1000;

// ── STARTUP CHECKS ──────────────────────────────────────────────────────────
const missing = ["CREATOR_PRIVATE_KEY","FIREBASE_SERVICE_ACCOUNT_JSON","CREATOR_WALLET","TOKEN_CA"]
  .filter(k => !process.env[k]);
if (missing.length) { console.error("Missing env:", missing.join(", ")); process.exit(1); }

// ── SOLANA ──────────────────────────────────────────────────────────────────
const connection = new Connection(SOLANA_RPC, "confirmed");
const creatorKP  = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_PRIVATE_KEY));

if (creatorKP.publicKey.toBase58() !== CREATOR_WALLET) {
  console.error("Key mismatch! Expected:", CREATOR_WALLET);
  process.exit(1);
}

// ── FIREBASE ────────────────────────────────────────────────────────────────
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const db = getFirestore();

// ── HELPERS ─────────────────────────────────────────────────────────────────
const log   = (m) => console.log("[" + new Date().toISOString() + "] " + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let isRunning    = false;
let roundCounter = 0;
let cycleEndTime = Date.now() + CYCLE_MS;
let nextTimer    = null;

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

async function getWaitingPlayers(n) {
  const snap = await db.collection("sos_queue")
    .where("status","==","waiting")
    .orderBy("joinedAt","asc")
    .limit(n)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function ejectPlayer(uid) {
  try { await db.doc("sos_queue/" + uid).delete(); } catch {}
}

async function setPlayerStatus(uid, status, extra) {
  try { await db.doc("sos_queue/" + uid).update(Object.assign({ status }, extra || {})); } catch {}
}

async function updateGlobal(fields) {
  await db.doc("sos_stats/global").set(fields, { merge: true });
}

function resolveOutcome(vote1, vote2) {
  if (vote1 === "SPLIT" && vote2 === "SPLIT") return "BOTH_SPLIT";
  if (vote1 === "STEAL" && vote2 === "STEAL") return "BOTH_STEAL";
  if (vote1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

function scheduleNext(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  const nextAt = Date.now() + ms;
  db.doc("sos_stats/global").set({ nextDuelAt: Timestamp.fromMillis(nextAt) }, { merge: true }).catch(() => {});
  nextTimer = setTimeout(runRound, ms);
  log("Next round in " + Math.round(ms / 1000) + "s");
}

// ── READY CHECK ─────────────────────────────────────────────────────────────
// Sets two players to ready_check, waits 90s, returns who responded.
// Ejects non-responders and adds 90s to cycleEndTime per ejection.
async function readyCheck(p1, p2) {
  const deadline   = Date.now() + READY_CHECK_MS;
  const deadlineTs = Timestamp.fromMillis(deadline);

  log("Ready check: " + p1.username + " vs " + p2.username);

  await Promise.all([
    setPlayerStatus(p1.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
    setPlayerStatus(p2.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
  ]);

  await sleep(READY_CHECK_MS + 3000);

  const [s1, s2] = await Promise.all([
    db.doc("sos_queue/" + p1.uid).get(),
    db.doc("sos_queue/" + p2.uid).get(),
  ]);

  const p1Ready = s1.exists() && s1.data().status === "ready";
  const p2Ready = s2.exists() && s2.data().status === "ready";

  if (!p1Ready) { await ejectPlayer(p1.uid); cycleEndTime += READY_CHECK_MS; }
  if (!p2Ready) { await ejectPlayer(p2.uid); cycleEndTime += READY_CHECK_MS; }

  log("P1 ready: " + p1Ready + " | P2 ready: " + p2Ready);
  return { p1Ready, p2Ready };
}

// ── MAIN ROUND ───────────────────────────────────────────────────────────────
async function runRound() {
  if (isRunning) { log("Already running, skipping."); return; }
  isRunning = true;
  const thisRound = ++roundCounter;
  log("\nRound " + thisRound + " starting...");

  try {
    // 1. Check pot
    const balLam  = await getBalanceLamports();
    const balSOL  = balLam / LAMPORTS_PER_SOL;
    const gasLam  = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);

    log("Balance: " + balSOL.toFixed(6) + " SOL");
    await updateGlobal({ currentPotSOL: balSOL });

    if (balLam - gasLam <= 0) {
      log("Pot empty. Skipping.");
      scheduleNext(CYCLE_MS);
      cycleEndTime = Date.now() + CYCLE_MS * 2;
      isRunning = false;
      return;
    }

    // 2. Find 2 ready players — retry up to 5 times
    var p1 = null;
    var p2 = null;
    var attempts = 0;

    while (!p1 && attempts < 5) {
      attempts++;
      const waiting = await getWaitingPlayers(4);
      if (waiting.length < 2) {
        log("Not enough players (" + waiting.length + "). Waiting.");
        break;
      }

      const result = await readyCheck(waiting[0], waiting[1]);

      if (result.p1Ready && result.p2Ready) {
        p1 = waiting[0];
        p2 = waiting[1];
      } else {
        log("Attempt " + attempts + " failed. Trying next players...");
      }
    }

    if (!p1 || !p2) {
      log("Could not pair 2 ready players.");
      var remainingMs = Math.max(cycleEndTime - Date.now(), 30000);
      scheduleNext(remainingMs);
      cycleEndTime = Date.now() + remainingMs + CYCLE_MS;
      isRunning = false;
      return;
    }

    log("Paired: " + p1.username + " vs " + p2.username);

    // 3. Snapshot balance NOW — this is what they play for
    const snapLam   = await getBalanceLamports();
    const sendLam   = Math.max(0, snapLam - gasLam);
    const lockedSOL = sendLam / LAMPORTS_PER_SOL;
    log("Locked pot: " + lockedSOL.toFixed(6) + " SOL");

    // 4. Create duel document
    const duelId     = "duel_r" + thisRound + "_" + Date.now();
    const now        = Date.now();
    const chatEndsAt = Timestamp.fromMillis(now + CHAT_MS);
    const voteEndsAt = Timestamp.fromMillis(now + CHAT_MS + VOTE_MS);

    await db.doc("sos_duels/" + duelId).set({
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
      amount:          lockedSOL,
      lockedLamports:  sendLam,
      status:          "ACTIVE",
      phase:           "chat",
      startedAt:       Timestamp.now(),
      chatEndsAt:      chatEndsAt,
      voteEndsAt:      voteEndsAt,
      timestamp:       Timestamp.now(),
      round:           thisRound,
    });

    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);

    await updateGlobal({
      activeDuel: {
        duelId:          duelId,
        player1:         p1.wallet,
        player2:         p2.wallet,
        player1Username: p1.username,
        player2Username: p2.username,
        chatEndsAt:      chatEndsAt,
        voteEndsAt:      voteEndsAt,
        amount:          lockedSOL,
        phase:           "chat",
      },
    });

    log("Duel " + duelId + " LIVE — chat phase " + (CHAT_MS/60000) + "min");

    // 5. Wait for chat phase
    await sleep(CHAT_MS);

    await db.doc("sos_duels/" + duelId).update({ phase: "vote" });
    await db.doc("sos_stats/global").set({ "activeDuel.phase": "vote" }, { merge: true });

    log("Vote phase — " + (VOTE_MS/60000) + "min");

    // 6. Wait for vote phase
    await sleep(VOTE_MS + 5000);

    // 7. Read votes
    const [v1snap, v2snap] = await Promise.all([
      db.doc("sos_private_votes/" + p1.uid).get(),
      db.doc("sos_private_votes/" + p2.uid).get(),
    ]);

    const v1ok  = v1snap.exists() && v1snap.data().duelId === duelId;
    const v2ok  = v2snap.exists() && v2snap.data().duelId === duelId;
    const vote1 = v1ok ? v1snap.data().vote : "SPLIT";
    const vote2 = v2ok ? v2snap.data().vote : "SPLIT";

    log("Votes — P1: " + vote1 + " | P2: " + vote2);

    const outcome = resolveOutcome(vote1, vote2);
    log("Outcome: " + outcome);

    // 8. Send SOL
    var txSig = null;

    if (outcome === "BOTH_STEAL") {
      log("Both stole — pot carries over.");

    } else if (outcome === "BOTH_SPLIT") {
      const half = Math.floor(sendLam / 2);
      log("Both split — sending " + (half/LAMPORTS_PER_SOL).toFixed(6) + " each");
      const [tx1, tx2] = await Promise.all([
        sendSOL(p1.wallet, half),
        sendSOL(p2.wallet, half),
      ]);
      txSig = tx1 + "|" + tx2;
      log("TX1: " + tx1);
      log("TX2: " + tx2);

    } else {
      const winner = outcome === "P1_STEAL" ? p1 : p2;
      log(winner.username + " steals " + lockedSOL.toFixed(6) + " SOL");
      txSig = await sendSOL(winner.wallet, sendLam);
      log("TX: " + txSig);
    }

    // 9. Finalise
    const batch = db.batch();

    batch.update(db.doc("sos_duels/" + duelId), {
      vote1:       vote1,
      vote2:       vote2,
      outcome:     outcome,
      status:      "COMPLETE",
      phase:       "complete",
      txSig:       txSig || null,
      completedAt: Timestamp.now(),
    });

    const statsUp = {
      totalRounds:      FieldValue.increment(1),
      totalDistributed: FieldValue.increment(outcome === "BOTH_STEAL" ? 0 : lockedSOL),
      lastDuelAt:       Timestamp.now(),
      activeDuel:       null,
    };
    if (outcome === "BOTH_SPLIT") statsUp.totalSplits = FieldValue.increment(1);
    if (outcome === "P1_STEAL" || outcome === "P2_STEAL") statsUp.totalSteals = FieldValue.increment(1);

    batch.set(db.doc("sos_stats/global"), statsUp, { merge: true });
    batch.delete(db.doc("sos_private_votes/" + p1.uid));
    batch.delete(db.doc("sos_private_votes/" + p2.uid));
    batch.delete(db.doc("sos_queue/" + p1.uid));
    batch.delete(db.doc("sos_queue/" + p2.uid));

    await batch.commit();

    const gs = await db.doc("sos_stats/global").get();
    if (lockedSOL > (gs.data().biggestPot || 0)) {
      await updateGlobal({ biggestPot: lockedSOL });
    }

    log("Round " + thisRound + " complete.");

    // 10. Schedule next on remaining cycle time
    const remaining = Math.max(cycleEndTime - Date.now(), 60000);
    log("Next round in " + Math.round(remaining/1000) + "s");
    scheduleNext(remainingMs);
    cycleEndTime = Date.now() + remainingMs + CYCLE_MS;

  } catch (err) {
    console.error("Round " + thisRound + " error:", err.message || err);
    try {
      await updateGlobal({ activeDuel: null });
      scheduleNext(CYCLE_MS);
    } catch {}
  }

  log("─────────────────────────────────────────────\n");
  isRunning = false;
}

// ── BOOT ────────────────────────────────────────────────────────────────────
console.log("\n  $SOS Split or Steal Engine v3\n  Wallet: " + CREATOR_WALLET + "\n  Token:  " + TOKEN_CA + "\n");
log("Gas Reserve: " + GAS_RESERVE_SOL + " SOL");
log("Chat Phase:  " + (CHAT_MS/60000) + " min");
log("Vote Phase:  " + (VOTE_MS/60000) + " min");
log("Cycle:       " + (CYCLE_MS/60000) + " min");
log("────────────────────────────────────────────");

runRound();