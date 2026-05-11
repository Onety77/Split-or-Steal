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

// Retry wrapper for flaky network calls
async function withRetry(fn, retries, label) {
  for (var i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      log("  Retry " + (i+1) + "/" + retries + " for " + label + ": " + e.message);
      await sleep(1500 * (i + 1));
    }
  }
}

async function getBalanceLamports() {
  return withRetry(
    () => connection.getBalance(new PublicKey(CREATOR_WALLET)),
    3,
    "getBalance"
  );
}

async function sendSOL(to, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creatorKP.publicKey,
      toPubkey:   new PublicKey(to),
      lamports,
    })
  );
  return withRetry(
    () => sendAndConfirmTransaction(connection, tx, [creatorKP], { commitment: "confirmed" }),
    2,
    "sendSOL"
  );
}

async function getWaitingPlayers(n) {
  const snap = await db.collection("sos_queue")
    .where("status","==","waiting")
    .orderBy("joinedAt","asc")
    .limit(n)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Use set+merge instead of update — never fails due to missing doc
async function setPlayerStatus(uid, status, extra) {
  try {
    await db.doc("sos_queue/" + uid).set(
      Object.assign({ status: status }, extra || {}),
      { merge: true }
    );
    log("  setPlayerStatus OK: " + uid + " → " + status);
  } catch (e) {
    log("  setPlayerStatus FAILED for " + uid + ": " + e.message);
  }
}

async function ejectPlayer(uid) {
  log("  Ejecting " + uid);
  try { await db.doc("sos_queue/" + uid).delete(); } catch (e) {
    log("  Eject failed for " + uid + ": " + e.message);
  }
}

async function updateGlobal(fields) {
  try {
    await db.doc("sos_stats/global").set(fields, { merge: true });
  } catch (e) {
    log("  updateGlobal failed: " + e.message);
  }
}

function resolveOutcome(v1, v2) {
  if (v1 === "SPLIT" && v2 === "SPLIT") return "BOTH_SPLIT";
  if (v1 === "STEAL" && v2 === "STEAL") return "BOTH_STEAL";
  if (v1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

function scheduleNext(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  var safeMs = Math.max(ms, 10000); // at least 10s
  var nextAt  = Date.now() + safeMs;
  updateGlobal({ nextDuelAt: Timestamp.fromMillis(nextAt) });
  nextTimer = setTimeout(runRound, safeMs);
  log("Next round scheduled in " + Math.round(safeMs / 1000) + "s");
}

// ── READY CHECK ─────────────────────────────────────────────────────────────
async function readyCheck(p1, p2) {
  var deadline   = Date.now() + READY_CHECK_MS;
  var deadlineTs = Timestamp.fromMillis(deadline);

  log("Ready check: " + p1.username + " vs " + p2.username + " (90s)");

  await Promise.all([
    setPlayerStatus(p1.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
    setPlayerStatus(p2.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
  ]);

  // Wait the full window
  await sleep(READY_CHECK_MS + 3000);

  var s1, s2;
  try {
    var results = await Promise.all([
      db.doc("sos_queue/" + p1.uid).get(),
      db.doc("sos_queue/" + p2.uid).get(),
    ]);
    s1 = results[0];
    s2 = results[1];
  } catch (e) {
    log("  Error reading queue after ready check: " + e.message);
    return { p1Ready: false, p2Ready: false };
  }

  var p1Ready = s1.exists() && s1.data().status === "ready";
  var p2Ready = s2.exists() && s2.data().status === "ready";

  log("  P1 ready: " + p1Ready + " | P2 ready: " + p2Ready);

  if (!p1Ready) { await ejectPlayer(p1.uid); cycleEndTime += READY_CHECK_MS; }
  if (!p2Ready) { await ejectPlayer(p2.uid); cycleEndTime += READY_CHECK_MS; }

  return { p1Ready: p1Ready, p2Ready: p2Ready };
}

// ── MAIN ROUND ───────────────────────────────────────────────────────────────
async function runRound() {
  if (isRunning) { log("Already running, skipping."); return; }
  isRunning = true;
  var thisRound = ++roundCounter;
  var p1 = null;
  var p2 = null;
  log("\n=== Round " + thisRound + " starting ===");

  try {
    // 1. Check pot balance
    log("Checking wallet balance...");
    var balLam = await getBalanceLamports();
    var balSOL = balLam / LAMPORTS_PER_SOL;
    var gasLam = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);
    log("Balance: " + balSOL.toFixed(6) + " SOL | Gas reserve: " + GAS_RESERVE_SOL);

    await updateGlobal({ currentPotSOL: balSOL });

    if (balLam - gasLam <= 0) {
      log("Pot empty after gas reserve. Skipping.");
      scheduleNext(CYCLE_MS);
      cycleEndTime = Date.now() + CYCLE_MS * 2;
      isRunning = false;
      return;
    }

    // 2. Find 2 ready players — up to 5 attempts
    var attempts = 0;
    while (!p1 && attempts < 5) {
      attempts++;
      log("Attempt " + attempts + " — fetching waiting players...");

      var waiting = await getWaitingPlayers(4);
      log("Waiting players found: " + waiting.length);

      if (waiting.length < 2) {
        log("Not enough players. Waiting for next cycle.");
        break;
      }

      var rc = await readyCheck(waiting[0], waiting[1]);

      if (rc.p1Ready && rc.p2Ready) {
        p1 = waiting[0];
        p2 = waiting[1];
        log("Both ready! Proceeding with: " + p1.username + " vs " + p2.username);
      } else {
        log("Ready check failed on attempt " + attempts + ". Trying next players...");
      }
    }

    if (!p1 || !p2) {
      log("Could not pair 2 ready players after " + attempts + " attempts.");
      var ms1 = Math.max(cycleEndTime - Date.now(), 30000);
      scheduleNext(ms1);
      cycleEndTime = Date.now() + ms1 + CYCLE_MS;
      isRunning = false;
      return;
    }

    // 3. Snapshot balance NOW — this is the locked pot
    log("Snapshotting balance for locked pot...");
    var snapLam  = await getBalanceLamports();
    var sendLam  = Math.max(0, snapLam - gasLam);
    var lockedSOL = sendLam / LAMPORTS_PER_SOL;
    log("Locked pot: " + lockedSOL.toFixed(6) + " SOL (" + sendLam + " lamports)");

    // 4. Create duel document in Firestore
    var duelId     = "duel_r" + thisRound + "_" + Date.now();
    var duelNow    = Date.now();
    var chatEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS);
    var voteEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS + VOTE_MS);

    log("Creating duel document: " + duelId);
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
    log("Duel document created OK.");

    // 5. Set players to in_duel
    log("Setting players to in_duel...");
    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);
    log("Players set to in_duel OK.");

    // 6. Update global stats with active duel
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
    log("Global stats updated — duel is LIVE.");

    // 7. Chat phase
    log("Chat phase: " + (CHAT_MS/60000) + " min...");
    await sleep(CHAT_MS);

    try {
      await db.doc("sos_duels/" + duelId).update({ phase: "vote" });
      await db.doc("sos_stats/global").set({ "activeDuel.phase": "vote" }, { merge: true });
    } catch (e) {
      log("Warning: phase update failed: " + e.message);
    }
    log("Vote phase: " + (VOTE_MS/60000) + " min...");

    // 8. Vote phase
    await sleep(VOTE_MS + 5000);

    // 9. Read votes from private collection
    log("Reading votes...");
    var v1snap, v2snap;
    try {
      var vResults = await Promise.all([
        db.doc("sos_private_votes/" + p1.uid).get(),
        db.doc("sos_private_votes/" + p2.uid).get(),
      ]);
      v1snap = vResults[0];
      v2snap = vResults[1];
    } catch (e) {
      log("Error reading votes: " + e.message);
      v1snap = { exists: () => false };
      v2snap = { exists: () => false };
    }

    var v1ok  = v1snap.exists() && v1snap.data().duelId === duelId;
    var v2ok  = v2snap.exists() && v2snap.data().duelId === duelId;
    var vote1 = v1ok ? v1snap.data().vote : "SPLIT";
    var vote2 = v2ok ? v2snap.data().vote : "SPLIT";

    log("Votes — P1: " + vote1 + " (voted: " + v1ok + ") | P2: " + vote2 + " (voted: " + v2ok + ")");

    var outcome = resolveOutcome(vote1, vote2);
    log("Outcome: " + outcome);

    // 10. Send SOL
    var txSig = null;

    if (outcome === "BOTH_STEAL") {
      log("Both stole — nobody wins, pot carries over.");

    } else if (outcome === "BOTH_SPLIT") {
      var half = Math.floor(sendLam / 2);
      log("Both split — sending " + (half/LAMPORTS_PER_SOL).toFixed(6) + " SOL each...");
      var tx1 = await sendSOL(p1.wallet, half);
      var tx2 = await sendSOL(p2.wallet, half);
      txSig = tx1 + "|" + tx2;
      log("TX1: " + tx1);
      log("TX2: " + tx2);

    } else {
      var winner = outcome === "P1_STEAL" ? p1 : p2;
      log(winner.username + " wins " + lockedSOL.toFixed(6) + " SOL...");
      txSig = await sendSOL(winner.wallet, sendLam);
      log("TX: " + txSig);
    }

    // 11. Finalise — write result and clean up
    log("Finalising duel...");
    var batch = db.batch();

    batch.update(db.doc("sos_duels/" + duelId), {
      vote1:       vote1,
      vote2:       vote2,
      outcome:     outcome,
      status:      "COMPLETE",
      phase:       "complete",
      txSig:       txSig || null,
      completedAt: Timestamp.now(),
    });

    var statsUp = {
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
    log("Duel finalised and committed.");

    // Update biggest pot
    try {
      var gs = await db.doc("sos_stats/global").get();
      if (gs.exists() && lockedSOL > (gs.data().biggestPot || 0)) {
        await updateGlobal({ biggestPot: lockedSOL });
      }
    } catch (e) {}

    log("=== Round " + thisRound + " complete ===");

    // 12. Schedule next on remaining cycle time
    var remainingMs = Math.max(cycleEndTime - Date.now(), 60000);
    scheduleNext(remainingMs);
    cycleEndTime = Date.now() + remainingMs + CYCLE_MS;

  } catch (err) {
    log("=== Round " + thisRound + " ERROR: " + (err.message || err) + " ===");

    // Always clean up players so they don't stay stuck
    if (p1) {
      log("Cleaning up P1: " + p1.uid);
      await ejectPlayer(p1.uid);
    }
    if (p2) {
      log("Cleaning up P2: " + p2.uid);
      await ejectPlayer(p2.uid);
    }

    try {
      await updateGlobal({ activeDuel: null });
      scheduleNext(CYCLE_MS);
    } catch (e2) {
      log("Error in error handler: " + e2.message);
    }
  }

  log("─────────────────────────────────────\n");
  isRunning = false;
}

// ── BOOT ────────────────────────────────────────────────────────────────────
console.log("\n  $SOS Split or Steal Engine v4");
console.log("  Wallet : " + CREATOR_WALLET);
console.log("  Token  : " + TOKEN_CA);
log("Gas Reserve : " + GAS_RESERVE_SOL + " SOL");
log("Chat Phase  : " + (CHAT_MS/60000) + " min");
log("Vote Phase  : " + (VOTE_MS/60000) + " min");
log("Cycle       : " + (CYCLE_MS/60000) + " min");
log("────────────────────────────────────────────");

runRound();