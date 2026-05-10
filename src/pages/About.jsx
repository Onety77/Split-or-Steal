import Orb from "../components/Orb";

export default function About({ navigate }) {
  return (
    <div className="page" style={{ padding:"100px 0 80px" }}>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{
        position:"relative",
        padding:"80px 24px 100px",
        textAlign:"center",
        overflow:"hidden",
      }}>
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse at 50% 0%, rgba(255,184,0,0.12) 0%, transparent 65%)",
          pointerEvents:"none",
        }}/>
        <div style={{ position:"relative", zIndex:2, maxWidth:680, margin:"0 auto" }}>
          <div className="label" style={{ marginBottom:20 }}>THE STORY</div>
          <h1 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(36px,7vw,72px)",
            letterSpacing:"0.1em",
            background:"linear-gradient(160deg,#FFE566 0%,#FFB800 45%,#FF8C00 100%)",
            WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",
            lineHeight:1.05,
            marginBottom:24,
          }}>
            WHY WE BUILT<br/>SPLIT OR STEAL
          </h1>
          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:"clamp(15px,2vw,18px)",
            fontWeight:300,
            color:"var(--muted)",
            lineHeight:1.75,
          }}>
            Because trust is the most expensive thing in the world,
            and nobody has ever made you bet on it with real money — in public, on-chain,
            with a stranger — until now.
          </p>
        </div>
      </section>

      <div style={{ maxWidth:760, margin:"0 auto", padding:"0 24px" }}>

        {/* ── THE ORIGIN ────────────────────────────────────────── */}
        <section style={{ marginBottom:80 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:20,
            marginBottom:32,
          }}>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
            <div className="label" style={{ color:"var(--muted)", whiteSpace:"nowrap" }}>THE ORIGIN</div>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
          </div>

          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(24px,4vw,38px)",
            letterSpacing:"0.08em",
            color:"var(--text)",
            marginBottom:24,
          }}>It Started on British Television.</h2>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, fontWeight:400,
            color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            In 2007, a British game show called <em style={{ color:"var(--text)" }}>Golden Balls</em> introduced
            the world to something they didn't know they needed: a game where the only variable
            was another human being's character. No skill. No trivia. No physical challenge.
            Just you, a stranger, and a choice between two golden balls — one marked SPLIT,
            one marked STEAL.
          </p>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            The rules were brutal in their simplicity. Both split — you share the prize equally.
            One steals while the other splits — the stealer takes everything, the trusting player
            walks away with nothing. Both steal — nobody gets anything.
          </p>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
          }}>
            Episodes became viral before viral was even a word people used for television.
            The show ran until 2009 and was never quite replicated — because what it captured
            wasn't entertainment. It was something more primal. The moment when a person
            decides what kind of person they are.
          </p>
        </section>

        {/* ── THE PSYCHOLOGY ──────────────────────────────────────── */}
        <section style={{ marginBottom:80 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:20,
            marginBottom:32,
          }}>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
            <div className="label" style={{ color:"var(--muted)", whiteSpace:"nowrap" }}>THE PSYCHOLOGY</div>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
          </div>

          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(24px,4vw,38px)",
            letterSpacing:"0.08em",
            color:"var(--text)",
            marginBottom:24,
          }}>Game Theory Made Human.</h2>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            Economists call it the Prisoner's Dilemma — a thought experiment designed to show
            why rational individuals don't always cooperate, even when cooperation produces
            the best collective outcome. The math is cold and logical. But Golden Balls proved
            that humans aren't cold or logical when money is on the line and someone is looking
            at them from across a table.
          </p>

          {/* Quote block */}
          <div style={{
            margin:"32px 0",
            padding:"28px 32px",
            borderLeft:"3px solid var(--gold)",
            background:"rgba(255,184,0,0.04)",
          }}>
            <p style={{
              fontFamily:"'Barlow',sans-serif",
              fontSize:18, fontStyle:"italic",
              color:"var(--text)", lineHeight:1.7,
              marginBottom:12,
            }}>
              "I'm going to choose STEAL — but here's what I want you to do.
              I want you to choose STEAL too. And then I promise I'll split the money with you
              after the show."
            </p>
            <p style={{ fontSize:12, color:"var(--muted)", letterSpacing:2, fontFamily:"'Oswald',sans-serif" }}>
              — NICK CORRIGAN, GOLDEN BALLS, 2012. THE MOST FAMOUS SPLIT OR STEAL MOMENT EVER RECORDED.
            </p>
          </div>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            Nick's opponent chose STEAL. Then Nick, true to his word, chose STEAL — because
            he knew if he showed SPLIT, the other person would betray him. He broke the game
            by reframing it entirely. His opponent, forced into a corner by the promise of a
            post-show split, also chose STEAL — and both walked away with nothing.
            It was genius, madness, and philosophy all at once.
          </p>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
          }}>
            That's what makes this game extraordinary. It exposes the gap between what people
            <em style={{ color:"var(--text)" }}> say</em> they'll do and what they <em style={{ color:"var(--text)" }}>actually</em> do.
            It turns character into a wager.
          </p>
        </section>

        {/* ── WHY ON-CHAIN ───────────────────────────────────────── */}
        <section style={{ marginBottom:80 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:20,
            marginBottom:32,
          }}>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
            <div className="label" style={{ color:"var(--muted)", whiteSpace:"nowrap" }}>WHY ON-CHAIN</div>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
          </div>

          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(24px,4vw,38px)",
            letterSpacing:"0.08em",
            color:"var(--text)",
            marginBottom:24,
          }}>Because Trust Deserves a Ledger.</h2>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            Television is controlled. The outcomes are edited. The producers decide what you see.
            The money isn't always what it appears to be. There's an invisible layer between you
            and the truth of what happened.
          </p>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
            marginBottom:20,
          }}>
            On-chain, there is no invisible layer. Every vote is recorded. Every transfer is
            public. Every betrayal is permanent. You can't edit the blockchain. You can't
            claim you chose SPLIT when you chose STEAL — the entire world can verify it
            with a wallet address and fifteen seconds.
          </p>

          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)", lineHeight:1.85,
          }}>
            We built $SOS because we believe this game belongs on-chain. Not because of the money —
            though the money makes it real. But because the ledger is the most honest audience
            that has ever existed. It doesn't care about your explanation. It just records what you did.
          </p>
        </section>

        {/* ── THE THREE OUTCOMES ──────────────────────────────────── */}
        <section style={{ marginBottom:80 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:20,
            marginBottom:32,
          }}>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
            <div className="label" style={{ color:"var(--muted)", whiteSpace:"nowrap" }}>THE OUTCOMES</div>
            <div style={{ flex:1, height:1, background:"var(--border)" }}/>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {/* BOTH SPLIT */}
            <div style={{
              padding:"28px",
              background:"rgba(0,200,83,0.05)",
              border:"1px solid rgba(0,200,83,0.2)",
              borderRadius:14,
            }}>
              <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:14 }}>
                <div style={{ display:"flex", gap:8 }}>
                  <Orb type="SPLIT" size={52} animated={false}/>
                  <Orb type="SPLIT" size={52} animated={false}/>
                </div>
                <div style={{
                  fontFamily:"'Russo One',sans-serif",
                  fontSize:18, color:"var(--green)", letterSpacing:2,
                }}>BOTH SPLIT</div>
              </div>
              <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", lineHeight:1.7 }}>
                The rare outcome. Both players trusted each other — or calculated that cooperation
                was their best shot. The pot splits equally. Everyone walks away with something.
                This is the outcome that restores your faith in people, briefly.
              </p>
            </div>

            {/* BETRAYAL */}
            <div style={{
              padding:"28px",
              background:"rgba(204,32,32,0.05)",
              border:"1px solid rgba(204,32,32,0.2)",
              borderRadius:14,
            }}>
              <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:14 }}>
                <div style={{ display:"flex", gap:8 }}>
                  <Orb type="STEAL" size={52} animated={false}/>
                  <Orb type="SPLIT" size={52} animated={false}/>
                </div>
                <div style={{
                  fontFamily:"'Russo One',sans-serif",
                  fontSize:18, color:"var(--red2)", letterSpacing:2,
                }}>BETRAYAL</div>
              </div>
              <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", lineHeight:1.7 }}>
                The defining outcome. One player trusted. One player stole. The stealer takes
                the entire pot. The trusting player gets nothing. This is the outcome that gets
                posted, discussed, argued about. The betrayer's address lives on the ledger forever.
              </p>
            </div>

            {/* BOTH STEAL */}
            <div style={{
              padding:"28px",
              background:"rgba(69,90,100,0.08)",
              border:"1px solid rgba(96,125,139,0.25)",
              borderRadius:14,
            }}>
              <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:14 }}>
                <div style={{ display:"flex", gap:8 }}>
                  <Orb type="STEAL" size={52} animated={false}/>
                  <Orb type="STEAL" size={52} animated={false}/>
                </div>
                <div style={{
                  fontFamily:"'Russo One',sans-serif",
                  fontSize:18, color:"#90A4AE", letterSpacing:2,
                }}>BOTH STEAL</div>
              </div>
              <p style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"var(--muted)", lineHeight:1.7 }}>
                The philosophical outcome. Neither player trusted the other. Both reached for
                everything — and got nothing. The pot carries over. Greed, left unchecked,
                destroys the very thing it reaches for.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <section style={{ textAlign:"center", paddingBottom:40 }}>
          <div style={{
            display:"flex", justifyContent:"center", gap:48,
            marginBottom:32,
          }}>
            <Orb type="SPLIT" size={130} animated={true}/>
            <Orb type="STEAL" size={130} animated={true}/>
          </div>
          <h2 style={{
            fontFamily:"'Russo One',sans-serif",
            fontSize:"clamp(24px,4vw,38px)",
            letterSpacing:"0.08em",
            color:"var(--text)",
            marginBottom:12,
          }}>WHAT WOULD YOU DO?</h2>
          <p style={{
            fontFamily:"'Barlow',sans-serif",
            fontSize:16, color:"var(--muted)",
            marginBottom:32, lineHeight:1.7,
          }}>
            Easy to say from the outside. Different when the money is real,
            the clock is running, and a stranger is typing their opening argument.
          </p>
          <button onClick={() => navigate("queue")} className="btn-gold"
            style={{ fontSize:16, padding:"16px 48px" }}>
            JOIN THE QUEUE
          </button>
        </section>

      </div>
    </div>
  );
}
