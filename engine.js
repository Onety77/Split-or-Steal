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
const GAS_RESERVE_SOL = parseFloat(process.env.GAS_RESERVE_SOL || "0.01");

const READY_WINDOW_MS = 45 * 1000;
const CHAT_MS         = 1.5 * 60 * 1000;
const VOTE_MAX_MS     = 1 * 60 * 1000;
const CYCLE_MS        = 3 * 60 * 1000;

// ── ROOM DEFINITIONS ─────────────────────────────────────────────────────────
// Room offsets stagger payouts so they never clash
const ROOM_CONFIGS = [
  { id: "room_1", name: "ROOM 1", offsetMs: 0 },
  { id: "room_2", name: "ROOM 2", offsetMs: Math.floor(CYCLE_MS / 3) },
  { id: "room_3", name: "ROOM 3", offsetMs: Math.floor((CYCLE_MS / 3) * 2) },
];

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
const log   = (room, m) => console.log("[" + new Date().toISOString() + "] [" + room + "] " + m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Global send mutex — serialises all SOL transfers so balance is always accurate
let sendChain = Promise.resolve();

async function withRetry(fn, retries, label) {
  for (var i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function getBalanceLamports() {
  return withRetry(() => connection.getBalance(new PublicKey(CREATOR_WALLET)), 3, "getBalance");
}

// All sends go through the chain — one at a time, no overlaps
function sendSOLQueued(to, lamports) {
  sendChain = sendChain.then(async () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: creatorKP.publicKey, toPubkey: new PublicKey(to), lamports })
    );
    return withRetry(
      () => sendAndConfirmTransaction(connection, tx, [creatorKP], { commitment: "confirmed" }),
      2, "sendSOL"
    );
  });
  return sendChain;
}

async function getWaitingPlayers(n, excludeUids) {
  const snap = await db.collection("sos_queue")
    .where("status","==","waiting")
    .orderBy("joinedAt","asc")
    .limit(n + (excludeUids ? excludeUids.length : 0))
    .get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!excludeUids || excludeUids.length === 0) return all.slice(0, n);
  return all.filter(p => !excludeUids.includes(p.uid)).slice(0, n);
}

async function setPlayerStatus(uid, status, extra) {
  try {
    await db.doc("sos_queue/" + uid).set(Object.assign({ status }, extra || {}), { merge: true });
  } catch (e) { console.error("setPlayerStatus failed:", e.message); }
}

async function ejectPlayer(uid) {
  try { await db.doc("sos_queue/" + uid).delete(); } catch {}
}

async function updateGlobal(fields) {
  try { await db.doc("sos_stats/global").set(fields, { merge: true }); }
  catch (e) { console.error("updateGlobal failed:", e.message); }
}

function resolveOutcome(v1, v2) {
  if (v1 === "SPLIT" && v2 === "SPLIT") return "BOTH_SPLIT";
  if (v1 === "STEAL" && v2 === "STEAL") return "BOTH_STEAL";
  if (v1 === "STEAL") return "P1_STEAL";
  return "P2_STEAL";
}

// ── GET UNLOCKED ROOM COUNT ───────────────────────────────────────────────────
async function getUnlockedRoomCount() {
  try {
    const snap = await db.collection("sos_rooms").get();
    if (snap.empty) return 1;
    return snap.docs.filter(d => d.data().unlocked).length || 1;
  } catch { return 1; }
}

// ── WAIT FOR BOTH READY ──────────────────────────────────────────────────────
function waitForBothReady(p1uid, p2uid) {
  return new Promise(function(resolve) {
    var p1Ready = false, p2Ready = false, resolved = false;
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
      if (p1Ready && p2Ready) done({ p1Ready: true, p2Ready: true });
    }

    var timeoutId = setTimeout(function() {
      done({ p1Ready, p2Ready });
    }, READY_WINDOW_MS + 2000);

    unsubP1 = db.doc("sos_queue/" + p1uid).onSnapshot(function(snap) {
      if (!snap.exists) return;
      if (snap.data().status === "ready") { p1Ready = true; check(); }
    });
    unsubP2 = db.doc("sos_queue/" + p2uid).onSnapshot(function(snap) {
      if (!snap.exists) return;
      if (snap.data().status === "ready") { p2Ready = true; check(); }
    });
  });
}

// ── WAIT FOR BOTH VOTES ──────────────────────────────────────────────────────
function waitForBothVotes(p1uid, p2uid, duelId) {
  return new Promise(function(resolve) {
    var vote1 = null, vote2 = null, resolved = false;
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
      if (vote1 && vote2) { log("both", "Both voted — ending early"); done(); }
    }

    var timeoutId = setTimeout(done, VOTE_MAX_MS);

    unsubV1 = db.doc("sos_private_votes/" + p1uid).onSnapshot(function(snap) {
      if (snap.exists && snap.data().duelId === duelId && snap.data().vote) {
        vote1 = snap.data().vote; check();
      }
    });
    unsubV2 = db.doc("sos_private_votes/" + p2uid).onSnapshot(function(snap) {
      if (snap.exists && snap.data().duelId === duelId && snap.data().vote) {
        vote2 = snap.data().vote; check();
      }
    });
  });
}

// ── SINGLE ROOM RUNNER ───────────────────────────────────────────────────────
async function runRoom(roomCfg, activeRoomUids) {
  const roomId   = roomCfg.id;
  const roomName = roomCfg.name;
  var p1 = null, p2 = null;
  log(roomName, "=== Round starting ===");

  try {
    // 1. Check balance
    var balLam = await getBalanceLamports();
    var balSOL = balLam / LAMPORTS_PER_SOL;
    var gasLam = Math.ceil(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);

    // Number of unlocked rooms — split pot fairly
    var numRooms = await getUnlockedRoomCount();
    var myShareLam = Math.floor(Math.max(0, balLam - gasLam) / numRooms);
    var myShareSOL = myShareLam / LAMPORTS_PER_SOL;

    log(roomName, "Balance: " + balSOL.toFixed(6) + " SOL | Rooms: " + numRooms + " | My share: " + myShareSOL.toFixed(6));

    if (myShareLam <= 0) {
      log(roomName, "No pot share available. Skipping.");
      return;
    }

    // 2. Find players — exclude players already in other rooms
    var attempts = 0;
    while (!p1 && attempts < 5) {
      attempts++;
      var waiting = await getWaitingPlayers(4, activeRoomUids);
      log(roomName, "Waiting players: " + waiting.length);

      if (waiting.length < 2) { log(roomName, "Not enough players."); break; }

      var c1 = waiting[0];
      var c2 = waiting[1];

      // Reserve these players so other rooms don't grab them
      activeRoomUids.push(c1.uid, c2.uid);

      var deadline = Date.now() + READY_WINDOW_MS;
      log(roomName, "Ready check: " + c1.username + " vs " + c2.username);
      await Promise.all([
        setPlayerStatus(c1.uid, "ready_check", { readyCheckEndsAt: Timestamp.fromMillis(deadline), roomId }),
        setPlayerStatus(c2.uid, "ready_check", { readyCheckEndsAt: Timestamp.fromMillis(deadline), roomId }),
      ]);

      var rc = await waitForBothReady(c1.uid, c2.uid);

      if (rc.p1Ready && rc.p2Ready) {
        p1 = c1; p2 = c2;
        log(roomName, "Both ready! Pairing: " + p1.username + " vs " + p2.username);
      } else {
        // Release reserved slots
        activeRoomUids.splice(activeRoomUids.indexOf(c1.uid), 1);
        activeRoomUids.splice(activeRoomUids.indexOf(c2.uid), 1);

        if (!rc.p1Ready) { await ejectPlayer(c1.uid); }
        else { await setPlayerStatus(c1.uid, "waiting", { readyCheckEndsAt: null, roomId: null }); }
        if (!rc.p2Ready) { await ejectPlayer(c2.uid); }
        else { await setPlayerStatus(c2.uid, "waiting", { readyCheckEndsAt: null, roomId: null }); }

        log(roomName, "Attempt " + attempts + " failed.");
      }
    }

    if (!p1 || !p2) {
      log(roomName, "Could not pair players.");
      // Release reserved slots
      if (p1) { activeRoomUids.splice(activeRoomUids.indexOf(p1.uid), 1); }
      if (p2) { activeRoomUids.splice(activeRoomUids.indexOf(p2.uid), 1); }
      return;
    }

    // 3. Lock pot — snapshot at this exact moment
    var snapLam    = await getBalanceLamports();
    var numRoomsNow= await getUnlockedRoomCount();
    var sendLam    = Math.floor(Math.max(0, snapLam - gasLam) / numRoomsNow);
    var lockedSOL  = sendLam / LAMPORTS_PER_SOL;
    log(roomName, "Locked pot: " + lockedSOL.toFixed(6) + " SOL");

    // 4. Create duel
    var duelId     = roomId + "_r" + Date.now();
    var duelNow    = Date.now();
    var chatEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS);
    var voteEndsAt = Timestamp.fromMillis(duelNow + CHAT_MS + VOTE_MAX_MS);

    await db.doc("sos_duels/" + duelId).set({
      player1: p1.wallet, player2: p2.wallet,
      player1Uid: p1.uid, player2Uid: p2.uid,
      player1Username: p1.username, player2Username: p2.username,
      vote1: null, vote2: null,
      hasVoted1: false, hasVoted2: false,
      outcome: null,
      amount: lockedSOL, lockedLamports: sendLam,
      status: "ACTIVE", phase: "chat",
      roomId, roomName,
      startedAt: Timestamp.now(),
      chatEndsAt, voteEndsAt,
      timestamp: Timestamp.now(),
    });

    await Promise.all([
      setPlayerStatus(p1.uid, "in_duel", { currentDuelId: duelId }),
      setPlayerStatus(p2.uid, "in_duel", { currentDuelId: duelId }),
    ]);

    // Update room active duel
    await db.doc("sos_rooms/" + roomId).set({
      activeDuel: {
        duelId, player1Username: p1.username, player2Username: p2.username,
        amount: lockedSOL, phase: "chat", chatEndsAt, voteEndsAt,
      }
    }, { merge: true });

    // Update global active duels map
    await db.doc("sos_stats/global").set({
      ["activeDuels." + roomId]: {
        duelId, roomId, roomName,
        player1Username: p1.username, player2Username: p2.username,
        amount: lockedSOL, phase: "chat", chatEndsAt, voteEndsAt,
      }
    }, { merge: true });

    log(roomName, "Duel LIVE — chat phase " + (CHAT_MS/60000) + "min");
    await sleep(CHAT_MS);

    // Transition to vote
    try {
      await db.doc("sos_duels/" + duelId).update({ phase: "vote" });
      await db.doc("sos_stats/global").set({ ["activeDuels." + roomId + ".phase"]: "vote" }, { merge: true });
    } catch {}

    log(roomName, "Vote phase...");
    var votes = await waitForBothVotes(p1.uid, p2.uid, duelId);
    var vote1  = votes.vote1;
    var vote2  = votes.vote2;
    log(roomName, "Votes: P1=" + vote1 + " P2=" + vote2);

    var outcome = resolveOutcome(vote1, vote2);
    log(roomName, "Outcome: " + outcome);

    // 5. Send SOL — queued so concurrent rooms never overlap
    var txSig = null;
    if (outcome === "BOTH_STEAL") {
      log(roomName, "Both stole — pot carries over.");
    } else if (outcome === "BOTH_SPLIT") {
      var half = Math.floor(sendLam / 2);
      log(roomName, "Splitting " + (half/LAMPORTS_PER_SOL).toFixed(6) + " each...");
      var tx1 = await sendSOLQueued(p1.wallet, half);
      var tx2 = await sendSOLQueued(p2.wallet, half);
      txSig = tx1 + "|" + tx2;
      log(roomName, "TX1: " + tx1 + " TX2: " + tx2);
    } else {
      var winner = outcome === "P1_STEAL" ? p1 : p2;
      log(roomName, winner.username + " steals " + lockedSOL.toFixed(6) + " SOL");
      txSig = await sendSOLQueued(winner.wallet, sendLam);
      log(roomName, "TX: " + txSig);
    }

    // 6. Finalise
    var batch = db.batch();
    batch.update(db.doc("sos_duels/" + duelId), {
      vote1, vote2, outcome, status: "COMPLETE", phase: "complete",
      txSig: txSig || null, completedAt: Timestamp.now(),
    });

    var statsUp = {
      totalRounds:      FieldValue.increment(1),
      totalDistributed: FieldValue.increment(outcome === "BOTH_STEAL" ? 0 : lockedSOL),
      lastDuelAt:       Timestamp.now(),
      ["activeDuels." + roomId]: null,
    };
    if (outcome === "BOTH_SPLIT") statsUp.totalSplits = FieldValue.increment(1);
    if (outcome === "P1_STEAL" || outcome === "P2_STEAL") statsUp.totalSteals = FieldValue.increment(1);

    batch.set(db.doc("sos_stats/global"), statsUp, { merge: true });
    batch.set(db.doc("sos_rooms/" + roomId), { activeDuel: null }, { merge: true });
    batch.delete(db.doc("sos_private_votes/" + p1.uid));
    batch.delete(db.doc("sos_private_votes/" + p2.uid));
    batch.delete(db.doc("sos_queue/" + p1.uid));
    batch.delete(db.doc("sos_queue/" + p2.uid));
    await batch.commit();

    // Update user stats
    try {
      var ub = db.batch();
      var p1Earned = outcome === "BOTH_SPLIT" ? lockedSOL/2 : outcome === "P1_STEAL" ? lockedSOL : 0;
      var p2Earned = outcome === "BOTH_SPLIT" ? lockedSOL/2 : outcome === "P2_STEAL" ? lockedSOL : 0;
      ub.set(db.doc("sos_users/" + p1.uid), {
        splits: vote1==="SPLIT" ? FieldValue.increment(1) : FieldValue.increment(0),
        steals: vote1==="STEAL" ? FieldValue.increment(1) : FieldValue.increment(0),
        totalEarned: FieldValue.increment(p1Earned),
        wins: FieldValue.increment(p1Earned > 0 ? 1 : 0),
      }, { merge: true });
      ub.set(db.doc("sos_users/" + p2.uid), {
        splits: vote2==="SPLIT" ? FieldValue.increment(1) : FieldValue.increment(0),
        steals: vote2==="STEAL" ? FieldValue.increment(1) : FieldValue.increment(0),
        totalEarned: FieldValue.increment(p2Earned),
        wins: FieldValue.increment(p2Earned > 0 ? 1 : 0),
      }, { merge: true });
      await ub.commit();
    } catch (e) { log(roomName, "User stats error: " + e.message); }

    // Biggest pot
    try {
      var gs = await db.doc("sos_stats/global").get();
      if (gs.exists && lockedSOL > (gs.data().biggestPot || 0)) {
        await updateGlobal({ biggestPot: lockedSOL });
      }
    } catch {}

    log(roomName, "=== Round complete ===");

  } catch (err) {
    log(roomName, "ROUND ERROR: " + (err.message || err));
    if (p1) { await ejectPlayer(p1.uid).catch(() => {}); }
    if (p2) { await ejectPlayer(p2.uid).catch(() => {}); }
    try {
      await db.doc("sos_rooms/" + roomId).set({ activeDuel: null }, { merge: true });
      await db.doc("sos_stats/global").set({ ["activeDuels." + roomId]: null }, { merge: true });
    } catch {}
  }

  // Release reserved player UIDs
  if (p1) { var i1 = activeRoomUids.indexOf(p1.uid); if (i1 > -1) activeRoomUids.splice(i1, 1); }
  if (p2) { var i2 = activeRoomUids.indexOf(p2.uid); if (i2 > -1) activeRoomUids.splice(i2, 1); }
}

// ── ROOM LOOP — runs forever for one room ────────────────────────────────────
async function startRoomLoop(roomCfg, activeRoomUids) {
  const roomId   = roomCfg.id;
  const roomName = roomCfg.name;

  // Stagger start
  if (roomCfg.offsetMs > 0) {
    log(roomName, "Starting in " + Math.round(roomCfg.offsetMs/1000) + "s...");
    await sleep(roomCfg.offsetMs);
  }

  log(roomName, "Room loop started.");

  while (true) {
    try {
      // Check if still unlocked
      var roomDoc = await db.doc("sos_rooms/" + roomId).get();
      if (!roomDoc.exists || !roomDoc.data().unlocked) {
        log(roomName, "Room locked — sleeping 30s...");
        await sleep(30000);
        continue;
      }

      // Update next duel time
      var nextAt = Date.now() + CYCLE_MS;
      await db.doc("sos_rooms/" + roomId).set({ nextDuelAt: Timestamp.fromMillis(nextAt) }, { merge: true });

      await runRoom(roomCfg, activeRoomUids);
    } catch (e) {
      log(roomName, "Loop error: " + e.message);
    }

    await sleep(CYCLE_MS);
  }
}

// ── INIT ROOMS IN FIRESTORE ───────────────────────────────────────────────────
async function initRooms() {
  const rooms = [
    { id: "room_1", name: "ROOM 1", unlocked: true  },
    { id: "room_2", name: "ROOM 2", unlocked: false },
    { id: "room_3", name: "ROOM 3", unlocked: false },
  ];
  for (var r of rooms) {
    var snap = await db.doc("sos_rooms/" + r.id).get();
    if (!snap.exists) {
      await db.doc("sos_rooms/" + r.id).set({
        id:         r.id,
        name:       r.name,
        unlocked:   r.unlocked,
        activeDuel: null,
        nextDuelAt: null,
      });
      log("INIT", "Created " + r.name + " (unlocked: " + r.unlocked + ")");
    }
  }
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
console.log("\n  $SOS Engine v6 — Multi-Room");
console.log("  Wallet : " + CREATOR_WALLET);
log("MAIN", "Gas Reserve: " + GAS_RESERVE_SOL + " SOL | Chat: " + (CHAT_MS/60000) + "min | Vote: " + (VOTE_MAX_MS/60000) + "min | Cycle: " + (CYCLE_MS/60000) + "min");
log("MAIN", "────────────────────────────────────────────");

// Shared array of UIDs currently reserved by any room (prevents double-booking)
var activeRoomUids = [];

initRooms().then(() => {
  startAutoClaimFees(connection, creatorKP, (m) => log("CLAIM", m));

  // Start all 3 room loops — each checks if it's unlocked before running
  for (var rc of ROOM_CONFIGS) {
    startRoomLoop(rc, activeRoomUids);
  }

  // Update global pot every 30s
  setInterval(async () => {
    try {
      var bal = await getBalanceLamports();
      await updateGlobal({ currentPotSOL: bal / LAMPORTS_PER_SOL });
    } catch {}
  }, 30000);

}).catch(e => {
  console.error("Boot error:", e.message);
  process.exit(1);
});