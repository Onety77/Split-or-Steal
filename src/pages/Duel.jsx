import { useState, useEffect, useRef } from "react";
import {
  doc, onSnapshot, collection, addDoc, setDoc,
  serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import Orb from "../components/Orb";

const short  = (a) => a ? a.slice(0,4) + "..." + a.slice(-4) : "—";
const fmtSOL = (n) => (!n && n !== 0) ? "—" : n.toFixed(4);

const R2 = 44;
const C2 = 2 * Math.PI * R2;

function PhaseRing({ seconds, totalSeconds, phase }) {
  const pct    = Math.max(0, seconds / totalSeconds);
  const offset = C2 * (1 - pct);
  const mins   = Math.floor(seconds / 60);
  const secs   = seconds % 60;
  const str    = String(mins).padStart(2,"0") + ":" + String(secs).padStart(2,"0");
  const urgent = seconds < 30;
  const isVote = phase === "vote";
  const color  = urgent ? "#FF3333" : isVote ? "#CC2020" : "#FFB800";

  return (
    <div style={{ position:"relative", width:100, height:100, flexShrink:0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={R2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3"/>
        <circle cx="50" cy="50" r={R2} fill="none" stroke={color} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={C2} strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:15, lineHeight:1, color, animation: urgent ? "countdown-urgent 0.8s ease infinite" : "none" }}>{str}</span>
        <span style={{ fontSize:7, letterSpacing:2, color:"var(--muted)", marginTop:3 }}>{isVote ? "TO VOTE" : "TO CHAT"}</span>
      </div>
    </div>
  );
}

export default function Duel({ navigate }) {
  const { user, profile } = useAuth();

  const [queueEntry,    setQueueEntry]    = useState(null);
  const [duel,          setDuel]          = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [chatInput,     setChatInput]     = useState("");
  const [myVote,        setMyVote]        = useState(null);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [chatUnlocked,  setChatUnlocked]  = useState(false);
  const [secondsLeft,   setSecondsLeft]   = useState(0);

  // Save duelId so reveal screen persists after queue entry is deleted
  const savedDuelId = useRef(null);
  const chatEndRef  = useRef(null);
  const timerRef    = useRef(null);

  // Watch queue entry
  useEffect(() => {
    if (!user) { navigate("auth"); return; }
    return onSnapshot(doc(db, "sos_queue", user.uid), snap => {
      if (!snap.exists()) {
        // Queue entry deleted — but don't clear entry if we have a saved duel
        // This happens right after the duel completes
        setQueueEntry(null);
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      setQueueEntry(data);
      // Save the duelId so we keep it even after queue entry is deleted
      if (data.currentDuelId) {
        savedDuelId.current = data.currentDuelId;
      }
    });
  }, [user, navigate]);

  // Use saved duelId if queueEntry is gone
  const duelId = queueEntry?.currentDuelId || savedDuelId.current;

  // Watch duel document
  useEffect(() => {
    if (!duelId) return;
    return onSnapshot(doc(db, "sos_duels", duelId), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setDuel({ id: snap.id, ...d });

      const now = Date.now();
      if (d.phase === "chat" && d.chatEndsAt) {
        setSecondsLeft(Math.max(0, Math.floor((d.chatEndsAt.toMillis() - now) / 1000)));
      } else if (d.phase === "vote" && d.voteEndsAt) {
        setSecondsLeft(Math.max(0, Math.floor((d.voteEndsAt.toMillis() - now) / 1000)));
      }
    });
  }, [duelId]);

  // Live chat
  useEffect(() => {
    if (!duelId) return;
    const q = query(collection(db, "sos_duels", duelId, "chat"), orderBy("timestamp","asc"));
    return onSnapshot(q, snap => setMessages(snap.docs.map(d => ({ id:d.id,...d.data() }))));
  }, [duelId]);

  // Countdown
  useEffect(() => {
    if (!duel || duel.status === "COMPLETE") { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => setSecondsLeft(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(timerRef.current);
  }, [duel?.phase, duel?.status]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const amP1       = duel && user && duel.player1Uid === user.uid;
  const amP2       = duel && user && duel.player2Uid === user.uid;
  const phase      = duel?.phase;
  const isChatPhase= phase === "chat";
  const isVotePhase= phase === "vote";
  const isComplete = duel?.status === "COMPLETE";

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !duelId || !profile) return;
    setChatInput("");
    try {
      await addDoc(collection(db, "sos_duels", duelId, "chat"), {
        uid: user.uid, username: profile.username, text, timestamp: serverTimestamp(),
      });
    } catch (err) { console.error(err); }
  };

  const submitVote = async (vote) => {
    if (voteSubmitted || !user || !duelId || !isVotePhase) return;
    setMyVote(vote);
    setVoteSubmitted(true); // set immediately so UI updates
    try {
      await setDoc(doc(db, "sos_private_votes", user.uid), {
        vote, duelId, uid: user.uid, timestamp: serverTimestamp(),
      });
      const field = amP1 ? "hasVoted1" : "hasVoted2";
      await setDoc(doc(db, "sos_duels", duelId), { [field]: true }, { merge: true });
    } catch (err) {
      console.error(err);
      // Don't revert — keep voteSubmitted true to prevent double voting
    }
  };

  // ── No duel at all (and no saved duel) ────────────────────────────────
  if (!duelId) {
    return (
      <div className="page" style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"100px 24px", textAlign:"center" }}>
        <div style={{ fontSize:56, marginBottom:16, opacity:0.3 }}>⚔️</div>
        <h2 style={{ fontFamily:"'Russo One',sans-serif", fontSize:24, letterSpacing:"0.08em", color:"var(--text)", marginBottom:12 }}>NO ACTIVE DUEL</h2>
        <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", marginBottom:24 }}>You are not currently in a duel.</p>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center" }}>
          <button onClick={() => navigate("queue")} className="btn-gold">GO TO QUEUE</button>
          <button onClick={() => navigate("home")} className="btn-outline">HOME</button>
        </div>
      </div>
    );
  }

  // ── Loading duel ───────────────────────────────────────────────────────
  if (!duel) {
    return (
      <div className="page" style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid rgba(255,184,0,0.2)", borderTopColor:"var(--gold)", animation:"led-breathe 0.8s linear infinite", margin:"0 auto 14px" }}/>
          <p className="label" style={{ color:"var(--muted)" }}>LOADING...</p>
        </div>
      </div>
    );
  }

  // ── REVEAL SCREEN ─────────────────────────────────────────────────────
  if (isComplete) {
    const outcome     = duel.outcome;
    const isSplit     = outcome === "BOTH_SPLIT";
    const isBothSteal = outcome === "BOTH_STEAL";
    const iWon        = (amP1 && outcome === "P1_STEAL") || (amP2 && outcome === "P2_STEAL") || isSplit;
    const iBetrayed   = (amP1 && outcome === "P2_STEAL") || (amP2 && outcome === "P1_STEAL");
    const myWinAmount = isSplit ? (duel.amount||0)/2 : iWon ? duel.amount : 0;

    const shareText = isSplit
      ? "I just split ◎" + fmtSOL(myWinAmount) + " on $SOS — Split or Steal on Solana 🤝"
      : iBetrayed
      ? "I just got betrayed on $SOS 🗡️ They stole everything. This game is ruthless."
      : iWon
      ? "I just stole ◎" + fmtSOL(myWinAmount) + " on $SOS — no remorse 🗡️"
      : "We both stole on $SOS — nobody wins. The pot carries over 💀";

    const shareUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText);

    return (
      <div className="page" style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"100px 20px 60px", textAlign:"center" }}>
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", background: isSplit ? "radial-gradient(ellipse at 50% 40%, rgba(0,200,83,0.12) 0%, transparent 65%)" : isBothSteal ? "radial-gradient(ellipse at 50% 40%, rgba(96,125,139,0.1) 0%, transparent 65%)" : "radial-gradient(ellipse at 50% 40%, rgba(204,32,32,0.15) 0%, transparent 65%)" }}/>

        <div style={{ position:"relative", zIndex:2, maxWidth:520, width:"100%" }}>

          <div style={{ fontSize:72, marginBottom:16, animation:"winner-burst 0.8s ease" }}>
            {isSplit ? "🤝" : isBothSteal ? "💀" : "🗡️"}
          </div>

          <h2 style={{ fontFamily:"'Russo One',sans-serif", fontSize:"clamp(28px,6vw,52px)", letterSpacing:"0.1em", color: isSplit ? "var(--green)" : isBothSteal ? "#90A4AE" : "var(--red2)", marginBottom:8, animation:"reveal-flip 0.8s ease 0.3s both" }}>
            {isSplit ? "BOTH SPLIT" : isBothSteal ? "BOTH STOLE" : "BETRAYAL"}
          </h2>

          {/* Personal result */}
          <div style={{
            display:"inline-block",
            padding:"12px 28px",
            marginBottom:28,
            background: iWon ? "rgba(255,184,0,0.1)" : iBetrayed ? "rgba(204,32,32,0.1)" : "rgba(96,125,139,0.1)",
            border: "1px solid " + (iWon ? "rgba(255,184,0,0.3)" : iBetrayed ? "rgba(204,32,32,0.3)" : "rgba(96,125,139,0.3)"),
            borderRadius:12,
          }}>
            <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:13, letterSpacing:3, color:"var(--muted)", marginBottom:6 }}>
              {isSplit ? "YOUR SHARE" : iWon ? "YOU WON" : iBetrayed ? "YOU LOST" : "RESULT"}
            </div>
            <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:28, color: iWon ? "var(--gold)" : iBetrayed ? "var(--red2)" : "#90A4AE" }}>
              {iWon ? "◎ " + fmtSOL(myWinAmount) : iBetrayed ? "◎ 0.0000" : isBothSteal ? "NOBODY WINS" : ""}
            </div>
          </div>

          {/* Orb reveal */}
          <div style={{ display:"flex", gap:32, justifyContent:"center", marginBottom:32 }}>
            <div style={{ textAlign:"center" }}>
              <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>{duel.player1Username || short(duel.player1)}</div>
              <div style={{ animation:"reveal-flip 0.7s ease 0.5s both" }}><Orb type={duel.vote1 || "SPLIT"} size={110} animated={false}/></div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>{duel.player2Username || short(duel.player2)}</div>
              <div style={{ animation:"reveal-flip 0.7s ease 0.7s both" }}><Orb type={duel.vote2 || "SPLIT"} size={110} animated={false}/></div>
            </div>
          </div>

          {/* TX link */}
          {duel.txSig && (
            <div style={{ marginBottom:24 }}>
              <a href={"https://solscan.io/tx/" + duel.txSig.split("|")[0]} target="_blank" rel="noreferrer"
                style={{ fontFamily:"'Oswald',sans-serif", fontSize:11, letterSpacing:3, color:"var(--gold)", textDecoration:"underline" }}>
                VIEW ON SOLSCAN ↗
              </a>
            </div>
          )}

          {/* Both stole — pot info */}
          {isBothSteal && (
            <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", marginBottom:24, lineHeight:1.6 }}>
              The pot carries over to the next round and grows.
            </p>
          )}

          {/* Action buttons */}
          <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap", marginBottom:16 }}>
            <button onClick={() => { savedDuelId.current = null; navigate("queue"); }} className="btn-gold">
              PLAY AGAIN
            </button>
            <button onClick={() => { savedDuelId.current = null; navigate("home"); }} className="btn-outline">
              HOME
            </button>
          </div>

          {/* Share button */}
          <a href={shareUrl} target="_blank" rel="noreferrer" style={{
            display:"inline-block",
            padding:"10px 28px",
            background:"rgba(255,255,255,0.04)",
            border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:8,
            fontFamily:"'Oswald',sans-serif",
            fontSize:12, fontWeight:600, letterSpacing:2,
            color:"var(--muted)",
            textDecoration:"none",
          }}>
            𝕏 SHARE RESULT
          </a>

        </div>
      </div>
    );
  }

  // ── ACTIVE DUEL ROOM ──────────────────────────────────────────────────
  const showChat = chatUnlocked || isVotePhase;

  return (
    <div className="page" style={{ padding:"80px 16px 60px", minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <div style={{ maxWidth:860, margin:"0 auto", width:"100%", flex:1, display:"flex", flexDirection:"column" }}>

        {/* Header row */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:100, padding:"12px 16px", background: amP1 ? "rgba(255,184,0,0.08)" : "var(--card)", border:"1px solid " + (amP1 ? "rgba(255,184,0,0.3)" : "var(--border)"), borderRadius:12, textAlign:"center" }}>
            <div className="label" style={{ marginBottom:5, color:"var(--muted)", fontSize:8 }}>P1</div>
            <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:14, fontWeight:700, color: amP1 ? "var(--gold)" : "var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {duel.player1Username || short(duel.player1)}{amP1 && <span style={{ fontSize:9, color:"var(--muted)", marginLeft:6 }}>(you)</span>}
            </div>
            {duel.hasVoted1 && <div style={{ fontSize:9, color:"var(--green)", letterSpacing:2, marginTop:4, fontFamily:"'Oswald',sans-serif" }}>● VOTED</div>}
          </div>

          <div style={{ textAlign:"center", flexShrink:0 }}>
            <PhaseRing seconds={secondsLeft} totalSeconds={isChatPhase ? 180 : 120} phase={phase}/>
            <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:16, color:"var(--gold)", marginTop:6 }}>◎ {fmtSOL(duel.amount)}</div>
            <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:9, letterSpacing:3, color: isVotePhase ? "var(--red2)" : "var(--gold)", marginTop:3 }}>
              {isChatPhase ? "CHAT PHASE" : "VOTE PHASE"}
            </div>
          </div>

          <div style={{ flex:1, minWidth:100, padding:"12px 16px", background: amP2 ? "rgba(255,184,0,0.08)" : "var(--card)", border:"1px solid " + (amP2 ? "rgba(255,184,0,0.3)" : "var(--border)"), borderRadius:12, textAlign:"center" }}>
            <div className="label" style={{ marginBottom:5, color:"var(--muted)", fontSize:8 }}>P2</div>
            <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:14, fontWeight:700, color: amP2 ? "var(--gold)" : "var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {duel.player2Username || short(duel.player2)}{amP2 && <span style={{ fontSize:9, color:"var(--muted)", marginLeft:6 }}>(you)</span>}
            </div>
            {duel.hasVoted2 && <div style={{ fontSize:9, color:"var(--green)", letterSpacing:2, marginTop:4, fontFamily:"'Oswald',sans-serif" }}>● VOTED</div>}
          </div>
        </div>

        {/* Enter gate */}
        {!showChat ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, textAlign:"center" }}>
            <div style={{ fontSize:44 }}>🔓</div>
            <h3 style={{ fontFamily:"'Russo One',sans-serif", fontSize:22, letterSpacing:"0.06em", color:"var(--text)" }}>ENTER THE ROOM</h3>
            <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", maxWidth:320, lineHeight:1.7 }}>
              Click to unlock the chat. If your opponent has not arrived yet, say something — they will see it when they enter.
            </p>
            <button onClick={() => setChatUnlocked(true)} className="btn-gold" style={{ fontSize:16, padding:"15px 48px" }}>ENTER ⚔️</button>
          </div>
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:14 }}>

            {/* Chat window */}
            <div style={{ flex:1, minHeight:220, maxHeight:320, background:"rgba(0,0,0,0.22)", border:"1px solid var(--border)", borderRadius:12, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"8px 14px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--green)", boxShadow:"0 0 6px var(--green)" }}/>
                <span className="label" style={{ fontSize:8, color:"var(--muted)" }}>
                  {isChatPhase ? "PRIVATE CHAT" : "CHAT CLOSED — VOTE NOW"}
                </span>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                {messages.length === 0 && (
                  <p style={{ textAlign:"center", color:"var(--dim)", fontFamily:"'Barlow',sans-serif", fontSize:13, fontStyle:"italic", margin:"auto" }}>The room is open.</p>
                )}
                {messages.map(m => {
                  const isMe = m.uid === user?.uid;
                  return (
                    <div key={m.id} style={{ display:"flex", justifyContent: isMe ? "flex-end" : "flex-start", animation:"chat-in 0.3s ease" }}>
                      <div style={{ maxWidth:"76%", padding:"9px 13px", borderRadius: isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px", background: isMe ? "rgba(255,184,0,0.1)" : "rgba(255,255,255,0.05)", border:"1px solid " + (isMe ? "rgba(255,184,0,0.18)" : "rgba(255,255,255,0.05)") }}>
                        {!isMe && <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:10, fontWeight:600, letterSpacing:1, color:"var(--gold)", marginBottom:3 }}>{m.username}</div>}
                        <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--text)", lineHeight:1.5, margin:0, wordBreak:"break-word" }}>{m.text}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef}/>
              </div>
              {isChatPhase && (
                <form onSubmit={sendMessage} style={{ display:"flex", gap:8, padding:"8px 10px", borderTop:"1px solid var(--border)" }}>
                  <input className="input-field" placeholder="Say something..." value={chatInput} onChange={e => setChatInput(e.target.value)} maxLength={200} style={{ flex:1, padding:"9px 13px", fontSize:14 }}/>
                  <button type="submit" style={{ background:"var(--goldDim)", border:"1px solid var(--goldBorder)", borderRadius:8, color:"var(--gold)", cursor:"pointer", fontFamily:"'Oswald',sans-serif", fontSize:12, fontWeight:600, letterSpacing:1, padding:"9px 16px", flexShrink:0 }}>SEND</button>
                </form>
              )}
            </div>

            {/* Vote section */}
            {isVotePhase && (
              <div style={{ padding:"20px", background:"var(--card)", border:"1px solid var(--border)", borderRadius:12 }}>
                {!voteSubmitted ? (
                  <>
                    <div className="label" style={{ textAlign:"center", marginBottom:18, color:"var(--muted)" }}>VOTE NOW — SEALED IMMEDIATELY</div>
                    <div style={{ display:"flex", justifyContent:"center", gap:"clamp(16px,5vw,52px)", flexWrap:"wrap" }}>
                      <div style={{ textAlign:"center" }}>
                        <Orb type="SPLIT" size={110} animated={false} onClick={() => submitVote("SPLIT")} selected={myVote==="SPLIT"}/>
                        <p style={{ marginTop:10, fontFamily:"'Oswald',sans-serif", fontSize:11, fontWeight:600, letterSpacing:3, color:"var(--gold)" }}>SHARE EQUALLY</p>
                      </div>
                      <div style={{ display:"flex", alignItems:"center" }}>
                        <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:18, color:"var(--dim)", letterSpacing:3 }}>VS</span>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <Orb type="STEAL" size={110} animated={false} onClick={() => submitVote("STEAL")} selected={myVote==="STEAL"}/>
                        <p style={{ marginTop:10, fontFamily:"'Oswald',sans-serif", fontSize:11, fontWeight:600, letterSpacing:3, color:"var(--red2)" }}>TAKE IT ALL</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign:"center", padding:"16px" }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>{myVote==="SPLIT" ? "🤝" : "🗡️"}</div>
                    <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:18, letterSpacing:2, color: myVote==="SPLIT" ? "var(--gold)" : "var(--red2)", marginBottom:8 }}>
                      VOTE LOCKED — {myVote}
                    </div>
                    <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:13, color:"var(--muted)" }}>
                      Waiting for reveal...
                    </p>
                    {((amP1 && duel.hasVoted2) || (amP2 && duel.hasVoted1)) && (
                      <div style={{ marginTop:10, fontFamily:"'Oswald',sans-serif", fontSize:11, letterSpacing:2, color:"var(--green)" }}>● OPPONENT HAS VOTED — REVEALING SOON</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Chat phase warning */}
            {isChatPhase && (
              <div style={{ padding:"11px 16px", background:"rgba(204,32,32,0.06)", border:"1px solid rgba(204,32,32,0.15)", borderRadius:8, textAlign:"center" }}>
                <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:12, color:"var(--muted)", margin:0 }}>
                  Chat closes in <span style={{ color:"var(--red2)", fontWeight:600 }}>{Math.floor(secondsLeft/60)}:{String(secondsLeft%60).padStart(2,"0")}</span> — then 2 minutes to vote SPLIT or STEAL.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}