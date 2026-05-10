import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit, onSnapshot, doc,
} from "firebase/firestore";
import { db } from "../firebase";
import Orb from "../components/Orb";

// ── Constants ──────────────────────────────────────────────────────────────
const X_URL         = "https://x.com/REPLACE_YOUR_HANDLE";
const COMMUNITY_URL = "https://x.com/i/communities/REPLACE";
const TOKEN_CA      = "13SVgpzFcZf8vF6Tg1QV7vec82FdJrf4Kg2VEX4xpump";
const DUEL_INTERVAL = 10 * 60 * 1000;
const isLive        = TOKEN_CA !== "13SVgpzFcZf8vF6Tg1QV7vec82FdJrf4Kg2VEX4xpump";

// ── Helpers ────────────────────────────────────────────────────────────────
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
  if (d.outcome === "BOTH_SPLIT")  return "Both Split 🤝";
  if (d.outcome === "BOTH_STEAL")  return "Both Stole 💀";
  if (d.vote1 === "STEAL")         return "P1 Betrayed 🗡️";
  return "P2 Betrayed 🗡️";
};
const outcomeColor = (o) => {
  if (o === "BOTH_SPLIT")  return "var(--green)";
  if (o === "BOTH_STEAL")  return "var(--slate)";
  return "var(--red2)";
};

// ── Floating particles ────────────────────────────────────────────────────
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  id:    i,
  left:  `${(i * 3.6 + 1.2) % 100}%`,
  dur:   `${12 + ((i * 2.8) % 10)}s`,
  delay: `${(i * 1.4) % 13}s`,
  size:  i % 5 === 0 ? 3 : 2,
  type:  i % 4,
}));

// ── Ring countdown ─────────────────────────────────────────────────────────
const R = 52;
const CIRC = 2 * Math.PI * R;

function MiniRing({ countdown, total }) {
  const pct    = Math.max(0, Math.min(1, countdown / total));
  const offset = CIRC * (1 - pct);
  const mins   = Math.floor(countdown / 60000);
  const secs   = Math.floor((countdown % 60000) / 1000);
  const str    = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  const urgent = countdown < 60000;

  return (
    <div style={{ position:"relative", width:120, height:120 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform:"rotate(-90deg)" }}>
        <defs>
          <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={urgent ? "#FF3333" : "#FF8C00"} />
            <stop offset="100%" stopColor={urgent ? "#FF9999" : "#FFE566"} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,184,0,0.08)" strokeWidth="3"/>
        <circle cx="60" cy="60" r={R} fill="none" stroke="url(#rg)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
      }}>
        <span style={{
          fontFamily:"'Russo One',sans-serif",
          fontSize:20, lineHeight:1,
          color: urgent ? "var(--red2)" : "var(--gold)",
          animation: urgent ? "countdown-urgent 1s ease infinite" : "none",
        }}>{str}</span>
        <span style={{ fontSize:8, letterSpacing:3, color:"var(--muted)", marginTop:4 }}>LEFT</span>
      </div>
    </div>
  );
}

// ── Home component ─────────────────────────────────────────────────────────
export default function Home({ navigate }) {
  const [stats,      setStats]      = useState(null);
  const [duels,      setDuels]      = useState([]);
  const [countdown,  setCountdown]  = useState(DUEL_INTERVAL);
  const [copiedCA,   setCopiedCA]   = useState(false);
  const nextDuelRef  = useRef(null);

  // Firestore: duels history
  useEffect(() => {
    const q = query(
      collection(db, "sos_duels"),
      orderBy("timestamp","desc"),
      limit(8)
    );
    return onSnapshot(q, snap =>
      setDuels(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

  // Firestore: global stats + countdown
  useEffect(() => {
    return onSnapshot(doc(db, "sos_stats","global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setStats(d);
      if (d.nextDuelAt) {
        nextDuelRef.current = d.nextDuelAt.toMillis();
        setCountdown(Math.max(d.nextDuelAt.toMillis() - Date.now(), 0));
      }
    });
  }, []);

  // Countdown tick
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
    if (!isLive) return;
    navigator.clipboard.writeText(TOKEN_CA);
    setCopiedCA(true);
    setTimeout(() => setCopiedCA(false), 2200);
  };

  const activeDuel   = stats?.activeDuel   ?? null;
  const currentPot   = stats?.currentPotSOL ?? null;
  const totalPaid    = stats?.totalDistributed ?? 0;
  const totalRounds  = stats?.totalRounds  ?? 0;
  const totalSplits  = stats?.totalSplits  ?? 0;
  const totalSteals  = stats?.totalSteals  ?? 0;
  const biggestPot   = stats?.biggestPot   ?? 0;

  return (
    <div className="page">

      {/* Floating particles */}
      {PARTICLES.map(p => (
        <div key={p.id} style={{
          position:"fixed", borderRadius:"50%",
          pointerEvents:"none", opacity:0,
          animation:`float-particle linear ${p.dur} ${p.delay} infinite`,
          zIndex:0,
          left:p.left, width:p.size, height:p.size,
          background: p.type===0 ? "var(--gold)"
                    : p.type===1 ? "var(--red2)"
                    : p.type===2 ? "rgba(255,184,0,0.4)"
                    : "rgba(255,255,255,0.25)",
        }} />
      ))}

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section style={{
        position:"relative",
        minHeight:"100vh",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"100px 24px 72px",
        overflow:"hidden",
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
          background:"radial-gradient(ellipse at 25% 0%, rgba(255,184,0,0.2) 0%, transparent 55%)",
        }}/>
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 75% 0%, rgba(255,184,0,0.16) 0%, transparent 55%)",
        }}/>
        {/* Bottom fade */}
        <div style={{
          position:"absolute", bottom:0, left:0, right:0, height:"28%",
          background:"linear-gradient(to bottom, transparent, var(--bg))",
        }}/>

        <div style={{ position:"relative", zIndex:2, textAlign:"center", maxWidth:900, width:"100%" }}>

          {/* Eyebrow */}
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:11, fontWeight:500, letterSpacing:8,
            color:"var(--gold)", marginBottom:20,
            animation:"fade-in 0.7s ease 0.2s both",
          }}>ON-CHAIN · REAL MONEY · REAL BETRAYAL</p>

          {/* Title */}
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(58px,11vw,130px)",
            letterSpacing:"0.14em",
            lineHeight:0.88,
            marginBottom:30,
            animation:"fade-in 0.8s ease 0.3s both",
            background:"linear-gradient(160deg, #FFE566 0%, #FFB800 40%, #FF8C00 70%, #F5EDD8 100%)",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
            backgroundSize:"200% auto",
          }}>
            SPLIT<br/>OR<br/>STEAL
          </h1>

          {/* Tagline */}
          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:"clamp(15px,2vw,19px)",
            fontWeight:300, color:"var(--muted)",
            maxWidth:460, margin:"0 auto 60px",
            lineHeight:1.65,
            animation:"fade-in 0.8s ease 0.6s both",
          }}>
            Two players. One pot. Five minutes to decide.<br/>
            Trust or betray — the consequences are on-chain.
          </p>

          {/* Orbs */}
          <div style={{
            display:"flex", alignItems:"center",
            justifyContent:"center", gap:"clamp(32px,8vw,80px)",
            marginBottom:64,
            flexWrap:"wrap",
            animation:"slide-up 0.9s ease 0.7s both",
          }}>
            <div style={{ textAlign:"center" }}>
              <Orb type="SPLIT" size={200}/>
              <p style={{
                marginTop:18,
                fontFamily:"'Oswald',sans-serif",
                fontSize:12, fontWeight:600, letterSpacing:4,
                color:"var(--gold)",
              }}>SHARE THE POT</p>
            </div>

            <div style={{ textAlign:"center" }}>
              <span style={{
                fontFamily:"'Russo One',sans-serif",
                fontSize:24, color:"var(--dim)", letterSpacing:4,
              }}>VS</span>
            </div>

            <div style={{ textAlign:"center" }}>
              <Orb type="STEAL" size={200}/>
              <p style={{
                marginTop:18,
                fontFamily:"'Oswald',sans-serif",
                fontSize:12, fontWeight:600, letterSpacing:4,
                color:"var(--red2)",
              }}>TAKE IT ALL</p>
            </div>
          </div>

          {/* CTA */}
          <div style={{
            display:"flex", gap:16, justifyContent:"center",
            flexWrap:"wrap",
            animation:"slide-up 0.8s ease 0.9s both",
          }}>
            <button onClick={() => navigate("queue")} className="btn-gold"
              style={{ fontSize:14, padding:"14px 40px" }}>
              JOIN THE QUEUE
            </button>
            <button onClick={() => navigate("about")} className="btn-outline"
              style={{ fontSize:14, padding:"14px 40px" }}>
              HOW IT WORKS
            </button>
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{
          position:"absolute", bottom:28,
          left:"50%", transform:"translateX(-50%)",
          display:"flex", flexDirection:"column",
          alignItems:"center", gap:6,
          opacity:0.3,
          animation:"fade-in 1s ease 2s both",
        }}>
          <span style={{ fontSize:9, letterSpacing:4, fontFamily:"'Oswald',sans-serif", color:"var(--muted)" }}>SCROLL</span>
          <div style={{ width:1, height:28, background:"var(--border)" }}/>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────────── */}
      <section style={{ padding:"0 24px 64px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
          gap:14,
        }}>
          {[
            { label:"CURRENT POT",    value: currentPot !== null ? `◎ ${fmtSOL(currentPot)}` : "—", accent:true },
            { label:"TOTAL PAID OUT", value:`◎ ${fmtSOL(totalPaid)}` },
            { label:"ROUNDS PLAYED",  value: totalRounds.toLocaleString() },
            { label:"BIGGEST POT",    value:`◎ ${fmtSOL(biggestPot)}` },
          ].map(s => (
            <div key={s.label} className={s.accent ? "card glow-gold" : "card"}
              style={{ background: s.accent ? "rgba(255,184,0,0.07)" : undefined,
                       border: s.accent ? "1px solid rgba(255,184,0,0.25)" : undefined }}>
              <div className="label" style={{ marginBottom:10 }}>{s.label}</div>
              <div style={{
                fontFamily:"'Russo One',sans-serif",
                fontSize:22,
                color: s.accent ? "var(--gold)" : "var(--text)",
              }}>{s.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIVE DUEL ─────────────────────────────────────────────── */}
      <section style={{ padding:"0 24px 64px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:24 }}>
          <span className="label" style={{ marginRight:8 }}>● LIVE</span>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:30, letterSpacing:"0.08em",
            color:"var(--text)", marginTop:8,
          }}>CURRENT DUEL</h2>
        </div>

        {activeDuel ? (
          <div className="card" style={{
            border:"1px solid rgba(255,184,0,0.25)",
            animation:"glow-gold 4s ease-in-out infinite",
            position:"relative", overflow:"hidden",
          }}>
            <div style={{
              position:"absolute", top:0, left:0, right:0, height:3,
              background:"linear-gradient(90deg,var(--gold2),var(--gold3),var(--gold2))",
              backgroundSize:"200%",
              animation:"shine 2s linear infinite",
            }}/>
            <div style={{
              display:"flex", alignItems:"center",
              justifyContent:"space-between",
              gap:20, flexWrap:"wrap",
            }}>
              <div style={{ textAlign:"center", flex:1, minWidth:120 }}>
                <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>PLAYER 1</div>
                <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:18, fontWeight:600 }}>
                  {activeDuel.player1Username || short(activeDuel.player1)}
                </div>
              </div>
              <div style={{ textAlign:"center", flexShrink:0 }}>
                <MiniRing countdown={countdown} total={5 * 60 * 1000}/>
                <div className="label" style={{ marginTop:10, color:"var(--muted)" }}>TO DECIDE</div>
              </div>
              <div style={{ textAlign:"center", flex:1, minWidth:120 }}>
                <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>PLAYER 2</div>
                <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:18, fontWeight:600 }}>
                  {activeDuel.player2Username || short(activeDuel.player2)}
                </div>
              </div>
            </div>
            <div style={{
              textAlign:"center", marginTop:20,
              fontFamily:"'Russo One',sans-serif",
              fontSize:22,
              color:"var(--gold)",
            }}>◎ {fmtSOL(activeDuel.amount)} <span style={{ color:"var(--muted)", fontSize:13 }}>at stake</span></div>
          </div>
        ) : (
          <div className="card" style={{ textAlign:"center", padding:"48px" }}>
            <MiniRing countdown={countdown} total={DUEL_INTERVAL}/>
            <p style={{ marginTop:20, fontFamily:"'Oswald',sans-serif", fontSize:13, letterSpacing:4, color:"var(--muted)" }}>
              NEXT DUEL IN
            </p>
            <p style={{ marginTop:12, color:"var(--dim)", fontSize:14, lineHeight:1.7 }}>
              Two random players from the queue will be selected.<br/>
              <button onClick={() => navigate("queue")} style={{
                background:"none", border:"none", cursor:"pointer",
                color:"var(--gold)", fontFamily:"'Barlow',sans-serif",
                fontSize:14, textDecoration:"underline",
              }}>Join the queue</button> to be eligible.
            </p>
          </div>
        )}
      </section>

      {/* ── DUEL HISTORY ──────────────────────────────────────────── */}
      <section style={{ padding:"0 24px 80px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:24 }}>
          <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>ON-CHAIN RECORD</div>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:30, letterSpacing:"0.08em", color:"var(--text)",
          }}>RECENT DUELS</h2>
        </div>

        {duels.length === 0 ? (
          <div className="card" style={{ textAlign:"center", padding:"60px" }}>
            <div style={{ fontSize:44, opacity:0.3, marginBottom:16 }}>⚔️</div>
            <div className="label" style={{ color:"var(--dim)" }}>FIRST DUEL COMING SOON</div>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:14 }}>
            {duels.map((d, i) => {
              const color = outcomeColor(d.outcome);
              const label = outcomeLabel(d);
              const isSplit = d.outcome === "BOTH_SPLIT";
              const isSteal = d.outcome === "BOTH_STEAL";
              return (
                <div key={d.id} style={{
                  background:"var(--card)",
                  border:`1px solid ${color}22`,
                  borderRadius:14,
                  padding:"20px",
                  position:"relative", overflow:"hidden",
                  animation:`slide-up 0.5s ease ${i*0.06}s both`,
                }}>
                  <div style={{
                    position:"absolute", top:0, left:0, right:0, height:3,
                    background:`linear-gradient(90deg,${color},${color}88)`,
                  }}/>
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:12, fontWeight:600,
                    color, letterSpacing:2, marginBottom:14,
                  }}>{label}</div>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:10 }}>
                    <div style={{ textAlign:"center" }}>
                      <div className="mono" style={{ marginBottom:6, fontSize:11 }}>
                        {d.player1Username || short(d.player1)}
                      </div>
                      <span style={{
                        display:"inline-block",
                        padding:"5px 12px", borderRadius:20,
                        fontFamily:"'Russo One',sans-serif", fontSize:11,
                        background: d.vote1==="STEAL" ? "var(--redDim)" : "var(--goldDim)",
                        color:      d.vote1==="STEAL" ? "var(--red2)"   : "var(--gold)",
                        border:`1px solid ${d.vote1==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                        letterSpacing:1,
                      }}>{d.vote1||"—"}</span>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:10, color:"var(--dim)", letterSpacing:3 }}>VS</div>
                      <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:15, color:"var(--gold)", marginTop:4 }}>◎ {fmtSOL(d.amount)}</div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div className="mono" style={{ marginBottom:6, fontSize:11 }}>
                        {d.player2Username || short(d.player2)}
                      </div>
                      <span style={{
                        display:"inline-block",
                        padding:"5px 12px", borderRadius:20,
                        fontFamily:"'Russo One',sans-serif", fontSize:11,
                        background: d.vote2==="STEAL" ? "var(--redDim)" : "var(--goldDim)",
                        color:      d.vote2==="STEAL" ? "var(--red2)"   : "var(--gold)",
                        border:`1px solid ${d.vote2==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                        letterSpacing:1,
                      }}>{d.vote2||"—"}</span>
                    </div>
                  </div>
                  <div style={{
                    marginTop:12, textAlign:"right",
                    fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif",
                  }}>{d.timestamp ? timeAgo(d.timestamp.toMillis()) : ""}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Betrayal rate bar */}
        {totalRounds > 0 && (
          <div className="card" style={{ marginTop:20, display:"flex", gap:32, flexWrap:"wrap" }}>
            {[
              { label:"BOTH SPLIT",   value:totalSplits,                        color:"var(--green)" },
              { label:"BETRAYALS",    value:totalSteals,                        color:"var(--red2)"  },
              { label:"BOTH STOLE",   value:totalRounds-totalSplits-totalSteals,color:"var(--slate)" },
            ].map(s => (
              <div key={s.label}>
                <div className="label" style={{ color:"var(--muted)", marginBottom:8 }}>{s.label}</div>
                <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:24, color:s.color }}>
                  {Math.max(0,s.value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── CA + LINKS ────────────────────────────────────────────── */}
      <section style={{ padding:"0 24px 80px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div className="card" style={{ border:"1px solid rgba(255,184,0,0.18)" }}>
          <div className="label" style={{ marginBottom:14, color:"var(--muted)" }}>CONTRACT ADDRESS</div>
          <div style={{
            display:"flex", alignItems:"center",
            gap:14, flexWrap:"wrap",
          }}>
            <div className="mono" style={{
              flex:1, minWidth:0,
              wordBreak:"break-all",
              fontSize:13,
              color: isLive ? "var(--text)" : "var(--dim)",
              fontStyle: isLive ? "normal" : "italic",
            }}>
              {isLive ? TOKEN_CA : "— contract address coming at launch —"}
            </div>
            <div style={{ display:"flex", gap:10, flexShrink:0, flexWrap:"wrap" }}>
              {isLive && (
                <button onClick={copyCA} className={`btn-outline${copiedCA?" copy-flash":""}`}>
                  {copiedCA ? "COPIED ✓" : "COPY CA"}
                </button>
              )}
              <a href={X_URL} target="_blank" rel="noreferrer" style={{
                padding:"10px 18px",
                background:"rgba(255,255,255,0.04)",
                border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:8,
                fontFamily:"'Oswald',sans-serif",
                fontSize:12, fontWeight:600, letterSpacing:2,
                color:"var(--muted)",
              }}>𝕏 TWITTER</a>
              <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" style={{
                padding:"10px 18px",
                background:"rgba(255,255,255,0.04)",
                border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:8,
                fontFamily:"'Oswald',sans-serif",
                fontSize:12, fontWeight:600, letterSpacing:2,
                color:"var(--muted)",
              }}>COMMUNITY</a>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
