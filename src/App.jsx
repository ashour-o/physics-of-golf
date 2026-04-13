import { useState, useRef, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

// ── Environmental data per location ──────────────────────────────────────────
const LOCATIONS = {
  standrews: {
    name: "St Andrews",
    subtitle: "Old Course, Scotland",
    period: "July 10–17, 2027",
    flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    altitude: 10,          // metres above sea level
    tempC: 17,             // average July temp °C
    humidity: 78,          // % relative humidity
    windSpeed: 6.2,        // m/s average wind speed
    windDir: 225,          // degrees (SW prevailing)
    airDensity: 1.225,     // kg/m³ at sea level, 17°C (calculated)
    gravity: 9.812,        // m/s² at this latitude
    notes: "Links course, sea-level, cool & humid. SW wind off the North Sea.",
  },
  lapaz: {
    name: "La Paz Golf Club",
    subtitle: "Bolivia",
    period: "August 2027",
    flag: "🇧🇴",
    altitude: 3300,
    tempC: 12,
    humidity: 55,
    windSpeed: 3.1,
    windDir: 270,
    airDensity: 0.881,     // ~28% less dense than sea level — massive effect
    gravity: 9.782,
    notes: "Highest major golf club in the world. Thin air = dramatically longer drives.",
  },
  philippines: {
    name: "Philippines",
    subtitle: "Tropical course",
    period: "January 2027",
    flag: "🇵🇭",
    altitude: 50,
    tempC: 28,
    humidity: 85,
    windSpeed: 4.8,
    windDir: 45,
    airDensity: 1.184,     // slightly less dense due to heat & humidity
    gravity: 9.810,
    notes: "Hot, humid, near sea-level. Trade winds from NE in January.",
  },
};

// ── Physics constants ─────────────────────────────────────────────────────────
const CLUB_SPEED_MS   = 44.7;   // ~100 mph, typical amateur driver
const BALL_MASS_KG    = 0.04593;
const BALL_RADIUS_M   = 0.02135;
const BALL_AREA_M2    = Math.PI * BALL_RADIUS_M ** 2;
const CD_BASE         = 0.47;   // drag coefficient (smooth sphere baseline)
const CL_BASE         = 0.21;   // lift coefficient (backspin)
const SPIN_RPM        = 2500;   // typical driver backspin
const DT              = 0.005;  // simulation timestep (seconds)
const MAX_T           = 20;     // max simulation time (seconds)

// ── Factor definitions ────────────────────────────────────────────────────────
const FACTORS = [
  { id: "drag",       label: "Aerodynamic drag",    desc: "Air resistance on the ball",         implemented: true  },
  { id: "lift",       label: "Magnus lift",          desc: "Backspin creates upward force",      implemented: true  },
  { id: "wind",       label: "Wind (headwind)",      desc: "Opposing horizontal wind component", implemented: true  },
  { id: "altitude",   label: "Altitude / air density", desc: "Thinner air at elevation",        implemented: true  },
  { id: "humidity",   label: "Humidity correction",  desc: "Moist air is slightly less dense",   implemented: false },
  { id: "temp",       label: "Temperature effect",   desc: "Ball compression & air density",     implemented: false },
  { id: "spin_decay", label: "Spin decay",           desc: "RPM loss during flight",             implemented: false },
  { id: "crosswind",  label: "Crosswind (lateral)",  desc: "Side deflection modelling",          implemented: false },
  { id: "ground",     label: "Ground roll",          desc: "Run-out distance after landing",     implemented: false },
  { id: "slope",      label: "Terrain slope",        desc: "Uphill / downhill fairway",          implemented: false },
];

// ── Core physics simulation ───────────────────────────────────────────────────
function simulate(angleDeg, location, activeFactors) {
  const loc   = LOCATIONS[location];
  const theta = (angleDeg * Math.PI) / 180;

  // Effective air density
  let rho = activeFactors.altitude ? loc.airDensity : 1.225;

  // Wind: headwind component reduces effective ball speed
  const windHeadMs = activeFactors.wind ? loc.windSpeed * 0.6 : 0; // 60% headwind assumption

  const v0 = CLUB_SPEED_MS;
  let vx = v0 * Math.cos(theta) - windHeadMs;
  let vy = v0 * Math.sin(theta);
  let x  = 0, y = 0;
  const path = [{ x: 0, y: 0 }];

  const g    = loc.gravity;
  const spin = (SPIN_RPM * 2 * Math.PI) / 60; // rad/s

  for (let t = 0; t < MAX_T; t += DT) {
    const v   = Math.sqrt(vx ** 2 + vy ** 2);
    const cd  = activeFactors.drag ? CD_BASE : 0;
    const cl  = activeFactors.lift ? CL_BASE : 0;

    const Fd  = 0.5 * rho * v ** 2 * BALL_AREA_M2 * cd;
    const Fl  = 0.5 * rho * v ** 2 * BALL_AREA_M2 * cl;

    const ax  = -(Fd * vx) / (BALL_MASS_KG * v);
    const ay  = (Fl / BALL_MASS_KG) - g - (Fd * vy) / (BALL_MASS_KG * v);

    vx += ax * DT;
    vy += ay * DT;
    x  += vx * DT;
    y  += vy * DT;

    if (y < 0 && t > 0.1) break;
    if (t % 0.1 < DT) path.push({ x: +x.toFixed(2), y: +Math.max(0, y).toFixed(2) });
  }

  return { path, distance: +x.toFixed(1) };
}

// ── Sweep angles 1–85° for the graph ─────────────────────────────────────────
function sweepAngles(location, activeFactors) {
  const data = [];
  for (let a = 1; a <= 85; a += 1) {
    const { distance } = simulate(a, location, activeFactors);
    data.push({ angle: a, distance: Math.max(0, distance) });
  }
  return data;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [location,      setLocation]      = useState("standrews");
  const [angle,         setAngle]          = useState(12);
  const [activeFactors, setActiveFactors]  = useState({ drag: true, lift: true, wind: true, altitude: true });
  const [view,          setView]           = useState("trajectory"); // "trajectory" | "graph"
  const canvasRef = useRef(null);

  const loc          = LOCATIONS[location];
  const { path, distance } = simulate(angle, location, activeFactors);
  const sweepData    = sweepAngles(location, activeFactors);
  const optAngle     = sweepData.reduce((best, d) => d.distance > best.distance ? d : best, sweepData[0]);

  // ── Canvas drawing ──────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const PAD = { left: 56, right: 24, top: 24, bottom: 40 };

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--color-background-secondary") || "#f8f8f6";
    ctx.fillRect(0, 0, W, H);

    // Determine scale
    const maxX = Math.max(...path.map(p => p.x), 10);
    const maxY = Math.max(...path.map(p => p.y), 5);
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;
    const scX = chartW / maxX;
    const scY = chartH / maxY;

    const toCanvas = (x, y) => ({
      cx: PAD.left + x * scX,
      cy: PAD.top  + chartH - y * scY,
    });

    // Grid lines
    ctx.strokeStyle = "rgba(128,128,128,0.12)";
    ctx.lineWidth = 0.5;
    for (let xi = 0; xi <= 4; xi++) {
      const gx = PAD.left + (xi / 4) * chartW;
      ctx.beginPath(); ctx.moveTo(gx, PAD.top); ctx.lineTo(gx, PAD.top + chartH); ctx.stroke();
      const label = Math.round((xi / 4) * maxX) + "m";
      ctx.fillStyle = "rgba(128,128,128,0.6)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, gx, H - 12);
    }
    for (let yi = 0; yi <= 3; yi++) {
      const gy = PAD.top + (yi / 3) * chartH;
      ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + chartW, gy); ctx.stroke();
      const label = Math.round(((3 - yi) / 3) * maxY) + "m";
      ctx.fillStyle = "rgba(128,128,128,0.6)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(label, PAD.left - 6, gy + 3);
    }

    // Ground line
    ctx.strokeStyle = "#2D5A27";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top + chartH);
    ctx.lineTo(PAD.left + chartW, PAD.top + chartH);
    ctx.stroke();

    // Trajectory
    if (path.length > 1) {
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1a6bb5";
      ctx.setLineDash([]);
      const p0 = toCanvas(path[0].x, path[0].y);
      ctx.moveTo(p0.cx, p0.cy);
      for (let i = 1; i < path.length; i++) {
        const p = toCanvas(path[i].x, path[i].y);
        ctx.lineTo(p.cx, p.cy);
      }
      ctx.stroke();

      // Angle indicator at tee
      const tee = toCanvas(0, 0);
      ctx.save();
      ctx.strokeStyle = "#e06c2a";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(tee.cx, tee.cy);
      ctx.lineTo(tee.cx + 60 * Math.cos(-angle * Math.PI / 180), tee.cy + 60 * Math.sin(-angle * Math.PI / 180));
      ctx.stroke();
      ctx.restore();

      // Apex marker
      const apex = path.reduce((best, p) => p.y > best.y ? p : best, path[0]);
      const ac = toCanvas(apex.x, apex.y);
      ctx.beginPath();
      ctx.arc(ac.cx, ac.cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#1a6bb5";
      ctx.fill();
      ctx.fillStyle = "#1a6bb5";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(apex.y)}m high`, ac.cx, ac.cy - 9);

      // Landing marker
      const last = path[path.length - 1];
      const lc = toCanvas(last.x, 0);
      ctx.beginPath();
      ctx.arc(lc.cx, PAD.top + chartH, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#e06c2a";
      ctx.fill();
      ctx.fillStyle = "#e06c2a";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${distance}m`, lc.cx, PAD.top + chartH + 14);
    }
  }, [path, angle, distance]);

  useEffect(() => { draw(); }, [draw]);

  // ── Toggle factor ─────────────────────────────────────────────────────────
  function toggleFactor(id) {
    setActiveFactors(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const styles = {
    app: { display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "var(--color-background-tertiary, #f2f0eb)" },
    sidebar: { width: 270, flexShrink: 0, background: "var(--color-background-primary, #fff)", borderRight: "0.5px solid rgba(0,0,0,0.1)", display: "flex", flexDirection: "column", overflowY: "auto" },
    main: { flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", gap: 16 },
    sectionHead: { fontSize: 9, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-text-tertiary, #888)", marginBottom: 8 },
    section: { padding: "14px 16px", borderBottom: "0.5px solid rgba(0,0,0,0.07)" },
    header: { padding: "16px 16px 14px", borderBottom: "0.5px solid rgba(0,0,0,0.07)" },
    locCard: (active) => ({
      border: active ? "1.5px solid #2D5A27" : "0.5px solid rgba(0,0,0,0.12)",
      borderRadius: 8, padding: "9px 11px", marginBottom: 7, cursor: "pointer",
      background: active ? "#f0f8ee" : "transparent", transition: "all .12s",
    }),
    viewBtn: (active) => ({
      flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 500,
      border: active ? "1px solid #1a6bb5" : "0.5px solid rgba(0,0,0,0.15)",
      borderRadius: 6, cursor: "pointer", background: active ? "#e8f2fb" : "transparent",
      color: active ? "#1a6bb5" : "var(--color-text-secondary, #666)", transition: "all .12s",
    }),
    factorRow: (impl) => ({
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 0", borderBottom: "0.5px solid rgba(0,0,0,0.05)",
      opacity: impl ? 1 : 0.45,
    }),
    chip: (impl) => ({
      fontSize: 9, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase",
      padding: "1px 5px", borderRadius: 3,
      background: impl ? "#eaf3e8" : "#f5ede8",
      color: impl ? "#2D5A27" : "#a0522d",
      border: `0.5px solid ${impl ? "#c2dbbf" : "#ddbba0"}`,
    }),
    statCard: { background: "var(--color-background-primary, #fff)", border: "0.5px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 0 },
    statVal: { fontSize: 26, fontWeight: 600, fontFamily: "monospace", lineHeight: 1 },
    statLabel: { fontSize: 10, color: "var(--color-text-secondary, #666)", marginTop: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".07em" },
    canvas: { width: "100%", borderRadius: 10, border: "0.5px solid rgba(0,0,0,0.1)", background: "var(--color-background-secondary, #f8f8f6)", display: "block" },
  };

  return (
    <div style={styles.app}>

      {/* ── SIDEBAR ── */}
      <aside style={styles.sidebar}>
        <div style={styles.header}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#2D5A27", marginBottom: 3 }}>Golf Physics</div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Trajectory Simulator</div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary, #888)", marginTop: 3 }}>Group project · Action plan v0.1</div>
        </div>

        {/* Locations */}
        <div style={styles.section}>
          <div style={styles.sectionHead}>Location</div>
          {Object.entries(LOCATIONS).map(([key, l]) => (
            <div key={key} style={styles.locCard(location === key)} onClick={() => setLocation(key)}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{l.flag} {l.name}</div>
              <div style={{ fontSize: 10, color: "var(--color-text-secondary, #888)", marginTop: 1 }}>{l.subtitle} · {l.period}</div>
              <div style={{ fontSize: 10, color: "#2D5A27", marginTop: 3 }}>{l.altitude}m alt · {l.tempC}°C · ρ={l.airDensity} kg/m³</div>
            </div>
          ))}
        </div>

        {/* Angle */}
        <div style={styles.section}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={styles.sectionHead}>Launch angle</div>
            <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 15 }}>{angle}°</div>
          </div>
          <input type="range" min={1} max={85} value={angle} onChange={e => setAngle(+e.target.value)} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-text-secondary, #888)", marginTop: 4 }}>
            <span>1°</span><span style={{ color: "#2D5A27", fontWeight: 600 }}>Optimal: {optAngle.angle}° ({Math.round(optAngle.distance)}m)</span><span>85°</span>
          </div>
        </div>

        {/* Factors */}
        <div style={{ ...styles.section, flex: 1 }}>
          <div style={styles.sectionHead}>Physics factors</div>
          {FACTORS.map(f => (
            <div key={f.id} style={styles.factorRow(f.implemented)}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{f.label}</span>
                  <span style={styles.chip(f.implemented)}>{f.implemented ? "live" : "todo"}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary, #888)", marginTop: 1 }}>{f.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={f.implemented ? (activeFactors[f.id] ?? false) : false}
                disabled={!f.implemented}
                onChange={() => f.implemented && toggleFactor(f.id)}
                style={{ marginLeft: 10, cursor: f.implemented ? "pointer" : "not-allowed" }}
              />
            </div>
          ))}
        </div>

        {/* Location notes */}
        <div style={{ padding: "12px 16px", background: "var(--color-background-secondary, #f8f8f6)", borderTop: "0.5px solid rgba(0,0,0,0.07)" }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#2D5A27", marginBottom: 4 }}>Location notes</div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary, #777)", lineHeight: 1.5 }}>{loc.notes}</div>
        </div>
      </aside>

      {/* ── MAIN PANEL ── */}
      <main style={styles.main}>

        {/* Stat bar */}
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "Distance", val: `${distance}m`, sub: `~${Math.round(distance * 1.094)}yd` },
            { label: "Optimal angle", val: `${optAngle.angle}°`, sub: `${Math.round(optAngle.distance)}m max` },
            { label: "Air density", val: `${loc.airDensity}`, sub: "kg/m³" },
            { label: "Wind speed", val: `${loc.windSpeed}`, sub: "m/s avg" },
            { label: "Altitude", val: `${loc.altitude}m`, sub: `${loc.tempC}°C` },
          ].map(s => (
            <div key={s.label} style={styles.statCard}>
              <div style={styles.statVal}>{s.val}</div>
              <div style={styles.statLabel}>{s.label}</div>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary, #aaa)", marginTop: 1 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 8, maxWidth: 340 }}>
          <button style={styles.viewBtn(view === "trajectory")} onClick={() => setView("trajectory")}>Trajectory path</button>
          <button style={styles.viewBtn(view === "graph")} onClick={() => setView("graph")}>Distance vs angle</button>
        </div>

        {/* Trajectory canvas */}
        {view === "trajectory" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <canvas
              ref={canvasRef}
              width={900} height={420}
              style={styles.canvas}
            />
            <div style={{ fontSize: 11, color: "var(--color-text-secondary, #888)" }}>
              <span style={{ color: "#1a6bb5", fontWeight: 600 }}>Blue</span> = trajectory &nbsp;·&nbsp;
              <span style={{ color: "#e06c2a", fontWeight: 600 }}>Orange</span> = launch angle & landing &nbsp;·&nbsp;
              Driver: {CLUB_SPEED_MS} m/s club speed, {SPIN_RPM} RPM backspin
            </div>
          </div>
        )}

        {/* Distance vs angle graph */}
        {view === "graph" && (
          <div style={{ flex: 1, background: "var(--color-background-primary, #fff)", borderRadius: 10, border: "0.5px solid rgba(0,0,0,0.1)", padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Distance vs launch angle — {loc.name}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary, #888)", marginBottom: 16 }}>Sweeping 1°–85°, all active factors applied</div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={sweepData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.07)" />
                <XAxis dataKey="angle" label={{ value: "Launch angle (°)", position: "insideBottom", offset: -2, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <YAxis label={{ value: "Distance (m)", angle: -90, position: "insideLeft", fontSize: 11 }} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v.toFixed(1)}m`, "Distance"]} labelFormatter={l => `${l}° launch angle`} />
                <ReferenceLine x={optAngle.angle} stroke="#2D5A27" strokeDasharray="4 3" label={{ value: `Optimal ${optAngle.angle}°`, position: "top", fontSize: 10, fill: "#2D5A27" }} />
                <ReferenceLine x={angle} stroke="#1a6bb5" strokeDasharray="4 3" label={{ value: `Current ${angle}°`, position: "top", fontSize: 10, fill: "#1a6bb5" }} />
                <Line type="monotone" dataKey="distance" stroke="#1a6bb5" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Footer note */}
        <div style={{ fontSize: 10, color: "var(--color-text-tertiary, #aaa)", paddingBottom: 4 }}>
          Physics model: projectile + drag (Cd={CD_BASE}) + Magnus lift (Cl={CL_BASE}) + altitude-adjusted air density · <span style={{ color: "#a0522d" }}>Greyed factors not yet implemented — toggle unavailable</span>
        </div>
      </main>
    </div>
  );
}