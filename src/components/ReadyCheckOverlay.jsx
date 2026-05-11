import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

function playReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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

function sendBrowserNotification(potSOL) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const potStr = potSOL ? " — ◎" + potSOL.toFixed(4) + " at stake" : "";
    new Notification("⚔️ It's your turn — $SOS", {
      body: "Click READY to enter the duel room" + potStr + ".",
      icon: "/logo.png",
      requireInteraction: true,
    });
  } catch {}
}

export async function requestNotificationPermission() {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch { return false; }
}

const RR = 70;
const CC = 2 * Math.PI * RR;

function BigRing({ seconds }) {
  const pct    = Math.max(0, seconds / 90);
  const offset = CC * (1 - pct);
  const urgent = seconds <= 20;
  return (
    <div style={{ position:"relative", width:160, height:160 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform:"rotate(-90deg)" }}>
        <defs>
          <linearGradient id="rcg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={urgent ? "#FF3333" : "#FF8C00"}/>
            <stop offset="100%" stopColor={urgent ? "#FF9999" : "#FFE566"}/>
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={RR} fill="none" stroke="rgba(255,184,0,0.08)" strokeWidth="4"/>
        <circle cx="80" cy="80" r={RR} fill="none" stroke="url(#rcg)" strokeWidth="4"
          strokeLinecap="round" strokeDasharray={CC} strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 1s linear" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:42, lineHeight:1, color: urgent ? "var(--red2)" : "var(--gold)", animation: urgent ? "countdown-urgent 0.8s ease infinite" : "none" }}>{seconds}</span>
        <span style={{ fontSize:9, letterSpacing:4, color:"var(--muted)", marginTop:4 }}>SECONDS</span>
      </div>
    </div>
  );
}

export default function ReadyCheckOverlay({ navigate }) {
  const { user } = useAuth();

  const [entry,        setEntry]        = useState(null);
  const [potSOL,       setPotSOL]       = useState(null);
  const [seconds,      setSeconds]      = useState(90);
  const [readyLoading, setReadyLoading] = useState(false);

  const soundFired = useRef(false);
  const timerRef   = useRef(null);

  // Listen to global stats for current pot
  useEffect(() => {
    return onSnapshot(doc(db, "sos_stats", "global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setPotSOL(d.currentPotSOL ?? null);
    });
  }, []);

  // Listen to user's queue entry
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "sos_queue", user.uid), (snap) => {
      if (!snap.exists()) {
        setEntry(null);
        soundFired.current = false;
        return;
      }
      const data = { id: snap.id, ...snap.data() };
      setEntry(data);

      if (data.status === "ready_check" && !soundFired.current) {
        soundFired.current = true;
        playReadySound();
        sendBrowserNotification(potSOL);
        if (data.readyCheckEndsAt) {
          const ms = data.readyCheckEndsAt.toMillis() - Date.now();
          setSeconds(Math.max(0, Math.floor(ms / 1000)));
        } else {
          setSeconds(90);
        }
      }

      if (data.status !== "ready_check" && data.status !== "ready") {
        soundFired.current = false;
      }

      // Navigate to duel room the instant engine sets us to in_duel
      if (data.status === "in_duel" && data.currentDuelId) {
        navigate("duel");
      }
    });
  }, [user, navigate, potSOL]);

  // Countdown ticker
  useEffect(() => {
    if (entry?.status !== "ready_check") {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSeconds(p => Math.max(0, p - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [entry?.status]);

  const clickReady = async () => {
    if (!user || readyLoading) return;
    setReadyLoading(true);
    try {
      await updateDoc(doc(db, "sos_queue", user.uid), { status: "ready" });
    } catch (e) { console.error(e); }
    finally { setReadyLoading(false); }
  };

  const leaveQueue = async () => {
    if (!user) return;
    try { await deleteDoc(doc(db, "sos_queue", user.uid)); } catch {}
  };

  if (!entry || (entry.status !== "ready_check" && entry.status !== "ready")) return null;

  const isReadyCheck = entry.status === "ready_check";

  const fmtSOL = (n) => (!n && n !== 0) ? null : n.toFixed(4);
  const potStr = fmtSOL(potSOL);

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(8,6,4,0.97)",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      padding:"24px",
      animation:"fade-in 0.3s ease",
    }}>
      <div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle, rgba(255,184,0,0.18) 0%, transparent 70%)", animation:"glow-gold 2s ease-in-out infinite", pointerEvents:"none" }}/>

      <div style={{ position:"relative", zIndex:2, textAlign:"center", maxWidth:420, width:"100%" }}>

        {/* ── READY CHECK ── */}
        {isReadyCheck && (
          <>
            <div style={{ fontSize:64, marginBottom:16, animation:"winner-burst 0.6s ease" }}>⚔️</div>
            <h2 style={{ fontFamily:"'Russo One',sans-serif", fontSize:"clamp(28px,7vw,48px)", letterSpacing:"0.08em", color:"var(--gold)", marginBottom:12, animation:"countdown-urgent 2s ease infinite" }}>
              YOU'RE UP!
            </h2>

            {/* SOL at stake */}
            {potStr && (
              <div style={{
                display:"inline-flex", alignItems:"center", gap:10,
                padding:"10px 24px",
                background:"rgba(255,184,0,0.08)",
                border:"1px solid rgba(255,184,0,0.25)",
                borderRadius:30,
                marginBottom:20,
              }}>
                <span style={{ fontFamily:"'Oswald',sans-serif", fontSize:11, letterSpacing:3, color:"var(--muted)" }}>AT STAKE</span>
                <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:22, color:"var(--gold)" }}>◎ {potStr}</span>
              </div>
            )}

            <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:15, color:"var(--muted)", lineHeight:1.65, marginBottom:28, maxWidth:340, margin:"0 auto 28px" }}>
              Click READY to lock in and enter the duel room.
            </p>

            <div style={{ display:"flex", justifyContent:"center", marginBottom:28 }}>
              <BigRing seconds={seconds}/>
            </div>

            <button onClick={clickReady} disabled={readyLoading} style={{
              background:"linear-gradient(135deg,#FF8C00,#FFB800)",
              border:"none", borderRadius:12, color:"#000",
              cursor:"pointer",
              fontFamily:"'Russo One',sans-serif",
              fontSize:"clamp(18px,5vw,26px)",
              letterSpacing:"0.1em",
              padding:"18px 56px",
              width:"100%", maxWidth:340,
              transition:"all 0.2s",
              boxShadow:"0 0 32px rgba(255,184,0,0.4)",
              animation:"glow-gold 2s ease-in-out infinite",
              marginBottom:20,
            }}>
              {readyLoading ? "..." : "⚔️  I'M READY"}
            </button>

            <p style={{ fontSize:12, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
              Can't play?{" "}
              <button onClick={leaveQueue} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--red2)", fontSize:12, fontFamily:"'Barlow',sans-serif", textDecoration:"underline" }}>
                Leave the queue
              </button>
            </p>
          </>
        )}

        {/* ── READY — waiting for opponent ── */}
        {!isReadyCheck && (
          <>
            <div style={{ fontSize:64, marginBottom:20 }}>✅</div>
            <h2 style={{ fontFamily:"'Russo One',sans-serif", fontSize:"clamp(24px,6vw,40px)", letterSpacing:"0.08em", color:"var(--green)", marginBottom:12 }}>
              YOU'RE IN!
            </h2>

            {potStr && (
              <div style={{
                display:"inline-flex", alignItems:"center", gap:10,
                padding:"8px 20px",
                background:"rgba(0,200,83,0.08)",
                border:"1px solid rgba(0,200,83,0.2)",
                borderRadius:30,
                marginBottom:20,
              }}>
                <span style={{ fontFamily:"'Oswald',sans-serif", fontSize:11, letterSpacing:3, color:"var(--muted)" }}>FIGHTING FOR</span>
                <span style={{ fontFamily:"'Russo One',sans-serif", fontSize:22, color:"var(--green)" }}>◎ {potStr}</span>
              </div>
            )}

            <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:16, color:"var(--muted)", lineHeight:1.65, marginBottom:32 }}>
              Waiting for your opponent to click READY.<br/>
              The duel room opens automatically.
            </p>

            <div style={{ display:"flex", justifyContent:"center", gap:10, marginBottom:32 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width:12, height:12, borderRadius:"50%", background:"var(--gold)", animation:"led-breathe 1.2s ease-in-out " + (i*0.3) + "s infinite" }}/>
              ))}
            </div>

            <p style={{ fontSize:12, color:"var(--dim)", fontFamily:"'Barlow',sans-serif" }}>
              Changed your mind?{" "}
              <button onClick={leaveQueue} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--red2)", fontSize:12, fontFamily:"'Barlow',sans-serif", textDecoration:"underline" }}>
                Leave the queue
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}