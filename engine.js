require("dotenv").config();
const { startAutoClaimFees } = require("./claimFees");

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
const SOLANA_RPC      = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const GAS_RESERVE_SOL = parseFloat(process.env.GAS_RESERVE_SOL || "0.002");

const READY_WINDOW_MS = 45 * 1000;
const CHAT_MS         = 1.5 * 60 * 1000;
const VOTE_MAX_MS     = 1 * 60 * 1000;
const CYCLE_MS        = 3 * 60 * 1000;

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

async function withRetry(fn, retries, label) {
  for (var i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      log("  Retry " + (i+1) + "/" + retries + " for " + label + ": " + e.message);
      await sleep(1500 * (i + 1));
    }
  }
}

async function getBalanceLamports() {
  return withRetry(() => connection.getBalance(new PublicKey(CREATOR_WALLET)), 3, "getBalance");
}

async function sendSOL(to, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: creatorKP.publicKey, toPubkey: new PublicKey(to), lamports })
  );
  return withRetry(
    () => sendAndConfirmTransaction(connection, tx, [creatorKP], { commitment: "confirmed" }),
    2, "sendSOL"
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

async function setPlayerStatus(uid, status, extra) {
  try {
    await db.doc("sos_queue/" + uid).set(Object.assign({ status: status }, extra || {}), { merge: true });
    log("  " + uid.slice(0,8) + "... → " + status);
  } catch (e) {
    log("  setPlayerStatus FAILED " + uid + ": " + e.message);
  }
}

async function ejectPlayer(uid) {
  log("  Ejecting " + uid.slice(0,8) + "...");
  try { await db.doc("sos_queue/" + uid).delete(); } catch {}
}

async function updateGlobal(fields) {
  try { await db.doc("sos_stats/global").set(fields, { merge: true }); }
  catch (e) { log("  updateGlobal failed: " + e.message); }
}

function scheduleNext(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  var safeMs = Math.max(ms, 5000);
  var nextAt  = Date.now() + safeMs;
  updateGlobal({ nextDuelAt: Timestamp.fromMillis(nextAt) });
  nextTimer = setTimeout(runRound, safeMs);
  log("  Next round in " + Math.round(safeMs / 1000) + "s");
}

// ── WAIT FOR BOTH READY ──────────────────────────────────────────────────────
function waitForBothReady(p1uid, p2uid) {
  return new Promise(function(resolve) {
    var p1Ready  = false;
    var p2Ready  = false;
    var resolved = false;
    var unsubP1, unsubP2;

    function done(result) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      if (unsubP1) unsubP1();
      if (unsubP2) unsubP2();
      resolve(result);
    }

    function check() {
      if (p1Ready && p2Ready) {
        log("  Both clicked READY — proceeding immediately!");
        done({ p1Ready: true, p2Ready: true });
      }
    }

    var timeoutId = setTimeout(function() {
      log("  Ready window closed. P1: " + p1Ready + " P2: " + p2Ready);
      done({ p1Ready: p1Ready, p2Ready: p2Ready });
    }, READY_WINDOW_MS + 2000);

    unsubP1 = db.doc("sos_queue/" + p1uid).onSnapshot(function(snap) {
      if (!snap.exists) return;
      if (snap.data().status === "ready") {
        log("  P1 clicked READY");
        p1Ready = true;
        check();
      }
    });

    unsubP2 = db.doc("sos_queue/" + p2uid).onSnapshot(function(snap) {
      if (!snap.exists) return;
      if (snap.data().status === "ready") {
        log("  P2 clicked READY");
        p2Ready = true;
        check();
      }
    });
  });
}

// ── WAIT FOR BOTH VOTES ──────────────────────────────────────────────────────
function waitForBothVotes(p1uid, p2uid, duelId) {
  return new Promise(function(resolve) {
    var vote1    = null;
    var vote2    = null;
    var resolved = false;
    var unsubV1, unsubV2;

    function done() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      if (unsubV1) unsubV1();
      if (unsubV2) unsubV2();
      resolve({ vote1: vote1 || "SPLIT", vote2: vote2 || "SPLIT" });
    }

    function check() {
      if (vote1 && vote2) {
        log("  Both voted! Ending vote phase early.");
        done();
      }
    }

    var timeoutId = setTimeout(function() {
      log("  Vote window closed. Votes — P1: " + (vote1||"none") + " P2: " + (vote2||"none"));
      done();
    }, VOTE_MAX_MS);

    unsubV1 = db.doc("sos_private_votes/" + p1uid).onSnapshot(function(snap) {
      if (snap.exists && snap.data().duelId === duelId && snap.data().vote) {
        vote1 = snap.data().vote;
        log("  P1 voted: " + vote1);
        check();
      }
    });

    unsubV2 = db.doc("sos_private_votes/" + p2uid).onSnapshot(function(snap) {
      if (snap.exists && snap.data().duelId === duelId && snap.data().vote) {
        vote2 = snap.data().vote;
        log("  P2 voted: " + vote2);
        check();
      }
    });
  });
}

function resolveOutcome(v1, v2) {
  if (v1 === "SPLIT" && v2 === "SPLIT") return "BOTH_SPLIT";
  if (v1 === "STEAL" && v2 === "STEAL") return "BOTH_STEAL";
  if (v1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

// ── MAIN ROUND ───────────────────────────────────────────────────────────────
async function runRound() {
  if (isRunning) { log("Already running, skipping."); return; }
  isRunning = true;
  var thisRound = ++roundCounter;
  var p1 = null;
  var p2 = null;
  log("\n=== Round " + thisRound + " ===");

  try {
    var balLam = await getBalanceLamports();
    var balSOL = balLam / LAMPORTS_PER_SOL;
    var gasLam = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);
    log("Balance: " + balSOL.toFixed(6) + " SOL");
    await updateGlobal({ currentPotSOL: balSOL });

    if (balLam - gasLam <= 0) {
      log("Pot empty. Skipping.");
      scheduleNext(CYCLE_MS);
      cycleEndTime = Date.now() + CYCLE_MS * 2;
      isRunning = false;
      return;
    }

    var attempts = 0;
    while (!p1 && attempts < 5) {
      attempts++;
      var waiting = await getWaitingPlayers(4);
      log("Waiting players: " + waiting.length);

      if (waiting.length < 2) {
        log("Not enough players.");
        break;
      }

      var c1 = waiting[0];
      var c2 = waiting[1];

      var deadline   = Date.now() + READY_WINDOW_MS;
      var deadlineTs = Timestamp.fromMillis(deadline);
      log("Ready check: " + c1.username + " vs " + c2.username);
      await Promise.all([
        setPlayerStatus(c1.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
        setPlayerStatus(c2.uid, "ready_check", { readyCheckEndsAt: deadlineTs }),
      ]);

      var rc = await waitForBothReady(c1.uid, c2.uid);

      if (rc.p1Ready && rc.p2Ready) {
        p1 = c1;
        p2 = c2;
        log("Both ready! Pairing: " + p1.username + " vs " + p2.username);
      } else {
        // Eject non-responders, reset responders back to waiting
        if (!rc.p1Ready) {
          await ejectPlayer(c1.uid);
          cycleEndTime += READY_WINDOW_MS;
        } else {
          await setPlayerStatus(c1.uid, "waiting", { readyCheckEndsAt: null });
          log("  Resetting " + c1.username + " back to waiting");
        }
        if (!rc.p2Ready) {
          await ejectPlayer(c2.uid);
          cycleEndTime += READY_WINDOW_MS;
        } else {
          await setPlayerStatus(c2.uid, "waiting", { readyCheckEndsAt: null });
          log("  Resetting " + c2.username + " back to waiting");
        }
        log("Attempt " + attempts + " failed. Trying next players...");
      }
    }

    if (!p1 || !p2) {
      log("Could not pair players.");
      var ms1 = Math.max(cycleEndTime - Date.now(), 30000);
      scheduleNext(ms1);
      cycleEndTime = Date.now() + ms1 + CYCLE_MS;
      isRunning = false;
      return;
    }

    var snapLam  = await getBalanceLamports();
    var sendLam  = Math.max(0, snapLam - gasLam);
    var lockedSOL = sendLam / LAMPORTS_PER_SOL;
    log("Locked pot: " + lockedSOL.toFixed(6) + " SOL");

    var duelId     = "duel_r" + thisRound + "_" + Date.now();
    var duelNow    = Date.now();
    var chatEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS);
    var voteEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS + VOTE_MAX_MS);

    log("Creating duel: " + duelId);
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
    log("Duel created.");

    log("Setting players to in_duel...");
    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);
    log("Players are now in_duel.");

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

    log("Chat phase: " + (CHAT_MS/60000) + " min...");
    await sleep(CHAT_MS);
    log("Chat phase over. Moving to vote phase.");

    try {
      await db.doc("sos_duels/" + duelId).update({ phase: "vote" });
      await db.doc("sos_stats/global").set({ "activeDuel.phase": "vote" }, { merge: true });
    } catch (e) { log("Phase update warning: " + e.message); }

    log("Vote phase: up to " + (VOTE_MAX_MS/60000) + " min...");
    var votes = await waitForBothVotes(p1.uid, p2.uid, duelId);
    var vote1 = votes.vote1;
    var vote2 = votes.vote2;
    log("Final votes — P1: " + vote1 + " | P2: " + vote2);

    var outcome = resolveOutcome(vote1, vote2);
    log("Outcome: " + outcome);

    var txSig = null;
    if (outcome === "BOTH_STEAL") {
      log("Both stole — pot carries over.");
    } else if (outcome === "BOTH_SPLIT") {
      var half = Math.floor(sendLam / 2);
      log("Both split — sending " + (half/LAMPORTS_PER_SOL).toFixed(6) + " each...");
      var tx1 = await sendSOL(p1.wallet, half);
      var tx2 = await sendSOL(p2.wallet, half);
      txSig = tx1 + "|" + tx2;
      log("TX1: " + tx1 + "  TX2: " + tx2);
    } else {
      var winner = outcome === "P1_STEAL" ? p1 : p2;
      log(winner.username + " steals " + lockedSOL.toFixed(6) + " SOL...");
      txSig = await sendSOL(winner.wallet, sendLam);
      log("TX: " + txSig);
    }

    var batch = db.batch();
    batch.update(db.doc("sos_duels/" + duelId), {
      vote1: vote1, vote2: vote2, outcome: outcome,
      status: "COMPLETE", phase: "complete",
      txSig: txSig || null, completedAt: Timestamp.now(),
    });
    var statsUp = {
      totalRounds:      FieldValue.increment(1),
      totalDistributed: FieldValue.increment(outcome === "BOTH_STEAL" ? 0 : lockedSOL),
      lastDuelAt:       Timestamp.now(),
      activeDuel:       null,
    };
    if (outcome === "BOTH_SPLIT")  statsUp.totalSplits  = FieldValue.increment(1);
    if (outcome === "P1_STEAL" || outcome === "P2_STEAL") statsUp.totalSteals = FieldValue.increment(1);
    batch.set(db.doc("sos_stats/global"), statsUp, { merge: true });
    batch.delete(db.doc("sos_private_votes/" + p1.uid));
    batch.delete(db.doc("sos_private_votes/" + p2.uid));
    batch.delete(db.doc("sos_queue/" + p1.uid));
    batch.delete(db.doc("sos_queue/" + p2.uid));
    await batch.commit();
    log("Round " + thisRound + " complete and committed.");

    try {
      var gs = await db.doc("sos_stats/global").get();
      if (gs.exists && lockedSOL > (gs.data().biggestPot || 0)) {
        await updateGlobal({ biggestPot: lockedSOL });
      }
    } catch (e) {}

    var remainingMs = Math.max(cycleEndTime - Date.now(), 60000);
    log("Cycle remaining: " + Math.round(remainingMs/1000) + "s — scheduling next round.");
    scheduleNext(remainingMs);
    cycleEndTime = Date.now() + remainingMs + CYCLE_MS;

  } catch (err) {
    log("=== ROUND ERROR: " + (err.message || err) + " ===");
    if (p1) await ejectPlayer(p1.uid);
    if (p2) await ejectPlayer(p2.uid);
    try {
      await updateGlobal({ activeDuel: null });
      scheduleNext(CYCLE_MS);
    } catch {}
  }

  log("─────────────────────────\n");
  isRunning = false;
}

// ── BOOT ────────────────────────────────────────────────────────────────────
console.log("\n  $SOS Engine v5 — Event-Driven");
console.log("  Wallet : " + CREATOR_WALLET);
log("Gas Reserve: " + GAS_RESERVE_SOL + " SOL | Chat: " + (CHAT_MS/60000) + "min | Vote: " + (VOTE_MAX_MS/60000) + "min | Cycle: " + (CYCLE_MS/60000) + "min");
log("────────────────────────────────────────────");

startAutoClaimFees(connection, creatorKP, log);
runRound();