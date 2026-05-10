export default function Orb({
  type,
  size = 200,
  animated = true,
  selected = false,
  disabled = false,
  onClick,
  revealed = false,
}) {
  const isSteal  = type === "STEAL";
  const primary  = isSteal ? "#CC2020"  : "#FFB800";
  const highlight= isSteal ? "#FF6666"  : "#FFE566";
  const darkC    = isSteal ? "#770000"  : "#CC7700";
  const glowAnim = isSteal ? "glow-red" : "glow-gold";
  const floatDly = isSteal ? "0.8s"     : "0s";

  const ringColors = isSteal
    ? ["rgba(255,100,100,0.25)", "rgba(255,100,100,0.15)", "rgba(255,100,100,0.08)"]
    : ["rgba(255,255,255,0.22)", "rgba(255,255,255,0.14)", "rgba(255,255,255,0.07)"];

  const containerStyle = {
    position:  "relative",
    width:     size,
    height:    size,
    flexShrink: 0,
    animation: animated ? `float-orb 5s ease-in-out ${floatDly} infinite` : "none",
    cursor:    onClick && !disabled ? "pointer" : "default",
    transition:"transform 0.3s ease",
    transform: selected ? "scale(1.08)" : "scale(1)",
  };

  const orbStyle = {
    width:         "100%",
    height:        "100%",
    borderRadius:  "50%",
    background:    `radial-gradient(circle at 35% 28%, ${highlight}, ${primary} 48%, ${darkC})`,
    border:        `${Math.max(2, size * 0.013)}px solid ${highlight}`,
    animation:     `${glowAnim} 3.5s ease-in-out infinite`,
    display:       "flex",
    alignItems:    "center",
    justifyContent:"center",
    position:      "relative",
    overflow:      "hidden",
    opacity:       disabled ? 0.45 : 1,
    transition:    "opacity 0.3s",
  };

  const labelSize = size < 120 ? Math.round(size * 0.22) : Math.round(size * 0.19);

  return (
    <div style={containerStyle} onClick={onClick && !disabled ? onClick : undefined}>
      {/* Pulse rings — only when animated and not disabled */}
      {animated && !disabled && [0, 1].map(i => (
        <div key={i} style={{
          position:    "absolute",
          inset:       -size * 0.1,
          borderRadius:"50%",
          border:      `2px solid ${primary}`,
          animation:   `pulse-ring ${2.6 + i * 0.9}s ease-out ${i * 1.3}s infinite`,
          pointerEvents:"none",
        }} />
      ))}

      <div style={orbStyle}>
        {/* Concentric inner rings */}
        {[0.78, 0.58, 0.38].map((scale, i) => (
          <div key={i} style={{
            position:    "absolute",
            width:       `${scale * 100}%`,
            height:      `${scale * 100}%`,
            borderRadius:"50%",
            border:      `1.5px solid ${ringColors[i]}`,
          }} />
        ))}

        {/* Shine highlight */}
        <div style={{
          position:  "absolute",
          top:       "8%",
          left:      "12%",
          width:     "34%",
          height:    "28%",
          borderRadius:"50%",
          background:"radial-gradient(circle, rgba(255,255,255,0.45) 0%, transparent 100%)",
          filter:    "blur(5px)",
          pointerEvents:"none",
        }} />

        {/* Label */}
        <span style={{
          fontFamily:  "'Russo One', sans-serif",
          fontSize:    labelSize,
          color:       "#fff",
          textShadow:  `0 2px 10px rgba(0,0,0,0.7), 0 0 20px ${primary}`,
          letterSpacing:"0.05em",
          zIndex:      1,
          userSelect:  "none",
          position:    "relative",
        }}>
          {type}
        </span>

        {/* Selected checkmark overlay */}
        {selected && (
          <div style={{
            position:  "absolute",
            inset:     0,
            borderRadius:"50%",
            background:"rgba(0,0,0,0.18)",
            display:   "flex",
            alignItems:"center",
            justifyContent:"center",
          }}>
            <span style={{ fontSize: size * 0.22, filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>✓</span>
          </div>
        )}
      </div>
    </div>
  );
}
