import React, { useEffect, useMemo, useRef, useState } from "react";
// Firebase client is configured in the project root; step out of src to import it
import { db } from "../firebase";
import { ref, onValue, set, push } from "firebase/database";
import "./App.css";

const SENSOR_PATH = "Water_purifier";
const LOG_PATH = "Water_purifier/logs";
const USAGE_SUMMARY_PATH = "Water_purifier/usageSummary";
const OPTION_PATH = "Water_purifier/Option";
const LOG_LIMIT = 10;

const optionButtons = [
  { key: "normal", label: "Normal", value: 1 },
  { key: "uv", label: "UV", value: 2 },
  { key: "ro", label: "RO", value: 3 },
  { key: "uv_ro", label: "UV + RO", value: 4 },
  { key: "tds", label: "TDS", value: 5 },
  { key: "tds_ro", label: "TDS + RO", value: 6 },
  { key: "dispense", label: "Dispense Water", value: 7 },
  { key: "pump_off", label: "Pump Off", value: 8 }
];

function formatTime(ts) {
  if (!ts) return "--";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "--";
  }
}

function getBatteryHealth(battery) {
  if (battery >= 80) return "Excellent";
  if (battery >= 60) return "Good";
  if (battery >= 35) return "Moderate";
  return "Low";
}

function getWaterStatus({ ph, tds, turb, gas }) {
  const safePH = ph >= 6.5 && ph <= 8.5;
  const safeTDS = tds <= 500;
  const safeTurb = turb <= 5;
  const safeOdor = gas <= 1500;

  const safe = safePH && safeTDS && safeTurb && safeOdor;

  return {
    label: safe ? "Safe" : "Unsafe",
    color: safe ? "safe" : "unsafe"
  };
}

function getAlerts(data) {
  const alerts = [];

  if (data.ph < 6.5 || data.ph > 8.5) {
    alerts.push("pH is out of safe range.");
  }
  if (data.tds > 500) {
    alerts.push("High TDS detected.");
  }
  if (data.turb > 5) {
    alerts.push("High turbidity detected.");
  }
  if (data.gas > 1500) {
    alerts.push("Odor level is high.");
  }
  if (data.battery < 25) {
    alerts.push("Low battery warning.");
  }
  return alerts;
}

export default function App() {
  const [sensorData, setSensorData] = useState({
    battery: 0,
    current: 0,
    gas: 0,
    ph: 0,
    tds: 0,
    turb: 0,
    voltage: 0,
    temperature: 0,
    solarCurrent: 0,
    solarStatus: "Not Charging",
    option: 1,
    timestamp: null
  });

  const [controls, setControls] = useState({
    // retained for compatibility; only option is used now
    option: 1
  });

  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const sensorRef = ref(db, SENSOR_PATH);
    const logRef = ref(db, LOG_PATH);
    const optionRef = ref(db, OPTION_PATH);

    const unsubSensors = onValue(sensorRef, (snapshot) => {
      const data = snapshot.val() || {};

      setSensorData({
        battery: Number(data.Battery || 0),
        current: Number(data.Current || 0),
        gas: Number(data.Gas || 0),
        ph: Number(data.Ph || 0),
        tds: Number(data.TDS || 0),
        turb: Number(data.Turb || 0),
        voltage: Number(data.Voltage || 0),
        temperature: Number(data.Temperature || 0),
        solarCurrent: Number(data.SolarCurrent || 0),
        solarStatus:
          Number(data.SolarCurrent || 0) > 0.05 ? "Charging" : "Not Charging",
        option: Number(data.Option || 1),
        timestamp: data.timestamp || Date.now()
      });
    });

    const unsubOption = onValue(optionRef, (snapshot) => {
      const value = snapshot.val();
      setControls((prev) => ({ ...prev, option: Number(value || 1) }));
    });

    const unsubLogs = onValue(logRef, (snapshot) => {
      const data = snapshot.val() || {};
      const arr = Object.keys(data).map((key) => ({
        id: key,
        ...data[key]
      }));

      arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setLogs(arr.slice(0, LOG_LIMIT));
    });

    return () => {
      unsubSensors();
      unsubOption();
      unsubLogs();
    };
  }, []);

  const waterStatus = useMemo(() => {
    return getWaterStatus(sensorData);
  }, [sensorData]);

  const alerts = useMemo(() => {
    return getAlerts(sensorData);
  }, [sensorData]);

  const lastAlertSignatureRef = useRef("");

  useEffect(() => {
    const signature = alerts.join(" | ");
    if (signature && signature !== lastAlertSignatureRef.current) {
      alert(`Alerts detected:\n- ${alerts.join("\n- ")}`);
      lastAlertSignatureRef.current = signature;
    }
  }, [alerts]);

  const batteryHealth = useMemo(() => {
    return getBatteryHealth(sensorData.battery);
  }, [sensorData.battery]);

  const powerUsage = useMemo(() => {
    const voltage = sensorData.voltage || 0;
    const current = sensorData.current || 0;
    return (voltage * current).toFixed(2);
  }, [sensorData.voltage, sensorData.current]);

  const usageSummary = useMemo(() => {
    if (!logs.length) {
      return {
        totalCycles: 0,
        avgTDS: 0,
        avgTurb: 0,
        avgBattery: 0
      };
    }

    const totalCycles = logs.length;
    const avgTDS =
      logs.reduce((sum, item) => sum + Number(item.tds || 0), 0) / totalCycles;
    const avgTurb =
      logs.reduce((sum, item) => sum + Number(item.turb || 0), 0) / totalCycles;
    const avgBattery =
      logs.reduce((sum, item) => sum + Number(item.battery || 0), 0) /
      totalCycles;

    return {
      totalCycles,
      avgTDS: avgTDS.toFixed(1),
      avgTurb: avgTurb.toFixed(1),
      avgBattery: avgBattery.toFixed(1)
    };
  }, [logs]);

  useEffect(() => {
    if (!logs.length) return;

    const summaryPayload = {
      totalCycles: usageSummary.totalCycles,
      avgTDS: Number(usageSummary.avgTDS),
      avgTurb: Number(usageSummary.avgTurb),
      avgBattery: Number(usageSummary.avgBattery)
    };

    // Persist latest usage summary for backend visibility
    set(ref(db, USAGE_SUMMARY_PATH), summaryPayload).catch(() => {
      /* ignore write errors in UI */
    });
  }, [usageSummary, logs.length]);

  const setOptionValue = async (value) => {
    await set(ref(db, OPTION_PATH), value);
    setControls((prev) => ({ ...prev, option: value }));
  };

  const saveCurrentLog = async () => {
    const logEntry = {
      timestamp: Date.now(),
      ph: sensorData.ph,
      tds: sensorData.tds,
      turb: sensorData.turb,
      gas: sensorData.gas,
      temperature: sensorData.temperature,
      battery: sensorData.battery,
      voltage: sensorData.voltage,
      current: sensorData.current,
      solarCurrent: sensorData.solarCurrent,
      solarStatus: sensorData.solarStatus,
      waterStatus: waterStatus.label,
      option: controls.option
    };

    const newLogRef = push(ref(db, LOG_PATH));
    await set(newLogRef, logEntry);
    alert("Current reading saved to logs.");
  };

  return (
    <div className="app">
      <div className="container">
        <header className="hero">
          <div>
            <h1>Solar Water Purification Dashboard</h1>
            <p>
              Real-time water quality monitoring, solar power status, and remote
              hardware control
            </p>
          </div>

          <div className={`status-pill ${waterStatus.color}`}>
            Water Status: {waterStatus.label}
          </div>
        </header>

        <section className="grid top-grid">
          <div className="card highlight">
            <h2>System Overview</h2>
            <div className="overview-grid">
              <div className="metric">
                <span>Battery</span>
                <strong>{sensorData.battery.toFixed(1)}%</strong>
              </div>
              <div className="metric">
                <span>Battery Health</span>
                <strong>{batteryHealth}</strong>
              </div>
              <div className="metric">
                <span>Solar Status</span>
                <strong>{sensorData.solarStatus}</strong>
              </div>
              <div className="metric">
                <span>Solar Current</span>
                <strong>{sensorData.solarCurrent.toFixed(2)} A</strong>
              </div>
              <div className="metric">
                <span>Power Usage</span>
                <strong>{powerUsage} W</strong>
              </div>
              <div className="metric">
                <span>Updated</span>
                <strong>{formatTime(sensorData.timestamp)}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Alerts</h2>
            {alerts.length === 0 ? (
              <div className="ok-box">No critical alerts. System is stable.</div>
            ) : (
              <div className="alert-list">
                {alerts.map((item, index) => (
                  <div className="alert-item" key={index}>
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid sensor-grid">
          <div className="card">
            <h2>Live Water Quality</h2>
            <div className="sensor-list">
              <div className="sensor-row">
                <span>pH</span>
                <strong>{sensorData.ph.toFixed(2)}</strong>
              </div>
              <div className="sensor-row">
                <span>TDS</span>
                <strong>{sensorData.tds.toFixed(2)} ppm</strong>
              </div>
              <div className="sensor-row">
                <span>Turbidity</span>
                <strong>{sensorData.turb.toFixed(2)} NTU</strong>
              </div>
              <div className="sensor-row">
                <span>Odor / Gas Level</span>
                <strong>{sensorData.gas.toFixed(0)}</strong>
              </div>
              <div className="sensor-row">
                <span>Water Temperature</span>
                <strong>{sensorData.temperature.toFixed(1)} °C</strong>
              </div>
              <div className="sensor-row">
                <span>Voltage</span>
                <strong>{sensorData.voltage.toFixed(2)} V</strong>
              </div>
              <div className="sensor-row">
                <span>Current</span>
                <strong>{sensorData.current.toFixed(2)} A</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Operation Options</h2>
            <div className="mode-section">
              <div className="mode-buttons">
                {optionButtons.map((item) => (
                  <button
                    key={item.key}
                    className={
                      controls.option === item.value
                        ? "mode-btn active"
                        : "mode-btn"
                    }
                    onClick={() => setOptionValue(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="save-btn" onClick={saveCurrentLog}>
              Save Current Reading to Log
            </button>
          </div>
        </section>

        <section className="grid summary-grid">
          <div className="card">
            <h2>Usage Summary</h2>
            <div className="overview-grid">
              <div className="metric">
                <span>Saved Cycles</span>
                <strong>{usageSummary.totalCycles}</strong>
              </div>
              <div className="metric">
                <span>Average TDS</span>
                <strong>{usageSummary.avgTDS}</strong>
              </div>
              <div className="metric">
                <span>Average Turbidity</span>
                <strong>{usageSummary.avgTurb}</strong>
              </div>
              <div className="metric">
                <span>Average Battery</span>
                <strong>{usageSummary.avgBattery}%</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Color-Coded Quality Result</h2>
            <div className={`quality-box ${waterStatus.color}`}>
              <div className="quality-title">{waterStatus.label}</div>
              <p>
                Water quality is automatically evaluated using pH, TDS,
                turbidity, and odor level.
              </p>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Previous Filtration Logs (Last 10)</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Option</th>
                  <th>pH</th>
                  <th>TDS</th>
                  <th>Turbidity</th>
                  <th>Battery</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center" }}>
                      No logs available
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatTime(log.timestamp)}</td>
                      <td>
                        <span
                          className={
                            log.waterStatus === "Safe"
                              ? "mini-pill safe"
                              : "mini-pill unsafe"
                          }
                        >
                          {log.waterStatus}
                        </span>
                      </td>
                      <td>{log.option || "-"}</td>
                      <td>{Number(log.ph || 0).toFixed(2)}</td>
                      <td>{Number(log.tds || 0).toFixed(1)}</td>
                      <td>{Number(log.turb || 0).toFixed(1)}</td>
                      <td>{Number(log.battery || 0).toFixed(1)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}