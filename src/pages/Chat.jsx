import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, serverTimestamp, doc, onSnapshot as onSnap,
  setDoc, deleteDoc, where, getDocs,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const ADMIN_USER    = "admin77";
const MAX_LENGTH    = 280;
const RATE_LIMIT_MS = 3000; // 3 seconds between messages
const MESSAGES_LIMIT= 120;

const timeStr = (ts) => {
  if (!ts) return "";
  const d = new Date(ts.toMillis());
  return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
};

const timeAgo = (ts) => {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  return Math.floor(s/3600) + "h ago";
};

// Color from username — deterministic
function usernameColor(username) {
  const colors = ["#FFB800","#00C853","#FF6B35","#7B61FF","#00BCD4","#FF4081","#69F0AE","#FF8A65"];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ username, size = 32 }) {
  const color = usernameColor(username);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: color + "22",
      border: "1.5px solid " + color + "55",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Russo One',sans-serif",
      fontSize: size * 0.38,
      color: color,
      userSelect: "none",
    }}>
      {username.slice(0,1).toUpperCase()}
    </div>
  );
}

function PinnedBanner({ message, onDismiss, isAdmin }) {
  if (!message) return null;
  return (
    <div style={{
      padding: "10px 16px",
      background: "rgba(255,184,0,0.08)",
      borderBottom: "1px solid rgba(255,184,0,0.15)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 12, color: "var(--gold)", flexShrink: 0 }}>📌</span>
      <span style={{ fontFamily: "'Barlow',sans-serif", fontSize: 13, color: "var(--muted)", flex: 1, lineHeight: 1.4 }}>
        <strong style={{ color: "var(--gold)", fontWeight: 600 }}>Pinned: </strong>{message}
      </span>
      {isAdmin && (
        <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dim)", fontSize: 14, flexShrink: 0 }}>×</button>
      )}
    </div>
  );
}

export default function Chat({ navigate }) {
  const { user, profile } = useAuth();

  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [pinnedMsg,   setPinnedMsg]   = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unread,      setUnread]      = useState(0);
  const [stats,       setStats]       = useState(null);

  const chatEndRef    = useRef(null);
  const chatBodyRef   = useRef(null);
  const lastSentRef   = useRef(0);
  const isAtBottomRef = useRef(true);
  const isAdmin       = profile?.username === ADMIN_USER;

  // Live messages
  useEffect(() => {
    const q = query(
      collection(db, "sos_chat"),
      orderBy("timestamp", "asc"),
      limit(MESSAGES_LIMIT)
    );
    return onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
      if (isAtBottomRef.current) {
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        setUnread(p => p + 1);
      }
    });
  }, []);

  // Pinned message
  useEffect(() => {
    return onSnapshot(doc(db, "sos_stats", "global"), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setStats(d);
      setPinnedMsg(d.pinnedMessage || "");
    });
  }, []);

  // Online presence — write heartbeat every 30s
  useEffect(() => {
    if (!user || !profile) return;
    const presenceRef = doc(db, "sos_presence", user.uid);

    const write = () => setDoc(presenceRef, {
      uid:       user.uid,
      username:  profile.username,
      lastSeen:  serverTimestamp(),
    }, { merge: true });

    write();
    const id = setInterval(write, 30000);

    return () => {
      clearInterval(id);
      deleteDoc(presenceRef).catch(() => {});
    };
  }, [user, profile]);

  // Online count — presence docs updated in last 2 minutes
  useEffect(() => {
    const q = query(collection(db, "sos_presence"));
    return onSnapshot(q, snap => {
      const cutoff = Date.now() - 2 * 60 * 1000;
      const active = snap.docs.filter(d => {
        const ls = d.data().lastSeen;
        return ls && ls.toMillis() > cutoff;
      });
      setOnlineCount(active.length);
    });
  }, []);

  // Scroll detection
  const handleScroll = () => {
    const el = chatBodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setUnread(0);
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnread(0);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !user || !profile || sending) return;

    const now = Date.now();
    if (now - lastSentRef.current < RATE_LIMIT_MS) return;
    lastSentRef.current = now;

    setInput("");
    setSending(true);
    try {
      await addDoc(collection(db, "sos_chat"), {
        uid:       user.uid,
        username:  profile.username,
        text,
        timestamp: serverTimestamp(),
        isAdmin:   isAdmin,
      });
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  const pinMessage = async (text) => {
    if (!isAdmin) return;
    await setDoc(doc(db, "sos_stats", "global"), { pinnedMessage: text }, { merge: true });
  };

  const dismissPin = async () => {
    if (!isAdmin) return;
    await setDoc(doc(db, "sos_stats", "global"), { pinnedMessage: "" }, { merge: true });
  };

  const charCount    = input.length;
  const charOver     = charCount > MAX_LENGTH;
  const canSend      = input.trim().length > 0 && !charOver && user && !sending;
  const currentPot   = stats?.currentPotSOL;
  const activeDuel   = stats?.activeDuel;

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", height: "100vh", paddingTop: 65 }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: "12px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div>
          <h2 style={{ fontFamily: "'Russo One',sans-serif", fontSize: 20, letterSpacing: "0.08em", color: "var(--text)", margin: 0 }}>
            COMMUNITY CHAT
          </h2>
          <div style={{ fontFamily: "'Barlow',sans-serif", fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            Talk about the duels, the betrayals, everything.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {/* Online count */}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)", animation: "led-breathe 2s ease-in-out infinite" }}/>
            <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 11, letterSpacing: 2, color: "var(--muted)" }}>
              {onlineCount} ONLINE
            </span>
          </div>
          {/* Live duel pill */}
          {activeDuel && (
            <button onClick={() => navigate("home")} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px",
              background: "rgba(255,184,0,0.1)",
              border: "1px solid rgba(255,184,0,0.25)",
              borderRadius: 20, cursor: "pointer",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gold)", animation: "led-breathe 1s ease-in-out infinite" }}/>
              <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 10, letterSpacing: 2, color: "var(--gold)" }}>LIVE DUEL</span>
            </button>
          )}
          {/* Pot */}
          {currentPot != null && (
            <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 14, color: "var(--gold)" }}>
              ◎ {currentPot.toFixed(4)}
            </div>
          )}
        </div>
      </div>

      {/* ── PINNED ── */}
      <PinnedBanner message={pinnedMsg} onDismiss={dismissPin} isAdmin={isAdmin}/>

      {/* ── CHAT BODY ── */}
      <div
        ref={chatBodyRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: "auto",
          padding: "16px 0",
          display: "flex", flexDirection: "column",
        }}>

        {/* Welcome message */}
        <div style={{ textAlign: "center", padding: "24px 24px 8px" }}>
          <div style={{ fontFamily: "'Russo One',sans-serif", fontSize: 28, color: "rgba(255,184,0,0.15)", marginBottom: 8 }}>⚔️</div>
          <p style={{ fontFamily: "'Barlow',sans-serif", fontSize: 13, color: "var(--dim)", lineHeight: 1.6 }}>
            Welcome to the $SOS community. Be real. Talk your game theory.
          </p>
        </div>

        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--dim)", fontFamily: "'Barlow',sans-serif", fontSize: 13, fontStyle: "italic" }}>
            No messages yet. Say something.
          </div>
        )}

        {/* Messages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px" }}>
          {messages.map((m, i) => {
            const isMe     = user && m.uid === user.uid;
            const prevMsg  = messages[i - 1];
            const sameUser = prevMsg && prevMsg.uid === m.uid;
            const color    = usernameColor(m.username);
            const showHead = !sameUser;

            return (
              <div key={m.id} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: showHead ? "8px 8px 2px" : "1px 8px 2px",
                borderRadius: 8,
                transition: "background 0.15s",
                animation: "chat-in 0.25s ease",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                {/* Avatar / spacer */}
                <div style={{ width: 36, flexShrink: 0 }}>
                  {showHead && <Avatar username={m.username} size={36}/>}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {showHead && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                      <span style={{
                        fontFamily: "'Oswald',sans-serif", fontSize: 13, fontWeight: 700,
                        color: m.isAdmin ? "var(--gold)" : color,
                        letterSpacing: 0.5,
                      }}>
                        {m.username}
                        {m.isAdmin && (
                          <span style={{ fontFamily: "'Barlow',sans-serif", fontSize: 10, background: "rgba(255,184,0,0.15)", border: "1px solid rgba(255,184,0,0.25)", borderRadius: 4, padding: "1px 5px", marginLeft: 6, color: "var(--gold)", letterSpacing: 1, fontWeight: 600 }}>
                            ADMIN
                          </span>
                        )}
                        {isMe && (
                          <span style={{ fontFamily: "'Barlow',sans-serif", fontSize: 10, color: "var(--dim)", marginLeft: 6, fontWeight: 400 }}>
                            (you)
                          </span>
                        )}
                      </span>
                      <span style={{ fontFamily: "'Barlow',sans-serif", fontSize: 11, color: "var(--dim)" }}>
                        {timeStr(m.timestamp)}
                      </span>
                    </div>
                  )}
                  <p style={{
                    fontFamily: "'Barlow',sans-serif", fontSize: 14,
                    color: "var(--text)", lineHeight: 1.55, margin: 0,
                    wordBreak: "break-word",
                  }}>
                    {m.text}
                  </p>
                </div>

                {/* Admin pin button */}
                {isAdmin && (
                  <button onClick={() => pinMessage(m.text)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dim)", fontSize: 12, flexShrink: 0, opacity: 0, transition: "opacity 0.2s", padding: "2px 4px" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0"}
                    title="Pin this message">📌</button>
                )}
              </div>
            );
          })}
        </div>

        <div ref={chatEndRef} style={{ height: 8 }}/>
      </div>

      {/* ── SCROLL TO BOTTOM BUTTON ── */}
      {showScrollBtn && (
        <button onClick={scrollToBottom} style={{
          position: "absolute", bottom: 90, right: 24,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 20, cursor: "pointer",
          padding: "7px 14px",
          display: "flex", alignItems: "center", gap: 7,
          fontFamily: "'Oswald',sans-serif", fontSize: 11, letterSpacing: 2, color: "var(--muted)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          zIndex: 10,
        }}>
          {unread > 0 && (
            <span style={{ background: "var(--red2)", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{unread}</span>
          )}
          ↓ NEW MESSAGES
        </button>
      )}

      {/* ── INPUT ── */}
      <div style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        padding: "12px 16px",
        flexShrink: 0,
      }}>
        {!user ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontFamily: "'Barlow',sans-serif", fontSize: 13, color: "var(--muted)" }}>
              Sign in to join the conversation.
            </span>
            <button onClick={() => navigate("auth")} className="btn-gold" style={{ fontSize: 12, padding: "9px 20px" }}>SIGN IN</button>
          </div>
        ) : (
          <form onSubmit={sendMessage}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <Avatar username={profile?.username || "?"} size={34}/>
              <div style={{ flex: 1, position: "relative" }}>
                <textarea
                  className="input-field"
                  placeholder={"What's on your mind, " + (profile?.username || "") + "?"}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (canSend) sendMessage(e);
                    }
                  }}
                  rows={1}
                  style={{
                    width: "100%", resize: "none",
                    padding: "10px 14px",
                    fontSize: 14, lineHeight: 1.5,
                    borderColor: charOver ? "rgba(204,32,32,0.4)" : undefined,
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                />
                {charCount > MAX_LENGTH * 0.7 && (
                  <div style={{
                    position: "absolute", right: 10, bottom: 8,
                    fontFamily: "'Space Tech Mono',monospace",
                    fontSize: 10,
                    color: charOver ? "var(--red2)" : "var(--dim)",
                  }}>
                    {MAX_LENGTH - charCount}
                  </div>
                )}
              </div>
              <button type="submit" disabled={!canSend} style={{
                background: canSend ? "var(--goldDim)" : "rgba(255,255,255,0.03)",
                border: "1px solid " + (canSend ? "var(--goldBorder)" : "var(--border)"),
                borderRadius: 8, cursor: canSend ? "pointer" : "default",
                color: canSend ? "var(--gold)" : "var(--dim)",
                fontFamily: "'Oswald',sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1,
                padding: "10px 18px", flexShrink: 0,
                transition: "all 0.2s",
              }}>
                {sending ? "..." : "SEND"}
              </button>
            </div>
            <div style={{ marginTop: 6, paddingLeft: 44, fontFamily: "'Barlow',sans-serif", fontSize: 11, color: "var(--dim)" }}>
              Enter to send · Shift+Enter for new line
            </div>
          </form>
        )}
      </div>
    </div>
  );
}