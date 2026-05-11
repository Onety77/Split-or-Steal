import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit, onSnapshot, doc, where,
} from "firebase/firestore";
import { db } from "../firebase";
import Orb from "../components/Orb";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const X_URL         = "https://x.com/REPLACE_YOUR_HANDLE";
const COMMUNITY_URL = "https://x.com/i/communities/REPLACE";
const TOKEN_CA      = "13SVgpzFcZf8vF6Tg1QV7vec82FdJrf4Kg2VEX4xpump";
const DUEL_INTERVAL = 10 * 60 * 1000;

// ─── HELPERS ───────────────────────────────────────────────────────────────
const short   = (a) => a ? `${a.slice(0,4)}...${a.slice(-4)}` : "—";
const fmtSOL  = (n) => (!n && n !== 0) ? "—" : n.toFixed(4);
const timeAgo = (ms) => {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const outcomeLabel = (d) => {
  if (d.outcome === "BOTH_SPLIT") return "Both Split 🤝";
  if (d.outcome === "BOTH_STEAL") return "Both Stole 💀";
  if (d.vote1 === "STEAL")        return "P1 Betrayed 🗡️";
  return "P2 Betrayed 🗡️";
};
const outcomeColor = (o) => {
  if (o === "BOTH_SPLIT") return "var(--green)";
  if (o === "BOTH_STEAL") return "var(--slate)";
  return "var(--red2)";
};

// ─── REACTIVE WINDOW WIDTH HOOK ────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handle = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  return width;
}

// ─── PARTICLES ─────────────────────────────────────────────────────────────
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id:    i,
  left:  `${(i * 5.6 + 1.3) % 100}%`,
  dur:   `${13 + ((i * 2.8) % 10)}s`,
  delay: `${(i * 1.6) % 13}s`,
  size:  i % 5 === 0 ? 3 : 2,
  type:  i % 4,
}));

// ─── MINI RING ─────────────────────────────────────────────────────────────
const R2 = 44;
const C2 = 2 * Math.PI * R2;

function MiniRing({ countdown, total }) {
  const pct    = Math.max(0, Math.min(1, countdown / total));
  const offset = C2 * (1 - pct);
  const mins   = Math.floor(countdown / 60000);
  const secs   = Math.floor((countdown % 60000) / 1000);
  const str    = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  const urgent = countdown < 60000;
  return (
    <div style={{ position:"relative", width:100, height:100 }}>
      <svg width="100" height="100" viewBox="0 0 100 100"
        style={{ transform:"rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={R2} fill="none"
          stroke="rgba(255,184,0,0.07)" strokeWidth="3"/>
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
          fontFamily:"'Russo One',sans-serif", fontSize:16, lineHeight:1,
          color: urgent ? "var(--red2)" : "var(--gold)",
          animation: urgent ? "countdown-urgent 1s ease infinite" : "none",
        }}>{str}</span>
        <span style={{ fontSize:7, letterSpacing:2, color:"var(--muted)", marginTop:3 }}>LEFT</span>
      </div>
    </div>

      {/* HOW IT WORKS MODAL */}
      {showHowModal && <HowItWorksModal onClose={() => setShowHowModal(false)}/>}
  );
}

// ─── ORB SECTION: mobile stacks vertically, desktop side-by-side ───────────
function OrbSection({ isMobile }) {
  const orbSize = isMobile ? 130 : 190;

  if (isMobile) {
    // ── MOBILE: clean vertical stack, everything centered ──────────────────
    return (
      <div style={{
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        gap:0,
        width:"100%",
        marginBottom:44,
      }}>
        {/* SPLIT */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <Orb type="SPLIT" size={orbSize}/>
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:11, fontWeight:600, letterSpacing:3,
            color:"var(--gold)", margin:0,
          }}>SHARE THE POT</p>
        </div>

        {/* VS divider */}
        <div style={{
          display:"flex", flexDirection:"column", alignItems:"center",
          padding:"18px 0",
        }}>
          <div style={{ width:1, height:20, background:"rgba(255,184,0,0.15)" }}/>
          <span style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:16, color:"var(--dim)", letterSpacing:4,
            padding:"8px 0",
          }}>VS</span>
          <div style={{ width:1, height:20, background:"rgba(255,184,0,0.15)" }}/>
        </div>

        {/* STEAL */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <Orb type="STEAL" size={orbSize}/>
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:11, fontWeight:600, letterSpacing:3,
            color:"var(--red2)", margin:0,
          }}>TAKE IT ALL</p>
        </div>
      </div>
    );
  }

  // ── DESKTOP: side by side ─────────────────────────────────────────────────
  return (
    <div style={{
      display:"flex",
      flexDirection:"row",
      alignItems:"center",
      justifyContent:"center",
      gap:64,
      marginBottom:52,
      animation:"slide-up 0.9s ease 0.7s both",
    }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
        <Orb type="SPLIT" size={orbSize}/>
        <p style={{
          fontFamily:"'Oswald',sans-serif",
          fontSize:12, fontWeight:600, letterSpacing:3,
          color:"var(--gold)", margin:0,
        }}>SHARE THE POT</p>
      </div>

      <div style={{ textAlign:"center" }}>
        <span style={{
          fontFamily:"'Russo One',sans-serif",
          fontSize:24, color:"var(--dim)", letterSpacing:4,
        }}>VS</span>
      </div>

      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
        <Orb type="STEAL" size={orbSize}/>
        <p style={{
          fontFamily:"'Oswald',sans-serif",
          fontSize:12, fontWeight:600, letterSpacing:3,
          color:"var(--red2)", margin:0,
        }}>TAKE IT ALL</p>
      </div>
    </div>
  );
}

// ─── HOME ──────────────────────────────────────────────────────────────────
export default function Home({ navigate }) {
  const width     = useWindowWidth();
  const isMobile  = width < 640;

  const [stats,     setStats]     = useState(null);
  const [duels,     setDuels]     = useState([]);
  const [countdown, setCountdown] = useState(DUEL_INTERVAL);
  const [copiedCA,    setCopiedCA]    = useState(false);
  const [showHowModal,setShowHowModal]= useState(false);
  const [liveChat,   setLiveChat]    = useState([]);
  const nextDuelRef = useRef(null);

  useEffect(() => {
    const q = query(
      collection(db, "sos_duels"),
      orderBy("timestamp","desc"),
      limit(6)
    );
    return onSnapshot(q, snap =>
      setDuels(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db,"sos_stats","global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setStats(d);
      if (d.nextDuelAt) {
        nextDuelRef.current = d.nextDuelAt.toMillis();
        setCountdown(Math.max(d.nextDuelAt.toMillis() - Date.now(), 0));
      }
    });
  }, []);

  // Live spectator chat — listens to active duel chat
  useEffect(() => {
    if (!activeDuel?.duelId) { setLiveChat([]); return; }
    const q = query(
      collection(db, "sos_duels", activeDuel.duelId, "chat"),
      orderBy("timestamp","asc"),
      limit(30)
    );
    return onSnapshot(q, snap =>
      setLiveChat(snap.docs.map(d => ({ id:d.id,...d.data() })))
    );
  }, [activeDuel?.duelId]);

  useEffect(() => {
    const id = setInterval(() => {
      if (nextDuelRef.current) {
        const rem = nextDuelRef.current - Date.now();
        setCountdown(rem > 0 ? rem : 0);
      } else {
        setCountdown(p => p <= 1000 ? DUEL_INTERVAL : p - 1000);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const copyCA = () => {
    navigator.clipboard.writeText(TOKEN_CA);
    setCopiedCA(true);
    setTimeout(() => setCopiedCA(false), 2200);
  };

  const activeDuel  = stats?.activeDuel       ?? null;
  const currentPot  = stats?.currentPotSOL    ?? null;
  const totalPaid   = stats?.totalDistributed ?? 0;
  const totalRounds = stats?.totalRounds      ?? 0;
  const totalSplits = stats?.totalSplits      ?? 0;
  const totalSteals = stats?.totalSteals      ?? 0;
  const biggestPot  = stats?.biggestPot       ?? 0;
  const pad         = isMobile ? "0 16px" : "0 24px";

  return (
    <div className="page">

      {/* Particles */}
      {PARTICLES.map(p => (
        <div key={p.id} style={{
          position:"fixed", borderRadius:"50%",
          pointerEvents:"none", opacity:0,
          animation:`float-particle linear ${p.dur} ${p.delay} infinite`,
          zIndex:0, left:p.left, width:p.size, height:p.size,
          background: p.type===0 ? "var(--gold)"
                    : p.type===1 ? "var(--red2)"
                    : p.type===2 ? "rgba(255,184,0,0.4)"
                    : "rgba(255,255,255,0.25)",
        }}/>
      ))}

      {/* ══════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════ */}
      <section style={{
        position:"relative",
        minHeight:"100vh",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding: isMobile ? "88px 20px 60px" : "100px 24px 72px",
        overflow:"hidden",
        textAlign:"center",
      }}>
        {/* BG image */}
        <div style={{
          position:"absolute", inset:0,
          backgroundImage:"url('/bg.jpg')",
          backgroundSize:"cover", backgroundPosition:"center",
          opacity:0.1,
        }}/>
        {/* Spotlights */}
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 25% 0%, rgba(255,184,0,0.18) 0%, transparent 55%)",
        }}/>
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 75% 0%, rgba(255,184,0,0.14) 0%, transparent 55%)",
        }}/>
        {/* Bottom fade */}
        <div style={{
          position:"absolute", bottom:0, left:0, right:0, height:"25%",
          background:"linear-gradient(to bottom, transparent, var(--bg))",
        }}/>

        <div style={{ position:"relative", zIndex:2, width:"100%", maxWidth:860 }}>

          {/* Eyebrow */}
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize: isMobile ? 9 : 11,
            fontWeight:500,
            letterSpacing: isMobile ? 5 : 7,
            color:"var(--gold)", marginBottom:16,
            animation:"fade-in 0.7s ease 0.2s both",
          }}>ON-CHAIN · REAL MONEY · REAL BETRAYAL</p>

          {/* Main title */}
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize: isMobile ? "clamp(52px,16vw,72px)" : "clamp(72px,11vw,120px)",
            letterSpacing: isMobile ? "0.08em" : "0.12em",
            lineHeight:0.88,
            marginBottom: isMobile ? 18 : 24,
            animation:"fade-in 0.8s ease 0.3s both",
            background:"linear-gradient(160deg,#FFE566 0%,#FFB800 40%,#FF8C00 70%,#F5EDD8 100%)",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
          }}>
            SPLIT<br/>OR<br/>STEAL
          </h1>

          {/* Tagline */}
          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize: isMobile ? 14 : 18,
            fontWeight:300, color:"var(--muted)",
            maxWidth: isMobile ? 300 : 420,
            margin: isMobile ? "0 auto 36px" : "0 auto 48px",
            lineHeight:1.65,
            animation:"fade-in 0.8s ease 0.6s both",
          }}>
            Two players. One pot. Five minutes to decide.<br/>
            Trust or betray — on-chain.
          </p>

          {/* ── ORBS ── */}
          <OrbSection isMobile={isMobile}/>

          {/* CTA buttons */}
          <div style={{
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:12,
            animation:"slide-up 0.8s ease 0.9s both",
          }}>
            <button onClick={() => navigate("queue")} className="btn-gold"
              style={{
                fontSize: isMobile ? 14 : 15,
                padding: isMobile ? "14px 0" : "15px 44px",
                width: isMobile ? "100%" : "auto",
                maxWidth: 320,
              }}>
              JOIN THE QUEUE
            </button>
            <button onClick={() => setShowHowModal(true)} className="btn-outline"
              style={{
                fontSize: isMobile ? 13 : 14,
                padding: isMobile ? "12px 0" : "13px 40px",
                width: isMobile ? "100%" : "auto",
                maxWidth: 320,
              }}>
              HOW IT WORKS
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          STATS
      ══════════════════════════════════════════════════════════ */}
      <section style={{ padding:pad, paddingBottom:52, maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{
          display:"grid",
          gridTemplateColumns:"1fr 1fr",
          gap: isMobile ? 10 : 14,
        }}>
          {[
            { label:"CURRENT POT",    value: currentPot !== null ? `◎ ${fmtSOL(currentPot)}` : "—", accent:true },
            { label:"TOTAL PAID OUT", value:`◎ ${fmtSOL(totalPaid)}` },
            { label:"ROUNDS PLAYED",  value: totalRounds.toLocaleString() },
            { label:"BIGGEST POT",    value:`◎ ${fmtSOL(biggestPot)}` },
          ].map(s => (
            <div key={s.label} className={s.accent ? "card glow-gold" : "card"}
              style={{
                background: s.accent ? "rgba(255,184,0,0.07)" : undefined,
                border: s.accent ? "1px solid rgba(255,184,0,0.25)" : undefined,
                padding: isMobile ? "14px 14px" : "18px 22px",
              }}>
              <div className="label" style={{ marginBottom:8, fontSize:8 }}>{s.label}</div>
              <div style={{
                fontFamily:"'Russo One',sans-serif",
                fontSize: isMobile ? "clamp(14px,4vw,18px)" : 22,
                color: s.accent ? "var(--gold)" : "var(--text)",
                wordBreak:"break-word",
              }}>{s.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          LIVE DUEL
      ══════════════════════════════════════════════════════════ */}
      <section style={{ padding:pad, paddingBottom:52, maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:18 }}>
          <span className="label" style={{ color:"var(--gold)" }}>● LIVE</span>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize: isMobile ? 22 : 30,
            letterSpacing:"0.08em",
            color:"var(--text)", marginTop:8,
          }}>CURRENT DUEL</h2>
        </div>

        {activeDuel ? (
          <div className="card" style={{
            border:"1px solid rgba(255,184,0,0.25)",
            animation:"glow-gold 4s ease-in-out infinite",
            position:"relative", overflow:"hidden",
            padding: isMobile ? "20px 16px" : "28px",
          }}>
            <div style={{
              position:"absolute", top:0, left:0, right:0, height:3,
              background:"linear-gradient(90deg,var(--gold2),var(--gold3),var(--gold2))",
              backgroundSize:"200%", animation:"shine 2s linear infinite",
            }}/>
            <div style={{
              display:"flex", alignItems:"center",
              justifyContent:"space-between", gap:8,
            }}>
              {/* P1 */}
              <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                <div className="label" style={{ marginBottom:6, color:"var(--muted)", fontSize:8 }}>P1</div>
                <div style={{
                  fontFamily:"'Oswald',sans-serif",
                  fontSize: isMobile ? 13 : 17, fontWeight:600,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                }}>{activeDuel.player1Username || short(activeDuel.player1)}</div>
              </div>

              {/* Timer */}
              <div style={{ flexShrink:0 }}>
                <MiniRing countdown={countdown} total={5*60*1000}/>
              </div>

              {/* P2 */}
              <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                <div className="label" style={{ marginBottom:6, color:"var(--muted)", fontSize:8 }}>P2</div>
                <div style={{
                  fontFamily:"'Oswald',sans-serif",
                  fontSize: isMobile ? 13 : 17, fontWeight:600,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                }}>{activeDuel.player2Username || short(activeDuel.player2)}</div>
              </div>
            </div>

            <div style={{
              textAlign:"center", marginTop:16,
              fontFamily:"'Russo One',sans-serif",
              fontSize: isMobile ? 18 : 22,
              color:"var(--gold)",
            }}>
              ◎ {fmtSOL(activeDuel.amount)}
              <span style={{ color:"var(--muted)", fontSize:11, marginLeft:8 }}>at stake</span>
            </div>

            {/* Phase badge */}
            <div style={{ textAlign:"center" }}>
              <span style={{
                display:"inline-block", padding:"4px 14px", borderRadius:20,
                fontFamily:"'Oswald',sans-serif", fontSize:9, fontWeight:600, letterSpacing:3,
                background: activeDuel.phase==="vote" ? "rgba(204,32,32,0.12)" : "rgba(255,184,0,0.1)",
                color:      activeDuel.phase==="vote" ? "var(--red2)" : "var(--gold)",
                border:     activeDuel.phase==="vote" ? "1px solid rgba(204,32,32,0.3)" : "1px solid rgba(255,184,0,0.25)",
              }}>
                {activeDuel.phase==="vote" ? "VOTE PHASE" : "CHAT PHASE"}
              </span>
            </div>

            {/* Spectator live chat */}
            {liveChat.length > 0 && (
              <div style={{
                marginTop:8,
                background:"rgba(0,0,0,0.2)",
                border:"1px solid var(--border)",
                borderRadius:10, overflow:"hidden",
              }}>
                <div style={{ padding:"6px 12px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:7 }}>
                  <div style={{ width:5,height:5,borderRadius:"50%",background:"var(--green)",boxShadow:"0 0 5px var(--green)" }}/>
                  <span style={{ fontFamily:"'Oswald',sans-serif",fontSize:8,letterSpacing:3,color:"var(--muted)" }}>LIVE CHAT — SPECTATOR VIEW</span>
                </div>
                <div style={{ maxHeight:140,overflowY:"auto",padding:"10px 12px",display:"flex",flexDirection:"column",gap:6 }}>
                  {liveChat.map(m => (
                    <div key={m.id} style={{ animation:"chat-in 0.3s ease" }}>
                      <span style={{ fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:600,color:"var(--gold)",letterSpacing:1,marginRight:8 }}>{m.username}</span>
                      <span style={{ fontFamily:"'Barlow',sans-serif",fontSize:13,color:"var(--muted)" }}>{m.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {liveChat.length === 0 && activeDuel.phase === "chat" && (
              <p style={{ textAlign:"center",fontSize:12,color:"var(--dim)",fontFamily:"'Barlow',sans-serif",fontStyle:"italic",margin:0 }}>
                Waiting for players to start chatting...
              </p>
            )}
          </div>
        ) : (
          <div className="card" style={{ textAlign:"center", padding: isMobile ? "32px 16px" : "44px" }}>
            <MiniRing countdown={countdown} total={DUEL_INTERVAL}/>
            <p style={{ marginTop:14, fontFamily:"'Oswald',sans-serif", fontSize:11, letterSpacing:4, color:"var(--muted)" }}>
              NEXT DUEL IN
            </p>
            <p style={{ marginTop:10, color:"var(--dim)", fontSize:13, lineHeight:1.7 }}>
              Join the queue to be eligible.{" "}
              <button onClick={() => navigate("queue")} style={{
                background:"none", border:"none", cursor:"pointer",
                color:"var(--gold)", fontFamily:"'Barlow',sans-serif",
                fontSize:13, textDecoration:"underline",
              }}>Join now →</button>
            </p>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════
          DUEL HISTORY
      ══════════════════════════════════════════════════════════ */}
      <section style={{ padding:pad, paddingBottom:64, maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:18 }}>
          <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>ON-CHAIN RECORD</div>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize: isMobile ? 22 : 30,
            letterSpacing:"0.08em", color:"var(--text)",
          }}>RECENT DUELS</h2>
        </div>

        {duels.length === 0 ? (
          <div className="card" style={{ textAlign:"center", padding:"44px 16px" }}>
            <div style={{ fontSize:36, opacity:0.3, marginBottom:12 }}>⚔️</div>
            <div className="label" style={{ color:"var(--dim)" }}>FIRST DUEL COMING SOON</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {duels.map((d, i) => {
              const color = outcomeColor(d.outcome);
              const label = outcomeLabel(d);
              return (
                <div key={d.id} style={{
                  background:"var(--card)",
                  border:`1px solid ${color}22`,
                  borderRadius:12,
                  padding: isMobile ? "14px 14px" : "18px 20px",
                  position:"relative", overflow:"hidden",
                  animation:`slide-up 0.5s ease ${i*0.05}s both`,
                }}>
                  <div style={{
                    position:"absolute", top:0, left:0, right:0, height:3,
                    background:`linear-gradient(90deg,${color},${color}55)`,
                  }}/>

                  {/* Outcome label */}
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:10, fontWeight:600,
                    color, letterSpacing:2, marginBottom:10,
                  }}>{label}</div>

                  {/* Players row */}
                  <div style={{
                    display:"flex",
                    justifyContent:"space-between",
                    alignItems:"center",
                    gap: isMobile ? 6 : 12,
                  }}>
                    {/* P1 */}
                    <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"'Oswald',sans-serif",
                        fontSize: isMobile ? 12 : 14,
                        fontWeight:600, color:"var(--text)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                        marginBottom:6,
                      }}>
                        {d.player1Username || short(d.player1)}
                      </div>
                      <span style={{
                        display:"inline-block",
                        padding: isMobile ? "3px 8px" : "4px 10px",
                        borderRadius:20,
                        fontFamily:"'Russo One',sans-serif",
                        fontSize: isMobile ? 9 : 10,
                        background: d.vote1==="STEAL" ? "var(--redDim)"  : "var(--goldDim)",
                        color:      d.vote1==="STEAL" ? "var(--red2)"    : "var(--gold)",
                        border:`1px solid ${d.vote1==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                        letterSpacing:1,
                      }}>{d.vote1||"—"}</span>
                    </div>

                    {/* Center: VS + amount */}
                    <div style={{ textAlign:"center", flexShrink:0 }}>
                      <div style={{
                        fontFamily:"'Oswald',sans-serif",
                        fontSize:8, color:"var(--dim)", letterSpacing:3,
                      }}>VS</div>
                      <div style={{
                        fontFamily:"'Russo One',sans-serif",
                        fontSize: isMobile ? 12 : 14,
                        color:"var(--gold)", marginTop:4,
                      }}>◎ {fmtSOL(d.amount)}</div>
                    </div>

                    {/* P2 */}
                    <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"'Oswald',sans-serif",
                        fontSize: isMobile ? 12 : 14,
                        fontWeight:600, color:"var(--text)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                        marginBottom:6,
                      }}>
                        {d.player2Username || short(d.player2)}
                      </div>
                      <span style={{
                        display:"inline-block",
                        padding: isMobile ? "3px 8px" : "4px 10px",
                        borderRadius:20,
                        fontFamily:"'Russo One',sans-serif",
                        fontSize: isMobile ? 9 : 10,
                        background: d.vote2==="STEAL" ? "var(--redDim)"  : "var(--goldDim)",
                        color:      d.vote2==="STEAL" ? "var(--red2)"    : "var(--gold)",
                        border:`1px solid ${d.vote2==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                        letterSpacing:1,
                      }}>{d.vote2||"—"}</span>
                    </div>
                  </div>

                  {/* Time */}
                  <div style={{
                    marginTop:10, textAlign:"right",
                    fontSize:10, color:"var(--dim)", fontFamily:"'Barlow',sans-serif",
                  }}>{d.timestamp ? timeAgo(d.timestamp.toMillis()) : ""}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Stats bar */}
        {totalRounds > 0 && (
          <div className="card" style={{ marginTop:14, display:"flex", gap:20, flexWrap:"wrap" }}>
            {[
              { label:"BOTH SPLIT",  value: totalSplits,                          color:"var(--green)" },
              { label:"BETRAYALS",   value: totalSteals,                          color:"var(--red2)"  },
              { label:"BOTH STOLE",  value: totalRounds - totalSplits - totalSteals, color:"var(--slate)" },
            ].map(s => (
              <div key={s.label}>
                <div className="label" style={{ color:"var(--muted)", marginBottom:6, fontSize:8 }}>{s.label}</div>
                <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:20, color:s.color }}>
                  {Math.max(0, s.value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════
          CA + LINKS
      ══════════════════════════════════════════════════════════ */}
      <section style={{ padding:pad, paddingBottom:72, maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div className="card" style={{ border:"1px solid rgba(255,184,0,0.18)" }}>
          <div className="label" style={{ marginBottom:12, color:"var(--muted)" }}>CONTRACT ADDRESS</div>

          {/* CA text — breaks cleanly on mobile */}
          <div style={{
            fontFamily:"'Share Tech Mono',monospace",
            fontSize: isMobile ? 10 : 13,
            color:"var(--text)",
            wordBreak:"break-all",
            lineHeight:1.7,
            marginBottom:16,
          }}>{TOKEN_CA}</div>

          {/* Buttons */}
          <div style={{
            display:"flex",
            flexDirection: isMobile ? "column" : "row",
            gap:10,
          }}>
            <button onClick={copyCA} className={`btn-outline${copiedCA?" copy-flash":""}`}
              style={{ flex: isMobile ? "none" : 1 }}>
              {copiedCA ? "COPIED ✓" : "COPY CA"}
            </button>
            <a href={X_URL} target="_blank" rel="noreferrer" style={{
              flex: isMobile ? "none" : 1,
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:"10px 16px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:8,
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, fontWeight:600, letterSpacing:2,
              color:"var(--muted)",
            }}>𝕏 TWITTER</a>
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" style={{
              flex: isMobile ? "none" : 1,
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:"10px 16px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:8,
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, fontWeight:600, letterSpacing:2,
              color:"var(--muted)",
            }}>COMMUNITY</a>
          </div>
        </div>
      </section>

    </div>
  );
}