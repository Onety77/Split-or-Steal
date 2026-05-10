import { useState, useEffect, useRef } from "react";
import {
  doc, onSnapshot, collection, addDoc, setDoc,
  serverTimestamp, query, orderBy, getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import Orb from "../components/Orb";

// ── Helpers ────────────────────────────────────────────────────────────────
const short  = (a) => a ? `${a.slice(0,4)}...${a.slice(-4)}` : "—";
const fmtSOL = (n) => (!n && n !== 0) ? "—" : n.toFixed(4);

// ── Countdown ring ─────────────────────────────────────────────────────────
const R2 = 44;
const C2 = 2 * Math.PI * R2;

function SmallRing({ seconds, total }) {
  const pct    = Math.max(0, seconds / total);
  const offset = C2 * (1 - pct);
  const mins   = Math.floor(seconds / 60);
  const secs   = seconds % 60;
  const str    = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  const urgent = seconds < 30;

  return (
    <div style={{ position:"relative", width:100, height:100, flexShrink:0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={R2} fill="none" stroke="rgba(255,184,0,0.07)" strokeWidth="3"/>
        <circle cx="50" cy="50" r={R2} fill="none"
          stroke={urgent ? "#FF3333" : "#FFB800"} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={C2} strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
      }}>
        <span style={{
          fontFamily:"'Russo One',sans-serif",
          fontSize:16, lineHeight:1,
          color: urgent ? "var(--red2)" : "var(--gold)",
          animation: urgent ? "countdown-urgent 0.8s ease infinite" : "none",
        }}>{str}</span>
        <span style={{ fontSize:7, letterSpacing:2, color:"var(--muted)", marginTop:3 }}>LEFT</span>
      </div>
    </div>
  );
}

// ── Main Duel component ────────────────────────────────────────────────────
export default function Duel({ navigate }) {
  const { user, profile } = useAuth();

  const [queueEntry, setQueueEntry]  = useState(null);
  const [duel,       setDuel]        = useState(null);
  const [messages,   setMessages]    = useState([]);
  const [chatInput,  setChatInput]   = useState("");
  const [myVote,     setMyVote]      = useState(null);  // "SPLIT" | "STEAL" | null
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [secondsLeft,   setSecondsLeft]   = useState(5 * 60);
  const [revealed,      setRevealed]      = useState(false);
  const [chatOpen,      setChatOpen]      = useState(false);

  const chatEndRef = useRef(null);
  const timerRef   = useRef(null);

  // Watch my queue entry for current duel ID
  useEffect(() => {
    if (!user) { navigate("auth"); return; }
    return onSnapshot(doc(db, "sos_queue", user.uid), snap => {
      if (!snap.exists()) {
        setQueueEntry(null);
        return;
      }
      setQueueEntry({ id: snap.id, ...snap.data() });
    });
  }, [user, navigate]);

  // Load duel from Firestore when we have a duelId
  const duelId = queueEntry?.currentDuelId;

  useEffect(() => {
    if (!duelId) return;
    return onSnapshot(doc(db, "sos_duels", duelId), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setDuel({ id: snap.id, ...d });

      // Set revealed when outcome is ready
      if (d.status === "COMPLETE") setRevealed(true);

      // Compute seconds left
      if (d.endsAt && d.status === "ACTIVE") {
        const ms = d.endsAt.toMillis() - Date.now();
        setSecondsLeft(Math.max(0, Math.floor(ms / 1000)));
      }
    });
  }, [duelId]);

  // Live chat messages
  useEffect(() => {
    if (!duelId) return;
    const q = query(
      collection(db, "sos_duels", duelId, "chat"),
      orderBy("timestamp","asc")
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [duelId]);

  // Countdown ticker
  useEffect(() => {
    if (!duel || duel.status !== "ACTIVE") return;
    timerRef.current = setInterval(() => {
      setSecondsLeft(p => {
        if (p <= 1) { clearInterval(timerRef.current); return 0; }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [duel?.status]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages]);

  // Determine if I'm player 1 or 2
  const amP1       = duel && user && duel.player1Uid === user.uid;
  const amP2       = duel && user && duel.player2Uid === user.uid;
  const myRole     = amP1 ? "player1" : amP2 ? "player2" : null;
  const oppUsername= amP1 ? duel?.player2Username : duel?.player1Username;
  const oppWallet  = amP1 ? duel?.player2 : duel?.player1;

  const isActive   = duel?.status === "ACTIVE";
  const isComplete = duel?.status === "COMPLETE";

  // Send chat message
  const sendMessage = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !duelId || !profile) return;
    setChatInput("");
    try {
      await addDoc(collection(db, "sos_duels", duelId, "chat"), {
        uid:       user.uid,
        username:  profile.username,
        text,
        timestamp: serverTimestamp(),
      });
    } catch (err) { console.error(err); }
  };

  // Submit vote (stored in private collection — only Admin SDK can read)
  const submitVote = async (vote) => {
    if (voteSubmitted || !user || !duelId) return;
    setMyVote(vote);
    try {
      await setDoc(doc(db, "sos_private_votes", user.uid), {
        vote,
        duelId,
        uid:       user.uid,
        timestamp: serverTimestamp(),
      });
      setVoteSubmitted(true);
    } catch (err) {
      console.error(err);
      setMyVote(null);
    }
  };

  // ── No duel active ─────────────────────────────────────────────────────
  if (!queueEntry || !queueEntry.currentDuelId) {
    return (
      <div className="page" style={{
        minHeight:"100vh",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"100px 24px",
        textAlign:"center",
      }}>
        <div style={{ fontSize:64, marginBottom:20, opacity:0.4 }}>⚔️</div>
        <h2 style={{
          fontFamily:"'Russo One',sans-serif",
          fontSize:28, letterSpacing:"0.08em",
          color:"var(--text)", marginBottom:14,
        }}>NO ACTIVE DUEL</h2>
        <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:15, color:"var(--muted)", marginBottom:28 }}>
          You're not currently in a duel. Join the queue to get matched.
        </p>
        <div style={{ display:"flex", gap:14, flexWrap:"wrap", justifyContent:"center" }}>
          <button onClick={() => navigate("queue")} className="btn-gold">GO TO QUEUE</button>
          <button onClick={() => navigate("home")}  className="btn-outline">HOME</button>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (!duel) {
    return (
      <div className="page" style={{
        minHeight:"100vh",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <div style={{ textAlign:"center" }}>
          <div style={{
            width:48, height:48, borderRadius:"50%",
            border:"3px solid rgba(255,184,0,0.2)",
            borderTopColor:"var(--gold)",
            animation:"led-breathe 0.8s linear infinite",
            margin:"0 auto 16px",
          }}/>
          <p className="label" style={{ color:"var(--muted)" }}>LOADING DUEL...</p>
        </div>
      </div>
    );
  }

  // ── OUTCOME REVEAL ─────────────────────────────────────────────────────
  if (isComplete && revealed) {
    const outcome    = duel.outcome;
    const isSplit    = outcome === "BOTH_SPLIT";
    const isBothSteal= outcome === "BOTH_STEAL";
    const isBetrayal = !isSplit && !isBothSteal;
    const iWon       = (amP1 && outcome === "P1_STEAL") || (amP2 && outcome === "P2_STEAL") || isSplit;
    const iBetrayed  = (amP1 && outcome === "P2_STEAL") || (amP2 && outcome === "P1_STEAL");

    return (
      <div className="page" style={{
        minHeight:"100vh",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"100px 24px 60px",
        textAlign:"center",
      }}>
        {/* Glow background */}
        <div style={{
          position:"fixed", inset:0, pointerEvents:"none",
          background: isSplit
            ? "radial-gradient(ellipse at 50% 40%, rgba(0,200,83,0.12) 0%, transparent 65%)"
            : isBothSteal
            ? "radial-gradient(ellipse at 50% 40%, rgba(96,125,139,0.1) 0%, transparent 65%)"
            : "radial-gradient(ellipse at 50% 40%, rgba(204,32,32,0.15) 0%, transparent 65%)",
        }}/>

        <div style={{ position:"relative", zIndex:2, maxWidth:560 }}>

          {/* Reveal icon */}
          <div style={{ fontSize:72, marginBottom:20, animation:"winner-burst 0.8s ease" }}>
            {isSplit ? "🤝" : isBothSteal ? "💀" : "🗡️"}
          </div>

          {/* Outcome label */}
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(28px,6vw,52px)",
            letterSpacing:"0.1em",
            color: isSplit ? "var(--green)" : isBothSteal ? "#90A4AE" : "var(--red2)",
            marginBottom:8,
            animation:"reveal-flip 0.8s ease 0.3s both",
          }}>
            {isSplit ? "BOTH SPLIT" : isBothSteal ? "BOTH STOLE" : "BETRAYAL"}
          </h2>

          {/* Personal outcome */}
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:18, fontWeight:600, letterSpacing:2,
            color: iWon ? "var(--gold)" : iBetrayed ? "var(--red2)" : "var(--dim)",
            marginBottom:28,
          }}>
            {isSplit    ? `YOU WON ◎ ${fmtSOL((duel.amount||0)/2)}` :
             iWon       ? `YOU WON ◎ ${fmtSOL(duel.amount)}` :
             iBetrayed  ? "YOU WERE BETRAYED" :
             isBothSteal ? "NOBODY WINS" : ""}
          </p>

          {/* Orb reveals */}
          <div style={{
            display:"flex", gap:40, justifyContent:"center",
            marginBottom:36,
          }}>
            <div style={{ textAlign:"center" }}>
              <div className="label" style={{ marginBottom:12, color:"var(--muted)" }}>
                {duel.player1Username || short(duel.player1)}
              </div>
              <div style={{ animation:"reveal-flip 0.7s ease 0.5s both" }}>
                <Orb type={duel.vote1} size={120} animated={false}/>
              </div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div className="label" style={{ marginBottom:12, color:"var(--muted)" }}>
                {duel.player2Username || short(duel.player2)}
              </div>
              <div style={{ animation:"reveal-flip 0.7s ease 0.7s both" }}>
                <Orb type={duel.vote2} size={120} animated={false}/>
              </div>
            </div>
          </div>

          {/* TX link */}
          {duel.txSig && (
            <div style={{ marginBottom:24 }}>
              <a href={`https://solscan.io/tx/${duel.txSig.split("|")[0]}`}
                target="_blank" rel="noreferrer"
                style={{
                  fontFamily:"'Oswald',sans-serif",
                  fontSize:11, letterSpacing:3,
                  color:"var(--gold)", textDecoration:"underline",
                }}>
                VIEW ON SOLSCAN ↗
              </a>
            </div>
          )}

          {/* Actions */}
          <div style={{ display:"flex", gap:14, justifyContent:"center", flexWrap:"wrap" }}>
            <button onClick={() => navigate("queue")} className="btn-gold">
              PLAY AGAIN
            </button>
            <button onClick={() => navigate("home")} className="btn-outline">
              SEE HISTORY
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ACTIVE DUEL ROOM ───────────────────────────────────────────────────
  return (
    <div className="page" style={{
      padding:"80px 16px 60px",
      minHeight:"100vh",
      display:"flex", flexDirection:"column",
    }}>
      <div style={{ maxWidth:900, margin:"0 auto", width:"100%", flex:1, display:"flex", flexDirection:"column" }}>

        {/* ── DUEL HEADER ────────────────────────────────────── */}
        <div style={{
          display:"flex", alignItems:"center",
          justifyContent:"space-between", gap:16,
          marginBottom:24, flexWrap:"wrap",
        }}>
          {/* Player 1 */}
          <div style={{
            flex:1, minWidth:120,
            padding:"14px 18px",
            background: amP1 ? "rgba(255,184,0,0.08)" : "var(--card)",
            border:`1px solid ${amP1 ? "rgba(255,184,0,0.3)" : "var(--border)"}`,
            borderRadius:12, textAlign:"center",
          }}>
            <div className="label" style={{ marginBottom:6, color:"var(--muted)", fontSize:8 }}>PLAYER 1</div>
            <div style={{
              fontFamily:"'Oswald',sans-serif",
              fontSize:15, fontWeight:700,
              color: amP1 ? "var(--gold)" : "var(--text)",
            }}>
              {duel.player1Username || short(duel.player1)}
              {amP1 && <span style={{ fontSize:9, color:"var(--muted)", marginLeft:6 }}>(you)</span>}
            </div>
            {/* Has voted indicator */}
            {duel.hasVoted1 && (
              <div style={{ marginTop:6, fontSize:10, color:"var(--green)", letterSpacing:2, fontFamily:"'Oswald',sans-serif" }}>
                ● VOTED
              </div>
            )}
          </div>

          {/* Center: timer + pot */}
          <div style={{ textAlign:"center", flexShrink:0 }}>
            <SmallRing seconds={secondsLeft} total={5 * 60}/>
            <div style={{
              marginTop:8,
              fontFamily:"'Russo One',sans-serif",
              fontSize:18, color:"var(--gold)",
            }}>◎ {fmtSOL(duel.amount)}</div>
            <div className="label" style={{ color:"var(--dim)", fontSize:8 }}>AT STAKE</div>
          </div>

          {/* Player 2 */}
          <div style={{
            flex:1, minWidth:120,
            padding:"14px 18px",
            background: amP2 ? "rgba(255,184,0,0.08)" : "var(--card)",
            border:`1px solid ${amP2 ? "rgba(255,184,0,0.3)" : "var(--border)"}`,
            borderRadius:12, textAlign:"center",
          }}>
            <div className="label" style={{ marginBottom:6, color:"var(--muted)", fontSize:8 }}>PLAYER 2</div>
            <div style={{
              fontFamily:"'Oswald',sans-serif",
              fontSize:15, fontWeight:700,
              color: amP2 ? "var(--gold)" : "var(--text)",
            }}>
              {duel.player2Username || short(duel.player2)}
              {amP2 && <span style={{ fontSize:9, color:"var(--muted)", marginLeft:6 }}>(you)</span>}
            </div>
            {duel.hasVoted2 && (
              <div style={{ marginTop:6, fontSize:10, color:"var(--green)", letterSpacing:2, fontFamily:"'Oswald',sans-serif" }}>
                ● VOTED
              </div>
            )}
          </div>
        </div>

        {/* ── CHAT + VOTE AREA ────────────────────────────────── */}
        {!chatOpen ? (
          /* Ready button — unlocks chat */
          <div style={{
            flex:1,
            display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center",
            gap:20, textAlign:"center",
          }}>
            <div style={{ fontSize:48 }}>🔒</div>
            <h3 style={{
              fontFamily:"'Russo One',sans-serif",
              fontSize:24, letterSpacing:"0.06em", color:"var(--text)",
            }}>READY TO ENTER?</h3>
            <p style={{
              fontFamily:"'Barlow',sans-serif",
              fontSize:14, color:"var(--muted)",
              maxWidth:360, lineHeight:1.7,
            }}>
              Clicking READY opens the chat room and starts your 5-minute negotiation.
              Once you enter, the clock runs whether you vote or not.
            </p>
            <button onClick={() => setChatOpen(true)} className="btn-gold"
              style={{ fontSize:16, padding:"16px 52px" }}>
              I'M READY ⚔️
            </button>
          </div>
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:16 }}>

            {/* Chat window */}
            <div style={{
              flex:1, minHeight:260, maxHeight:360,
              background:"rgba(0,0,0,0.25)",
              border:"1px solid var(--border)",
              borderRadius:12,
              display:"flex", flexDirection:"column",
              overflow:"hidden",
            }}>
              {/* Chat header */}
              <div style={{
                padding:"10px 16px",
                borderBottom:"1px solid var(--border)",
                display:"flex", alignItems:"center", gap:8,
              }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--green)", boxShadow:"0 0 6px var(--green)" }}/>
                <span className="label" style={{ fontSize:9, color:"var(--muted)" }}>
                  PRIVATE CHAT — ONLY YOU AND {oppUsername?.toUpperCase() || "OPPONENT"} CAN SEE THIS
                </span>
              </div>

              {/* Messages */}
              <div style={{
                flex:1, overflowY:"auto",
                padding:"14px 16px",
                display:"flex", flexDirection:"column", gap:10,
              }}>
                {messages.length === 0 && (
                  <p style={{
                    textAlign:"center", color:"var(--dim)",
                    fontFamily:"'Barlow',sans-serif",
                    fontSize:13, fontStyle:"italic",
                    margin:"auto",
                  }}>
                    The room is open. Say something — or don't.
                  </p>
                )}
                {messages.map(m => {
                  const isMe = m.uid === user?.uid;
                  return (
                    <div key={m.id} style={{
                      display:"flex",
                      justifyContent: isMe ? "flex-end" : "flex-start",
                      animation:"chat-in 0.3s ease",
                    }}>
                      <div style={{
                        maxWidth:"75%",
                        padding:"10px 14px",
                        borderRadius: isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                        background: isMe
                          ? "rgba(255,184,0,0.12)"
                          : "rgba(255,255,255,0.06)",
                        border:`1px solid ${isMe ? "rgba(255,184,0,0.2)" : "rgba(255,255,255,0.06)"}`,
                      }}>
                        {!isMe && (
                          <div style={{
                            fontFamily:"'Oswald',sans-serif",
                            fontSize:10, fontWeight:600, letterSpacing:1,
                            color:"var(--gold)", marginBottom:4,
                          }}>{m.username}</div>
                        )}
                        <p style={{
                          fontFamily:"'Barlow',sans-serif",
                          fontSize:14, color:"var(--text)", lineHeight:1.5,
                          wordBreak:"break-word",
                        }}>{m.text}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef}/>
              </div>

              {/* Chat input */}
              <form onSubmit={sendMessage} style={{
                display:"flex", gap:8, padding:"10px 12px",
                borderTop:"1px solid var(--border)",
              }}>
                <input
                  className="input-field"
                  placeholder="Say something..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  maxLength={200}
                  style={{ flex:1, padding:"10px 14px", fontSize:14 }}
                />
                <button type="submit" style={{
                  background:"var(--goldDim)",
                  border:"1px solid var(--goldBorder)",
                  borderRadius:8,
                  color:"var(--gold)",
                  cursor:"pointer",
                  fontFamily:"'Oswald',sans-serif",
                  fontSize:13, fontWeight:600, letterSpacing:1,
                  padding:"10px 18px",
                  flexShrink:0,
                  transition:"background 0.2s",
                }}>SEND</button>
              </form>
            </div>

            {/* Vote section */}
            <div style={{
              padding:"24px",
              background:"var(--card)",
              border:"1px solid var(--border)",
              borderRadius:12,
            }}>
              {!voteSubmitted ? (
                <>
                  <div className="label" style={{ textAlign:"center", marginBottom:20, color:"var(--muted)" }}>
                    YOUR VOTE IS PRIVATE — CHOOSE CAREFULLY
                  </div>
                  <div style={{
                    display:"flex", justifyContent:"center",
                    gap:"clamp(20px,5vw,60px)",
                    flexWrap:"wrap",
                  }}>
                    <div style={{ textAlign:"center", cursor:"pointer" }} onClick={() => submitVote("SPLIT")}>
                      <Orb type="SPLIT" size={120} animated={false}
                        selected={myVote==="SPLIT"} onClick={() => submitVote("SPLIT")}/>
                      <p style={{
                        marginTop:12, fontFamily:"'Oswald',sans-serif",
                        fontSize:12, fontWeight:600, letterSpacing:3,
                        color:"var(--gold)",
                      }}>SPLIT — SHARE EQUALLY</p>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <span style={{
                        fontFamily:"'Russo One',sans-serif",
                        fontSize:20, color:"var(--dim)", letterSpacing:3,
                        display:"block", marginTop:40,
                      }}>VS</span>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <Orb type="STEAL" size={120} animated={false}
                        selected={myVote==="STEAL"} onClick={() => submitVote("STEAL")}/>
                      <p style={{
                        marginTop:12, fontFamily:"'Oswald',sans-serif",
                        fontSize:12, fontWeight:600, letterSpacing:3,
                        color:"var(--red2)",
                      }}>STEAL — TAKE IT ALL</p>
                    </div>
                  </div>
                  <p style={{
                    textAlign:"center", marginTop:16,
                    fontSize:12, color:"var(--dim)", fontFamily:"'Barlow',sans-serif",
                  }}>
                    Your vote is sealed the moment you click. Your opponent cannot see it until the timer ends.
                  </p>
                </>
              ) : (
                <div style={{ textAlign:"center", padding:"20px" }}>
                  <div style={{ fontSize:36, marginBottom:12 }}>
                    {myVote === "SPLIT" ? "🤝" : "🗡️"}
                  </div>
                  <div style={{
                    fontFamily:"'Russo One',sans-serif",
                    fontSize:20, letterSpacing:2,
                    color: myVote === "SPLIT" ? "var(--gold)" : "var(--red2)",
                    marginBottom:8,
                  }}>
                    VOTE LOCKED — {myVote}
                  </div>
                  <p style={{
                    fontFamily:"'Barlow',sans-serif",
                    fontSize:13, color:"var(--muted)",
                  }}>
                    Waiting for your opponent and the timer to expire.
                    The reveal happens simultaneously.
                  </p>
                  {/* Opponent voted indicator */}
                  {((amP1 && duel.hasVoted2) || (amP2 && duel.hasVoted1)) && (
                    <div style={{
                      marginTop:14,
                      fontFamily:"'Oswald',sans-serif",
                      fontSize:12, letterSpacing:2, color:"var(--green)",
                    }}>
                      ● OPPONENT HAS VOTED
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
