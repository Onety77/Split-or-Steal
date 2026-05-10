import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit, onSnapshot, doc,
} from "firebase/firestore";
import { db } from "../firebase";
import Orb from "../components/Orb";

const X_URL         = "https://x.com/REPLACE_YOUR_HANDLE";
const COMMUNITY_URL = "https://x.com/i/communities/REPLACE";
const TOKEN_CA      = "VuAy6VubBezBYzMurxDfJe6xcBWnaRhCcjzjGCqpump";
const DUEL_INTERVAL = 10 * 60 * 1000;
const isLive        = TOKEN_CA !== "PASTE_TOKEN_CA_HERE";

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

const PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id:    i,
  left:  `${(i * 5.1 + 1.3) % 100}%`,
  dur:   `${13 + ((i * 2.8) % 10)}s`,
  delay: `${(i * 1.6) % 13}s`,
  size:  i % 5 === 0 ? 3 : 2,
  type:  i % 4,
}));

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
          fontFamily:"'Russo One',sans-serif", fontSize:16, lineHeight:1,
          color: urgent ? "var(--red2)" : "var(--gold)",
          animation: urgent ? "countdown-urgent 1s ease infinite" : "none",
        }}>{str}</span>
        <span style={{ fontSize:7, letterSpacing:2, color:"var(--muted)", marginTop:3 }}>LEFT</span>
      </div>
    </div>
  );
}

export default function Home({ navigate }) {
  const [stats,     setStats]     = useState(null);
  const [duels,     setDuels]     = useState([]);
  const [countdown, setCountdown] = useState(DUEL_INTERVAL);
  const [copiedCA,  setCopiedCA]  = useState(false);
  const nextDuelRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db,"sos_duels"), orderBy("timestamp","desc"), limit(6));
    return onSnapshot(q, snap => setDuels(snap.docs.map(d => ({ id:d.id,...d.data() }))));
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

  const activeDuel  = stats?.activeDuel   ?? null;
  const currentPot  = stats?.currentPotSOL ?? null;
  const totalPaid   = stats?.totalDistributed ?? 0;
  const totalRounds = stats?.totalRounds  ?? 0;
  const totalSplits = stats?.totalSplits  ?? 0;
  const totalSteals = stats?.totalSteals  ?? 0;
  const biggestPot  = stats?.biggestPot   ?? 0;

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

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{
        position:"relative",
        minHeight:"100vh",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"90px 20px 64px",
        overflow:"hidden",
        textAlign:"center",
      }}>
        {/* BG */}
        <div style={{
          position:"absolute", inset:0,
          backgroundImage:"url('/bg.jpg')",
          backgroundSize:"cover", backgroundPosition:"center",
          opacity:0.1,
        }}/>
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 25% 0%, rgba(255,184,0,0.18) 0%, transparent 55%)",
        }}/>
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 75% 0%, rgba(255,184,0,0.14) 0%, transparent 55%)",
        }}/>
        <div style={{
          position:"absolute", bottom:0, left:0, right:0, height:"25%",
          background:"linear-gradient(to bottom, transparent, var(--bg))",
        }}/>

        <div style={{ position:"relative", zIndex:2, width:"100%", maxWidth:860 }}>

          {/* Eyebrow */}
          <p style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:11, fontWeight:500, letterSpacing:7,
            color:"var(--gold)", marginBottom:18,
            animation:"fade-in 0.7s ease 0.2s both",
          }}>ON-CHAIN · REAL MONEY · REAL BETRAYAL</p>

          {/* Title */}
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(52px,13vw,120px)",
            letterSpacing:"0.12em",
            lineHeight:0.9,
            marginBottom:24,
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
            fontSize:"clamp(14px,3.5vw,18px)",
            fontWeight:300, color:"var(--muted)",
            maxWidth:400, margin:"0 auto 48px",
            lineHeight:1.65,
            animation:"fade-in 0.8s ease 0.6s both",
          }}>
            Two players. One pot. Five minutes to decide.<br/>
            Trust or betray — on-chain.
          </p>

          {/* ── ORBS — stacked on mobile, side by side on desktop ── */}
          <div style={{
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:32,
            marginBottom:48,
            animation:"slide-up 0.9s ease 0.7s both",
          }}>
            {/* Mobile: vertical stack. Desktop: horizontal row */}
            <div style={{
              display:"flex",
              flexDirection:"row",
              alignItems:"center",
              justifyContent:"center",
              gap:"clamp(24px,6vw,72px)",
              flexWrap:"wrap",
              width:"100%",
            }}>
              {/* SPLIT orb */}
              <div style={{ textAlign:"center" }}>
                <Orb type="SPLIT" size={Math.min(180, window.innerWidth * 0.38)}/>
                <p style={{
                  marginTop:14,
                  fontFamily:"'Oswald',sans-serif",
                  fontSize:11, fontWeight:600, letterSpacing:3,
                  color:"var(--gold)",
                }}>SHARE THE POT</p>
              </div>

              {/* VS */}
              <div>
                <span style={{
                  fontFamily:"'Russo One',sans-serif",
                  fontSize:"clamp(18px,4vw,24px)",
                  color:"var(--dim)", letterSpacing:4,
                  display:"block",
                }}>VS</span>
              </div>

              {/* STEAL orb */}
              <div style={{ textAlign:"center" }}>
                <Orb type="STEAL" size={Math.min(180, window.innerWidth * 0.38)}/>
                <p style={{
                  marginTop:14,
                  fontFamily:"'Oswald',sans-serif",
                  fontSize:11, fontWeight:600, letterSpacing:3,
                  color:"var(--red2)",
                }}>TAKE IT ALL</p>
              </div>
            </div>
          </div>

          {/* CTA buttons */}
          <div style={{
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:12,
            animation:"slide-up 0.8s ease 0.9s both",
          }}>
            <button onClick={() => navigate("queue")} className="btn-gold"
              style={{ fontSize:15, padding:"15px 44px", width:"100%", maxWidth:320 }}>
              JOIN THE QUEUE
            </button>
            <button onClick={() => navigate("about")} className="btn-outline"
              style={{ fontSize:14, padding:"13px 40px", width:"100%", maxWidth:320 }}>
              HOW IT WORKS
            </button>
          </div>
        </div>

        {/* Scroll hint — hide on short screens */}
        <div style={{
          position:"absolute", bottom:20,
          left:"50%", transform:"translateX(-50%)",
          display:"flex", flexDirection:"column",
          alignItems:"center", gap:6,
          opacity:0.3,
          animation:"fade-in 1s ease 2s both",
        }}>
          <span style={{ fontSize:9, letterSpacing:4, fontFamily:"'Oswald',sans-serif", color:"var(--muted)" }}>
            SCROLL
          </span>
          <div style={{ width:1, height:24, background:"var(--border)" }}/>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────── */}
      <section style={{ padding:"0 20px 56px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{
          display:"grid",
          gridTemplateColumns:"1fr 1fr",
          gap:12,
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
                padding:"16px 18px",
              }}>
              <div className="label" style={{ marginBottom:8, fontSize:8 }}>{s.label}</div>
              <div style={{
                fontFamily:"'Russo One',sans-serif",
                fontSize:"clamp(16px,4vw,22px)",
                color: s.accent ? "var(--gold)" : "var(--text)",
              }}>{s.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIVE DUEL ─────────────────────────────────────────── */}
      <section style={{ padding:"0 20px 56px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:20 }}>
          <span className="label" style={{ color:"var(--gold)" }}>● LIVE</span>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(22px,5vw,30px)", letterSpacing:"0.08em",
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
            {/* On mobile: stack vertically */}
            <div style={{
              display:"flex",
              flexDirection:"column",
              alignItems:"center",
              gap:16,
            }}>
              <div style={{
                display:"flex",
                alignItems:"center",
                justifyContent:"space-between",
                width:"100%",
                gap:12,
              }}>
                {/* P1 */}
                <div style={{ textAlign:"center", flex:1 }}>
                  <div className="label" style={{ marginBottom:8, color:"var(--muted)", fontSize:8 }}>PLAYER 1</div>
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:"clamp(14px,4vw,18px)", fontWeight:600,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>
                    {activeDuel.player1Username || short(activeDuel.player1)}
                  </div>
                </div>

                {/* Timer */}
                <div style={{ textAlign:"center", flexShrink:0 }}>
                  <MiniRing countdown={countdown} total={5*60*1000}/>
                </div>

                {/* P2 */}
                <div style={{ textAlign:"center", flex:1 }}>
                  <div className="label" style={{ marginBottom:8, color:"var(--muted)", fontSize:8 }}>PLAYER 2</div>
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:"clamp(14px,4vw,18px)", fontWeight:600,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>
                    {activeDuel.player2Username || short(activeDuel.player2)}
                  </div>
                </div>
              </div>

              {/* Pot */}
              <div style={{
                fontFamily:"'Russo One',sans-serif",
                fontSize:"clamp(18px,5vw,24px)",
                color:"var(--gold)", textAlign:"center",
              }}>
                ◎ {fmtSOL(activeDuel.amount)}
                <span style={{ color:"var(--muted)", fontSize:12, marginLeft:8 }}>at stake</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign:"center", padding:"40px 20px" }}>
            <MiniRing countdown={countdown} total={DUEL_INTERVAL}/>
            <p style={{ marginTop:16, fontFamily:"'Oswald',sans-serif", fontSize:12, letterSpacing:4, color:"var(--muted)" }}>
              NEXT DUEL IN
            </p>
            <p style={{ marginTop:10, color:"var(--dim)", fontSize:13, lineHeight:1.7 }}>
              Two players from the queue will be selected.{" "}
              <button onClick={() => navigate("queue")} style={{
                background:"none", border:"none", cursor:"pointer",
                color:"var(--gold)", fontFamily:"'Barlow',sans-serif",
                fontSize:13, textDecoration:"underline",
              }}>Join the queue</button> to be eligible.
            </p>
          </div>
        )}
      </section>

      {/* ── DUEL HISTORY ──────────────────────────────────────── */}
      <section style={{ padding:"0 20px 72px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div style={{ marginBottom:20 }}>
          <div className="label" style={{ marginBottom:10, color:"var(--muted)" }}>ON-CHAIN RECORD</div>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(22px,5vw,30px)", letterSpacing:"0.08em", color:"var(--text)",
          }}>RECENT DUELS</h2>
        </div>

        {duels.length === 0 ? (
          <div className="card" style={{ textAlign:"center", padding:"48px 20px" }}>
            <div style={{ fontSize:40, opacity:0.3, marginBottom:14 }}>⚔️</div>
            <div className="label" style={{ color:"var(--dim)" }}>FIRST DUEL COMING SOON</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {duels.map((d, i) => {
              const color = outcomeColor(d.outcome);
              const label = outcomeLabel(d);
              return (
                <div key={d.id} style={{
                  background:"var(--card)",
                  border:`1px solid ${color}22`,
                  borderRadius:14, padding:"16px 18px",
                  position:"relative", overflow:"hidden",
                  animation:`slide-up 0.5s ease ${i*0.05}s both`,
                }}>
                  <div style={{
                    position:"absolute", top:0, left:0, right:0, height:3,
                    background:`linear-gradient(90deg,${color},${color}66)`,
                  }}/>
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:11, fontWeight:600, color, letterSpacing:2, marginBottom:12,
                  }}>{label}</div>

                  <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
                    {/* P1 */}
                    <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"'Oswald',sans-serif",
                        fontSize:13, fontWeight:600, color:"var(--text)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>
                        {d.player1Username || short(d.player1)}
                      </div>
                      <span style={{
                        display:"inline-block", marginTop:6,
                        padding:"4px 10px", borderRadius:20,
                        fontFamily:"'Russo One',sans-serif", fontSize:10,
                        background: d.vote1==="STEAL" ? "var(--redDim)" : "var(--goldDim)",
                        color:      d.vote1==="STEAL" ? "var(--red2)"   : "var(--gold)",
                        border:`1px solid ${d.vote1==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                      }}>{d.vote1||"—"}</span>
                    </div>

                    {/* Center */}
                    <div style={{ textAlign:"center", flexShrink:0 }}>
                      <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:9, color:"var(--dim)", letterSpacing:3 }}>VS</div>
                      <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:14, color:"var(--gold)", marginTop:4 }}>
                        ◎ {fmtSOL(d.amount)}
                      </div>
                    </div>

                    {/* P2 */}
                    <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"'Oswald',sans-serif",
                        fontSize:13, fontWeight:600, color:"var(--text)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>
                        {d.player2Username || short(d.player2)}
                      </div>
                      <span style={{
                        display:"inline-block", marginTop:6,
                        padding:"4px 10px", borderRadius:20,
                        fontFamily:"'Russo One',sans-serif", fontSize:10,
                        background: d.vote2==="STEAL" ? "var(--redDim)" : "var(--goldDim)",
                        color:      d.vote2==="STEAL" ? "var(--red2)"   : "var(--gold)",
                        border:`1px solid ${d.vote2==="STEAL" ? "rgba(204,32,32,0.3)" : "var(--goldBorder)"}`,
                      }}>{d.vote2||"—"}</span>
                    </div>
                  </div>

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
          <div className="card" style={{ marginTop:16, display:"flex", gap:24, flexWrap:"wrap" }}>
            {[
              { label:"BOTH SPLIT",  value:totalSplits,                          color:"var(--green)" },
              { label:"BETRAYALS",   value:totalSteals,                          color:"var(--red2)"  },
              { label:"BOTH STOLE",  value:totalRounds-totalSplits-totalSteals,  color:"var(--slate)" },
            ].map(s => (
              <div key={s.label}>
                <div className="label" style={{ color:"var(--muted)", marginBottom:6, fontSize:8 }}>{s.label}</div>
                <div style={{ fontFamily:"'Russo One',sans-serif", fontSize:22, color:s.color }}>
                  {Math.max(0, s.value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── CA + LINKS ────────────────────────────────────────── */}
      <section style={{ padding:"0 20px 72px", maxWidth:"var(--max-w)", margin:"0 auto" }}>
        <div className="card" style={{ border:"1px solid rgba(255,184,0,0.18)" }}>
          <div className="label" style={{ marginBottom:12, color:"var(--muted)" }}>CONTRACT ADDRESS</div>

          <div style={{ marginBottom:14 }}>
            <div className="mono" style={{
              wordBreak:"break-all", fontSize:12,
              color: isLive ? "var(--text)" : "var(--dim)",
              fontStyle: isLive ? "normal" : "italic",
              lineHeight:1.6,
            }}>
              {isLive ? TOKEN_CA : "— contract address coming at launch —"}
            </div>
          </div>

          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {isLive && (
              <button onClick={copyCA} className={`btn-outline${copiedCA?" copy-flash":""}`}
                style={{ flex:1, minWidth:120 }}>
                {copiedCA ? "COPIED ✓" : "COPY CA"}
              </button>
            )}
            <a href={X_URL} target="_blank" rel="noreferrer" style={{
              flex:1, minWidth:100,
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:"10px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:8,
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, fontWeight:600, letterSpacing:2,
              color:"var(--muted)", textAlign:"center",
            }}>𝕏 TWITTER</a>
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" style={{
              flex:1, minWidth:100,
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:"10px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:8,
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, fontWeight:600, letterSpacing:2,
              color:"var(--muted)", textAlign:"center",
            }}>COMMUNITY</a>
          </div>
        </div>
      </section>

    </div>
  );
}