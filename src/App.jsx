import "./App.css";
import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, Legend } from "recharts";


const LOCATIONS = {
  standrews: {
    name: "St Andrews",
    period: "July 10-17th, 2027",
    altitudeM: 24, 
    tempC: 14.6,
    humidity: 77,   // percentage
    windSpeedMS: 4.42,  
    gravity: 9.81
  },

  lapaz: {
    name: "Bolivia",
    period: "August 2027",
    altitudeM: 3600,
    tempC: 5.2,
    humidity: 67,
    windSpeedMS: 3.14,
    gravity: 9.77
  },

  philippines: {
    name: "Philippines",
    period: "January 2027",
    altitudeM: 300,
    tempC: 6.3,
    humidity: 79,
    windSpeedMS: 3.9,
    gravity: 9.81
  }
}


const GLOBAL_PHYSICS = {
  ballMassKG: 0.04593,
  ballRadiusM: 0.02135,
  clubMassKG: 0.2,
  clubSpeedMS: 45, 
  loftMinDEG: 0,  
  loftMaxDEG: 30,
  DT: 0.001  // timestep for simulation
} 


function simulate(staticLoft, loc) {
  // storing these using math variable names for brevity
  const v_ci = GLOBAL_PHYSICS.clubSpeedMS;
  const M = GLOBAL_PHYSICS.clubMassKG;
  const m = GLOBAL_PHYSICS.ballMassKG;
  const r = GLOBAL_PHYSICS.ballRadiusM;

  const g = loc.gravity;
  const v_wind = loc.windSpeedMS;
  const T_C = loc.tempC; // temperature in celsius
  const T = loc.tempC + 273.15; // convert to kelvin
  const z = loc.altitudeM;
  const h = loc.humidity / 100; // relative humidity as decimal [0-1]

  // pre-calculating constants for later
  const A = Math.PI * ( r ** 2 );

  const M_v = 18.02; // molar mass of water
  const M_a = 28.97; // molar mass of dry air in g/mol
  const m_a = M_a / (6.022*(10**26)) // converting molar mass to average mass of single dry air molecule, kg
  const k = 1.381 * (10**-23);
  const R = 8.314; // J mol^-1 K^-1

  // used later to account for wind speed
  const n = 0.37 - 0.0881*Math.log(v_wind)

  // BEGINNING OF THE MATH IN RESEARCH DOC

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

  // launch angle of ball
  let psi = theta + Math.atan(v_bfp / v_bfn);

  // speed of ball
  const v_bo = Math.sqrt( (v_bfn ** 2) + (v_bfp ** 2) );

  // angular velocity of ball
  let w_b = -m * v_bfp * r / I;

  // setting initial position of ball
  let x = 0;
  let y = 0;

  // resolving initial velocity of ball relative to x/y directions
  let v_x = v_bo * Math.cos(psi);
  let v_y = v_bo * Math.sin(psi);

  while (y >= 0) {
    // apply a wind
    const v_windcurrent = v_wind * ((y / 10)**n);
    const v_relx = v_x - v_windcurrent; // v_windcurrent > 0 means tail wind and vice versa

    // calculate new angle based on vy/vx
    let psi = Math.atan(v_y / v_relx);

    // relative speed of ball
    const v_rel = Math.sqrt( (v_relx ** 2) + (v_y ** 2) );

    // LIFT COEFFICIENT
    const S = w_b * r / v_rel;
    const C_l = -3.25 * (S ** 2) + 1.99 * S;

    // DRAG COEFFICIENT

    // sutherland's law for air viscosity
    // https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_high_mach.08.43.html
    const mu = 1.716*(10**-5) * ((T / 273)**1.5) * (273+111) / (T+111);

    // barometric formula for air pressure
    // https://web.tecnico.ulisboa.pt/berberan/data/43.pdf
    const P = 101325 * Math.exp( - m_a * g * z / (k * T));

    // air density using ideal gas law

    const A = 1.2378847 * (10**-5);
    const B = -1.9121316 * (10**-2);
    const C = 33.93711047;
    const D = -6.3431645 * (10**3);
    const P_sv = 1 * Math.exp(A*(T**2) + B*T + C + D/T); // vapour pressure at saturation
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
    const e = -0.765 * (10**-8);

    const Z = 1 - ((P / T) * (a_0 + a_1*T_C + a_2*(T_C**2) + (b_0 + b_1*T_C)*x_v + (c_0 + c_1*T_C)*(x_v**2)
            + ((P/T)**2) * (d + e*(x_v**2))));

    const rho = ((P * (M_a / 1000)) / (Z * R * T)) * (1 - x_v*(1 - (M_v / M_a)));

    // reynold's number
    const Re = rho * v_rel * (2*r) / mu;

    // drag coefficient (at high speeds)
    const C_d = 1.91*(10**-11)*(Re**2) - 5.40*(10**-6)*(Re) + 0.56;

    const F_l = 0.5 * rho * A * C_l * v_rel**2;
    const F_d = 0.5 * rho * A * C_d * v_rel**2;

    const a_x = (-F_d * Math.cos(psi) - F_l * Math.sin(psi)) / m;
    const a_y = (-F_d * Math.sin(psi) + F_l * Math.cos(psi)) / m - g;
    const a_w = -0.00002 * w_b * v_rel / r

    v_x += a_x * GLOBAL_PHYSICS.DT;
    v_y += a_y * GLOBAL_PHYSICS.DT;
    w_b += a_w * GLOBAL_PHYSICS.DT;

    x += v_x * GLOBAL_PHYSICS.DT;
    y += v_y * GLOBAL_PHYSICS.DT;

    
  }

  return x;
}


function getDistance(loftDeg, loc) {
  // seems arbitrary but useful later on if trajectory paths are used
  // since simulate function will return a path
  // this is just a bit easier to work with than [0]'ing a returned array
  return simulate(loftDeg, loc)
}


// creating the component for the information cards at the bottom
function StatCard({ label, value, sub, highlight }) {
  return (
    <div className={`stat-card${highlight ? " highlight" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {/* Only render the sub line if a sub prop was provided */}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}


export default function App() {
  // retrieving constants and setting variables
  
  const [locationKey, setLocationKey] = useState("standrews");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const loc = LOCATIONS[locationKey];

  const loftAngles = useMemo(() => {
    const angles = [];
    for (let i = GLOBAL_PHYSICS.loftMinDEG; i <= GLOBAL_PHYSICS.loftMaxDEG; i+=0.1) {
      angles.push(Math.round(i*10)/10);
    }
    return angles;
  }, []);


  // running simulate function to get dict assocating each loft with a distance
  const distancePerLoft = useMemo(() => {
    return loftAngles.map(loft => ({
      loft,
      distance: getDistance(loft, loc),
    }));
  }, [locationKey]);

  const optimalEntry   = distancePerLoft.reduce(
    (best, d) => d.distance > best.distance ? d : best,
    distancePerLoft[0]
  );

  const optimalLoft = optimalEntry.loft;
  const maxDistance = optimalEntry.distance;


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
            label="Optimal loft"
            value={`${optimalLoft}°`}
            sub="for max distance"
            highlight
          />
          <StatCard
            label="Max distance"
            value={`${Math.round(maxDistance*10) / 10}m`}
            sub={`with optimal loft`}
            highlight
          />
        </div>
        <div className="graphs-row">
          <div className="graph-card">
            <div className="graph-title">Static loft vs distance</div>
            <div className="graph-sub">{loc.name} · {loc.period}</div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={distancePerLoft} margin={{ top: 5, right: 10, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="loft"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Static loft (°)", position: "insideBottom", offset: -14, fontSize: 11, fill: "#999" }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  label={{ value: "Distance (m)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "#999" }}
                />
                <Tooltip
                  formatter={(v) => [`${v.toFixed(1)} m`, "Carry distance"]}
                  labelFormatter={(l) => `${l}° static loft`}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)" }}
                />
                {/* Vertical dashed line at the optimal loft */}
                <ReferenceLine
                  x={optimalLoft}
                  stroke="#2d5a27"
                  strokeDasharray="4 3"
                  label={{ value: `${optimalLoft}° optimal`, position: "top", fontSize: 10, fill: "#2d5a27" }}
                />
                <Line
                  type="monotone"
                  dataKey="distance"
                  stroke="#1a6bb5"
                  strokeWidth={2}
                  dot={{ r: 1, fill: "#1a6bb5", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="optimal-callout">
              <strong>{Math.round(optimalLoft*10)/10}˚ loft</strong> achieves maximum carry of {Math.round(maxDistance*10) / 10}<strong> m</strong>
            </div>
          </div>
        </div>
        <div className="details-wrap">
          <button
            className="details-toggle"
            onClick={() => setDetailsOpen(o => !o)}
          >
            <span className={`details-arrow${detailsOpen ? " open" : ""}`}>▼</span>
            Location &amp; physics details
          </button>

          {detailsOpen && (
            <div className="details-body">
              <div className="details-section">
                <div className="details-head">Location - {loc.name}</div>
                {[
                  ["Altitude",          `${loc.altitudeM} m`],
                  ["Temperature",       `${loc.tempC} °C`],
                  ["Humidity",          `${loc.humidity} %`],
                  ["Wind speed",        `${loc.windSpeedMS} m/s`],
                  ["Gravity",           `${loc.gravity} m/s²`],
                ].map(([label, value]) => (
                  <div key={label} className="details-row">
                    <span className="details-row-label">{label}</span>
                    <span className="details-row-value">{value}</span>
                  </div>
                ))}
              </div>
              <div className="details-section">
                <div className="details-head">Global physics constants</div>
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