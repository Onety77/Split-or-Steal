import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Orb from "../components/Orb";

export default function Auth({ navigate }) {
  const { signIn, signUp } = useAuth();

  const [tab,       setTab]      = useState("signin"); // "signin" | "signup"
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState("");

  // Sign in fields
  const [siEmail,   setSiEmail]  = useState("");
  const [siPass,    setSiPass]   = useState("");

  // Sign up fields
  const [suUsername,setSuUsername]= useState("");
  const [suEmail,   setSuEmail]  = useState("");
  const [suPass,    setSuPass]   = useState("");
  const [suPass2,   setSuPass2]  = useState("");
  const [suWallet,  setSuWallet] = useState("");

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn({ email: siEmail, password: siPass });
      navigate("queue");
    } catch (err) {
      setError(err.message.replace("Firebase:","").trim());
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError("");

    if (suPass !== suPass2)        { setError("Passwords don't match"); return; }
    if (suUsername.length < 3)     { setError("Username must be at least 3 characters"); return; }
    if (suUsername.length > 20)    { setError("Username can't exceed 20 characters"); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(suUsername)) { setError("Username: letters, numbers and underscores only"); return; }
    if (suWallet.length < 32)      { setError("Enter a valid Solana wallet address"); return; }

    setLoading(true);
    try {
      await signUp({
        username: suUsername,
        email:    suEmail,
        password: suPass,
        wallet:   suWallet,
      });
      navigate("queue");
    } catch (err) {
      setError(err.message.replace("Firebase:","").trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{
      minHeight:"100vh",
      display:"flex",
      flexDirection:"column",
      alignItems:"center",
      justifyContent:"center",
      padding:"100px 24px 60px",
    }}>

      {/* Background spotlights */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        background:"radial-gradient(ellipse at 50% 0%, rgba(255,184,0,0.12) 0%, transparent 60%)",
      }}/>

      {/* Card */}
      <div style={{
        position:"relative", zIndex:2,
        width:"100%", maxWidth:480,
        animation:"slide-up 0.6s ease both",
      }}>

        {/* Orb header */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ display:"flex", justifyContent:"center", gap:32, marginBottom:20 }}>
            <Orb type="SPLIT" size={80} animated={false}/>
            <Orb type="STEAL" size={80} animated={false}/>
          </div>
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:28, letterSpacing:"0.1em",
            background:"linear-gradient(135deg,#FFE566,#FFB800)",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
          }}>
            {tab === "signin" ? "WELCOME BACK" : "JOIN THE GAME"}
          </h1>
          <p style={{
            marginTop:8,
            fontFamily:"'Barlow',sans-serif",
            fontSize:14, color:"var(--muted)",
          }}>
            {tab === "signin"
              ? "Sign in to your account and join the queue."
              : "Create your account. Hold $SOS to qualify for duels."}
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display:"flex",
          background:"rgba(255,255,255,0.03)",
          border:"1px solid var(--border)",
          borderRadius:10, padding:4,
          marginBottom:28,
        }}>
          {[["signin","SIGN IN"],["signup","SIGN UP"]].map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setError(""); }} style={{
              flex:1,
              background: tab===key ? "rgba(255,184,0,0.12)" : "none",
              border:     tab===key ? "1px solid rgba(255,184,0,0.25)" : "1px solid transparent",
              borderRadius:8,
              color:      tab===key ? "var(--gold)" : "var(--muted)",
              cursor:     "pointer",
              fontFamily: "'Oswald',sans-serif",
              fontSize:   13, fontWeight:600, letterSpacing:2,
              padding:    "10px",
              transition: "all 0.2s",
            }}>{label}</button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom:16, padding:"12px 16px",
            background:"rgba(204,32,32,0.1)",
            border:"1px solid rgba(204,32,32,0.25)",
            borderRadius:8,
          }}>
            <p className="error-text">{error}</p>
          </div>
        )}

        {/* ── SIGN IN FORM ── */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn} style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>EMAIL</label>
              <input
                type="email"
                className="input-field"
                placeholder="your@email.com"
                value={siEmail}
                onChange={e => setSiEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>PASSWORD</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={siPass}
                onChange={e => setSiPass(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn-gold" disabled={loading}
              style={{ marginTop:8, fontSize:15, padding:"15px" }}>
              {loading ? "SIGNING IN..." : "SIGN IN →"}
            </button>
          </form>
        )}

        {/* ── SIGN UP FORM ── */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>USERNAME</label>
              <input
                type="text"
                className="input-field"
                placeholder="your_username"
                value={suUsername}
                onChange={e => setSuUsername(e.target.value)}
                required
                minLength={3} maxLength={20}
                autoComplete="username"
              />
              <p style={{ marginTop:5, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
                Letters, numbers, underscores. This is your public identity in every duel.
              </p>
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>EMAIL</label>
              <input
                type="email"
                className="input-field"
                placeholder="your@email.com"
                value={suEmail}
                onChange={e => setSuEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>PASSWORD</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={suPass}
                onChange={e => setSuPass(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>CONFIRM PASSWORD</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={suPass2}
                onChange={e => setSuPass2(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, letterSpacing:3, color:"var(--muted)",
                fontFamily:"'Oswald',sans-serif", marginBottom:7 }}>SOLANA WALLET ADDRESS</label>
              <input
                type="text"
                className="input-field"
                placeholder="Paste your Solana wallet address"
                value={suWallet}
                onChange={e => setSuWallet(e.target.value)}
                required
                style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12 }}
              />
              <p style={{ marginTop:5, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
                Must hold $10+ worth of $SOS to qualify for duels. Verified automatically.
              </p>
            </div>
            <button type="submit" className="btn-gold" disabled={loading}
              style={{ marginTop:8, fontSize:15, padding:"15px" }}>
              {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT →"}
            </button>
          </form>
        )}

        {/* Switch tab */}
        <p style={{ textAlign:"center", marginTop:20, fontSize:13, color:"var(--muted)", fontFamily:"'Barlow',sans-serif" }}>
          {tab === "signin" ? "No account? " : "Already have one? "}
          <button onClick={() => { setTab(tab==="signin"?"signup":"signin"); setError(""); }} style={{
            background:"none", border:"none", cursor:"pointer",
            color:"var(--gold)", fontSize:13, fontFamily:"'Barlow',sans-serif",
            textDecoration:"underline",
          }}>
            {tab === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>

      </div>
    </div>
  );
}
