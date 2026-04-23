import "./App.css";
import { useState, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, Legend } from "recharts";


const LOCATIONS = {
  standrews: {
    name: "St Andrews, UK",
    period: "July 2027",
    altitudeM: 5, 
    tempC: 18,
    humidity: 77,   // percentage
    windSpeedMS: 4.39,  
    gravity: 9.816
  },

  lapaz: {
    name: "La Paz, Bolivia",
    period: "August 2027",
    altitudeM: 3315,
    tempC: 14,
    humidity: 67,
    windSpeedMS: 3.08,
    gravity: 9.775
  },

  philippines: {
    name: "Davao City, Philippines",
    period: "January 2027",
    altitudeM: 50,
    tempC: 31,
    humidity: 82,
    windSpeedMS: 2.25,
    gravity: 9.781
  },

  custom: {
    name: "Custom",
    period: "User-defined"
  }
}


const GLOBAL_PHYSICS = {
  ballMassKG: 0.0459,
  ballRadiusM: 0.02135,
  clubMassKG: 0.2,
  clubSpeedMS: 51.4, 
  loftMinDEG: 0,  
  loftMaxDEG: 35,
  DT: 0.001  // timestep for Euler's method
} 


// main function doing all the mathematics to simulate motion of golf ball
function simulate(staticLoft, loc, tailWind) {
  // storing these using math variable names for brevity
  // global physics data
  const v_ci = GLOBAL_PHYSICS.clubSpeedMS;
  const M = GLOBAL_PHYSICS.clubMassKG;
  const m = GLOBAL_PHYSICS.ballMassKG;
  const r = GLOBAL_PHYSICS.ballRadiusM;

  // per-location data
  const g = loc.gravity;
  const v_wind = tailWind ? loc.windSpeedMS : -loc.windSpeedMS;
  const T_C = loc.tempC // celsius
  const T = T_C + 273.15; // convert to kelvin
  const z = loc.altitudeM;
  const h = loc.humidity / 100 // humidity as a decimal [0-1]

  // pre-calculating constants for later
  const A = Math.PI * ( r ** 2 );

  const m_air = 4.8 * (10**-26);
  const M_a = 28.97 // molar mass of air
  const M_v = 18.02 // molar mass of water
  const k = 1.381 * (10**-23);
  const R = 8.31

  // USED LATER TO ACCOUNT FOR AIR DENSITY

  // barometric formula for air pressure
  const P = 101325 * Math.exp( - m_air * g * z / (k * T));

  // sutherland's law for air viscosity
  const mu = 1.716*(10**-5) * ((T / 273)**1.5) * (273+111) / (T+111);

  // calculating x_v 
  const A0 = 1.2378847 * (10**-5);
  const B = -1.9121316 * (10**-2);
  const C = 33.93711047;
  const D = -6.3431645 * (10**3);
  const P_sv = 1 * Math.exp(A0*(T**2) + B*T + C + D/T); // vapour pressure at saturation
  const f = 1.00062 + (3.14*(10**-8) * P) + 5.6*(10**-7)*(T_C**2) // enhancement factor
  const x_v = h * f * P_sv / P; // mole fraction of water

  // defining constants for calculating Z
  const a_0 = 1.58123 * (10**-6);
  const a_1 = -2.9331 * (10**-8);
  const a_2 = 1.1043 * (10**-10);
  const b_0 = 5.707 * (10**-6);
  const b_1 = -2.051 * (10**-8);
  const c_0 = 1.9898 * (10**-4);
  const c_1 = 2.376 * (10**-6);
  const d = 1.83 * (10**-11);
  const e0 = -0.765 * (10**-8);

  const Z = 1 - ((P / T) * (a_0 + a_1*T_C + a_2*(T_C**2) + (b_0 + b_1*T_C)*x_v + (c_0 + c_1*T_C)*(x_v**2)
          + ((P/T)**2) * (d + e0*(x_v**2))));

  // calculating air density
  const rho = ((P * (M_a / 1000)) / (Z * R * T)) * (1 - x_v*(1 - (M_v / M_a)));

  // used later to account for wind speed
  const n = 0.37 - 0.0881*Math.log(Math.abs(v_wind))


  // dynamic loft
  const thetaDeg = staticLoft + 3.3
  const theta = thetaDeg * Math.PI / 180;
  
  // coefficient of restitution
  const e = 0.86 - 0.0029 * v_ci * Math.cos(theta);

  // moment of inertia of the ball
  const I = 0.4 * m * (r ** 2);
  
  // initial components of ball's velocity normal and perpendicular to the club face
  const v_bfn = (1+e) * v_ci * Math.cos(theta) / (1 + (m / M));
  const v_bfp = -v_ci * Math.sin(theta) / (1 + (m/M) + (m * (r**2) / I));

  // launch angle of ball (initial)
  const psi = theta + Math.atan(v_bfp / v_bfn);

  // speed of ball
  const v_b = Math.sqrt( (v_bfn ** 2) + (v_bfp ** 2) );

  // angular velocity of ball
  let w_b = -m * v_bfp * r / I;

  // setting initial position of ball
  let x = 0;
  let y = 0;

  // resolving initial velocity of ball relative to x/y directions
  let v_x = v_b * Math.cos(psi);
  let v_y = v_b * Math.sin(psi);

  // stores ball path for trajectory graph
  let points = [];
  while (y >= 0) {
    // apply wind
    const v_windcurrent = v_wind === 0 ? 0 : v_wind * ((y / 10)**n); // 0 if v_wind = 0, otherwise uses the formula
    const v_relx = v_x - v_windcurrent; // v_windcurrent > 0 means tail wind

    // calculate angle (relative motion to the air)
    let phi = Math.atan(v_y / v_relx);

    // relative speed of ball
    const v_rel = Math.sqrt( (v_relx ** 2) + (v_y ** 2) );

    // LIFT COEFFICIENT
    const S = w_b * r / v_rel;
    const C_l = -3.25 * (S ** 2) + 1.99 * S;

    // DRAG COEFFICIENT
    // reynold's number
    const Re = rho * v_rel * (2*r) / mu;

    // drag coefficient (at high speeds)
    const C_d = 1.91*(10**-11)*(Re**2) - 5.40*(10**-6)*(Re) + 0.56;

    // calculate forces
    const F_l = 0.5 * rho * A * C_l * v_rel**2;
    const F_d = 0.5 * rho * A * C_d * v_rel**2;

    // calculate accelerations
    const a_x = (-F_d * Math.cos(phi) - F_l * Math.sin(phi)) / m;
    const a_y = (-F_d * Math.sin(phi) + F_l * Math.cos(phi)) / m - g;
    const a_w = -0.00002 * w_b * v_rel / r

    // calculate velocities
    v_x += a_x * GLOBAL_PHYSICS.DT;
    v_y += a_y * GLOBAL_PHYSICS.DT;
    w_b += a_w * GLOBAL_PHYSICS.DT;

    // update position
    x += v_x * GLOBAL_PHYSICS.DT;
    y += v_y * GLOBAL_PHYSICS.DT;

    // stores trajectory of ball
    
    points.push({x, y: Math.max(0, y)})
  }

  return {points, psi};
}

// returns the max distance and associated launch angle from the simulate function
function getDistance(loftDeg, loc, tailWind) {
  const info = simulate(loftDeg, loc, tailWind); // has both trajectory and launch angle
  const max_distance = info.points[info.points.length - 1].x;
  return [max_distance, info.psi * 180/Math.PI];
}


// creating the component for the information cards at the bottom
function StatCard({ label, value, sub, highlight }) {
  return (
    <div className={`stat-card${highlight ? " highlight" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}


function findOptimal(data, key) {
  return data.reduce(
    (best, d) => d[key] > best[key] ? d : best,
    data[0]
  );
}


function getDistancePerLoft(loftAngles, loc) {
  // running the simulate function on every loft and storing the results + launch angles
  const data = loftAngles.map(loft => {
    const [headwindDistance, headwindLaunchAngle] = getDistance(loft, loc, false);
    const [tailwindDistance, tailwindLaunchAngle] = getDistance(loft, loc, true);
    return { loft, headwindDistance, headwindLaunchAngle, tailwindDistance, tailwindLaunchAngle };
  });

  // finding the optimal distance from the data
  const rawOptimalHeadwind = findOptimal(data, "headwindDistance");
  const rawOptimalTailwind = findOptimal(data, "tailwindDistance");

  // cleaning up the return to make it nicer to refer to
  const optimalHeadwind = {
    loft:        rawOptimalHeadwind.loft,
    distance:    rawOptimalHeadwind.headwindDistance,
    launchAngle: rawOptimalHeadwind.headwindLaunchAngle,
  };

  const optimalTailwind = {
    loft:        rawOptimalTailwind.loft,
    distance:    rawOptimalTailwind.tailwindDistance,
    launchAngle: rawOptimalTailwind.tailwindLaunchAngle,
  };

  return { data, optimalHeadwind, optimalTailwind };
}


export default function App() {
  // used to auto-scroll when opening the information tab at bottom
  const detailsRef = useRef(null);
  function toggleDetails() {
    const opening = !detailsOpen;
    setDetailsOpen(opening);
    if (opening) {
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }

  // used to help change values for the custom location
  function updateCustomLoc(field, value) {
    setCustomLoc(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
  }

  // retrieving constants and setting variables
  const [locationKey, setLocationKey] = useState("standrews");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tailWind, setTailWind] = useState(false);
  const [customLoc, setCustomLoc] = useState({
    name: "Custom",
    period: "Custom",
    altitudeM: 100,
    tempC: 15,
    humidity: 70,
    windSpeedMS: 3,
    gravity: 9.81
  });

  // uses custom loc if selected
  const loc = locationKey === "custom" ? customLoc : LOCATIONS[locationKey];

  const loftAngles = useMemo(() => {
    const angles = [];
    for (let i = GLOBAL_PHYSICS.loftMinDEG; i <= GLOBAL_PHYSICS.loftMaxDEG; i+=0.1) {
      angles.push(Math.round(i*10)/10);
    }
    return angles;
  }, []);


  // runs simulate function on every loft value in loftAngles
  const { data: loftData, optimalHeadwind, optimalTailwind } = useMemo(() => {
    return getDistancePerLoft(loftAngles, loc);
  }) 

  // used to plot trajectories as we only want steps of 1˚ for each trajectory path shown
  const loftAnglesInt = useMemo(() => {
    const angles = [];
    for (let i = GLOBAL_PHYSICS.loftMinDEG; i <= GLOBAL_PHYSICS.loftMaxDEG; i++) {
      angles.push(i);
    }
    return angles;
  }, []);

  const allPaths = useMemo(() => {
    return loftAnglesInt.map(loft => ({
      loft,
      path: simulate(loft, loc, tailWind).points,
      isOptimal: Math.round(tailWind ? optimalTailwind.loft : optimalHeadwind.loft) === loft,
    }));
  }, [locationKey, customLoc, tailWind]);


  return (
    <div>
      <header className="header">
        <div>
          <div className="brand-title">Golf Physics Simulator</div>
        </div>
        <nav className="loc-nav">
          {Object.entries(LOCATIONS).map(([key, l]) => (
            <button
              key={key}
              className={`loc-btn${locationKey === key ? " active" : ""}`}
              onClick={() => setLocationKey(key)}
            >
              <span className="loc-btn-name">{l.name}</span>
              <span className="loc-btn-period">{l.subtitle}</span>
              <span className="loc-btn-period">{l.period}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        <div className="stats-row">
          <StatCard
            label="Optimal static loft"
            value={`${optimalHeadwind.loft}° - ${optimalTailwind.loft}°`}
            sub="for maximum carry distance"
            highlight
          />
          <StatCard
            label="Maximum carry"
            value={`${Math.round(optimalHeadwind.distance*10) / 10}m - ${Math.round(optimalTailwind.distance*10) / 10}m`}
            sub={`with optimal static loft`}
            highlight
          />
        </div>
        <div className="graphs-row">
          <div className="graph-card">
            <div className="graph-title">Carry distance as a function of static loft</div>
            <div className="graph-sub">{loc.name} · {loc.period}</div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={loftData} margin={{ top: 5, right: 10, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="loft"
                  tick={{ fontSize: 11 }}
                  ticks={[0, 5, 10, 15, 20, 25, 30, 35]}
                  label={{ value: "Static loft (°)", position: "insideBottom", offset: -14, fontSize: 11, fill: "#999" }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  label={{ value: "Carry distance (m)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#999" }}
                />
                <Tooltip
                  formatter={(v) => [`${v.toFixed(1)}m`, "Carry distance"]}
                  labelFormatter={(l) => `Static loft : ${l}°`}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)" }}
                />
                <ReferenceLine
                  x={optimalHeadwind.loft}
                  stroke="#2d5a27"
                  strokeDasharray="4 3"
                  label={{ value: `${optimalHeadwind.loft}° optimal`, position: "top", fontSize: 10, fill: "#2d5a27" }}
                />
                <ReferenceLine
                  x={optimalTailwind.loft}
                  stroke="#2d5a27"
                  strokeDasharray="4 3"
                  label={{ value: `${optimalTailwind.loft}° optimal`, position: "top", fontSize: 10, fill: "#2d5a27" }}
                />
                <Line
                  type="monotone"
                  dataKey="headwindDistance"
                  stroke="#1a6bb5"
                  strokeWidth={2}
                  dot={{ r: 0, fill: "#1a6bb5", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  name="Headwind"
                />
                <Line
                  type="monotone"
                  dataKey="tailwindDistance"
                  stroke="#ed133f"
                  strokeWidth={2}
                  dot={{ r: 0, fill: "#1a6bb5", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  name="Tailwind"
                />
                <Legend verticalAlign="top" align="right"/>
              </LineChart>
            </ResponsiveContainer>
            <div className="optimal-callout">
              Headwind: <strong>{Math.round(optimalHeadwind.loft*10)/10}˚ static loft</strong> achieves a maximum carry of <strong>{Math.round(optimalHeadwind.distance*10) / 10}m </strong>
              with a launch angle of <strong>{Math.round(optimalHeadwind.launchAngle*10)/10}˚</strong>
              <br/>Tailwind: <strong>{Math.round(optimalTailwind.loft*10)/10}˚ static loft</strong> achieves a maximum carry of <strong>{Math.round(optimalTailwind.distance*10) / 10}m </strong>
              with a launch angle of <strong>{Math.round(optimalTailwind.launchAngle*10)/10}˚</strong>
            </div>
          </div>
          <div className="graph-card">
            <div className="graph-title">Ball trajectory for a range of static lofts</div>
            <div className="graph-sub">{loc.name} · static lofts {GLOBAL_PHYSICS.loftMinDEG}-{GLOBAL_PHYSICS.loftMaxDEG}°</div>

            <ResponsiveContainer width="100%" height={280}>
              <LineChart margin={{ top: 5, right: 10, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Horizontal displacement (m)", position: "insideBottom", offset: -14, fontSize: 11, fill: "#999" }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  label={{ value: "Height (m)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#999" }}
                />
                {allPaths.map(({ loft, path, isOptimal }) => (
                  <Line
                    key={loft}
                    data={path}
                    type="monotone"
                    dataKey="y"
                    stroke={isOptimal ? "#ed133f" : "#16b8e0"}
                    strokeWidth={isOptimal ? 2.5 : 1.2}
                    strokeOpacity={isOptimal ? 1 : 0.3}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    name={`${loft}°`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

            <div className="optimal-callout">
              <strong style={{ color: "#ed133f" }}>Red</strong>: optimal static loft {Math.round(optimalHeadwind.loft * 10) / 10}° &nbsp;&nbsp;
              <strong style={{ color: "#27a3c2" }}>Blue</strong>: integer static lofts from 0-35˚
            </div>
          </div>
        </div>
        <div className="details-wrap" ref={detailsRef}>
          <button
            className="details-toggle"
            onClick={toggleDetails}
          >
            <span className={`details-arrow${detailsOpen ? " open" : ""}`}>▼</span>
            Environmental and physical / mathematical values
          </button>

          {detailsOpen && (
            <div className="details-body">
              <div className="details-section">
                <div className="details-head">Location - {loc.name}</div>
                {[
                  ["altitudeM", "Altitude", "m"],
                  ["tempC", "Temperature", "°C"],
                  ["humidity", "Humidity", "%"],
                  ["gravity", "Gravity", "m/s²"],
                ].map(([field, label, unit]) => (
                  <div key={label} className="details-row">
                    <span className="details-row-label">{label}</span>
                    {locationKey === "custom" ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, "justifyContent": "flex-end" }}>
                        <input
                          type="number"
                          value={customLoc[field]}
                          onChange={e => updateCustomLoc(field, e.target.value)}
                          className="custom-input"
                        />
                        <span className="details-row-value" style={{ color: "#aaa", minWidth:28 }}>{unit}</span>
                      </span>
                    ) : (
                      <span className="details-row-value">{loc[field]} {unit}</span>
                    )}
                  </div>
                ))}
                <div className="details-row">
                  <span className="details-row-label">Wind speed ({tailWind ? "Tailwind" : "Headwind"})</span>
                  <button 
                      onClick={() => setTailWind(w => !w)}
                      className={`wind-toggle${tailWind ? " tailwind" : ""}`}
                    >
                      {tailWind ? "Change to Headwind" : "Change to Tailwind"}
                    </button>
                  {locationKey === "custom" ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, "justifyContent": "flex-end" }}>
                        <input
                          type="number"
                          value={customLoc["windSpeedMS"]}
                          onChange={e => updateCustomLoc("windSpeedMS", e.target.value)}
                          className="custom-input"
                        />
                        <span className="details-row-value" style={{ color: "#aaa", minWidth:28 }}>m/s</span>
                      </span>
                    </span>
                  ) : (
                    <span className="details-row-value">{loc["windSpeedMS"]} m/s</span>
                  )}
                  
              </div>
              </div>
              <div className="details-section">
                <div className="details-head">Physical and mathematical values</div>
                {[
                  ["Ball mass", `${GLOBAL_PHYSICS.ballMassKG} kg`],
                  ["Ball radius", `${GLOBAL_PHYSICS.ballRadiusM} m`],
                  ["Club mass",`${GLOBAL_PHYSICS.clubMassKG} kg`],
                  ["Club speed",   `${GLOBAL_PHYSICS.clubSpeedMS} m/s`],
                  ["Timestep",     `${GLOBAL_PHYSICS.DT} s`],
                  ["Loft range",   `${GLOBAL_PHYSICS.loftMinDEG}° - ${GLOBAL_PHYSICS.loftMaxDEG}°`],
                ].map(([label, value]) => (
                  <div key={label} className="details-row">
                    <span className="details-row-label">{label}</span>
                    <span className="details-row-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
