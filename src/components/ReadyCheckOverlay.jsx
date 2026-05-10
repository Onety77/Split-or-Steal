import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

// ── Audio: three ascending tones using Web Audio API ──────────────────────
function playReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // C - E - G ascending, game-show feel
    [523, 659, 784].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.04);
      gain.gain.linearRampToValueAtTime(0, t + 0.38);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {}
}

// ── Browser notification ───────────────────────────────────────────────────
function sendBrowserNotification() {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification("⚔️ It's your turn — $SOS", {
      body: "You have 90 seconds to click READY and enter the duel room.",
      icon: "/logo.png",
      requireInteraction: true, // stays until user dismisses
    });
  } catch {}
}

// ── Request permission (called externally when user joins queue) ───────────
export async function requestNotificationPermission() {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

// ── Countdown ring ─────────────────────────────────────────────────────────
const RR = 70;
const CC = 2 * Math.PI * RR;

function BigRing({ seconds }) {
  const total  = 90;
  const pct    = Math.max(0, seconds / total);
  const offset = CC * (1 - pct);
  const urgent = seconds <= 20;

  return (
    <div style={{ position:"relative", width:160, height:160 }}>
      <svg width="160" height="160" viewBox="0 0 160 160"
        style={{ transform:"rotate(-90deg)" }}>
        <defs>
          <linearGradient id="rcg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={urgent ? "#FF3333" : "#FF8C00"}/>
            <stop offset="100%" stopColor={urgent ? "#FF9999" : "#FFE566"}/>
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={RR} fill="none"
          stroke="rgba(255,184,0,0.08)" strokeWidth="4"/>
        <circle cx="80" cy="80" r={RR} fill="none"
          stroke="url(#rcg)" strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CC}
          strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{
        position:"absolute", inset:0,
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
      }}>
        <span style={{
          fontFamily:"'Russo One',sans-serif",
          fontSize:42, lineHeight:1,
          color: urgent ? "var(--red2)" : "var(--gold)",
          animation: urgent ? "countdown-urgent 0.8s ease infinite" : "none",
        }}>{seconds}</span>
        <span style={{ fontSize:9, letterSpacing:4, color:"var(--muted)", marginTop:4 }}>
          SECONDS
        </span>
      </div>
    </div>
  );
}

// ── Main overlay component ─────────────────────────────────────────────────
export default function ReadyCheckOverlay() {
  const { user } = useAuth();

  const [entry,        setEntry]        = useState(null);
  const [seconds,      setSeconds]      = useState(90);
  const [readyLoading, setReadyLoading] = useState(false);
  const [alreadyFired, setAlreadyFired] = useState(false);

  const timerRef    = useRef(null);
  const soundFired  = useRef(false);

  // Listen to user's queue entry
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "sos_queue", user.uid), (snap) => {
      if (!snap.exists()) {
        setEntry(null);
        soundFired.current = false;
        setAlreadyFired(false);
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      setEntry(data);

      if (data.status === "ready_check" && !soundFired.current) {
        soundFired.current = true;

        // Play sound
        playReadySound();

        // Browser notification
        sendBrowserNotification();

        // Set initial countdown from Firestore deadline
        if (data.readyCheckEndsAt) {
          const ms  = data.readyCheckEndsAt.toMillis() - Date.now();
          setSeconds(Math.max(0, Math.floor(ms / 1000)));
        } else {
          setSeconds(90);
        }
      }

      // Reset sound flag when no longer in ready_check
      if (data.status !== "ready_check") {
        soundFired.current = false;
      }
    });
  }, [user]);

  // Countdown ticker
  useEffect(() => {
    if (entry?.status !== "ready_check") {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSeconds(p => {
        if (p <= 1) { clearInterval(timerRef.current); return 0; }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [entry?.status]);

  const clickReady = async () => {
    if (!user || readyLoading || seconds <= 0) return;
    setReadyLoading(true);
    try {
      await updateDoc(doc(db, "sos_queue", user.uid), { status: "ready" });
    } catch (e) {
      console.error(e);
    } finally {
      setReadyLoading(false);
    }
  };

  const leaveQueue = async () => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "sos_queue", user.uid));
    } catch {}
  };

  // Only show when status is ready_check
  if (!entry || entry.status !== "ready_check") return null;

  const isReady   = entry.status === "ready";
  const isExpired = seconds <= 0;

  return (
    <div style={{
      position:  "fixed",
      inset:     0,
      zIndex:    1000,
      background:"rgba(8,6,4,0.97)",
      display:   "flex",
      flexDirection:"column",
      alignItems:"center",
      justifyContent:"center",
      padding:   "24px",
      animation: "fade-in 0.3s ease",
    }}>

      {/* Pulsing gold glow behind ring */}
      <div style={{
        position:     "absolute",
        width:        320,
        height:       320,
        borderRadius: "50%",
        background:   "radial-gradient(circle, rgba(255,184,0,0.18) 0%, transparent 70%)",
        animation:    "glow-gold 2s ease-in-out infinite",
        pointerEvents:"none",
      }}/>

      <div style={{
        position:   "relative",
        zIndex:     2,
        textAlign:  "center",
        maxWidth:   420,
        width:      "100%",
      }}>

        {/* Icon */}
        <div style={{
          fontSize:   64,
          marginBottom:16,
          animation:  "winner-burst 0.6s ease",
        }}>⚔️</div>

        {/* Title */}
        <h2 style={{
          fontFamily:   "'Russo One',sans-serif",
          fontSize:     "clamp(28px,7vw,48px)",
          letterSpacing:"0.08em",
          color:        "var(--gold)",
          marginBottom: 10,
          animation:    "countdown-urgent 2s ease infinite",
        }}>YOU'RE UP!</h2>

        {/* Subtitle */}
        <p style={{
          fontFamily:   "'Barlow',sans-serif",
          fontSize:     15,
          color:        "var(--muted)",
          lineHeight:   1.65,
          marginBottom: 32,
          maxWidth:     340,
          margin:       "0 auto 32px",
        }}>
          Your duel is starting. Click READY to enter the room
          and open the chat with your opponent.
        </p>

        {/* Ring */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:32 }}>
          <BigRing seconds={seconds}/>
        </div>

        {/* Ready / already ready state */}
        {entry.status === "ready" ? (
          <div style={{
            padding:    "18px 40px",
            background: "rgba(0,200,83,0.1)",
            border:     "1px solid rgba(0,200,83,0.3)",
            borderRadius:12,
            fontFamily: "'Russo One',sans-serif",
            fontSize:   18,
            color:      "var(--green)",
            letterSpacing:2,
            marginBottom:20,
          }}>
            READY ✓ — WAITING FOR OPPONENT
          </div>
        ) : isExpired ? (
          <div style={{
            padding:    "18px 40px",
            background: "rgba(204,32,32,0.1)",
            border:     "1px solid rgba(204,32,32,0.3)",
            borderRadius:12,
            fontFamily: "'Russo One',sans-serif",
            fontSize:   18,
            color:      "var(--red2)",
            letterSpacing:2,
            marginBottom:20,
          }}>
            TIME'S UP
          </div>
        ) : (
          <button
            onClick={clickReady}
            disabled={readyLoading}
            style={{
              background:   "linear-gradient(135deg,#FF8C00,#FFB800)",
              border:       "none",
              borderRadius: 12,
              color:        "#000",
              cursor:       "pointer",
              fontFamily:   "'Russo One',sans-serif",
              fontSize:     "clamp(18px,5vw,26px)",
              letterSpacing:"0.1em",
              padding:      "18px 56px",
              width:        "100%",
              maxWidth:     340,
              transition:   "all 0.2s",
              boxShadow:    "0 0 32px rgba(255,184,0,0.4)",
              animation:    "glow-gold 2s ease-in-out infinite",
              marginBottom: 20,
            }}
            onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
            onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
          >
            {readyLoading ? "..." : "⚔️  I'M READY"}
          </button>
        )}

        {/* Leave option */}
        {!isExpired && entry.status !== "ready" && (
          <p style={{
            fontSize:   12,
            color:      "var(--dim)",
            fontFamily: "'Barlow',sans-serif",
          }}>
            Can't play right now?{" "}
            <button onClick={leaveQueue} style={{
              background:    "none",
              border:        "none",
              cursor:        "pointer",
              color:         "var(--red2)",
              fontSize:      12,
              fontFamily:    "'Barlow',sans-serif",
              textDecoration:"underline",
            }}>Leave the queue</button>
          </p>
        )}

      </div>
    </div>
  );
}