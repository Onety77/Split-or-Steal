import { useState, useEffect } from "react";
import {
  collection, query, orderBy, onSnapshot, doc,
  setDoc, deleteDoc, serverTimestamp, getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { requestNotificationPermission } from "../components/ReadyCheckOverlay";

const TOKEN_CA  = "13SVgpzFcZf8vF6Tg1QV7vec82FdJrf4Kg2VEX4xpump";
const ST_API_KEY= "7e03dd01-b931-4fac-8e9f-06a310c1238a";
const MIN_USD   = 10;

const positionLabel = (pos) => {
  if (pos === 1 || pos === 2) return "NEXT UP";
  return "#" + pos + " IN QUEUE";
};

// Verify wallet holds $10+ — checks SolanaTracker holders pages
async function verifyHolding(wallet) {
  const walletLower = wallet.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    try {
      const res = await fetch(
        "https://data.solanatracker.io/tokens/" + TOKEN_CA + "/holders?page=" + page + "&limit=100",
        { headers: { "x-api-key": ST_API_KEY } }
      );

      if (!res.ok) {
        // API error — block to be safe
        return { found: false, usd: 0, error: "API error " + res.status };
      }

      const raw  = await res.json();
      const list = raw.holders ?? raw.accounts ?? raw.items
                ?? raw.wallets ?? (Array.isArray(raw) ? raw : null);

      if (!list || list.length === 0) break;

      for (const h of list) {
        const w = (h.address || h.owner || h.wallet || h.pubkey || "").toLowerCase();
        if (w === walletLower) {
          // Try every possible USD value field
          const usd = h.value?.usd
                   ?? h.valueUsd
                   ?? h.usd
                   ?? h.usdValue
                   ?? h.worth
                   ?? h.worth_usd
                   ?? 0;
          return { found: true, usd: parseFloat(usd) || 0 };
        }
      }

      if (list.length < 100) break; // no more pages
    } catch (e) {
      return { found: false, usd: 0, error: e.message };
    }
  }
  return { found: false, usd: 0 };
}

export default function Queue({ navigate }) {
  const { user, profile } = useAuth();

  const [queueList, setQueueList] = useState([]);
  const [myEntry,   setMyEntry]   = useState(null);
  const [joining,   setJoining]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    const q = query(collection(db, "sos_queue"), orderBy("joinedAt","asc"));
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setQueueList(list);
      if (user) setMyEntry(list.find(e => e.uid === user.uid) || null);
    });
  }, [user]);

  useEffect(() => {
    if (myEntry?.status === "in_duel" && myEntry?.currentDuelId) {
      navigate("duel");
    }
  }, [myEntry?.status, myEntry?.currentDuelId, navigate]);

  const joinQueue = async () => {
    if (!user || !profile) { navigate("auth"); return; }
    setJoinError("");
    setVerifying(true);

    try {
      const { found, usd, error } = await verifyHolding(profile.wallet);

      if (error) {
        setJoinError("Could not verify your holdings right now. Please try again in a moment.");
        setVerifying(false);
        return;
      }

      if (!found) {
        setJoinError("Your wallet was not found in the $SOS holder list. You need to hold at least $" + MIN_USD + " worth of $SOS to play.");
        setVerifying(false);
        return;
      }

      if (usd < MIN_USD) {
        setJoinError("You need at least $" + MIN_USD + " worth of $SOS to join. Your current holding: $" + usd.toFixed(2) + ".");
        setVerifying(false);
        return;
      }

      setVerifying(false);
      setJoining(true);

      await requestNotificationPermission();

      await setDoc(doc(db, "sos_queue", user.uid), {
        uid:              user.uid,
        username:         profile.username,
        wallet:           profile.wallet,
        joinedAt:         serverTimestamp(),
        status:           "waiting",
        readyCheckEndsAt: null,
        currentDuelId:    null,
      });

    } catch (e) {
      console.error(e);
      setJoinError("Something went wrong. Please try again.");
    } finally {
      setVerifying(false);
      setJoining(false);
    }
  };

  const leaveQueue = async () => {
    if (!user) return;
    try { await deleteDoc(doc(db, "sos_queue", user.uid)); } catch {}
  };

  const myPosition    = myEntry ? queueList.findIndex(e => e.uid === user?.uid) + 1 : null;
  const estimatedWait = myPosition ? Math.max(0, Math.ceil((myPosition - 2) / 2)) * 10 : null;
  const isLoading     = verifying || joining;
  const loadingLabel  = verifying ? "VERIFYING..." : "JOINING...";

  return (
    <div className="page" style={{ padding:"100px 24px 80px" }}>
      <div style={{ maxWidth:"var(--max-w)", margin:"0 auto" }}>

        <div style={{ marginBottom:48 }}>
          <div className="label" style={{ marginBottom:12 }}>WAITING ROOM</div>
          <h1 style={{ fontFamily:"'Russo One',sans-serif", fontSize:"clamp(32px,6vw,56px)", letterSpacing:"0.08em", color:"var(--text)", marginBottom:12 }}>THE QUEUE</h1>
          <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:15, color:"var(--muted)", lineHeight:1.7, maxWidth:520 }}>
            Every 10 minutes, the top two players in the queue are called to duel.
            Sign in and join — watch your name move up the line.
          </p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:24, alignItems:"start" }}>

          {/* LEFT */}
          <div>
            {user && profile && (
              <div style={{ marginBottom:16 }}>
                {!myEntry ? (
                  <div className="card" style={{ border:"1px solid rgba(255,184,0,0.25)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap", marginBottom: joinError ? 12 : 0 }}>
                      <div>
                        <div className="label" style={{ marginBottom:6, color:"var(--muted)" }}>YOUR STATUS</div>
                        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:16, color:"var(--dim)" }}>Not in queue</div>
                        {verifying && (
                          <div style={{ fontFamily:"'Barlow',sans-serif", fontSize:12, color:"var(--muted)", marginTop:4 }}>
                            Checking your $SOS holdings...
                          </div>
                        )}
                      </div>
                      <button onClick={joinQueue} disabled={isLoading} className="btn-gold">
                        {isLoading ? loadingLabel : "JOIN QUEUE"}
                      </button>
                    </div>
                    {joinError && (
                      <div style={{ padding:"10px 14px", background:"rgba(204,32,32,0.08)", border:"1px solid rgba(204,32,32,0.2)", borderRadius:8, fontFamily:"'Barlow',sans-serif", fontSize:13, color:"var(--red2)", lineHeight:1.5 }}>
                        {joinError}
                      </div>
                    )}
                  </div>
                ) : myEntry.status === "waiting" ? (
                  <div className="card" style={{ border:"1px solid rgba(0,200,83,0.2)", background:"rgba(0,200,83,0.04)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
                      <div>
                        <div className="label" style={{ marginBottom:6, color:"var(--green)" }}>
                          {myPosition ? positionLabel(myPosition) : "IN QUEUE"}
                        </div>
                        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:18, color:"var(--text)" }}>{profile.username}</div>
                        {estimatedWait !== null && estimatedWait > 0 && (
                          <div style={{ fontSize:12, color:"var(--dim)", marginTop:4, fontFamily:"'Barlow',sans-serif" }}>~{estimatedWait} min estimated wait</div>
                        )}
                        {(myPosition === 1 || myPosition === 2) && (
                          <div style={{ fontSize:12, color:"var(--gold)", marginTop:4, fontFamily:"'Barlow',sans-serif" }}>⚡ Your duel is starting soon — stay ready!</div>
                        )}
                      </div>
                      <button onClick={leaveQueue} className="btn-outline" style={{ color:"var(--red2)", borderColor:"rgba(204,32,32,0.3)", fontSize:12 }}>LEAVE</button>
                    </div>
                  </div>
                ) : myEntry.status === "ready" ? (
                  <div className="card" style={{ border:"1px solid rgba(0,200,83,0.3)", textAlign:"center" }}>
                    <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:18, color:"var(--green)", letterSpacing:2 }}>READY ✓</div>
                    <p style={{ marginTop:8, fontSize:13, color:"var(--muted)", fontFamily:"'Barlow',sans-serif" }}>Waiting for your opponent to ready up...</p>
                  </div>
                ) : myEntry.status === "in_duel" ? (
                  <div className="card" style={{ border:"1px solid rgba(255,184,0,0.3)", textAlign:"center" }}>
                    <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:18, color:"var(--gold)", letterSpacing:2 }}>⚔️ DUEL IN PROGRESS</div>
                    <button onClick={() => navigate("duel")} className="btn-gold" style={{ marginTop:14 }}>ENTER DUEL ROOM</button>
                  </div>
                ) : null}
              </div>
            )}

            {!user && (
              <div className="card" style={{ border:"1px solid rgba(255,184,0,0.2)", textAlign:"center", marginBottom:16, padding:"32px" }}>
                <div style={{ fontSize:32, marginBottom:14 }}>🎯</div>
                <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:18, letterSpacing:2, color:"var(--text)", marginBottom:10 }}>SIGN IN TO JOIN</div>
                <p style={{ fontSize:13, color:"var(--muted)", marginBottom:20, fontFamily:"'Barlow',sans-serif" }}>Create an account to enter the queue and play.</p>
                <button onClick={() => navigate("auth")} className="btn-gold">SIGN IN / SIGN UP</button>
              </div>
            )}

            <div className="card" style={{ padding:"20px 24px" }}>
              <div className="label" style={{ marginBottom:14, color:"var(--muted)" }}>HOW THE QUEUE WORKS</div>
              {[
                ["01","Sign in and click Join Queue. Holdings are verified every time you join."],
                ["02","Every 10 minutes, the top 2 in queue are called to duel."],
                ["03","A full-screen alert fires with sound — 90 seconds to click READY or you are ejected."],
                ["04","READY unlocks the chat room. Vote in secret. Reveal happens simultaneously."],
                ["05","After your duel, rejoin to play again. Must still hold $10+ of $SOS."],
              ].map(([n,t]) => (
                <div key={n} style={{ display:"flex", gap:14, alignItems:"flex-start", paddingBottom:12, borderBottom:"1px solid var(--border)", marginBottom:12 }}>
                  <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:20, color:"rgba(255,184,0,0.2)", flexShrink:0, lineHeight:1.2 }}>{n}</span>
                  <p style={{ fontSize:13, color:"var(--muted)", lineHeight:1.65, fontFamily:"'Barlow',sans-serif" }}>{t}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Live queue */}
          <div>
            <div style={{ marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--green)", boxShadow:"0 0 8px var(--green)", animation:"led-breathe 2s ease-in-out infinite" }}/>
              <span style={{ fontFamily:"'Oswald',sans-serif", fontSize:11, fontWeight:600, letterSpacing:4, color:"var(--muted)" }}>
                LIVE QUEUE — {queueList.length} WAITING
              </span>
            </div>

            {queueList.length === 0 ? (
              <div className="card" style={{ textAlign:"center", padding:"48px" }}>
                <div style={{ fontSize:36, opacity:0.3, marginBottom:12 }}>🕐</div>
                <div className="label" style={{ color:"var(--dim)" }}>QUEUE IS EMPTY</div>
                <p style={{ marginTop:8, fontSize:13, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>Be the first to join.</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {queueList.map((entry, i) => {
                  const isMe  = user && entry.uid === user.uid;
                  const isTop = i < 2;
                  const statusIcon =
                    entry.status === "ready"       ? "✓" :
                    entry.status === "ready_check" ? "⏳" :
                    entry.status === "in_duel"     ? "⚔️" : null;
                  return (
                    <div key={entry.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", borderRadius:10, background: isMe ? "rgba(255,184,0,0.08)" : isTop ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)", border:"1px solid " + (isMe ? "rgba(255,184,0,0.3)" : isTop ? "rgba(255,184,0,0.12)" : "rgba(255,255,255,0.05)"), animation:"slide-up 0.4s ease " + (i*0.04) + "s both" }}>
                      <div style={{ width:28, height:28, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background: isTop ? "rgba(255,184,0,0.15)" : "rgba(255,255,255,0.04)", fontFamily:"'Russo One',sans-serif", fontSize:12, color: isTop ? "var(--gold)" : "var(--dim)", flexShrink:0 }}>{i+1}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:15, fontWeight:600, color: isMe ? "var(--gold)" : "var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {entry.username}{isMe && <span style={{ fontSize:10, color:"var(--muted)", marginLeft:8 }}>(you)</span>}
                        </div>
                        {isTop && <div style={{ fontSize:10, color:"var(--gold)", letterSpacing:2, fontFamily:"'Oswald',sans-serif", marginTop:2 }}>NEXT UP</div>}
                      </div>
                      {statusIcon && (
                        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:11, fontWeight:600, letterSpacing:1, color: entry.status==="ready" ? "var(--green)" : entry.status==="in_duel" ? "var(--gold)" : "var(--muted)", background: entry.status==="ready" ? "rgba(0,200,83,0.1)" : entry.status==="in_duel" ? "rgba(255,184,0,0.1)" : "rgba(255,255,255,0.04)", border:"1px solid " + (entry.status==="ready" ? "rgba(0,200,83,0.25)" : entry.status==="in_duel" ? "rgba(255,184,0,0.25)" : "rgba(255,255,255,0.08)"), borderRadius:20, padding:"4px 10px", flexShrink:0 }}>
                          {statusIcon}{" "}{entry.status==="ready" ? "READY" : entry.status==="in_duel" ? "DUELING" : "WAITING"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}