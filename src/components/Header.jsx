import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { doc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const DUEL_INTERVAL = 10 * 60 * 1000;

export default function Header({ navigate, currentPage }) {
  const { user, profile, signOut } = useAuth();
  const [menuOpen,   setMenuOpen]  = useState(false);
  const [countdown,  setCountdown] = useState(DUEL_INTERVAL);
  const [activeDuel, setActiveDuel]= useState(false);
  const nextDuelRef = useRef(null);

  // Live countdown from Firestore
  useEffect(() => {
    return onSnapshot(doc(db, "sos_stats", "global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setActiveDuel(!!d.activeDuel);
      if (d.nextDuelAt) {
        nextDuelRef.current = d.nextDuelAt.toMillis();
        setCountdown(Math.max(d.nextDuelAt.toMillis() - Date.now(), 0));
      }
    });
  }, []);

  // Tick
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

  const mins   = Math.floor(countdown / 60000);
  const secs   = Math.floor((countdown % 60000) / 1000);
  const cdStr  = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  const urgent = countdown < 60000 && !activeDuel;

  const navLinks = [
    { label:"HOME",  page:"home"  },
    { label:"QUEUE", page:"queue" },
    { label:"ABOUT", page:"about" },
  ];

  const handleSignOut = async () => {
    if (user) {
      try { await deleteDoc(doc(db, "sos_queue", user.uid)); } catch {}
    }
    await signOut();
    navigate("home");
  };

  return (
    <header style={{
      position:"fixed", top:0, left:0, right:0, zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"12px 24px",
      backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
      borderBottom:"1px solid rgba(255,184,0,0.1)",
      background:"rgba(8,6,4,0.9)",
      gap:12,
    }}>

      {/* Logo */}
      <button onClick={() => navigate("home")} style={{
        background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", gap:10, padding:0, flexShrink:0,
      }}>
        <img src="/logo.png" alt="$SOS" style={{
          width:34, height:34, borderRadius:9, objectFit:"cover",
          boxShadow:"0 0 14px rgba(255,184,0,0.4)",
        }}/>
        <div style={{ textAlign:"left" }}>
          <div style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:17, letterSpacing:"0.12em",
            background:"linear-gradient(135deg,#FFE566,#FFB800)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>$SOS</div>
          <div style={{ fontSize:7, letterSpacing:4, color:"rgba(245,237,216,0.3)", marginTop:-2 }}>
            SPLIT OR STEAL
          </div>
        </div>
      </button>

      {/* Desktop nav */}
      <nav style={{ display:"flex", alignItems:"center", gap:24 }} className="hide-mobile">
        {navLinks.map(({ label, page }) => (
          <button key={page} onClick={() => navigate(page)} style={{
            background:"none", border:"none", cursor:"pointer",
            fontFamily:"'Oswald',sans-serif",
            fontSize:12, fontWeight:600, letterSpacing:3,
            color: currentPage===page ? "var(--gold)" : "var(--muted)",
            borderBottom: currentPage===page ? "1px solid var(--gold)" : "1px solid transparent",
            paddingBottom:2, transition:"color 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.color="var(--text)"}
          onMouseLeave={e => e.currentTarget.style.color=currentPage===page?"var(--gold)":"var(--muted)"}
          >{label}</button>
        ))}
      </nav>

      {/* ── FLOATING COUNTDOWN PILL ── */}
      <button
        onClick={() => navigate("home")}
        style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"7px 14px",
          background: activeDuel
            ? "rgba(255,184,0,0.12)"
            : urgent
            ? "rgba(204,32,32,0.12)"
            : "rgba(255,255,255,0.04)",
          border:`1px solid ${
            activeDuel ? "rgba(255,184,0,0.35)"
          : urgent     ? "rgba(204,32,32,0.35)"
          :              "rgba(255,255,255,0.08)"}`,
          borderRadius:30,
          cursor:"pointer",
          transition:"all 0.3s",
          flexShrink:0,
        }}>
        {/* Status dot */}
        <div style={{
          width:6, height:6, borderRadius:"50%", flexShrink:0,
          background: activeDuel ? "var(--gold)"
                    : urgent     ? "var(--red2)"
                    :              "rgba(255,255,255,0.3)",
          boxShadow: activeDuel ? "0 0 6px rgba(255,184,0,0.7)"
                    : urgent     ? "0 0 6px rgba(204,32,32,0.7)"
                    : "none",
          animation: activeDuel || urgent ? "led-breathe 1.2s ease-in-out infinite" : "none",
        }}/>

        {/* Label + time */}
        <div style={{ textAlign:"left" }}>
          <div style={{
            fontFamily:"'Oswald',sans-serif",
            fontSize:8, letterSpacing:3,
            color: activeDuel ? "var(--gold)" : urgent ? "var(--red2)" : "var(--dim)",
            lineHeight:1,
            marginBottom:2,
          }}>
            {activeDuel ? "LIVE DUEL" : "NEXT DUEL"}
          </div>
          <div style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:14, lineHeight:1,
            color: activeDuel ? "var(--gold3)"
                  : urgent     ? "var(--red2)"
                  :              "var(--text)",
            animation: urgent && !activeDuel ? "countdown-urgent 1s ease infinite" : "none",
          }}>
            {activeDuel ? "IN PROGRESS" : cdStr}
          </div>
        </div>
      </button>

      {/* Auth controls */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        {user && profile ? (
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={() => navigate("queue")} style={{
              background:"none", border:"1px solid var(--border)",
              borderRadius:8, cursor:"pointer",
              display:"flex", alignItems:"center", gap:7,
              padding:"7px 12px", transition:"border-color 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor="var(--goldBorder)"}
            onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
            >
              <div style={{
                width:6, height:6, borderRadius:"50%",
                background:"var(--green)",
                boxShadow:"0 0 6px var(--green)",
              }}/>
              <span style={{
                fontFamily:"'Oswald',sans-serif",
                fontSize:12, fontWeight:600, letterSpacing:1, color:"var(--text)",
              }}>{profile.username}</span>
            </button>
            <button onClick={handleSignOut} style={{
              background:"none", border:"none", cursor:"pointer",
              fontFamily:"'Oswald',sans-serif",
              fontSize:11, letterSpacing:2, color:"var(--muted)",
              transition:"color 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.color="var(--red2)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >OUT</button>
          </div>
        ) : (
          <button onClick={() => navigate("auth")} className="btn-gold"
            style={{ padding:"8px 18px", fontSize:12 }}>
            SIGN IN
          </button>
        )}

        {/* Mobile hamburger */}
        <button onClick={() => setMenuOpen(o => !o)} className="hide-desktop" style={{
          background:"none", border:"1px solid var(--border)",
          borderRadius:6, cursor:"pointer",
          padding:"6px 10px", color:"var(--muted)", fontSize:16, lineHeight:1,
        }}>☰</button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div style={{
          position:"absolute", top:"100%", left:0, right:0,
          background:"rgba(8,6,4,0.98)",
          borderBottom:"1px solid var(--border)",
          padding:"12px 20px",
          display:"flex", flexDirection:"column", gap:2,
        }}>
          {navLinks.map(({ label, page }) => (
            <button key={page}
              onClick={() => { navigate(page); setMenuOpen(false); }}
              style={{
                background:"none", border:"none", cursor:"pointer",
                fontFamily:"'Oswald',sans-serif",
                fontSize:15, fontWeight:600, letterSpacing:3,
                color: currentPage===page ? "var(--gold)" : "var(--muted)",
                textAlign:"left", padding:"10px 0",
                borderBottom:"1px solid var(--border)",
              }}>{label}</button>
          ))}
        </div>
      )}
    </header>
  );
}