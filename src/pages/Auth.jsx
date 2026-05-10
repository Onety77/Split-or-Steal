import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import Orb from "../components/Orb";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const TOKEN_CA   = "13SVgpzFcZf8vF6Tg1QV7vec82FdJrf4Kg2VEX4xpump";
const ST_API_KEY = import.meta.env.VITE_TRACKER_CODE;
const MIN_USD    = 10;

// ─── Wallet verification ───────────────────────────────────────────────────
// 1. Gets token price from SolanaTracker
// 2. Gets wallet's token balance from Solana RPC
// 3. Returns { eligible, usdValue, tokenAmount }
async function verifyWallet(walletAddress) {
  // Step 1: get token price
  let price = 0;
  try {
    const res  = await fetch(
      `https://data.solanatracker.io/tokens/${TOKEN_CA}`,
      { headers: { "x-api-key": ST_API_KEY } }
    );
    const data = await res.json();
    price = data?.price?.usd ?? data?.price ?? data?.pools?.[0]?.price?.usd ?? 0;
  } catch {}

  // Step 2: get wallet's token balance from Solana RPC
  let tokenAmount = 0;
  try {
    const res  = await fetch("https://api.mainnet-beta.solana.com", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id:      1,
        method:  "getTokenAccountsByOwner",
        params:  [
          walletAddress,
          { mint: TOKEN_CA },
          { encoding: "jsonParsed" },
        ],
      }),
    });
    const data = await res.json();
    const accounts = data?.result?.value ?? [];
    if (accounts.length > 0) {
      tokenAmount = accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
  } catch {}

  const usdValue = tokenAmount * price;
  return {
    eligible:    usdValue >= MIN_USD,
    usdValue,
    tokenAmount,
    price,
  };
}

// ─── AUTH PAGE ─────────────────────────────────────────────────────────────
export default function Auth({ navigate }) {
  const { signIn, signUp } = useAuth();

  const [tab,     setTab]    = useState("signin");
  const [loading, setLoading]= useState(false);
  const [error,   setError]  = useState("");

  // Sign in fields
  const [siEmail, setSiEmail]= useState("");
  const [siPass,  setSiPass] = useState("");

  // Sign up fields
  const [suUsername, setSuUsername]= useState("");
  const [suEmail,    setSuEmail]   = useState("");
  const [suPass,     setSuPass]    = useState("");
  const [suPass2,    setSuPass2]   = useState("");
  const [suWallet,   setSuWallet]  = useState("");

  // Wallet verification state
  const [walletStatus, setWalletStatus] = useState("idle");
  // idle | checking | eligible | insufficient | not_holding | error
  const [walletInfo,   setWalletInfo]   = useState(null);
  const debounceRef = useRef(null);

  // Debounced wallet check — fires 800ms after user stops typing
  useEffect(() => {
    if (tab !== "signup") return;

    const addr = suWallet.trim();

    // Reset if too short
    if (addr.length < 32) {
      setWalletStatus("idle");
      setWalletInfo(null);
      return;
    }

    setWalletStatus("checking");
    setWalletInfo(null);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await verifyWallet(addr);
        setWalletInfo(result);
        if (result.tokenAmount === 0) {
          setWalletStatus("not_holding");
        } else if (!result.eligible) {
          setWalletStatus("insufficient");
        } else {
          setWalletStatus("eligible");
        }
      } catch {
        setWalletStatus("error");
      }
    }, 800);

    return () => clearTimeout(debounceRef.current);
  }, [suWallet, tab]);

  // ── Sign in ─────────────────────────────────────────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn({ email: siEmail, password: siPass });
      navigate("queue");
    } catch (err) {
      setError(err.message.replace("Firebase:", "").trim());
    } finally {
      setLoading(false);
    }
  };

  // ── Sign up ─────────────────────────────────────────────────────────────
  const handleSignUp = async (e) => {
    e.preventDefault();
    setError("");

    if (suUsername.length < 3)          { setError("Username must be at least 3 characters"); return; }
    if (suUsername.length > 20)         { setError("Username can't exceed 20 characters"); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(suUsername)) { setError("Username: letters, numbers and underscores only"); return; }
    if (suPass !== suPass2)             { setError("Passwords don't match"); return; }
    if (walletStatus !== "eligible")    { setError("Your wallet must hold $10+ worth of $SOS to sign up"); return; }

    setLoading(true);
    try {
      await signUp({
        username: suUsername,
        email:    suEmail,
        password: suPass,
        wallet:   suWallet.trim(),
      });
      navigate("queue");
    } catch (err) {
      setError(err.message.replace("Firebase:", "").trim());
    } finally {
      setLoading(false);
    }
  };

  // ── Wallet status UI ────────────────────────────────────────────────────
  const walletStatusUI = () => {
    if (walletStatus === "idle") return null;

    const styles = {
      checking:     { bg: "rgba(255,184,0,0.06)",  border: "rgba(255,184,0,0.2)",  color: "var(--muted)" },
      eligible:     { bg: "rgba(0,200,83,0.08)",   border: "rgba(0,200,83,0.3)",   color: "var(--green)" },
      insufficient: { bg: "rgba(204,32,32,0.08)",  border: "rgba(204,32,32,0.3)",  color: "var(--red2)"  },
      not_holding:  { bg: "rgba(204,32,32,0.08)",  border: "rgba(204,32,32,0.3)",  color: "var(--red2)"  },
      error:        { bg: "rgba(255,184,0,0.06)",  border: "rgba(255,184,0,0.2)",  color: "var(--muted)" },
    };

    const s = styles[walletStatus] || styles.idle;

    const messages = {
      checking:     "Checking your wallet...",
      eligible:     `✓ Eligible — holding $${walletInfo?.usdValue?.toFixed(2)} worth of $SOS`,
      insufficient: `✗ Not enough — you hold $${walletInfo?.usdValue?.toFixed(2)} but need $${MIN_USD}+`,
      not_holding:  `✗ This wallet doesn't hold any $SOS`,
      error:        "Couldn't verify wallet — check the address and try again",
    };

    return (
      <div style={{
        marginTop:8, padding:"10px 14px",
        background: s.bg,
        border:     `1px solid ${s.border}`,
        borderRadius:8,
        display:"flex", alignItems:"center", gap:10,
      }}>
        {walletStatus === "checking" && (
          <div style={{
            width:12, height:12, borderRadius:"50%",
            border:"2px solid rgba(255,184,0,0.3)",
            borderTopColor:"var(--gold)",
            animation:"led-breathe 0.7s linear infinite",
            flexShrink:0,
          }}/>
        )}
        <p style={{
          fontFamily:"'Barlow',sans-serif",
          fontSize:12, color: s.color, lineHeight:1.5,
        }}>
          {messages[walletStatus]}
        </p>
      </div>
    );
  };

  const canSubmitSignUp = walletStatus === "eligible" && !loading;

  return (
    <div className="page" style={{
      minHeight:"100vh",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      padding:"100px 24px 60px",
    }}>

      {/* Background spotlight */}
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
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>
            {tab === "signin" ? "WELCOME BACK" : "JOIN THE GAME"}
          </h1>
          <p style={{
            marginTop:8, fontFamily:"'Barlow',sans-serif",
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
          borderRadius:10, padding:4, marginBottom:28,
        }}>
          {[["signin","SIGN IN"],["signup","SIGN UP"]].map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setError(""); }} style={{
              flex:1,
              background: tab===key ? "rgba(255,184,0,0.12)" : "none",
              border:     tab===key ? "1px solid rgba(255,184,0,0.25)" : "1px solid transparent",
              borderRadius:8,
              color:      tab===key ? "var(--gold)" : "var(--muted)",
              cursor:"pointer",
              fontFamily:"'Oswald',sans-serif",
              fontSize:13, fontWeight:600, letterSpacing:2,
              padding:"10px", transition:"all 0.2s",
            }}>{label}</button>
          ))}
        </div>

        {/* Error banner */}
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

        {/* ── SIGN IN ── */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn} style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>EMAIL</label>
              <input type="email" className="input-field"
                placeholder="your@email.com"
                value={siEmail} onChange={e => setSiEmail(e.target.value)}
                required autoComplete="email"/>
            </div>
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={siPass} onChange={e => setSiPass(e.target.value)}
                required autoComplete="current-password"/>
            </div>
            <button type="submit" className="btn-gold" disabled={loading}
              style={{ marginTop:8, fontSize:15, padding:"15px" }}>
              {loading ? "SIGNING IN..." : "SIGN IN →"}
            </button>
          </form>
        )}

        {/* ── SIGN UP ── */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>

            {/* Username */}
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>USERNAME</label>
              <input type="text" className="input-field"
                placeholder="your_username"
                value={suUsername} onChange={e => setSuUsername(e.target.value)}
                required minLength={3} maxLength={20} autoComplete="username"/>
              <p style={{ marginTop:5, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
                Letters, numbers, underscores. Your public identity in every duel.
              </p>
            </div>

            {/* Email */}
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>EMAIL</label>
              <input type="email" className="input-field"
                placeholder="your@email.com"
                value={suEmail} onChange={e => setSuEmail(e.target.value)}
                required autoComplete="email"/>
            </div>

            {/* Password */}
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={suPass} onChange={e => setSuPass(e.target.value)}
                required minLength={6} autoComplete="new-password"/>
            </div>

            {/* Confirm password */}
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>CONFIRM PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={suPass2} onChange={e => setSuPass2(e.target.value)}
                required autoComplete="new-password"/>
            </div>

            {/* Wallet — with live verification */}
            <div>
              <label style={{
                display:"block", fontSize:11, letterSpacing:3,
                color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
              }}>
                SOLANA WALLET ADDRESS
                {walletStatus === "eligible" && (
                  <span style={{ marginLeft:8, color:"var(--green)", fontSize:10, letterSpacing:1 }}>
                    ● VERIFIED
                  </span>
                )}
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Paste your Solana wallet address"
                value={suWallet}
                onChange={e => setSuWallet(e.target.value)}
                required
                style={{
                  fontFamily:"'Share Tech Mono',monospace",
                  fontSize:12,
                  borderColor: walletStatus === "eligible"
                    ? "rgba(0,200,83,0.4)"
                    : walletStatus === "not_holding" || walletStatus === "insufficient"
                    ? "rgba(204,32,32,0.4)"
                    : undefined,
                  boxShadow: walletStatus === "eligible"
                    ? "0 0 0 3px rgba(0,200,83,0.06)"
                    : walletStatus === "not_holding" || walletStatus === "insufficient"
                    ? "0 0 0 3px rgba(204,32,32,0.06)"
                    : undefined,
                }}
              />

              {/* Verification status */}
              {walletStatusUI()}

              {walletStatus === "idle" && (
                <p style={{ marginTop:6, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
                  Must hold $10+ worth of $SOS. Verified automatically when you paste your address.
                </p>
              )}

              {/* Where to buy hint if not holding */}
              {(walletStatus === "not_holding" || walletStatus === "insufficient") && (
                <p style={{ marginTop:8, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
                  Buy $SOS on pump.fun to qualify. Come back once you're holding.
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn-gold"
              disabled={!canSubmitSignUp}
              style={{
                marginTop:8, fontSize:15, padding:"15px",
                opacity: canSubmitSignUp ? 1 : 0.45,
                cursor:  canSubmitSignUp ? "pointer" : "not-allowed",
              }}
            >
              {loading             ? "CREATING ACCOUNT..." :
               walletStatus === "checking"  ? "VERIFYING WALLET..."  :
               walletStatus === "eligible"  ? "CREATE ACCOUNT →"     :
               "VERIFY WALLET TO CONTINUE"}
            </button>

          </form>
        )}

        {/* Switch tab */}
        <p style={{
          textAlign:"center", marginTop:20,
          fontSize:13, color:"var(--muted)", fontFamily:"'Barlow',sans-serif",
        }}>
          {tab === "signin" ? "No account? " : "Already have one? "}
          <button
            onClick={() => { setTab(tab==="signin"?"signup":"signin"); setError(""); }}
            style={{
              background:"none", border:"none", cursor:"pointer",
              color:"var(--gold)", fontSize:13, fontFamily:"'Barlow',sans-serif",
              textDecoration:"underline",
            }}
          >
            {tab === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>

      </div>
    </div>
  );
}