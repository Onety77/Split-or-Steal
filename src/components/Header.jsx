import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function Header({ navigate, currentPage }) {
  const { user, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { label: "HOME",   page: "home"  },
    { label: "QUEUE",  page: "queue" },
    { label: "ABOUT",  page: "about" },
  ];

  const handleSignOut = async () => {
    // Remove from queue if in queue
    if (user) {
      try {
        await deleteDoc(doc(db, "sos_queue", user.uid));
      } catch {}
    }
    await signOut();
    navigate("home");
  };

  return (
    <header style={{
      position:          "fixed",
      top:               0,
      left:              0,
      right:             0,
      zIndex:            500,
      display:           "flex",
      alignItems:        "center",
      justifyContent:    "space-between",
      padding:           "14px 32px",
      backdropFilter:    "blur(20px)",
      WebkitBackdropFilter:"blur(20px)",
      borderBottom:      "1px solid rgba(255,184,0,0.1)",
      background:        "rgba(8,6,4,0.9)",
    }}>

      {/* Logo */}
      <button onClick={() => navigate("home")} style={{
        background:"none", border:"none", cursor:"pointer",
        display:"flex", alignItems:"center", gap:12,
        padding:0,
      }}>
        <img src="/logo.png" alt="$SOS" style={{
          width:36, height:36, borderRadius:9,
          objectFit:"cover",
          boxShadow:"0 0 14px rgba(255,184,0,0.4)",
        }} />
        <div style={{ textAlign:"left" }}>
          <div style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:18, letterSpacing:"0.12em",
            background:"linear-gradient(135deg,#FFE566,#FFB800)",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
          }}>$SOS</div>
          <div style={{ fontSize:8, letterSpacing:4, color:"rgba(245,237,216,0.35)", marginTop:-2 }}>
            SPLIT OR STEAL
          </div>
        </div>
      </button>

      {/* Desktop nav */}
      <nav style={{ display:"flex", alignItems:"center", gap:28 }} className="hide-mobile">
        {navLinks.map(({ label, page }) => (
          <button key={page} onClick={() => navigate(page)} style={{
            background:   "none",
            border:       "none",
            cursor:       "pointer",
            fontFamily:   "'Oswald',sans-serif",
            fontSize:     13,
            fontWeight:   600,
            letterSpacing:3,
            color:        currentPage === page ? "var(--gold)" : "var(--muted)",
            transition:   "color 0.2s",
            borderBottom: currentPage === page ? "1px solid var(--gold)" : "1px solid transparent",
            paddingBottom:2,
          }}
          onMouseEnter={e => e.currentTarget.style.color="var(--text)"}
          onMouseLeave={e => e.currentTarget.style.color=currentPage===page?"var(--gold)":"var(--muted)"}
          >{label}</button>
        ))}
      </nav>

      {/* Auth controls */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        {user && profile ? (
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button onClick={() => navigate("queue")} style={{
              background: "none", border:"none", cursor:"pointer",
              display:"flex", alignItems:"center", gap:8,
              padding:"8px 14px",
              borderRadius:8,
              border:"1px solid var(--border)",
              transition:"border-color 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor="var(--goldBorder)"}
            onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
            >
              <div style={{
                width:7, height:7, borderRadius:"50%",
                background:"var(--green)",
                boxShadow:"0 0 8px var(--green)",
              }} />
              <span style={{
                fontFamily:"'Oswald',sans-serif",
                fontSize:13, fontWeight:600, letterSpacing:1,
                color:"var(--text)",
              }}>{profile.username}</span>
            </button>
            <button onClick={handleSignOut} style={{
              background:"none", border:"none", cursor:"pointer",
              fontFamily:"'Oswald',sans-serif",
              fontSize:12, letterSpacing:2,
              color:"var(--muted)",
              transition:"color 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.color="var(--red2)"}
            onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}
            >SIGN OUT</button>
          </div>
        ) : (
          <button onClick={() => navigate("auth")} className="btn-gold"
            style={{ padding:"9px 22px", fontSize:12 }}>
            SIGN IN
          </button>
        )}

        {/* Mobile menu toggle */}
        <button onClick={() => setMenuOpen(o => !o)} className="hide-desktop" style={{
          background:"none", border:"1px solid var(--border)",
          borderRadius:6, cursor:"pointer",
          padding:"6px 10px",
          color:"var(--muted)",
          fontSize:18, lineHeight:1,
        }}>☰</button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div style={{
          position:"absolute", top:"100%", left:0, right:0,
          background:"rgba(8,6,4,0.98)",
          borderBottom:"1px solid var(--border)",
          padding:"16px 24px",
          display:"flex", flexDirection:"column", gap:4,
        }}>
          {navLinks.map(({ label, page }) => (
            <button key={page} onClick={() => { navigate(page); setMenuOpen(false); }} style={{
              background:"none", border:"none", cursor:"pointer",
              fontFamily:"'Oswald',sans-serif",
              fontSize:16, fontWeight:600, letterSpacing:3,
              color: currentPage === page ? "var(--gold)" : "var(--muted)",
              textAlign:"left", padding:"10px 0",
              borderBottom:"1px solid var(--border)",
            }}>{label}</button>
          ))}
        </div>
      )}
    </header>
  );
}
