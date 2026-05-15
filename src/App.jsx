import { useState, useEffect, useRef, useCallback } from "react";

const PRESETS = {
  "Low Voice":  { voiceBoost: 3.5, threshold: -45, lowCut: 80,  highCut: 3500 },
  "Whisper":    { voiceBoost: 5.0, threshold: -55, lowCut: 100, highCut: 2800 },
  "Conference": { voiceBoost: 2.5, threshold: -35, lowCut: 200, highCut: 4000 },
  "Studio":     { voiceBoost: 1.5, threshold: -25, lowCut: 80,  highCut: 8000 },
};

export default function AmplifyNoise() {
  const [active, setActive]               = useState(false);
  const [preset, setPreset]               = useState("Low Voice");
  const [params, setParams]               = useState(PRESETS["Low Voice"]);
  const [inputLevel, setInputLevel]       = useState(0);
  const [outputLevel, setOutputLevel]     = useState(0);
  const [freqBars, setFreqBars]           = useState(new Array(32).fill(0));
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [status, setStatus]               = useState("STANDBY");
  const [noiseFloor, setNoiseFloor]       = useState(-60);
  const [error, setError]                 = useState(null);

  const ctxRef         = useRef(null);
  const streamRef      = useRef(null);
  const gainRef        = useRef(null);
  const hpRef          = useRef(null);
  const lpRef          = useRef(null);
  const compRef        = useRef(null);
  const inAnalyserRef  = useRef(null);
  const outAnalyserRef = useRef(null);
  const rafRef         = useRef(null);
  const nfRef          = useRef(-60);
  const paramsRef      = useRef(params);

  useEffect(() => { paramsRef.current = params; }, [params]);

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { ctxRef.current?.close(); } catch (_) {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current    = null;
    streamRef.current = null;
    setActive(false);
    setStatus("STANDBY");
    setInputLevel(0);
    setOutputLevel(0);
    setFreqBars(new Array(32).fill(0));
    setVoiceDetected(false);
  }, []);

  const tick = useCallback(() => {
    const inAn  = inAnalyserRef.current;
    const outAn = outAnalyserRef.current;
    if (!inAn || !outAn) return;

    const inData  = new Uint8Array(inAn.frequencyBinCount);
    const outData = new Uint8Array(outAn.frequencyBinCount);
    inAn.getByteFrequencyData(inData);
    outAn.getByteFrequencyData(outData);

    const inAvg  = inData.reduce((a, b) => a + b, 0) / inData.length / 255;
    const outAvg = outData.reduce((a, b) => a + b, 0) / outData.length / 255;

    const db = inAvg > 0 ? 20 * Math.log10(Math.max(inAvg, 0.0001)) : -80;
    nfRef.current = nfRef.current * 0.97 + db * 0.03;

    const detected = db > nfRef.current + 8;
    setInputLevel(Math.min(1, inAvg * 3));
    setOutputLevel(Math.min(1, outAvg * 3));
    setVoiceDetected(detected);
    setNoiseFloor(Math.round(nfRef.current));

    const step = Math.max(1, Math.floor(inData.length / 32));
    const bars = Array.from({ length: 32 }, (_, i) => inData[Math.min(i * step, inData.length - 1)] || 0);
    setFreqBars(bars);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("CONNECTING…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);

      // Input analyser — taps raw mic, monitor only (not connected to output)
      const inAnalyser = ctx.createAnalyser();
      inAnalyser.fftSize = 64;
      inAnalyser.smoothingTimeConstant = 0.75;
      inAnalyserRef.current = inAnalyser;

      // HP filter — kill low rumble/noise
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = paramsRef.current.lowCut;
      hp.Q.value = 0.7;
      hpRef.current = hp;

      // LP filter — kill hiss/high freq noise
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = paramsRef.current.highCut;
      lp.Q.value = 0.7;
      lpRef.current = lp;

      // Compressor — gate noise, let voice through
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = paramsRef.current.threshold;
      comp.knee.value = 10;
      comp.ratio.value = 10;
      comp.attack.value = 0.003;
      comp.release.value = 0.1;
      compRef.current = comp;

      // Output gain — voice amplification
      const gain = ctx.createGain();
      gain.gain.value = paramsRef.current.voiceBoost;
      gainRef.current = gain;

      // Output analyser — post-processing level meter
      const outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 64;
      outAnalyser.smoothingTimeConstant = 0.75;
      outAnalyserRef.current = outAnalyser;

      // Graph:
      // source ──► inAnalyser                            (monitor branch)
      // source ──► hp ──► lp ──► comp ──► gain ──► outAnalyser ──► destination
      source.connect(inAnalyser);
      source.connect(hp);
      hp.connect(lp);
      lp.connect(comp);
      comp.connect(gain);
      gain.connect(outAnalyser);
      outAnalyser.connect(ctx.destination);

      rafRef.current = requestAnimationFrame(tick);
      setActive(true);
      setStatus("ACTIVE");
    } catch (e) {
      setError(e.message || "Microphone access denied");
      setStatus("ERROR");
    }
  }, [tick]);

  const applyPreset = (name) => {
    const p = PRESETS[name];
    setPreset(name);
    setParams(p);
    if (gainRef.current) gainRef.current.gain.value = p.voiceBoost;
    if (compRef.current) compRef.current.threshold.value = p.threshold;
    if (hpRef.current)   hpRef.current.frequency.value = p.lowCut;
    if (lpRef.current)   lpRef.current.frequency.value = p.highCut;
  };

  const updateParam = (key, val) => {
    setParams(prev => {
      const next = { ...prev, [key]: val };
      if (key === "voiceBoost" && gainRef.current) gainRef.current.gain.value = val;
      if (key === "threshold"  && compRef.current) compRef.current.threshold.value = val;
      if (key === "lowCut"     && hpRef.current)   hpRef.current.frequency.value = val;
      if (key === "highCut"    && lpRef.current)   lpRef.current.frequency.value = val;
      return next;
    });
  };

  useEffect(() => () => stopAll(), [stopAll]);

  const vuColor = l => l > 0.8 ? "#ef4444" : l > 0.5 ? "#f59e0b" : "#00ff9d";

  const VUMeter = ({ level, label }) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <div style={{ fontSize:9, letterSpacing:"0.2em", color:"#3a3a3a" }}>{label}</div>
      <div style={{
        width:18, height:80, background:"#080808",
        border:"1px solid #1a1a1a", position:"relative",
        display:"flex", flexDirection:"column-reverse", overflow:"hidden",
      }}>
        <div style={{
          width:"100%", height:`${level * 100}%`,
          background:`linear-gradient(to top, ${vuColor(level)}, ${vuColor(level)}88)`,
          transition:"height 0.06s",
          boxShadow: level > 0.05 ? `0 0 8px ${vuColor(level)}44` : "none",
        }}/>
        {[0.8, 0.5, 0.2].map(m => (
          <div key={m} style={{
            position:"absolute", bottom:`${m * 100}%`,
            width:"100%", height:1, background:"#1a1a1a",
          }}/>
        ))}
      </div>
      <div style={{ fontSize:8, color:"#2a2a2a", letterSpacing:"0.1em" }}>
        {Math.round(level * 100)}
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight:"100vh", background:"#070707",
      fontFamily:"'DM Mono','Courier New',monospace",
      color:"#e0e0e0", display:"flex", flexDirection:"column",
      alignItems:"center", padding:"32px 16px",
      position:"relative", overflow:"hidden",
    }}>
      {/* Grid overlay */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        backgroundImage:"linear-gradient(rgba(0,255,157,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,157,0.025) 1px,transparent 1px)",
        backgroundSize:"32px 32px",
      }}/>

      {/* Header */}
      <div style={{ position:"relative", zIndex:1, textAlign:"center", marginBottom:36 }}>
        <div style={{ fontSize:10, letterSpacing:"0.35em", color:"#00ff9d", opacity:0.55, marginBottom:6 }}>
          SENTINEL AUDIO // v2.1
        </div>
        <h1 style={{
          fontSize:40, fontWeight:700, margin:0,
          fontFamily:"'Courier New',monospace", letterSpacing:"-0.02em",
          background:"linear-gradient(135deg,#fff 0%,#00ff9d 100%)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        }}>AMPLIFY</h1>
        <div style={{ fontSize:10, letterSpacing:"0.2em", color:"#2a2a2a", marginTop:4 }}>
          LOW-VOICE ISOLATION ENGINE
        </div>
      </div>

      {/* Main panel */}
      <div style={{
        position:"relative", zIndex:1, width:"100%", maxWidth:700,
        background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:2,
      }}>
        {/* Status bar */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"10px 20px", borderBottom:"1px solid #141414", background:"#090909",
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:7, height:7, borderRadius:"50%",
              background: active ? (voiceDetected ? "#00ff9d" : "#f59e0b") : "#1e1e1e",
              boxShadow: active ? `0 0 8px ${voiceDetected ? "#00ff9d" : "#f59e0b"}` : "none",
              transition:"all 0.15s",
            }}/>
            <span style={{ fontSize:11, letterSpacing:"0.2em", color: active ? "#fff" : "#444" }}>
              {status}
            </span>
          </div>
          <span style={{ fontSize:10, color:"#252525", letterSpacing:"0.12em" }}>
            NF: <span style={{ color:"#383838" }}>{noiseFloor}dB</span>
          </span>
          <span style={{
            fontSize:10, letterSpacing:"0.15em",
            color: voiceDetected ? "#00ff9d" : "#252525",
            transition:"color 0.1s",
          }}>
            {voiceDetected ? "▸ VOICE LOCKED" : "▸ SCANNING"}
          </span>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            margin:"12px 20px 0", padding:"10px 14px",
            border:"1px solid #3a1212", background:"rgba(239,68,68,0.06)",
            fontSize:11, color:"#ef4444", letterSpacing:"0.1em",
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Spectrum + VU meters */}
        <div style={{ padding:"20px 20px 0", display:"flex", gap:16, alignItems:"flex-start" }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, letterSpacing:"0.25em", color:"#252525", marginBottom:8 }}>
              FREQUENCY SPECTRUM
            </div>
            <div style={{
              display:"flex", alignItems:"flex-end", gap:2,
              height:80, background:"#080808", padding:"8px 8px 0",
              border:"1px solid #141414",
            }}>
              {freqBars.map((v, i) => (
                <div key={i} style={{
                  flex:1, minHeight:1,
                  height:`${(v / 255) * 100}%`,
                  background:`rgba(0,255,157,${0.08 + (v / 255) * 0.85})`,
                  borderTop: v > 30 ? "1px solid rgba(0,255,157,0.35)" : "none",
                  transition:"height 0.06s",
                }}/>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", gap:10, paddingTop:17 }}>
            <VUMeter level={inputLevel}  label="IN"/>
            <VUMeter level={outputLevel} label="OUT"/>
          </div>
        </div>

        {/* Presets */}
        <div style={{ padding:"18px 20px 0" }}>
          <div style={{ fontSize:9, letterSpacing:"0.25em", color:"#252525", marginBottom:10 }}>
            PRESETS
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {Object.keys(PRESETS).map(name => (
              <button key={name} onClick={() => applyPreset(name)} style={{
                padding:"7px 14px", fontSize:10, letterSpacing:"0.15em",
                border:`1px solid ${preset === name ? "#00ff9d" : "#1a1a1a"}`,
                background: preset === name ? "rgba(0,255,157,0.07)" : "transparent",
                color: preset === name ? "#00ff9d" : "#3a3a3a",
                cursor:"pointer", borderRadius:1, transition:"all 0.15s",
              }}>
                {name.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div style={{ padding:20, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"18px 32px" }}>
          {[
            { key:"voiceBoost", label:"VOICE BOOST",    min:0.5, max:8,     step:0.1, fmt: v => `${v.toFixed(1)}×` },
            { key:"threshold",  label:"GATE THRESHOLD", min:-80, max:-10,   step:1,   fmt: v => `${v}dB` },
            { key:"lowCut",     label:"LOW CUT (HP)",   min:60,  max:500,   step:10,  fmt: v => `${v}Hz` },
            { key:"highCut",    label:"HIGH CUT (LP)",  min:1000,max:12000, step:100, fmt: v => v >= 1000 ? `${(v/1000).toFixed(1)}kHz` : `${v}Hz` },
          ].map(({ key, label, min, max, step, fmt }) => {
            const pct = ((params[key] - min) / (max - min)) * 100;
            return (
              <div key={key} style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, letterSpacing:"0.2em", color:"#3a3a3a" }}>{label}</span>
                  <span style={{ fontSize:10, color:"#00ff9d", letterSpacing:"0.1em" }}>{fmt(params[key])}</span>
                </div>
                <input
                  type="range" min={min} max={max} step={step} value={params[key]}
                  onChange={e => updateParam(key, parseFloat(e.target.value))}
                  style={{
                    width:"100%", appearance:"none", WebkitAppearance:"none",
                    height:2, outline:"none", border:"none", cursor:"pointer",
                    background:`linear-gradient(to right,#00ff9d ${pct}%,#1a1a1a ${pct}%)`,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Engage/Disengage */}
        <div style={{ padding:"4px 20px 28px", display:"flex", justifyContent:"center" }}>
          <button onClick={active ? stopAll : start} style={{
            width:220, height:52,
            border:`1px solid ${active ? "#ef4444" : "#00ff9d"}`,
            background: active ? "rgba(239,68,68,0.07)" : "rgba(0,255,157,0.05)",
            color: active ? "#ef4444" : "#00ff9d",
            fontSize:11, letterSpacing:"0.3em", cursor:"pointer",
            transition:"all 0.2s", borderRadius:1,
            boxShadow: active
              ? "0 0 20px rgba(239,68,68,0.12)"
              : "0 0 20px rgba(0,255,157,0.08)",
          }}>
            {active ? "DISENGAGE" : "ENGAGE"}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        position:"relative", zIndex:1, marginTop:20,
        fontSize:9, color:"#1a1a1a", letterSpacing:"0.2em", textAlign:"center",
      }}>
        WEB AUDIO API // HP → LP → COMPRESSOR → GAIN // REAL-TIME DSP
      </div>

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance:none;
          width:12px; height:12px; border-radius:50%;
          background:#00ff9d; cursor:pointer;
          box-shadow:0 0 6px rgba(0,255,157,0.6);
        }
        input[type=range]::-moz-range-thumb {
          width:12px; height:12px; border-radius:50%;
          background:#00ff9d; cursor:pointer;
          border:none;
          box-shadow:0 0 6px rgba(0,255,157,0.6);
        }
      `}</style>
    </div>
  );
}
