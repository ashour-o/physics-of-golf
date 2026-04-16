import { useState, useRef, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

// ── Location defaults ─────────────────────────────────────────────────────────
const LOCATION_DEFAULTS = {
  standrews: {
    name: "St Andrews", subtitle: "Old Course, Scotland", period: "July 10–17, 2027", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    altitude: 24, tempC: 14.6, humidity: 77,
    windSpeed: 4.42, airDensity: 1.225, gravity: 9.81,
    notes: "Links course, sea-level, cool & humid.",
  },
  lapaz: {
    name: "La Paz Golf Club", subtitle: "Bolivia", period: "August 2027", flag: "🇧🇴",
    altitude: 3812, tempC: 5.2, humidity: 67,
    windSpeed: 3.14, airDensity: 0.85, gravity: 9.77,
    notes: "Highest major golf club in the world. Thin air = dramatically longer drives.",
  },
  philippines: {
    name: "Philippines", subtitle: "Tropical course", period: "January 2027", flag: "🇵🇭",
    altitude: 300, tempC: 26.3, humidity: 79,
    windSpeed: 3.9, airDensity: 1.184, gravity: 9.81,
    notes: "Hot, humid, near sea-level. Trade winds from NE in January.",
  },
};

// ── Physics constants (non-adjustable) ───────────────────────────────────────
const BALL_MASS_KG  = 0.04593;
const BALL_RADIUS_M = 0.02135;
const BALL_AREA_M2  = Math.PI * BALL_RADIUS_M ** 2;
const DT            = 0.005;
const MAX_T         = 20;

// ── Adjustable parameter definitions ─────────────────────────────────────────
// Each has: key (matches param state), label, unit, min, max, step, decimals
const PARAM_DEFS = [
  { key: "clubSpeed",  label: "Club speed",    unit: "m/s",   min: 20,   max: 80,   step: 0.5,  decimals: 1 },
  { key: "spinRpm",    label: "Backspin",       unit: "RPM",   min: 500,  max: 5000, step: 50,   decimals: 0 },
  { key: "cd",         label: "Drag coeff (Cd)", unit: "",     min: 0.1,  max: 0.6,  step: 0.01, decimals: 2 },
  { key: "cl",         label: "Lift coeff (Cl)", unit: "",     min: 0,    max: 0.5,  step: 0.01, decimals: 2 },
  { key: "airDensity", label: "Air density",   unit: "kg/m³", min: 0.6,  max: 1.4,  step: 0.005,decimals: 3 },
  { key: "windSpeed",  label: "Wind speed",    unit: "m/s",   min: 0,    max: 20,   step: 0.1,  decimals: 1 },
  { key: "gravity",    label: "Gravity",       unit: "m/s²",  min: 9.7,  max: 9.85, step: 0.001,decimals: 3 },
];

const GLOBAL_DEFAULTS = { clubSpeed: 44.7, spinRpm: 2500, cd: 0.47, cl: 0.25 };

function getDefaultParams(locationKey) {
  const loc = LOCATION_DEFAULTS[locationKey];
  return {
    ...GLOBAL_DEFAULTS,
    airDensity: loc.airDensity,
    windSpeed:  loc.windSpeed,
    gravity:    loc.gravity,
  };
}

// ── Factor definitions ────────────────────────────────────────────────────────
const FACTORS = [
  { id: "drag",      label: "Aerodynamic drag",     desc: "Air resistance on the ball",        implemented: true  },
  { id: "lift",      label: "Magnus effect",          desc: "Backspin creates upward force",     implemented: true  },
  { id: "wind",      label: "Wind (headwind)",        desc: "Opposing horizontal wind component",implemented: true  },
  { id: "altitude",  label: "Altitude / air density", desc: "Thinner air at elevation",         implemented: true  },
  { id: "humidity",  label: "Humidity correction",    desc: "Moist air is slightly less dense",  implemented: false },
  { id: "temp",      label: "Temperature effect",     desc: "Ball compression & air density",    implemented: false },
  { id: "crosswind", label: "Crosswind (lateral)",    desc: "Side deflection modelling",         implemented: false },
  { id: "slope",     label: "Terrain slope",          desc: "Uphill / downhill fairway",         implemented: false },
];

// ── Physics simulation ────────────────────────────────────────────────────────
function simulate(angleDeg, params, activeFactors) {
  const theta = (angleDeg * Math.PI) / 180;
  const rho   = activeFactors.altitude ? params.airDensity : 1.225;
  const windHeadMs = activeFactors.wind ? params.windSpeed * 0.6 : 0;
  const cd    = activeFactors.drag ? params.cd : 0;
  const cl    = activeFactors.lift ? params.cl : 0;

  let vx = params.clubSpeed * Math.cos(theta) - windHeadMs;
  let vy = params.clubSpeed * Math.sin(theta);
  let x = 0, y = 0;
  const path = [{ x: 0, y: 0 }];

  for (let t = 0; t < MAX_T; t += DT) {
    const v  = Math.sqrt(vx ** 2 + vy ** 2);
    if (v < 0.001) break;
    const Fd = 0.5 * rho * v ** 2 * BALL_AREA_M2 * cd;
    const Fl = 0.5 * rho * v ** 2 * BALL_AREA_M2 * cl;

    // (vx / v) and (vy / v) represent orthogonal unit vectors
    // that are used as the basis for creating forces perpendicular to the ball's velocity
    const ax = -(Fd * vx) / (BALL_MASS_KG * v);
    const ay = -(Fd * vy) / (BALL_MASS_KG * v) + (Fl *  vy) / (BALL_MASS_KG * v) - params.gravity;

    vx += ax * DT; vy += ay * DT;
    x  += vx * DT; y  += vy * DT;

    if (y < 0 && t > 0.1) break;
    if (t % 0.1 < DT) path.push({ x: +x.toFixed(2), y: +Math.max(0, y).toFixed(2) });
  }
  return { path, distance: +x.toFixed(1) };
}

function sweepAngles(params, activeFactors) {
  const data = [];
  for (let a = 1; a <= 85; a++) {
    const { distance } = simulate(a, params, activeFactors);
    data.push({ angle: a, distance: Math.max(0, distance) });
  }
  return data;
}

function paramsEqual(a, b) {
  return Object.keys(a).every(k => Math.abs(a[k] - b[k]) < 0.0001);
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [location,      setLocation]      = useState("standrews");
  const [params,        setParams]        = useState(getDefaultParams("standrews"));
  const [activeFactors, setActiveFactors] = useState({ drag: true, lift: true, wind: true, altitude: true });
  const [angle,         setAngle]         = useState(12);
  const [view,          setView]          = useState("trajectory");
  const [bottomTab,     setBottomTab]     = useState("parameters");
  const canvasRef = useRef(null);

  const loc          = LOCATION_DEFAULTS[location];
  const defaults     = getDefaultParams(location);
  const isCustomised = !paramsEqual(params, defaults);

  const { path, distance } = simulate(angle, params, activeFactors);
  const sweepData  = sweepAngles(params, activeFactors);
  const optAngle   = sweepData.reduce((best, d) => d.distance > best.distance ? d : best, sweepData[0]);

  function handleLocationChange(key) {
    setLocation(key);
    setParams(getDefaultParams(key)); // reset to new location's defaults
  }

  function handleParam(key, value) {
    setParams(prev => ({ ...prev, [key]: value }));
  }

  function resetToDefaults() {
    setParams(getDefaultParams(location));
  }

  function toggleFactor(id) {
    setActiveFactors(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // ── Canvas ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const PAD = { left: 52, right: 20, top: 20, bottom: 36 };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f9f9f7";
    ctx.fillRect(0, 0, W, H);

    const maxX = Math.max(...path.map(p => p.x), 10);
    const maxY = Math.max(...path.map(p => p.y), 5);
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const toC = (x, y) => ({ cx: PAD.left + x * (chartW / maxX), cy: PAD.top + chartH - y * (chartH / maxY) });

    // Grid
    ctx.strokeStyle = "rgba(0,0,0,0.06)"; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const gx = PAD.left + (i / 4) * chartW;
      ctx.beginPath(); ctx.moveTo(gx, PAD.top); ctx.lineTo(gx, PAD.top + chartH); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(Math.round((i / 4) * maxX) + "m", gx, H - 8);
    }
    for (let i = 0; i <= 3; i++) {
      const gy = PAD.top + (i / 3) * chartH;
      ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + chartW, gy); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.textAlign = "right";
      ctx.fillText(Math.round(((3 - i) / 3) * maxY) + "m", PAD.left - 4, gy + 3);
    }

    // Ground
    ctx.strokeStyle = "#2D5A27"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + chartH); ctx.lineTo(PAD.left + chartW, PAD.top + chartH); ctx.stroke();

    if (path.length > 1) {
      // Trajectory
      ctx.beginPath(); ctx.strokeStyle = "#1a6bb5"; ctx.lineWidth = 2; ctx.setLineDash([]);
      const p0 = toC(path[0].x, path[0].y); ctx.moveTo(p0.cx, p0.cy);
      path.forEach(p => { const c = toC(p.x, p.y); ctx.lineTo(c.cx, c.cy); });
      ctx.stroke();

      // Launch angle guide
      const tee = toC(0, 0);
      ctx.save(); ctx.strokeStyle = "#e06c2a"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(tee.cx, tee.cy);
      ctx.lineTo(tee.cx + 55 * Math.cos(-angle * Math.PI / 180), tee.cy + 55 * Math.sin(-angle * Math.PI / 180));
      ctx.stroke(); ctx.restore();

      // Apex
      const apex = path.reduce((b, p) => p.y > b.y ? p : b, path[0]);
      const ac = toC(apex.x, apex.y);
      ctx.beginPath(); ctx.arc(ac.cx, ac.cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#1a6bb5"; ctx.fill();
      ctx.fillStyle = "#1a6bb5"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(`${Math.round(apex.y)}m high`, ac.cx, ac.cy - 8);

      // Landing
      const last = path[path.length - 1];
      const lc = toC(last.x, 0);
      ctx.beginPath(); ctx.arc(lc.cx, PAD.top + chartH, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#e06c2a"; ctx.fill();
      ctx.fillStyle = "#e06c2a"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(`${distance}m`, lc.cx, PAD.top + chartH + 13);
    }
  }, [path, angle, distance]);

  useEffect(() => { draw(); }, [draw]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    wrap:       { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", background: "#f0ede8", overflow: "hidden" },
    topBar:     { background: "#fff", borderBottom: "0.5px solid rgba(0,0,0,0.1)", padding: "0 20px", display: "flex", alignItems: "center", gap: 0, flexShrink: 0 },
    brand:      { fontSize: 12, fontWeight: 700, color: "#2D5A27", letterSpacing: ".08em", textTransform: "uppercase", marginRight: 24, whiteSpace: "nowrap" },
    locBtn:     (a) => ({ padding: "14px 18px", fontSize: 13, fontWeight: a ? 600 : 400, border: "none", borderBottom: a ? "2px solid #2D5A27" : "2px solid transparent", background: "none", cursor: "pointer", color: a ? "#2D5A27" : "#555", transition: "all .12s", whiteSpace: "nowrap" }),
    mid:        { flex: 1, display: "flex", gap: 0, overflow: "hidden" },
    canvas:     { flex: 1, padding: "16px 16px 0", display: "flex", flexDirection: "column", overflow: "hidden" },
    statRow:    { display: "flex", gap: 10, marginBottom: 12, flexShrink: 0 },
    statCard:   { background: "#fff", border: "0.5px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 14px", flex: 1 },
    statVal:    { fontSize: 20, fontWeight: 700, fontFamily: "monospace" },
    statLbl:    { fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em", color: "#888", marginTop: 2 },
    statSub:    { fontSize: 10, color: "#aaa" },
    viewTabs:   { display: "flex", gap: 6, marginBottom: 10, flexShrink: 0 },
    viewBtn:    (a) => ({ padding: "5px 14px", fontSize: 11, fontWeight: 500, border: a ? "1px solid #1a6bb5" : "0.5px solid rgba(0,0,0,0.15)", borderRadius: 5, cursor: "pointer", background: a ? "#e8f2fb" : "transparent", color: a ? "#1a6bb5" : "#666" }),
    rightPanel: { width: 300, flexShrink: 0, background: "#fff", borderLeft: "0.5px solid rgba(0,0,0,0.1)", display: "flex", flexDirection: "column", overflow: "hidden" },
    tabBar:     { display: "flex", borderBottom: "0.5px solid rgba(0,0,0,0.08)", flexShrink: 0 },
    tabBtn:     (a) => ({ flex: 1, padding: "11px 0", fontSize: 11, fontWeight: a ? 600 : 400, border: "none", borderBottom: a ? "2px solid #2D5A27" : "2px solid transparent", background: "none", cursor: "pointer", color: a ? "#2D5A27" : "#777" }),
    panelBody:  { flex: 1, overflowY: "auto", padding: "14px 16px" },
    sliderRow:  { marginBottom: 14 },
    sliderHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
    sliderLbl:  { fontSize: 11, fontWeight: 500, color: "#444" },
    sliderVal:  { fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#1a6bb5" },
    sliderSub:  { display: "flex", justifyContent: "space-between", fontSize: 9, color: "#bbb", marginTop: 2 },
    sectionHd:  { fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#aaa", margin: "16px 0 10px" },
    factRow:    (impl) => ({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "7px 0", borderBottom: "0.5px solid rgba(0,0,0,0.05)", opacity: impl ? 1 : 0.4 }),
    chip:       (impl) => ({ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: ".05em", background: impl ? "#eaf3e8" : "#f5ede8", color: impl ? "#2D5A27" : "#a0522d", border: `0.5px solid ${impl ? "#c2dbbf" : "#ddbba0"}` }),
    resetBtn:   { width: "100%", padding: "8px", fontSize: 11, fontWeight: 600, border: "1px solid #e06c2a", borderRadius: 6, background: "#fff8f4", color: "#e06c2a", cursor: "pointer", marginTop: 4 },
    angleWrap:  { background: "#fff", borderTop: "0.5px solid rgba(0,0,0,0.08)", padding: "12px 20px", flexShrink: 0, display: "flex", alignItems: "center", gap: 16 },
    angleLbl:   { fontSize: 11, fontWeight: 600, color: "#555", whiteSpace: "nowrap" },
    angleVal:   { fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: "#1a6bb5", minWidth: 36 },
    optLbl:     { fontSize: 10, color: "#2D5A27", fontWeight: 600, whiteSpace: "nowrap" },
  };

  return (
    <div style={S.wrap}>

      {/* ── TOP BAR: brand + location tabs ── */}
      <div style={S.topBar}>
        <div style={S.brand}>Golf Physics</div>
        {Object.entries(LOCATION_DEFAULTS).map(([key, l]) => (
          <button key={key} style={S.locBtn(location === key)} onClick={() => handleLocationChange(key)}>
            {l.flag} {l.name} <span style={{ fontSize: 10, opacity: .6, marginLeft: 4 }}>{l.period}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: "#aaa" }}>Group project · v0.1</div>
      </div>

      {/* ── MIDDLE: canvas + right panel ── */}
      <div style={S.mid}>

        {/* Canvas area */}
        <div style={S.canvas}>
          {/* Stat row */}
          <div style={S.statRow}>
            {[
              { label: "Distance",      val: `${distance}m`,          sub: `~${Math.round(distance * 1.094)}yd` },
              { label: "Optimal angle", val: `${optAngle.angle}°`,    sub: `${Math.round(optAngle.distance)}m max` },
              { label: "Air density",   val: `${params.airDensity}`,  sub: "kg/m³" },
              { label: "Wind",          val: `${params.windSpeed}`,   sub: "m/s" },
              { label: "Altitude",      val: `${loc.altitude}m`,      sub: `${loc.tempC}°C` },
            ].map(s => (
              <div key={s.label} style={S.statCard}>
                <div style={S.statVal}>{s.val}</div>
                <div style={S.statLbl}>{s.label}</div>
                <div style={S.statSub}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div style={S.viewTabs}>
            <button style={S.viewBtn(view === "trajectory")} onClick={() => setView("trajectory")}>Trajectory path</button>
            <button style={S.viewBtn(view === "graph")}      onClick={() => setView("graph")}>Distance vs angle</button>
            {isCustomised && <span style={{ fontSize: 10, color: "#e06c2a", alignSelf: "center", marginLeft: 8 }}>⚠ Custom parameters active</span>}
          </div>

          {/* Trajectory */}
          {view === "trajectory" && (
            <canvas ref={canvasRef} width={900} height={380}
              style={{ width: "100%", flex: 1, borderRadius: 8, border: "0.5px solid rgba(0,0,0,0.08)", display: "block", background: "#f9f9f7" }} />
          )}

          {/* Graph */}
          {view === "graph" && (
            <div style={{ flex: 1, background: "#fff", borderRadius: 8, border: "0.5px solid rgba(0,0,0,0.08)", padding: "16px 20px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Distance vs launch angle — {loc.name}</div>
              <div style={{ fontSize: 10, color: "#888", marginBottom: 12 }}>Sweeping 1°–85° with current parameters</div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={sweepData} margin={{ top: 4, right: 16, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="angle" tick={{ fontSize: 10 }} label={{ value: "Launch angle (°)", position: "insideBottom", offset: -8, fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: "Distance (m)", angle: -90, position: "insideLeft", fontSize: 10 }} />
                  <Tooltip formatter={v => [`${v.toFixed(1)}m`, "Distance"]} labelFormatter={l => `${l}° launch`} />
                  <ReferenceLine x={optAngle.angle} stroke="#2D5A27" strokeDasharray="4 3" label={{ value: `Opt ${optAngle.angle}°`, position: "top", fontSize: 9, fill: "#2D5A27" }} />
                  <ReferenceLine x={angle}          stroke="#1a6bb5"  strokeDasharray="4 3" label={{ value: `${angle}°`, position: "top", fontSize: 9, fill: "#1a6bb5" }} />
                  <Line type="monotone" dataKey="distance" stroke="#1a6bb5" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={S.rightPanel}>
          <div style={S.tabBar}>
            <button style={S.tabBtn(bottomTab === "parameters")} onClick={() => setBottomTab("parameters")}>Parameters</button>
            <button style={S.tabBtn(bottomTab === "factors")}    onClick={() => setBottomTab("factors")}>Factors</button>
          </div>

          <div style={S.panelBody}>

            {/* ── PARAMETERS TAB ── */}
            {bottomTab === "parameters" && (
              <>
                <div style={{ fontSize: 10, color: "#888", lineHeight: 1.5, marginBottom: 8 }}>
                  Defaults loaded from <strong>{loc.name}</strong> data. Changing location resets to its defaults.
                </div>

                {PARAM_DEFS.map(def => {
                  const val = params[def.key];
                  const defVal = defaults[def.key];
                  const changed = Math.abs(val - defVal) > 0.0001;
                  return (
                    <div key={def.key} style={S.sliderRow}>
                      <div style={S.sliderHead}>
                        <span style={{ ...S.sliderLbl, color: changed ? "#e06c2a" : "#444" }}>
                          {def.label} {changed && "●"}
                        </span>
                        <span style={S.sliderVal}>
                          {val.toFixed(def.decimals)}{def.unit && <span style={{ fontSize: 10, color: "#aaa", marginLeft: 2 }}>{def.unit}</span>}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={def.min} max={def.max} step={def.step}
                        value={val}
                        onChange={e => handleParam(def.key, parseFloat(e.target.value))}
                        style={{ width: "100%" }}
                      />
                      <div style={S.sliderSub}>
                        <span>{def.min}{def.unit}</span>
                        {changed && <span style={{ color: "#e06c2a", fontSize: 9 }}>default: {defVal.toFixed(def.decimals)}</span>}
                        <span>{def.max}{def.unit}</span>
                      </div>
                    </div>
                  );
                })}

                {isCustomised && (
                  <button style={S.resetBtn} onClick={resetToDefaults}>
                    ↺ Reset to {loc.name} defaults
                  </button>
                )}
              </>
            )}

            {/* ── FACTORS TAB ── */}
            {bottomTab === "factors" && (
              <>
                <div style={{ fontSize: 10, color: "#888", lineHeight: 1.5, marginBottom: 4 }}>
                  Toggle which physics factors are included in the simulation. Greyed items are not yet implemented.
                </div>
                {FACTORS.map(f => (
                  <div key={f.id} style={S.factRow(f.implemented)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{f.label}</span>
                        <span style={S.chip(f.implemented)}>{f.implemented ? "live" : "todo"}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#999" }}>{f.desc}</div>
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

                <div style={{ marginTop: 16, padding: "10px 12px", background: "#f0f8ee", borderRadius: 6, border: "0.5px solid #c2dbbf" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#2D5A27", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>Location notes</div>
                  <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{loc.notes}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM: angle slider ── */}
      <div style={S.angleWrap}>
        <span style={S.angleLbl}>Launch angle</span>
        <span style={S.angleVal}>{angle}°</span>
        <input type="range" min={1} max={85} value={angle} onChange={e => setAngle(+e.target.value)} style={{ flex: 1 }} />
        <span style={S.optLbl}>Optimal: {optAngle.angle}° ({Math.round(optAngle.distance)}m)</span>
      </div>

    </div>
  );
}