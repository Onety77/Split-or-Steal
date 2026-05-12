import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import Orb from "../components/Orb";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const TOKEN_CA   = "GVkQKdubVk57GXoneqHZ3RtVYjUAgTst9W8C2w2ppump";
const ST_API_KEY = import.meta.env.VITE_TRACKER_CODE;
const MIN_USD    = 10;

// ─── WALLET VERIFICATION ───────────────────────────────────────────────────
// Searches through SolanaTracker holders pages for the wallet
// Returns { eligible, usdValue, tokenAmount, found }
async function verifyWallet(walletAddress) {
  const wallet = walletAddress.trim();

  // Try up to 5 pages (500 holders max)
  for (let page = 1; page <= 5; page++) {
    let raw;
    try {
      const res = await fetch(
        `https://data.solanatracker.io/tokens/${TOKEN_CA}/holders?page=${page}&limit=100`,
        { headers: { "x-api-key": ST_API_KEY } }
      );
      raw = await res.json();
    } catch {
      break;
    }

    // Rate limited or error
    if (raw?.error) break;

    // Normalise the list — we've seen it come back as .accounts, .holders, or bare array
    const list = raw?.accounts ?? raw?.holders ?? raw?.items
               ?? (Array.isArray(raw) ? raw : null);

    if (!list || list.length === 0) break;

    // Search for this wallet in the list
    const match = list.find(h => {
      const addr = h.wallet ?? h.address ?? h.owner ?? h.pubkey ?? "";
      return addr.toLowerCase() === wallet.toLowerCase();
    });

    if (match) {
      const usdValue    = match.value?.usd ?? match.value?.quote ?? 0;
      const tokenAmount = match.amount ?? 0;
      return {
        found:       true,
        eligible:    usdValue >= MIN_USD,
        usdValue,
        tokenAmount,
      };
    }

    // If page returned less than 100, no more pages
    if (list.length < 100) break;
  }

  // Not found in any page — wallet doesn't hold this token
  return { found: false, eligible: false, usdValue: 0, tokenAmount: 0 };
}

// ─── AUTH PAGE ─────────────────────────────────────────────────────────────
export default function Auth({ navigate }) {
  const { signIn, signUp } = useAuth();

  const [tab,     setTab]    = useState("signin");
  const [loading, setLoading]= useState(false);
  const [error,   setError]  = useState("");

  // Sign in — only username now
  const [siUsername, setSiUsername] = useState("");
  const [siPass,     setSiPass]     = useState("");

  // Sign up — only username, password, wallet
  const [suUsername, setSuUsername] = useState("");
  const [suPass,     setSuPass]     = useState("");
  const [suPass2,    setSuPass2]    = useState("");
  const [suWallet,   setSuWallet]   = useState("");

  // Wallet verification state
  const [walletStatus, setWalletStatus] = useState("idle");
  // idle | checking | eligible | insufficient | not_holding | error
  const [walletInfo,   setWalletInfo]   = useState(null);
  const debounceRef = useRef(null);

  // Debounced wallet check
  useEffect(() => {
    if (tab !== "signup") return;
    const addr = suWallet.trim();

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
        if (!result.found) {
          setWalletStatus("not_holding");
        } else if (!result.eligible) {
          setWalletStatus("insufficient");
        } else {
          setWalletStatus("eligible");
        }
      } catch {
        setWalletStatus("error");
      }
    }, 900);

    return () => clearTimeout(debounceRef.current);
  }, [suWallet, tab]);

  // ── Sign in (username → derive internal email) ──────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const email = `${siUsername.toLowerCase().trim()}@sos-game.app`;
      await signIn({ email, password: siPass });
      navigate("queue");
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("user-not-found") || msg.includes("invalid-credential") || msg.includes("wrong-password")) {
        setError("Username or password is incorrect.");
      } else {
        setError(msg.replace("Firebase:","").trim());
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Sign up (generate email internally) ─────────────────────────────────
  const handleSignUp = async (e) => {
    e.preventDefault();
    setError("");

    if (suUsername.length < 3)
      { setError("Username must be at least 3 characters"); return; }
    if (suUsername.length > 20)
      { setError("Username can't exceed 20 characters"); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(suUsername))
      { setError("Username: letters, numbers and underscores only"); return; }
    if (suPass.length < 6)
      { setError("Password must be at least 6 characters"); return; }
    if (suPass !== suPass2)
      { setError("Passwords don't match"); return; }
    if (walletStatus !== "eligible")
      { setError("Your wallet must hold $10+ worth of $SOS to sign up"); return; }

    setLoading(true);
    try {
      // Generate internal email from username — user never sees this
      const email = `${suUsername.toLowerCase().trim()}@sos-game.app`;
      await signUp({
        username: suUsername.trim(),
        email,
        password: suPass,
        wallet:   suWallet.trim(),
      });
      navigate("queue");
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("email-already-in-use") || msg.includes("Username already taken")) {
        setError("That username is already taken. Pick a different one.");
      } else {
        setError(msg.replace("Firebase:","").trim());
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Wallet status UI ────────────────────────────────────────────────────
  const walletStatusUI = () => {
    if (walletStatus === "idle") return null;

    const cfg = {
      checking:     { bg:"rgba(255,184,0,0.06)",  border:"rgba(255,184,0,0.2)",  color:"var(--muted)" },
      eligible:     { bg:"rgba(0,200,83,0.08)",   border:"rgba(0,200,83,0.3)",   color:"var(--green)" },
      insufficient: { bg:"rgba(204,32,32,0.08)",  border:"rgba(204,32,32,0.3)",  color:"var(--red2)"  },
      not_holding:  { bg:"rgba(204,32,32,0.08)",  border:"rgba(204,32,32,0.3)",  color:"var(--red2)"  },
      error:        { bg:"rgba(255,184,0,0.06)",  border:"rgba(255,184,0,0.2)",  color:"var(--muted)" },
    };
    const s   = cfg[walletStatus] || cfg.checking;
    const msg = {
      checking:     "Checking your wallet...",
      eligible:     `✓ Eligible — holding $${walletInfo?.usdValue?.toFixed(2)} worth of $SOS`,
      insufficient: `✗ Not enough — you hold $${walletInfo?.usdValue?.toFixed(2)}, need $${MIN_USD}+`,
      not_holding:  "✗ This wallet doesn't hold any $SOS",
      error:        "Couldn't verify — check the address and try again",
    };

    return (
      <div style={{
        marginTop:8, padding:"10px 14px",
        background:s.bg, border:`1px solid ${s.border}`, borderRadius:8,
        display:"flex", alignItems:"center", gap:10,
      }}>
        {walletStatus === "checking" && (
          <div style={{
            width:12, height:12, borderRadius:"50%",
            border:"2px solid rgba(255,184,0,0.25)",
            borderTopColor:"var(--gold)",
            animation:"led-breathe 0.7s linear infinite",
            flexShrink:0,
          }}/>
        )}
        <p style={{
          fontFamily:"'Barlow',sans-serif",
          fontSize:12, color:s.color, lineHeight:1.5, margin:0,
        }}>{msg[walletStatus]}</p>
      </div>
    );
  };

  const canSubmit = walletStatus === "eligible" && !loading;

  // ── Label style ─────────────────────────────────────────────────────────
  const labelStyle = {
    display:"block", fontSize:11, letterSpacing:3,
    color:"var(--muted)", fontFamily:"'Oswald',sans-serif", marginBottom:7,
  };
  const hintStyle = {
    marginTop:5, fontSize:11, color:"var(--dim)", fontFamily:"'Barlow',sans-serif",
  };

  return (
    <div className="page" style={{
      minHeight:"100vh",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      padding:"100px 24px 60px",
    }}>

      {/* Spotlight */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        background:"radial-gradient(ellipse at 50% 0%, rgba(255,184,0,0.12) 0%, transparent 60%)",
      }}/>

      <div style={{
        position:"relative", zIndex:2,
        width:"100%", maxWidth:460,
        animation:"slide-up 0.6s ease both",
      }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ display:"flex", justifyContent:"center", gap:28, marginBottom:20 }}>
            <Orb type="SPLIT" size={76} animated={false}/>
            <Orb type="STEAL" size={76} animated={false}/>
          </div>
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:26, letterSpacing:"0.1em",
            background:"linear-gradient(135deg,#FFE566,#FFB800)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>
            {tab === "signin" ? "WELCOME BACK" : "JOIN THE GAME"}
          </h1>
          <p style={{ marginTop:8, fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)" }}>
            {tab === "signin"
              ? "Sign in and join the queue."
              : "Create your account. Hold $SOS to qualify."}
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
            <button key={key}
              onClick={() => { setTab(key); setError(""); }}
              style={{
                flex:1,
                background: tab===key ? "rgba(255,184,0,0.12)" : "none",
                border:     tab===key ? "1px solid rgba(255,184,0,0.25)" : "1px solid transparent",
                borderRadius:8, cursor:"pointer",
                fontFamily:"'Oswald',sans-serif",
                fontSize:13, fontWeight:600, letterSpacing:2,
                color: tab===key ? "var(--gold)" : "var(--muted)",
                padding:"10px", transition:"all 0.2s",
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
            <p className="error-text" style={{ margin:0 }}>{error}</p>
          </div>
        )}

        {/* ── SIGN IN ─────────────────────────────────────────────── */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn}
            style={{ display:"flex", flexDirection:"column", gap:16 }}>

            <div>
              <label style={labelStyle}>USERNAME</label>
              <input type="text" className="input-field"
                placeholder="your_username"
                value={siUsername}
                onChange={e => setSiUsername(e.target.value)}
                required autoComplete="username"/>
            </div>

            <div>
              <label style={labelStyle}>PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={siPass}
                onChange={e => setSiPass(e.target.value)}
                required autoComplete="current-password"/>
            </div>

            <button type="submit" className="btn-gold" disabled={loading}
              style={{ marginTop:6, fontSize:15, padding:"15px" }}>
              {loading ? "SIGNING IN..." : "SIGN IN →"}
            </button>
          </form>
        )}

        {/* ── SIGN UP ─────────────────────────────────────────────── */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp}
            style={{ display:"flex", flexDirection:"column", gap:14 }}>

            {/* Username */}
            <div>
              <label style={labelStyle}>USERNAME</label>
              <input type="text" className="input-field"
                placeholder="your_username"
                value={suUsername}
                onChange={e => setSuUsername(e.target.value)}
                required minLength={3} maxLength={20}
                autoComplete="username"/>
              <p style={hintStyle}>
                Letters, numbers, underscores. Your public identity in every duel.
              </p>
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}>PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={suPass}
                onChange={e => setSuPass(e.target.value)}
                required minLength={6}
                autoComplete="new-password"/>
            </div>

            {/* Confirm password */}
            <div>
              <label style={labelStyle}>CONFIRM PASSWORD</label>
              <input type="password" className="input-field"
                placeholder="••••••••"
                value={suPass2}
                onChange={e => setSuPass2(e.target.value)}
                required autoComplete="new-password"/>
            </div>

            {/* Wallet */}
            <div>
              <label style={labelStyle}>
                SOLANA WALLET ADDRESS
                {walletStatus === "eligible" && (
                  <span style={{ marginLeft:8, color:"var(--green)", fontSize:10 }}>
                    ● VERIFIED
                  </span>
                )}
              </label>
              <input type="text" className="input-field"
                placeholder="Paste your Solana wallet address"
                value={suWallet}
                onChange={e => setSuWallet(e.target.value)}
                required
                style={{
                  fontFamily:"'Share Tech Mono',monospace",
                  fontSize:12,
                  borderColor:
                    walletStatus === "eligible"    ? "rgba(0,200,83,0.4)"
                  : walletStatus === "insufficient" || walletStatus === "not_holding"
                                                   ? "rgba(204,32,32,0.4)"
                  : undefined,
                  boxShadow:
                    walletStatus === "eligible"    ? "0 0 0 3px rgba(0,200,83,0.06)"
                  : walletStatus === "insufficient" || walletStatus === "not_holding"
                                                   ? "0 0 0 3px rgba(204,32,32,0.06)"
                  : undefined,
                }}/>

              {walletStatusUI()}

              {walletStatus === "idle" && (
                <p style={hintStyle}>
                  Must hold $10+ worth of $SOS. Verified automatically when you paste your address.
                </p>
              )}
              {(walletStatus === "not_holding" || walletStatus === "insufficient") && (
                <p style={{ ...hintStyle, marginTop:8 }}>
                  Buy $SOS on pump.fun and come back once you're holding $10+.
                </p>
              )}
            </div>

            {/* Submit */}
            <button type="submit" className="btn-gold"
              disabled={!canSubmit}
              style={{
                marginTop:6, fontSize:15, padding:"15px",
                opacity: canSubmit ? 1 : 0.45,
                cursor:  canSubmit ? "pointer" : "not-allowed",
              }}>
              {loading              ? "CREATING ACCOUNT..."    :
               walletStatus === "checking" ? "VERIFYING WALLET..."   :
               walletStatus === "eligible" ? "CREATE ACCOUNT →"      :
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
              color:"var(--gold)", fontSize:13,
              fontFamily:"'Barlow',sans-serif",
              textDecoration:"underline",
            }}>
            {tab === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>

      </div>
    </div>
  );
}