import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const fmtSOL = (n) => (!n && n !== 0) ? "0.0000" : n.toFixed(4);
const short  = (a) => a ? a.slice(0,4) + "..." + a.slice(-4) : "—";

const TABS = [
  { id:"earned",  label:"TOP EARNERS",   field:"totalEarned", icon:"◎" },
  { id:"splits",  label:"MOST SPLITS",   field:"splits",      icon:"🤝" },
  { id:"steals",  label:"MOST STEALS",   field:"steals",      icon:"🗡️" },
  { id:"rounds",  label:"MOST ROUNDS",   field:"wins",        icon:"⚔️" },
];

export default function Leaderboard({ navigate }) {
  const [tab,     setTab]     = useState("earned");
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const active = TABS.find(t => t.id === tab);
    getDocs(
      query(
        collection(db, "sos_users"),
        orderBy(active.field, "desc"),
        limit(20)
      )
    ).then(snap => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [tab]);

  const active = TABS.find(t => t.id === tab);

  const getValue = (p) => {
    if (tab === "earned") return "◎ " + fmtSOL(p.totalEarned || 0);
    if (tab === "splits")  return (p.splits  || 0) + " splits";
    if (tab === "steals")  return (p.steals  || 0) + " steals";
    if (tab === "rounds")  return (p.wins    || 0) + " rounds";
    return "—";
  };

  const medalColor = (i) => {
    if (i === 0) return "#FFD700";
    if (i === 1) return "#C0C0C0";
    if (i === 2) return "#CD7F32";
    return "var(--dim)";
  };

  return (
    <div className="page" style={{ padding:"100px 24px 80px" }}>
      <div style={{ maxWidth:"var(--max-w)", margin:"0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom:40, textAlign:"center" }}>
          <div className="label" style={{ marginBottom:12 }}>HALL OF FAME</div>
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(32px,7vw,64px)",
            letterSpacing:"0.08em",
            background:"linear-gradient(160deg,#FFE566 0%,#FFB800 45%,#FF8C00 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            marginBottom:12,
          }}>LEADERBOARD</h1>
          <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:15, color:"var(--muted)" }}>
            The trust you broke. The money you made. All on-chain.
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display:"flex", gap:8, flexWrap:"wrap",
          justifyContent:"center", marginBottom:32,
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab===t.id ? "rgba(255,184,0,0.12)" : "var(--card)",
              border: "1px solid " + (tab===t.id ? "rgba(255,184,0,0.35)" : "var(--border)"),
              borderRadius:30, cursor:"pointer",
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, fontWeight:600, letterSpacing:2,
              color: tab===t.id ? "var(--gold)" : "var(--muted)",
              padding:"9px 20px", transition:"all 0.2s",
            }}>{t.icon} {t.label}</button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign:"center", padding:"80px" }}>
            <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid rgba(255,184,0,0.2)", borderTopColor:"var(--gold)", animation:"led-breathe 0.8s linear infinite", margin:"0 auto 16px" }}/>
            <p className="label" style={{ color:"var(--muted)" }}>LOADING...</p>
          </div>
        ) : players.length === 0 ? (
          <div className="card" style={{ textAlign:"center", padding:"60px" }}>
            <div style={{ fontSize:40, opacity:0.3, marginBottom:14 }}>🏆</div>
            <div className="label" style={{ color:"var(--dim)" }}>NO DATA YET — BE THE FIRST</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {players.map((p, i) => (
              <div key={p.id} style={{
                display:"flex", alignItems:"center", gap:16,
                padding:"16px 20px",
                background: i < 3 ? "rgba(255,184,0,0.04)" : "var(--card)",
                border:"1px solid " + (i < 3 ? "rgba(255,184,0,0.12)" : "var(--border)"),
                borderRadius:12,
                animation:"slide-up 0.4s ease " + (i*0.04) + "s both",
                position:"relative", overflow:"hidden",
              }}>
                {/* Gold bar for top 3 */}
                {i < 3 && (
                  <div style={{
                    position:"absolute", left:0, top:0, bottom:0, width:3,
                    background: medalColor(i),
                  }}/>
                )}

                {/* Rank */}
                <div style={{
                  width:36, height:36, borderRadius:"50%", flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background: i < 3 ? medalColor(i) + "22" : "rgba(255,255,255,0.04)",
                  fontFamily:"'Russo One',sans-serif",
                  fontSize: i < 3 ? 16 : 13,
                  color: i < 3 ? medalColor(i) : "var(--dim)",
                }}>
                  {i < 3 ? ["🥇","🥈","🥉"][i] : i + 1}
                </div>

                {/* Name + wallet */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{
                    fontFamily:"'Oswald',sans-serif",
                    fontSize:17, fontWeight:700,
                    color: i < 3 ? "var(--text)" : "var(--muted)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>{p.username}</div>
                  <div style={{
                    fontFamily:"'Share Tech Mono',monospace",
                    fontSize:10, color:"var(--dim)", marginTop:2,
                  }}>{short(p.wallet)}</div>
                </div>

                {/* Stats */}
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{
                    fontFamily:"'Russo One',sans-serif",
                    fontSize:18,
                    color: i < 3 ? "var(--gold)" : "var(--text)",
                  }}>{getValue(p)}</div>
                  <div style={{
                    fontFamily:"'Barlow',sans-serif",
                    fontSize:11, color:"var(--dim)", marginTop:2,
                  }}>
                    {(p.splits||0) + (p.steals||0)} duels played
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Back */}
        <div style={{ textAlign:"center", marginTop:40 }}>
          <button onClick={() => navigate("home")} className="btn-outline">
            ← BACK TO HOME
          </button>
        </div>

      </div>
    </div>
  );
}