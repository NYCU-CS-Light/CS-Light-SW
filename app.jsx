/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio, TweakSelect, TweakToggle, TweakColor, TweakButton */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============ TWEAKS ============
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "gridRes": "1/16",
  "previewLayout": "line",
  "showFade": true,
  "theme": "dark",
  "paletteMode": "chromatic",
  "ballGlow": 0.85,
  "waveStyle": "wave"
}/*EDITMODE-END*/;

// ============ PALETTES ============
const PALETTES = {
  chromatic: [
    { name: 'Red',     hex: '#ff3b3b' },
    { name: 'Orange',  hex: '#ff8a00' },
    { name: 'Amber',   hex: '#ffc933' },
    { name: 'Green',   hex: '#3ddc84' },
    { name: 'Cyan',    hex: '#22d3ee' },
    { name: 'Blue',    hex: '#3b82f6' },
    { name: 'Violet',  hex: '#a855f7' },
    { name: 'Magenta', hex: '#ec4899' },
  ],
  pastel: [
    { name: 'Blush',   hex: '#ffb3ba' },
    { name: 'Peach',   hex: '#ffd9a8' },
    { name: 'Butter',  hex: '#fff5b3' },
    { name: 'Mint',    hex: '#b8f2c9' },
    { name: 'Sky',     hex: '#b5e2ff' },
    { name: 'Lavender',hex: '#cdb8ff' },
    { name: 'Rose',    hex: '#ffc0e0' },
    { name: 'Sand',    hex: '#e8dcc4' },
  ],
  mono: [
    { name: '15%',  hex: '#262626' },
    { name: '30%',  hex: '#4a4a4a' },
    { name: '45%',  hex: '#6e6e6e' },
    { name: '60%',  hex: '#929292' },
    { name: '75%',  hex: '#b6b6b6' },
    { name: '85%',  hex: '#cfcfcf' },
    { name: '95%',  hex: '#e8e8e8' },
    { name: '100%', hex: '#ffffff' },
  ],
  // ROYGBIV + white, tuned for what a real RGB LED actually emits. Each swatch
  // uses primaries only (no muddying mid-tones), so when the firmware's
  // calibration LUT scales the channels, the on-device color reads cleanly as
  // the named hue rather than as a wash of all three channels.
  realworld: [
    { name: 'Red',    hex: '#ff0000' },
    { name: 'Orange', hex: '#ff7000' },
    { name: 'Yellow', hex: '#ffff00' },
    { name: 'Green',  hex: '#00ff00' },
    { name: 'Blue',   hex: '#0000ff' },
    { name: 'Indigo', hex: '#3000ff' },
    { name: 'Purple', hex: '#a000ff' },
    { name: 'White',  hex: '#ffffff' },
  ],
};

// ============ COMMANDS ============
// Each command is a kind of LED behavior placed as a clip.
// IDs map 1:1 to firmware CmdType in CS-Light-FW/lightball/types.h
//   0 COLOR, 1 BLINK, 2 FADE, 3 BREATHE, 4 PINGPONG, 5 WAIT, 6 LOOP
// 'rainbow' is a software-only macro — exports as a chain of FADE rows.
const COMMANDS = [
  { id: 'color',    name: 'Color',    icon: '■', desc: 'Hold one color',           fwType: 0 },
  { id: 'blink',    name: 'Blink',    icon: '⚡', desc: 'Alternate A ↔ B',          fwType: 1 },
  { id: 'fade',     name: 'Fade',     icon: '◐', desc: 'Linear A → B',             fwType: 2 },
  { id: 'breathe',  name: 'Breathe',  icon: '◉', desc: 'Sine in/out from off',     fwType: 3 },
  { id: 'pingpong', name: 'Pingpong', icon: '⇢', desc: 'Sine sweep A ↔ B',         fwType: 4 },
  { id: 'restart',  name: 'Restart',  icon: '↻', desc: 'Wait for button press, then restart from the beginning', fwType: 5 },
  { id: 'rainbow',  name: 'Rainbow',  icon: '◑', desc: 'Cycle hues (macro)',       fwType: null },
];

// ============ INITIAL DATA ============
const initialBalls = [
  { id: 'B1', name: 'Ball 01', color: '#ff3b3b' },
  { id: 'B2', name: 'Ball 02', color: '#ff8a00' },
  { id: 'B3', name: 'Ball 03', color: '#ffc933' },
  { id: 'B4', name: 'Ball 04', color: '#3ddc84' },
  { id: 'B5', name: 'Ball 05', color: '#22d3ee' },
  { id: 'B6', name: 'Ball 06', color: '#3b82f6' },
  { id: 'B7', name: 'Ball 07', color: '#a855f7' },
  { id: 'B8', name: 'Ball 08', color: '#ec4899' },
];

const STEPS_PER_BAR = 16;
const DEFAULT_TOTAL_BARS = 4;
const DEFAULT_TOTAL_STEPS = STEPS_PER_BAR * DEFAULT_TOTAL_BARS;

function cryptoId() {
  return 's' + Math.random().toString(36).slice(2, 10);
}

function seedSteps() {
  const out = {};
  initialBalls.forEach((b) => {
    out[b.id + '-A'] = [];
    out[b.id + '-B'] = [];
  });
  initialBalls.forEach((b, i) => {
    const p = PALETTES.chromatic;
    out[b.id + '-A'].push({
      id: cryptoId(), start: i * 2, length: 2, command: 'breathe',
      color: p[i % p.length].hex, colorB: p[(i+3) % p.length].hex,
      brightness: 1, rate: 4,
    });
    out[b.id + '-A'].push({
      id: cryptoId(), start: 32 + i * 2, length: 2, command: 'fade',
      color: p[i % p.length].hex, colorB: p[(i+4) % p.length].hex,
      brightness: 0.95, rate: 1,
    });
    if (i % 2 === 0) {
      out[b.id + '-B'].push({
        id: cryptoId(), start: 4, length: 1, command: 'blink',
        color: '#ffffff', colorB: '#000000', brightness: 1, rate: 8,
      });
      out[b.id + '-B'].push({
        id: cryptoId(), start: 12, length: 1, command: 'blink',
        color: '#ffffff', colorB: '#000000', brightness: 1, rate: 8,
      });
    } else {
      out[b.id + '-B'].push({
        id: cryptoId(), start: 16 + i, length: 4, command: 'rainbow',
        color: p[0].hex, colorB: p[7].hex, brightness: 0.9, rate: 1,
      });
    }
  });
  return out;
}

// ============ COMMAND EVALUATION ============
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHex(r,g,b) {
  return '#' + [r,g,b].map(x => Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
}
function lerpColor(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca[0]+(cb[0]-ca[0])*t, ca[1]+(cb[1]-ca[1])*t, ca[2]+(cb[2]-ca[2])*t);
}
function hslToHex(h, s, l) {
  // h 0..360, s 0..1, l 0..1
  s = Math.max(0,Math.min(1,s)); l = Math.max(0,Math.min(1,l));
  const c = (1 - Math.abs(2*l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r=0,g=0,b=0;
  if (hp<1) [r,g,b]=[c,x,0];
  else if (hp<2) [r,g,b]=[x,c,0];
  else if (hp<3) [r,g,b]=[0,c,x];
  else if (hp<4) [r,g,b]=[0,x,c];
  else if (hp<5) [r,g,b]=[x,0,c];
  else [r,g,b]=[c,0,x];
  const m = l - c/2;
  return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);
}

// step + playhead position → { color, brightness } or null
function evalStep(step, playhead) {
  if (playhead < step.start || playhead >= step.start + step.length) return null;
  const local = (playhead - step.start) / step.length; // 0..1 within clip
  const rate = step.rate ?? 1;
  let color = step.color;
  let brightness = step.brightness ?? 1;
  switch (step.command) {
    case 'color':
      break;
    case 'restart':
      // Idle visualization — show as off; awaits a button press, then restarts.
      color = '#000000';
      brightness = 0;
      break;
    case 'breathe': {
      // sine 0..1
      const phase = local * rate;
      brightness *= 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 - Math.PI/2);
      break;
    }
    case 'blink': {
      const phase = local * rate;
      const on = Math.floor(phase * 2) % 2 === 0;
      color = on ? step.color : (step.colorB || '#000000');
      break;
    }
    case 'fade': {
      color = lerpColor(step.color, step.colorB || step.color, local);
      break;
    }
    case 'rainbow': {
      const h = (local * rate * 360) % 360;
      color = hslToHex(h, 1, 0.55);
      break;
    }
    case 'pingpong': {
      // sine sweep A<->B
      const phase = (local * rate) % 1;
      brightness *= Math.max(0, 1 - Math.abs(phase - 0.5) * 2.5);
      break;
    }
    default:
      break;
  }
  return { color, brightness: Math.max(0, Math.min(1, brightness)) };
}

// ============ LED CALIBRATION ============
// Single shared model used by both the simulator and the firmware (via export).
// Defaults are estimates for a generic 5mm common-cathode RGB LED behind a
// frosted diffuser. Sliders tune them by eye against the real ball.
const CAL_DEFAULTS = {
  gamma:         2.2,
  channelGain:   { r: 1.00, g: 0.85, b: 0.55 },
  maxBrightness: 0.90,
  diffuser:      { sigmaPct: 0.32 },
};
const CAL_LS_KEY = 'lightseq.calibration.v1';

function loadCalibration() {
  try {
    const raw = localStorage.getItem(CAL_LS_KEY);
    if (!raw) return CAL_DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      gamma:         Number(parsed.gamma)         || CAL_DEFAULTS.gamma,
      channelGain:   {
        r: Number(parsed.channelGain?.r) ?? CAL_DEFAULTS.channelGain.r,
        g: Number(parsed.channelGain?.g) ?? CAL_DEFAULTS.channelGain.g,
        b: Number(parsed.channelGain?.b) ?? CAL_DEFAULTS.channelGain.b,
      },
      maxBrightness: Number(parsed.maxBrightness) || CAL_DEFAULTS.maxBrightness,
      diffuser:      { sigmaPct: Number(parsed.diffuser?.sigmaPct) || CAL_DEFAULTS.diffuser.sigmaPct },
    };
  } catch { return CAL_DEFAULTS; }
}

// ---- Custom palette (user-editable, persisted) ----
const CUSTOM_PALETTE_LS_KEY = 'lightseq.customPalette.v1';
const CUSTOM_PALETTE_DEFAULT = PALETTES.chromatic.map(c => ({ ...c }));

function loadCustomPalette() {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_LS_KEY);
    if (!raw) return CUSTOM_PALETTE_DEFAULT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 8) return CUSTOM_PALETTE_DEFAULT;
    return parsed.map((c, i) => ({
      name: typeof c?.name === 'string' ? c.name : CUSTOM_PALETTE_DEFAULT[i].name,
      hex:  /^#[0-9a-fA-F]{6}$/.test(c?.hex) ? c.hex : CUSTOM_PALETTE_DEFAULT[i].hex,
    }));
  } catch { return CUSTOM_PALETTE_DEFAULT; }
}

function useCustomPalette() {
  const { useState, useCallback } = React;
  const [pal, setPalState] = useState(() => loadCustomPalette());
  const setSwatch = useCallback((index, hex) => {
    setPalState(prev => {
      const next = prev.map((c, i) => i === index ? { ...c, hex } : c);
      try { localStorage.setItem(CUSTOM_PALETTE_LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const resetPalette = useCallback(() => {
    try { localStorage.removeItem(CUSTOM_PALETTE_LS_KEY); } catch {}
    setPalState(CUSTOM_PALETTE_DEFAULT);
  }, []);
  return [pal, setSwatch, resetPalette];
}

function useCalibration() {
  const { useState, useCallback } = React;
  const [cal, setCalState] = useState(() => loadCalibration());
  const setCal = useCallback((next) => {
    setCalState(prev => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      try { localStorage.setItem(CAL_LS_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, []);
  const resetCal = useCallback(() => {
    try { localStorage.removeItem(CAL_LS_KEY); } catch {}
    setCalState(CAL_DEFAULTS);
  }, []);
  return [cal, setCal, resetCal];
}

// Map a single channel through the calibration: linear input (0..1) → linear
// output (0..1) ready to add or to gamma-encode for display.
function calibrateChannel(linearIn, gain, maxBri) {
  return Math.max(0, Math.min(1, linearIn * gain * maxBri));
}

// Take an LED state (hex color + brightness) and return its linear-light RGB
// triplet (0..1 per channel). This is what the device emits in photons.
function ledToLinearRGB(ledState, cal) {
  if (!ledState || ledState.brightness <= 0) return [0, 0, 0];
  const [R, G, B] = hexToRgb(ledState.color);
  const bri = ledState.brightness;
  return [
    calibrateChannel((R / 255) * bri, cal.channelGain.r, cal.maxBrightness),
    calibrateChannel((G / 255) * bri, cal.channelGain.g, cal.maxBrightness),
    calibrateChannel((B / 255) * bri, cal.channelGain.b, cal.maxBrightness),
  ];
}

// sRGB-encode a linear value in 0..1 to an 8-bit display value.
function linearToSrgb8(x, gamma) {
  const c = Math.max(0, Math.min(1, x));
  return Math.round(255 * Math.pow(c, 1 / gamma));
}

// Build the firmware LUT bytes for one channel.
function calLutForChannel(gain, maxBri) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(255 * calibrateChannel(i / 255, gain, maxBri));
  }
  return lut;
}

// Format a Uint8Array as a C array body, 16 values per line.
function lutToCArray(lut) {
  const lines = [];
  for (let i = 0; i < 256; i += 16) {
    const slice = Array.from(lut.slice(i, i + 16))
      .map(v => String(v).padStart(3, ' '))
      .join(', ');
    lines.push('  ' + slice + ',');
  }
  // strip trailing comma on last line
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,\s*$/, '');
  return lines.join('\n');
}

// Build the full calibration.h text from a calibration object.
function buildFirmwareHeader(cal) {
  const lr = calLutForChannel(cal.channelGain.r, cal.maxBrightness);
  const lg = calLutForChannel(cal.channelGain.g, cal.maxBrightness);
  const lb = calLutForChannel(cal.channelGain.b, cal.maxBrightness);
  const stamp = new Date().toISOString();
  return [
    '#pragma once',
    '#include <stdint.h>',
    '// Auto-generated by LightSeq calibration panel.',
    `// Generated: ${stamp}`,
    `// gamma=${cal.gamma.toFixed(2)} (display-only, not in LUT)`,
    `// gainR=${cal.channelGain.r.toFixed(3)}  gainG=${cal.channelGain.g.toFixed(3)}  gainB=${cal.channelGain.b.toFixed(3)}`,
    `// maxBrightness=${cal.maxBrightness.toFixed(3)}`,
    '',
    'static const uint8_t CAL_LUT_R[256] = {',
    lutToCArray(lr),
    '};',
    '',
    'static const uint8_t CAL_LUT_G[256] = {',
    lutToCArray(lg),
    '};',
    '',
    'static const uint8_t CAL_LUT_B[256] = {',
    lutToCArray(lb),
    '};',
    '',
  ].join('\n');
}

function downloadBlob(filename, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importCalibrationJson(setCal) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      setCal({
        gamma:         Number(parsed.gamma)         || CAL_DEFAULTS.gamma,
        channelGain: {
          r: Number(parsed.channelGain?.r) ?? CAL_DEFAULTS.channelGain.r,
          g: Number(parsed.channelGain?.g) ?? CAL_DEFAULTS.channelGain.g,
          b: Number(parsed.channelGain?.b) ?? CAL_DEFAULTS.channelGain.b,
        },
        maxBrightness: Number(parsed.maxBrightness) || CAL_DEFAULTS.maxBrightness,
        diffuser:      { sigmaPct: Number(parsed.diffuser?.sigmaPct) || CAL_DEFAULTS.diffuser.sigmaPct },
      });
    } catch (e) {
      alert('Could not import calibration JSON: ' + e.message);
    }
  };
  input.click();
}

// Loads a single-ball test sequence designed for visual calibration: pure R/G/B
// solids, white, mid-grey (gamma sanity), and additive blend tests where LED A
// and LED B carry different colors. Switches BPM to 60 so each clip step = 0.25s
// and the pattern timing reads cleanly off the playhead.
function loadCalibrationTestPattern({ setBalls, setSteps, setBpm }) {
  if (!confirm('Replace current project with the calibration test pattern? Unsaved work will be lost.')) return;
  const ball = { id: 'CAL', name: 'Calibration', color: '#ffffff' };
  setBalls([ball]);
  setBpm(60);

  const mkStep = (start, length, command, color, colorB, brightness = 1, rate = 1) => ({
    id: cryptoId(), start, length, command, color, colorB, brightness, rate,
  });

  // Both LEDs together — single-color tests.
  const both = [
    [ 0,  8, 'color', '#ff0000'], // pure red 2s
    [ 8,  8, 'color', '#00ff00'], // pure green 2s
    [16,  8, 'color', '#0000ff'], // pure blue 2s
    [24,  8, 'color', '#ffffff'], // white 2s — white-balance check
    [32,  8, 'color', '#808080'], // mid-grey 2s — gamma check
  ];
  // Additive-blend tests — LED A and LED B carry different colors.
  const splitA = [
    [40,  8, 'color', '#ff0000'],
    [48,  8, 'color', '#0000ff'],
    [56,  8, 'fade',  '#ff0000', '#0000ff'], // 2s R→B fade
  ];
  const splitB = [
    [40,  8, 'color', '#0000ff'],
    [48,  8, 'color', '#ff0000'],
    [56,  8, 'fade',  '#0000ff', '#ff0000'],
  ];

  const a = [...both.map(s => mkStep(...s)), ...splitA.map(s => mkStep(...s))];
  const b = [...both.map(s => mkStep(...s)), ...splitB.map(s => mkStep(...s))];
  setSteps({ 'CAL-A': a, 'CAL-B': b });
}

// ============ APP ============
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [cal, setCal, resetCal] = useCalibration();
  const [customPalette, setCustomSwatch, resetCustomPalette] = useCustomPalette();
  const [balls, setBalls] = useState(initialBalls);
  const [steps, setSteps] = useState(seedSteps);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState('breathe');
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [clipboard, setClipboard] = useState(null); // { clips: [{trackKey, start, length, command, color, colorB, brightness, rate}], anchor }
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loop, setLoop] = useState(true);
  const [audio, setAudio] = useState(null); // { name, peaks, durationSec, buffer }
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);
  const [restartTick, setRestartTick] = useState(0); // bumped when Restart clip is hit, retriggers audio
  const [tool, setTool] = useState('paint');

  const palette = t.paletteMode === 'custom'
    ? customPalette
    : (PALETTES[t.paletteMode] || PALETTES.chromatic);
  const [stepW, setStepW] = useState(22);
  const [scrollLeft, setScrollLeft] = useState(0);
  const gridSubdiv = { '1/2': 2, '1/4': 4, '1/8': 8, '1/16': 16, '1/32': 32, '1/64': 64 }[t.gridRes] || 16;

  // Total bars/steps follow the music track when one is loaded
  const TOTAL_BARS = useMemo(() => {
    if (!audio) return DEFAULT_TOTAL_BARS;
    // bars = duration_sec * (bpm/60) / 4  (one bar = 4 beats)
    const bars = (audio.durationSec * bpm / 60) / 4;
    return Math.max(1, Math.ceil(bars));
  }, [audio, bpm]);
  const TOTAL_STEPS = TOTAL_BARS * STEPS_PER_BAR;

  // Transport loop
  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      const stepsPerSec = (bpm / 60) * 4;
      setPlayhead((p) => {
        let np = p + dt * stepsPerSec;
        // If the playhead has entered a Restart clip on any track, jump back to 0.
        // (On the device this would wait for a button press; in the simulator we just loop.)
        try {
          for (const k in steps) {
            const arr = steps[k];
            if (!arr) continue;
            for (const s of arr) {
              if (s.command === 'restart' && np >= s.start && np < s.start + s.length) {
                setRestartTick(t => t + 1);
                return 0;
              }
            }
          }
        } catch (e) { /* ignore */ }
        if (np >= TOTAL_STEPS) {
          np = loop ? 0 : TOTAL_STEPS - 0.001;
          if (!loop) setPlaying(false);
        }
        return np;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, bpm, loop, steps, TOTAL_STEPS]);

  // ---------- Audio import + playback ----------
  const importAudio = useCallback(async (file) => {
    if (!file) return;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    const arr = await file.arrayBuffer();
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(arr);
    } catch (e) {
      alert('Could not decode audio: ' + e.message);
      return;
    }
    // Build N peak buckets (max abs over both channels)
    // Use higher N for long songs so the waveform stays resolved when stretched across many bars.
    const N = Math.min(8192, Math.max(512, Math.round(buffer.duration * 40)));
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const peaks = new Array(N).fill(0);
    const bucket = Math.floor(ch0.length / N);
    for (let i = 0; i < N; i++) {
      let max = 0;
      const start = i * bucket, end = Math.min(start + bucket, ch0.length);
      for (let j = start; j < end; j++) {
        const v = ch1 ? Math.max(Math.abs(ch0[j]), Math.abs(ch1[j])) : Math.abs(ch0[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    // Normalize
    const peak = Math.max(0.01, ...peaks);
    for (let i = 0; i < N; i++) peaks[i] /= peak;

    setAudio({
      name: file.name,
      peaks,
      durationSec: buffer.duration,
      buffer,
    });
  }, []);

  // Start/stop audio with transport
  useEffect(() => {
    if (!audio || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    // stop any prior source
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch {}
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (!playing) return;
    if (ctx.state === 'suspended') ctx.resume();

    // map current playhead (steps) -> seconds in song
    const stepsPerSec = (bpm / 60) * 4;
    const offsetSec = playhead / stepsPerSec;
    const src = ctx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(ctx.destination);
    const startAt = Math.min(audio.buffer.duration - 0.01, Math.max(0, offsetSec));
    src.start(0, startAt);
    audioSourceRef.current = src;

    return () => {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch {}
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audio, restartTick]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    for (const k in steps) {
      const s = steps[k].find(st => st.id === selectedStepId);
      if (s) return { ...s, trackKey: k };
    }
    return null;
  }, [selectedStepId, steps]);

  const updateStep = useCallback((id, patch) => {
    setSteps(prev => {
      const out = { ...prev };
      for (const k in out) {
        const idx = out[k].findIndex(s => s.id === id);
        if (idx >= 0) {
          out[k] = [...out[k]];
          out[k][idx] = { ...out[k][idx], ...patch };
          break;
        }
      }
      return out;
    });
  }, []);

  // Move a clip across tracks (e.g. drag from B1-A → B2-B). Caller has already
  // computed the desired { start, length } for the target lane and confirmed
  // it doesn't collide with anything in there. Returns true if applied.
  const moveStepToTrack = useCallback((id, fromTrack, toTrack, patch) => {
    if (fromTrack === toTrack) {
      // Same lane — just patch in place.
      if (patch) updateStep(id, patch);
      return true;
    }
    setSteps(prev => {
      const fromArr = prev[fromTrack] || [];
      const clip = fromArr.find(s => s.id === id);
      if (!clip) return prev;
      const merged = { ...clip, ...(patch || {}) };
      const toArr = (prev[toTrack] || []).filter(s => s.id !== id);
      // Reject if the new position collides with anything in the target lane.
      const collides = toArr.some(s =>
        merged.start < s.start + s.length && merged.start + merged.length > s.start
      );
      if (collides) return prev;
      return {
        ...prev,
        [fromTrack]: fromArr.filter(s => s.id !== id),
        [toTrack]: [...toArr, merged],
      };
    });
    return true;
  }, [updateStep]);

  const deleteStep = useCallback((id) => {
    setSteps(prev => {
      const out = { ...prev };
      for (const k in out) {
        if (out[k].some(s => s.id === id)) {
          out[k] = out[k].filter(s => s.id !== id);
          break;
        }
      }
      return out;
    });
    setSelectedStepId(null);
  }, []);

  const onPaint = useCallback((trackKey, startStep) => {
    const cmd = COMMANDS.find(c => c.id === selectedCommand);
    const desiredLen = STEPS_PER_BAR / gridSubdiv;
    setSteps(prev => {
      const arr = prev[trackKey] || [];
      // Find next clip starting after startStep — clip new length to fit before it
      const after = arr.filter(s => s.start >= startStep).sort((a,b) => a.start - b.start)[0];
      const maxEnd = after ? after.start : TOTAL_STEPS;
      const length = Math.max(0, Math.min(desiredLen, maxEnd - startStep));
      // Reject if overlapping a clip that contains startStep, OR no room
      const containing = arr.find(s => startStep >= s.start && startStep < s.start + s.length);
      if (containing || length <= 0) return prev;
      const newStep = {
        id: cryptoId(),
        start: startStep,
        length,
        command: selectedCommand,
        color: palette[selectedColor].hex,
        colorB: palette[(selectedColor + 4) % palette.length].hex,
        brightness: 1,
        rate: cmd && cmd.id === 'blink' ? 8 : (cmd && (cmd.id === 'breathe' || cmd.id === 'pingpong') ? 4 : 1),
      };
      setSelectedStepId(newStep.id);
      return { ...prev, [trackKey]: [...arr, newStep] };
    });
  }, [gridSubdiv, palette, selectedColor, selectedCommand]);

  const deleteStepById = useCallback((id) => {
    setSteps(prev => {
      const out = { ...prev };
      for (const k in out) {
        if (out[k].some(s => s.id === id)) {
          out[k] = out[k].filter(s => s.id !== id);
          break;
        }
      }
      return out;
    });
  }, []);

  // Copy selected clips to in-memory clipboard. Stores trackKey + relative offset from the earliest selected clip.
  const copySelected = useCallback(() => {
    setSteps(prev => {
      const ids = selectedIds.size > 0 ? selectedIds : (selectedStepId ? new Set([selectedStepId]) : new Set());
      if (ids.size === 0) return prev;
      const found = [];
      for (const k in prev) {
        for (const s of prev[k]) {
          if (ids.has(s.id)) found.push({ trackKey: k, ...s });
        }
      }
      if (found.length === 0) return prev;
      const minStart = Math.min(...found.map(c => c.start));
      const payload = found.map(c => ({
        trackKey: c.trackKey,
        offset: c.start - minStart,
        length: c.length,
        command: c.command,
        color: c.color,
        colorB: c.colorB,
        brightness: c.brightness,
        rate: c.rate,
      }));
      setClipboard({ clips: payload });
      return prev;
    });
  }, [selectedIds, selectedStepId]);

  // Paste clipboard at playhead. Each clip lands in its original track at playhead+offset,
  // clamped against existing clips in that lane (no overlap).
  const pasteClipboard = useCallback(() => {
    if (!clipboard || !clipboard.clips.length) return;
    setSteps(prev => {
      const out = { ...prev };
      const newIds = [];
      const anchor = Math.round(playhead);
      // Process in order so earlier clips reserve their lane span before later ones in same lane.
      const sorted = [...clipboard.clips].sort((a, b) => a.offset - b.offset);
      for (const c of sorted) {
        if (!out[c.trackKey]) continue; // track may have been removed
        const arr = out[c.trackKey];
        const startStep = anchor + c.offset;
        if (startStep >= TOTAL_STEPS) continue;
        // Reject if startStep falls inside an existing clip
        const containing = arr.find(s => startStep >= s.start && startStep < s.start + s.length);
        if (containing) continue;
        const after = arr.filter(s => s.start >= startStep).sort((a, b) => a.start - b.start)[0];
        const maxEnd = after ? after.start : TOTAL_STEPS;
        const length = Math.max(0, Math.min(c.length, maxEnd - startStep));
        if (length <= 0) continue;
        const id = cryptoId();
        newIds.push(id);
        out[c.trackKey] = [...arr, {
          id, start: startStep, length,
          command: c.command, color: c.color, colorB: c.colorB,
          brightness: c.brightness, rate: c.rate,
        }];
      }
      if (newIds.length > 0) {
        setSelectedIds(new Set(newIds));
        setSelectedStepId(newIds[newIds.length - 1]);
      }
      return out;
    });
  }, [clipboard, playhead, TOTAL_STEPS]);

  // New project: reset balls/steps/transport. Audio kept (so user can retry against same track).
  const newProject = useCallback(() => {
    if (!confirm('Start a new project? Unsaved changes will be lost.')) return;
    const emptySteps = {};
    initialBalls.forEach((b) => {
      emptySteps[b.id + '-A'] = [];
      emptySteps[b.id + '-B'] = [];
    });
    setBalls(initialBalls);
    setSteps(emptySteps);
    setBpm(120);
    setPlayhead(0);
    setPlaying(false);
    setSelectedStepId(null);
    setSelectedIds(new Set());
    setClipboard(null);
  }, []);

  // Serialize project to a .lbproj (JSON) file. Audio is referenced by name only — not embedded.
  const exportProject = useCallback(() => {
    const payload = {
      kind: 'lbproj',
      version: 1,
      bpm,
      balls,
      steps,
      audio: audio ? { name: audio.name, durationSec: audio.durationSec } : null,
      tweaks: t,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lightseq_' + Date.now() + '.lbproj';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [bpm, balls, steps, audio, t]);

  // Import a .lbproj. Restores balls/steps/bpm/tweaks; audio must be re-imported separately.
  const importProject = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.kind !== 'lbproj') throw new Error('Not a LightSeq project file.');
        if (data.balls) setBalls(data.balls);
        if (data.steps) setSteps(data.steps);
        if (typeof data.bpm === 'number') setBpm(data.bpm);
        if (data.tweaks) {
          for (const k in data.tweaks) setTweak(k, data.tweaks[k]);
        }
        setPlayhead(0);
        setPlaying(false);
        setSelectedStepId(null);
        setSelectedIds(new Set());
        if (data.audio && data.audio.name) {
          // Just notify — we don't re-attach the audio file because we never embedded it.
          setTimeout(() => alert('Project loaded.\n\nThis project referenced an audio track (' + data.audio.name + '). Re-import it from the MUSIC panel to sync.'), 0);
        }
      } catch (err) {
        alert('Could not load project: ' + err.message);
      }
    };
    reader.readAsText(file);
  }, [setTweak]);

  const exportTxt = useCallback(() => {
    // Convert hex -> [r,g,b]
    const hex2rgb = (h) => {
      const x = h.replace('#', '');
      return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)];
    };
    const stepsToMs = (s) => Math.round((s / 4) * (60 / bpm) * 1000);
    const scaleRgb = ([r,g,b], br) => [Math.round(r*br), Math.round(g*br), Math.round(b*br)];
    const row = (type, dur, on, off, c1, c2) => [type, dur, on, off, ...c1, ...c2].join(',');

    // Firmware uses uint16_t for durationMs — cap is 65535 ms (~65.5 s).
    // Anything longer must be split into chained commands so it doesn't overflow.
    const MAX_DUR = 65535;

    // Split one parsed row record into N rows whose durations all fit in uint16.
    // Splitting is command-aware: COLOR/BLINK/BREATHE/PINGPONG/off-gaps repeat
    // cleanly when chained, but FADE has to interpolate the start/end colors
    // for each chunk so the gradient stays continuous.
    const splitRow = (rec) => {
      const { type, dur, on, off, c1, c2 } = rec;
      if (dur <= MAX_DUR) return [row(type, dur, on, off, c1, c2)];
      const lerp = (a, b, t) => [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ];

      // Chunk count + base size. For period-based commands (BLINK/BREATHE/
      // PINGPONG), align chunk size to the period so the waveform doesn't get
      // a phase glitch at each boundary.
      const period = (type === 1) ? Math.max(1, on + off)        // BLINK
                   : (type === 3 || type === 4) ? Math.max(1, on)  // BREATHE / PINGPONG (period in `on`)
                   : 0;
      let chunk = MAX_DUR;
      if (period > 0) chunk = Math.floor(MAX_DUR / period) * period;
      if (chunk <= 0) chunk = MAX_DUR;
      const out = [];
      let remaining = dur;
      let elapsed = 0;
      while (remaining > 0) {
        const d = Math.min(chunk, remaining);
        let rc1 = c1, rc2 = c2;
        if (type === 2) {
          // FADE: this chunk fades from color@elapsed → color@(elapsed+d).
          const t0 = elapsed / dur;
          const t1 = Math.min(1, (elapsed + d) / dur);
          rc1 = lerp(c1, c2, t0);
          rc2 = lerp(c1, c2, t1);
        }
        out.push(row(type, d, on, off, rc1, rc2));
        elapsed += d;
        remaining -= d;
      }
      return out;
    };

    // Helper: emit rows directly, but route through splitRow to enforce uint16 cap.
    const emit = (type, dur, on, off, c1, c2) =>
      splitRow({ type, dur, on, off, c1, c2 });

    // Convert one clip into one or more firmware rows.
    // Returns array of strings (no trailing newline). Each command path uses
    // `emit()` so any duration > 65535 ms is auto-split into chained rows.
    const clipToRows = (clip, durMs) => {
      const c1 = scaleRgb(hex2rgb(clip.color), clip.brightness ?? 1);
      const c2 = clip.colorB ? scaleRgb(hex2rgb(clip.colorB), clip.brightness ?? 1) : [0,0,0];
      const rate = Math.max(0.1, clip.rate ?? 1);
      switch (clip.command) {
        case 'color':
          return emit(0, durMs, 0, 0, c1, [0,0,0]);
        case 'restart':
          // Restart = WAIT (pause until button) followed by LOOP (jump to start of sequence).
          // type 5 = WAIT, type 6 = LOOP. Both ignore duration/colors on firmware.
          return [
            row(5, 0, 0, 0, [0,0,0], [0,0,0]),
            row(6, 0, 0, 0, [0,0,0], [0,0,0]),
          ];
        case 'blink': {
          // BLINK: rate = flashes/sec; on=off=half-period
          const half = Math.max(20, Math.round(500 / rate));
          return emit(1, durMs, half, half, c1, c2);
        }
        case 'fade':
          return emit(2, durMs, 0, 0, c1, c2);
        case 'breathe': {
          // BREATHE: period = 1000/rate ms
          const period = Math.max(100, Math.round(1000 / rate));
          return emit(3, durMs, period, 0, c1, [0,0,0]);
        }
        case 'pingpong': {
          // PINGPONG between c1 and c2
          const period = Math.max(100, Math.round(1000 / rate));
          return emit(4, durMs, period, 0, c1, c2);
        }
        case 'rainbow': {
          // Expand into a chain of FADEs across hue cycle.
          // Period per full cycle = 1000/rate ms; min 6 stops.
          const cyclePeriod = Math.max(600, Math.round(1000 / rate));
          const stops = 6;
          const segMs = Math.max(40, Math.round(cyclePeriod / stops));
          const cycles = Math.max(1, Math.round(durMs / cyclePeriod));
          const totalSegs = cycles * stops;
          // remainder absorbed into last segment
          const segs = [];
          for (let i = 0; i < totalSegs; i++) {
            const h1 = (i / stops) % 1;
            const h2 = ((i + 1) / stops) % 1;
            const a = scaleRgb(hsl2rgb(h1, 1, 0.5), clip.brightness ?? 1);
            const b = scaleRgb(hsl2rgb(h2, 1, 0.5), clip.brightness ?? 1);
            const isLast = i === totalSegs - 1;
            const d = isLast ? Math.max(40, durMs - segMs * (totalSegs - 1)) : segMs;
            // Each rainbow segment is itself a FADE; emit() handles overflow.
            emit(2, d, 0, 0, a, b).forEach(r => segs.push(r));
          }
          return segs;
        }
        default:
          return emit(0, durMs, 0, 0, c1, [0,0,0]);
      }
    };

    const hsl2rgb = (h, s, l) => {
      const f = (n) => {
        const k = (n + h * 12) % 12;
        const a = s * Math.min(l, 1 - l);
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
      };
      return [f(0), f(8), f(4)];
    };

    // Build firmware text for one track (ball+LED side).
    const buildTrack = (trackKey) => {
      const arr = (steps[trackKey] || []).slice().sort((a,b) => a.start - b.start);
      const out = ['# type,duration,on,off,r,g,b,r2,g2,b2'];
      let cursor = 0;
      arr.forEach(clip => {
        if (clip.start > cursor) {
          // gap -> off
          emit(0, stepsToMs(clip.start - cursor), 0, 0, [0,0,0], [0,0,0]).forEach(r => out.push(r));
        }
        const durMs = stepsToMs(clip.length);
        clipToRows(clip, durMs).forEach(r => out.push(r));
        cursor = clip.start + clip.length;
      });
      if (cursor < TOTAL_STEPS) {
        emit(0, stepsToMs(TOTAL_STEPS - cursor), 0, 0, [0,0,0], [0,0,0]).forEach(r => out.push(r));
      }
      // CMD_LOOP infinite at end
      out.push('6,0,0,0,0,0,0,0,0,0');
      return out.join('\n') + '\n';
    };

    // Build a ZIP with one folder per ball.
    const zip = new JSZip();
    zip.file('README.txt',
      'LightSeq firmware export\n' +
      'BPM=' + bpm + '  bars=' + TOTAL_BARS + '  steps=' + TOTAL_STEPS + '\n' +
      'Each ball folder contains led0.txt (LED-A) and led1.txt (LED-B).\n' +
      'Drop both files at the root of the SD card for that ball.\n');
    balls.forEach((b) => {
      const folder = zip.folder(b.id.toLowerCase());
      folder.file('led0.txt', buildTrack(b.id + '-A'));
      folder.file('led1.txt', buildTrack(b.id + '-B'));
    });

    zip.generateAsync({ type: 'blob' }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lightseq_export_' + Date.now() + '.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }, [balls, steps, bpm]);

  const onEraseAt = useCallback((trackKey, atStep) => {
    setSteps(prev => {
      const arr = (prev[trackKey] || []).filter(s => !(atStep >= s.start && atStep < s.start + s.length));
      return { ...prev, [trackKey]: arr };
    });
  }, []);

  const addBall = () => {
    if (balls.length >= 16) return;
    const i = balls.length;
    const id = 'B' + String(i + 1).padStart(2, '0');
    const color = palette[i % palette.length].hex;
    setBalls([...balls, { id, name: 'Ball ' + String(i + 1).padStart(2, '0'), color }]);
    setSteps(prev => ({ ...prev, [id + '-A']: [], [id + '-B']: [] }));
  };
  const removeBall = (ballId) => {
    if (balls.length <= 1) return;
    setBalls(balls.filter(b => b.id !== ballId));
    setSteps(prev => {
      const out = { ...prev };
      delete out[ballId + '-A']; delete out[ballId + '-B'];
      return out;
    });
  };

  // Live LED states
  const litState = useMemo(() => {
    const out = {};
    balls.forEach(b => {
      ['A', 'B'].forEach(led => {
        const key = b.id + '-' + led;
        const arr = steps[key] || [];
        const active = arr.find(s => playhead >= s.start && playhead < s.start + s.length);
        out[key] = active ? evalStep(active, playhead) : null;
      });
    });
    return out;
  }, [playhead, steps, balls]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          selectedIds.forEach(id => deleteStepById(id));
          setSelectedIds(new Set());
          setSelectedStepId(null);
        } else if (selectedStepId) {
          deleteStep(selectedStepId);
        }
      }
      if (!mod && e.key >= '1' && e.key <= '8') setSelectedColor(parseInt(e.key) - 1);
      if (!mod && e.key === 'p') setTool('paint');
      if (!mod && e.key === 'e') setTool('erase');
      if (!mod && e.key === 's') setTool('select');
      if (!mod && e.key === '`') {
        e.preventDefault();
        // Toggle TweaksPanel via the host protocol it already listens for.
        // Local flag tracks open/closed since the panel owns its own state.
        window.__tweaksOpen = !window.__tweaksOpen;
        window.postMessage({
          type: window.__tweaksOpen ? '__activate_edit_mode' : '__deactivate_edit_mode',
        }, '*');
      }
    };
    const onMsg = (e) => {
      if (e?.data?.type === '__edit_mode_dismissed') window.__tweaksOpen = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMsg);
    };
  }, [selectedStepId, selectedIds, deleteStep, deleteStepById, copySelected, pasteClipboard]);

  return (
    <div className={"app theme-" + t.theme} data-screen-label="Sequencer">
      <TopBar
        bpm={bpm} setBpm={setBpm}
        playing={playing} setPlaying={setPlaying}
        loop={loop} setLoop={setLoop}
        playhead={playhead} setPlayhead={setPlayhead}
        tool={tool} setTool={setTool}
        gridRes={t.gridRes} setGridRes={(v) => setTweak('gridRes', v)}
        onExport={exportTxt}
        onNewProject={newProject}
        onExportProject={exportProject}
        onImportProject={importProject}
      />

      <CommandBar
        commands={COMMANDS}
        selectedCommand={selectedCommand}
        setSelectedCommand={setSelectedCommand}
        palette={palette}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
      />

      <div className="main">
        <div className="left">
          <TrackList balls={balls} litState={litState} onAdd={addBall} onRemove={removeBall} />
        </div>

        <div className="center">
          <WaveformTrack
            playhead={playhead}
            setPlayhead={setPlayhead}
            bpm={bpm}
            style={t.waveStyle}
            audio={audio}
            onImport={importAudio}
            onClear={() => setAudio(null)}
            totalBars={TOTAL_BARS}
            totalSteps={TOTAL_STEPS}
            stepW={stepW}
            setStepW={setStepW}
            scrollLeft={scrollLeft}
          />
          <Timeline
            balls={balls}
            steps={steps}
            playhead={playhead}
            setPlayhead={setPlayhead}
            tool={tool}
            gridSubdiv={gridSubdiv}
            selectedStepId={selectedStepId}
            setSelectedStepId={setSelectedStepId}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onPaint={onPaint}
            onErase={onEraseAt}
            updateStep={updateStep}
            moveStepToTrack={moveStepToTrack}
            deleteStepById={deleteStepById}
            totalBars={TOTAL_BARS}
            totalSteps={TOTAL_STEPS}
            stepW={stepW}
            setStepW={setStepW}
            onScroll={setScrollLeft}
          />
        </div>

        <div className="right">
          <PreviewStage balls={balls} litState={litState} layout={t.previewLayout} glow={t.ballGlow} cal={cal} />
          <Inspector
            step={selectedStep}
            updateStep={updateStep}
            deleteStep={deleteStep}
            palette={palette}
          />
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Waveform">
          <TweakRadio label="Style" value={t.waveStyle}
            options={[{value:'bars',label:'Bars'},{value:'wave',label:'Wave'},{value:'spec',label:'Spectro'}]}
            onChange={v => setTweak('waveStyle', v)} />
        </TweakSection>
        <TweakSection title="Preview">
          <TweakRadio label="Layout" value={t.previewLayout}
            options={[{value:'line',label:'Line'},{value:'grid',label:'Grid'},{value:'circle',label:'Circle'}]}
            onChange={v => setTweak('previewLayout', v)} />
          <TweakSlider label="Glow" min={0} max={1} step={0.05} value={t.ballGlow} onChange={v => setTweak('ballGlow', v)} />
        </TweakSection>
        <TweakSection label="LED Calibration">
          <TweakSlider label="Gamma" min={1.8} max={2.6} step={0.05}
            value={Number(cal.gamma.toFixed(2))}
            onChange={v => setCal({ gamma: v })} />
          <TweakSlider label="Red gain" min={0.20} max={1.00} step={0.01}
            value={Number(cal.channelGain.r.toFixed(2))}
            onChange={v => setCal(prev => ({ ...prev, channelGain: { ...prev.channelGain, r: v } }))} />
          <TweakSlider label="Green gain" min={0.20} max={1.00} step={0.01}
            value={Number(cal.channelGain.g.toFixed(2))}
            onChange={v => setCal(prev => ({ ...prev, channelGain: { ...prev.channelGain, g: v } }))} />
          <TweakSlider label="Blue gain" min={0.20} max={1.00} step={0.01}
            value={Number(cal.channelGain.b.toFixed(2))}
            onChange={v => setCal(prev => ({ ...prev, channelGain: { ...prev.channelGain, b: v } }))} />
          <TweakSlider label="Max bri" min={0.50} max={1.00} step={0.01}
            value={Number(cal.maxBrightness.toFixed(2))}
            onChange={v => setCal({ maxBrightness: v })} />
          <TweakSlider label="Diffuser σ" min={0.10} max={0.60} step={0.01}
            value={Number(cal.diffuser.sigmaPct.toFixed(2))}
            onChange={v => setCal(prev => ({ ...prev, diffuser: { sigmaPct: v } }))} />
          <TweakButton label="Load test pattern"
            onClick={() => loadCalibrationTestPattern({ setBalls, setSteps, setBpm })} />
          <TweakButton label="Export firmware header"
            onClick={() => downloadBlob('calibration.h', 'text/x-c', buildFirmwareHeader(cal))} />
          <TweakButton label="Export JSON"
            onClick={() => downloadBlob('calibration.json', 'application/json', JSON.stringify(cal, null, 2))} />
          <TweakButton label="Import JSON"
            onClick={() => importCalibrationJson(setCal)} secondary />
          <TweakButton label="Reset to defaults" onClick={resetCal} secondary />
        </TweakSection>
        <TweakSection title="Style">
          <TweakRadio label="Palette" value={t.paletteMode}
            options={[{value:'chromatic',label:'Chroma'},{value:'pastel',label:'Pastel'},{value:'mono',label:'Mono'},{value:'realworld',label:'Real'},{value:'custom',label:'Custom'}]}
            onChange={v => setTweak('paletteMode', v)} />
          {t.paletteMode === 'custom' && (
            <>
              {customPalette.map((c, i) => (
                <TweakColor key={i} label={`Swatch ${i + 1}`} value={c.hex}
                  onChange={(hex) => setCustomSwatch(i, hex)} />
              ))}
              <TweakButton label="Reset palette" onClick={resetCustomPalette} secondary />
            </>
          )}
          <TweakRadio label="Theme" value={t.theme}
            options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'}]}
            onChange={v => setTweak('theme', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ============ TOP BAR ============
function TopBar({ bpm, setBpm, playing, setPlaying, loop, setLoop, playhead, setPlayhead, tool, setTool, gridRes, setGridRes, onExport, onNewProject, onExportProject, onImportProject }) {
  const RESOLUTIONS = ['1/2','1/4','1/8','1/16','1/32','1/64'];
  const bar = Math.floor(playhead / 16) + 1;
  const beat = Math.floor((playhead % 16) / 4) + 1;
  const tick = Math.floor(playhead % 4) + 1;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  const importRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const runItem = (fn) => () => { setMenuOpen(false); fn && fn(); };
  return (
    <div className="topbar topbar-x">
      <div className="brand">
        <div className="brand-mark"><span/><span/><span/></div>
        <div className="brand-text">
          <div className="brand-title">LIGHTSEQ</div>
          <div className="brand-sub">LED Sequencer · Studio</div>
        </div>
      </div>

      <div className="transport">
        <button className="tbtn" onClick={() => { setPlayhead(0); setPlaying(false); }}>⏮</button>
        <button className={"tbtn " + (playing ? 'active' : 'pri')} onClick={() => setPlaying(p => !p)}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className="tbtn" onClick={() => setPlaying(false)}>⏹</button>
        <button className={"tbtn " + (loop ? 'active' : '')} onClick={() => setLoop(l => !l)} title="Loop">⟲</button>
      </div>

      <div className="readouts">
        <div className="readout">
          <div className="ro-label">BPM</div>
          <input className="ro-input" type="number" value={bpm} min="40" max="240"
            onChange={e => setBpm(parseInt(e.target.value)||120)} />
        </div>
        <div className="readout">
          <div className="ro-label">POSITION</div>
          <div className="ro-value mono">{String(bar).padStart(2,'0')}.{beat}.{tick}</div>
        </div>
        <div className="readout">
          <div className="ro-label">TIME</div>
          <div className="ro-value mono">{formatTime(playhead, bpm)}</div>
        </div>
        <div className="readout">
          <div className="ro-label">SIG</div>
          <div className="ro-value mono">4/4</div>
        </div>
      </div>

      <div className="res-group">
        <div className="res-label mono">RES</div>
        <div className="res-list">
          {RESOLUTIONS.map(r => (
            <button key={r}
              className={"res-btn mono " + (gridRes===r?'on':'')}
              onClick={() => setGridRes(r)}
              title={"Snap to " + r + " note"}>{r}</button>
          ))}
        </div>
      </div>

      <div className="tools">
        <button className={"tool " + (tool==='paint'?'on':'')} onClick={() => setTool('paint')} title="Paint (P)">✏</button>
        <button className={"tool " + (tool==='select'?'on':'')} onClick={() => setTool('select')} title="Select (S)">▢</button>
        <button className={"tool " + (tool==='erase'?'on':'')} onClick={() => setTool('erase')} title="Erase (E)">⌫</button>
        <div className="file-menu" ref={menuRef}>
          <button className={"tool file-menu-btn " + (menuOpen ? 'on' : '')} onClick={() => setMenuOpen(o => !o)} title="Project menu">
            File ▾
          </button>
          {menuOpen && (
            <div className="file-menu-pop">
              <button className="file-menu-item" onClick={runItem(onNewProject)}>
                <span className="fm-glyph">＋</span>
                <span className="fm-label">New project</span>
                <span className="fm-hint">empty</span>
              </button>
              <button className="file-menu-item" onClick={runItem(() => importRef.current && importRef.current.click())}>
                <span className="fm-glyph">↥</span>
                <span className="fm-label">Import .lbproj</span>
                <span className="fm-hint">load</span>
              </button>
              <button className="file-menu-item" onClick={runItem(onExportProject)}>
                <span className="fm-glyph">↧</span>
                <span className="fm-label">Export .lbproj</span>
                <span className="fm-hint">save</span>
              </button>
              <div className="file-menu-divider"/>
              <button className="file-menu-item primary" onClick={runItem(onExport)}>
                <span className="fm-glyph">⤓</span>
                <span className="fm-label">Export sequence</span>
                <span className="fm-hint">.zip</span>
              </button>
            </div>
          )}
          <input
            ref={importRef}
            type="file"
            accept=".lbproj,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f && onImportProject) onImportProject(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}

function formatTime(stepPos, bpm) {
  const sec = (stepPos / 4) * (60 / bpm);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
}

// ============ COMMAND BAR ============
function CommandBar({ commands, selectedCommand, setSelectedCommand, palette, selectedColor, setSelectedColor }) {
  return (
    <div className="cmdbar">
      <div className="cmdbar-section">
        <div className="cmdbar-label">COMMAND</div>
        <div className="cmd-list">
          {commands.map(c => (
            <button key={c.id}
              className={"cmd-btn " + (selectedCommand===c.id?'on':'')}
              onClick={() => setSelectedCommand(c.id)}
              title={c.desc}>
              <span className="cmd-icon">{c.icon}</span>
              <span className="cmd-name">{c.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cmdbar-divider"/>
      <div className="cmdbar-section">
        <div className="cmdbar-label">COLOR</div>
        <div className="palette">
          {palette.map((c, i) => (
            <button key={i}
              className={"swatch " + (selectedColor===i?'on':'')}
              style={{ background: c.hex, boxShadow: selectedColor===i ? '0 0 0 2px var(--bg), 0 0 0 4px '+c.hex+', 0 0 14px '+c.hex : 'none' }}
              onClick={() => setSelectedColor(i)}
              title={c.name + ' · ' + (i+1)} />
          ))}
        </div>
      </div>
      <div className="cmdbar-hint mono">Pick a command + color, then click-drag on the grid to place.</div>
    </div>
  );
}

// ============ WAVEFORM TRACK ============
function WaveformTrack({ playhead, setPlayhead, bpm, style, audio, onImport, onClear, totalBars, totalSteps, stepW, setStepW, scrollLeft }) {
  const TOTAL_STEPS = totalSteps;
  const TOTAL_BARS = totalBars;
  const fileRef = useRef(null);
  // Use imported peaks if present, otherwise a deterministic fake
  const wave = useMemo(() => {
    if (audio && audio.peaks) return audio.peaks;
    const N = 256;
    const out = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const kick = (i % 32 === 0) ? 1 : 0;
      const swell = 0.4 + 0.4 * Math.sin(t * Math.PI * 4);
      const noise = 0.2 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31));
      const hi = (i % 8 === 4) ? 0.45 : 0;
      const v = Math.min(1, kick * 0.95 + swell * 0.5 + noise + hi);
      out.push(v);
    }
    return out;
  }, [audio]);

  const STEP_W = stepW;
  const totalW = STEP_W * TOTAL_STEPS;
  // Audio occupies only its real duration in steps; the rest of the timeline is silence.
  const audioSteps = audio
    ? (audio.durationSec * bpm / 60) * (STEPS_PER_BAR / 4)  // sec * beats/sec * steps/beat
    : TOTAL_STEPS;
  const audioW = Math.min(totalW, STEP_W * audioSteps);

  const onScrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const setFromX = (clientX) => {
      const x = clientX - rect.left;
      setPlayhead(Math.max(0, Math.min(TOTAL_STEPS, x / STEP_W)));
    };
    setFromX(e.clientX);
    document.body.classList.add('dragging');
    const onMove = (ev) => setFromX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="wave-track">
      <div className="wave-label">
        <div className="wave-label-title mono">MUSIC</div>
        <div className="wave-label-sub mono">{audio ? audio.name : 'no track'}</div>
        <div className="wave-label-bpm mono">{bpm} BPM</div>
        <div className="wave-label-actions">
          <button className="wave-import-btn mono" onClick={() => fileRef.current && fileRef.current.click()}>
            {audio ? 'Replace' : '＋ Import'}
          </button>
          {audio && (
            <button className="wave-import-btn mono" onClick={onClear} title="Remove track">×</button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="wave-viewport">
        <div className="wave-rail" style={{ width: totalW, transform: `translateX(${-scrollLeft}px)` }}>
          <div className="wave-canvas" onMouseDown={onScrub} style={{ width: totalW }}>
          {/* Waveform content layer — sized to actual audio duration so peaks align with beats. */}
          <div className="wave-content" style={{ width: audioW, position: 'absolute', left: 0, top: 0, bottom: 0 }}>
          {style === 'bars' && (
            <div className="wave-bars">
              {wave.map((v, i) => (
                <div key={i} className="wave-bar" style={{ height: (v*100).toFixed(0)+'%' }}/>
              ))}
            </div>
          )}
          {style === 'wave' && (
            <svg className="wave-svg" viewBox={`0 0 ${wave.length} 100`} preserveAspectRatio="none">
              <path
                d={"M 0 50 " + wave.map((v,i) => `L ${i} ${50 - v*45}`).join(' ') +
                   " L " + wave.length + " 50 " +
                   wave.map((v,i) => `L ${wave.length-i-1} ${50 + wave[wave.length-i-1]*45}`).join(' ') + " Z"}
                fill="url(#wgrad)"/>
              <defs>
                <linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9"/>
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.3"/>
                </linearGradient>
              </defs>
            </svg>
          )}
          {style === 'spec' && (
            <div className="wave-spec">
              {wave.map((v, i) => (
                <div key={i} className="wave-spec-col" style={{
                  background: `linear-gradient(180deg,
                    hsl(${280 - v*200} 90% 60%) 0%,
                    hsl(${280 - v*200} 90% 60%) ${(1-v)*100}%,
                    transparent ${(1-v)*100}%)`
                }}/>
              ))}
            </div>
          )}
          </div>
          {/* beat ticks */}
          <div className="wave-ticks">
            {Array.from({ length: TOTAL_BARS * 4 }).map((_, i) => (
              <div key={i} className={"wave-tick " + (i%4===0?'bar':'')}
                style={{ left: i * STEP_W * 4 }}>
                {i%4===0 && <span className="wave-tick-num mono">{(i/4)+1}</span>}
              </div>
            ))}
          </div>
          <div className="wave-playhead" style={{ left: playhead * STEP_W }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ TRACK LIST ============
function TrackList({ balls, litState, onAdd, onRemove }) {
  return (
    <div className="tracklist">
      <div className="tl-header">
        <div className="tl-title">BALLS · {balls.length}</div>
        <button className="tl-add" onClick={onAdd}>＋ Add</button>
      </div>
      <div className="tl-rows">
        {balls.map((b) => (
          <div key={b.id} className="tl-ball">
            <div className="tl-ball-row">
              <div className="tl-handle" style={{ background: b.color }}>{b.id}</div>
              <div className="tl-name">{b.name}</div>
              <div className="tl-leds">
                <LEDDot lit={litState[b.id+'-A']} label="A" />
                <LEDDot lit={litState[b.id+'-B']} label="B" />
              </div>
              <button className="tl-rm" onClick={() => onRemove(b.id)} title="Remove">×</button>
            </div>
            <div className="tl-led-row"><span className="tl-led-tag">LED-A</span><div className="tl-led-meter"><div className="tl-led-fill" style={{ width: (litState[b.id+'-A']?.brightness*100||0)+'%', background: litState[b.id+'-A']?.color || 'transparent' }}/></div></div>
            <div className="tl-led-row"><span className="tl-led-tag">LED-B</span><div className="tl-led-meter"><div className="tl-led-fill" style={{ width: (litState[b.id+'-B']?.brightness*100||0)+'%', background: litState[b.id+'-B']?.color || 'transparent' }}/></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LEDDot({ lit, label }) {
  const on = lit && lit.brightness > 0;
  const c = on ? lit.color : 'transparent';
  return (
    <div className="led-dot">
      <span className="led-dot-label">{label}</span>
      <span className="led-dot-bulb" style={{
        background: on ? c : 'var(--surface-2)',
        boxShadow: on ? '0 0 8px '+c+', 0 0 2px '+c : 'inset 0 0 0 1px var(--border)',
        opacity: on ? lit.brightness : 1,
      }}/>
    </div>
  );
}

// ============ TIMELINE ============
function Timeline({ balls, steps, playhead, setPlayhead, tool, gridSubdiv, selectedStepId, setSelectedStepId, selectedIds, setSelectedIds, onPaint, onErase, updateStep, moveStepToTrack, deleteStepById, totalBars, totalSteps, stepW, setStepW, onScroll }) {
  const TOTAL_STEPS = totalSteps;
  const TOTAL_BARS = totalBars;
  const [drag, setDrag] = useState(null);
  const [paintDrag, setPaintDrag] = useState(false);
  const [marquee, setMarquee] = useState(null); // { x0,y0,x1,y1 }
  const gridRef = useRef(null);

  const STEP_W = stepW;
  const totalW = STEP_W * TOTAL_STEPS;
  // gridSubdiv is "divisions per bar": 1/4 = 4 cells/bar, 1/16 = 16/bar, 1/64 = 64/bar.
  const cellsPerBar = gridSubdiv;
  const subdivStep = STEPS_PER_BAR / cellsPerBar;

  // Flat list of trackKeys in display order — used to map drag-Y → target lane.
  const ROW_H = 30;
  const RULER_H = 28;
  const trackOrder = useMemo(() => {
    const out = [];
    balls.forEach(b => { out.push(b.id + '-A'); out.push(b.id + '-B'); });
    return out;
  }, [balls]);

  const xToStep = (x) => Math.max(0, Math.min(TOTAL_STEPS, x / STEP_W));
  const xToSnappedStep = (x) => Math.floor(xToStep(x) / subdivStep) * subdivStep;

  const onMouseDownGrid = (e, trackKey, rowEl) => {
    if (e.target.classList.contains('clip') || e.target.closest('.clip')) return;
    const rect = rowEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const start = xToSnappedStep(x);
    if (tool === 'paint') {
      onPaint(trackKey, start);
      setPaintDrag(true);
    } else if (tool === 'erase') {
      onErase(trackKey, xToStep(x));
    } else if (tool === 'select') {
      // start marquee
      const gridRect = gridRef.current.getBoundingClientRect();
      const mx = e.clientX - gridRect.left;
      const my = e.clientY - gridRect.top;
      setMarquee({ x0: mx, y0: my, x1: mx, y1: my });
      if (!e.shiftKey) {
        setSelectedIds(new Set());
        setSelectedStepId(null);
      }
    }
  };

  const onRulerMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const setFromX = (clientX) => {
      const x = clientX - rect.left;
      setPlayhead(xToStep(x));
    };
    setFromX(e.clientX);
    document.body.classList.add('dragging');
    const onMove = (ev) => setFromX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // resize/move with overlap clamp
  useEffect(() => {
    if (!drag) return;
    document.body.classList.add('dragging');
    const onMove = (e) => {
      const dxSteps = (e.clientX - drag.startX) / STEP_W;
      const snapped = Math.round(dxSteps / subdivStep) * subdivStep;
      if (drag.mode === 'move') {
        let ns = Math.max(0, Math.min(TOTAL_STEPS - drag.origLength, drag.origStart + snapped));

        // Determine target track from cursor Y (allow drag across LEDs/balls).
        let targetTrack = drag.trackKey;
        if (gridRef.current) {
          const gridRect = gridRef.current.getBoundingClientRect();
          // Account for sticky ruler and current scroll inside the timeline container.
          const yInGrid = e.clientY - gridRect.top - RULER_H + (gridRef.current.scrollTop || 0);
          const idx = Math.max(0, Math.min(trackOrder.length - 1, Math.floor(yInGrid / ROW_H)));
          targetTrack = trackOrder[idx] || drag.trackKey;
        }

        // Clamp horizontally against neighbours in TARGET track (skip self).
        const tArr = (steps[targetTrack] || []).filter(s => s.id !== drag.stepId);
        const before = tArr.filter(s => s.start + s.length <= ns).sort((a,b) => (b.start+b.length)-(a.start+a.length))[0];
        const after = tArr.filter(s => s.start >= ns + drag.origLength).sort((a,b) => a.start - b.start)[0];
        const minS = before ? before.start + before.length : 0;
        const maxS = after ? after.start - drag.origLength : TOTAL_STEPS - drag.origLength;
        // If the natural slot doesn't fit at all in the target lane, fall back
        // to current track to avoid ejecting the clip into a colliding spot.
        if (minS > maxS) return;
        ns = Math.max(minS, Math.min(maxS, ns));

        if (targetTrack !== drag.trackKey) {
          // Cross-lane drop: move clip and update drag's notion of its lane.
          moveStepToTrack(drag.stepId, drag.trackKey, targetTrack, { start: ns });
          setDrag(d => d ? { ...d, trackKey: targetTrack } : d);
        } else {
          updateStep(drag.stepId, { start: ns });
        }
      } else if (drag.mode === 'resize') {
        const arr = (steps[drag.trackKey] || []).filter(s => s.id !== drag.stepId);
        const after = arr.filter(s => s.start >= drag.origStart).sort((a,b) => a.start - b.start)[0];
        const maxLen = (after ? after.start : TOTAL_STEPS) - drag.origStart;
        const nl = Math.max(subdivStep, Math.min(maxLen, drag.origLength + snapped));
        updateStep(drag.stepId, { length: nl });
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.classList.remove('dragging'); };
  }, [drag, subdivStep, updateStep, moveStepToTrack, steps, trackOrder, TOTAL_STEPS, STEP_W]);

  useEffect(() => {
    if (!paintDrag) return;
    const onUp = () => setPaintDrag(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [paintDrag]);

  // marquee drag
  useEffect(() => {
    if (!marquee) return;
    document.body.classList.add('dragging');
    const ROW_H = 30;
    const LABEL_W = 110;
    const onMove = (e) => {
      const gridRect = gridRef.current.getBoundingClientRect();
      const mx = e.clientX - gridRect.left;
      const my = e.clientY - gridRect.top;
      setMarquee(m => ({ ...m, x1: mx, y1: my }));
    };
    const onUp = () => {
      // Compute selected clips intersecting marquee
      const x0 = Math.min(marquee.x0, marquee.x1) - LABEL_W;
      const x1 = Math.max(marquee.x0, marquee.x1) - LABEL_W;
      const y0 = Math.min(marquee.y0, marquee.y1);
      const y1 = Math.max(marquee.y0, marquee.y1);
      const sel = new Set();
      let rowIdx = 0;
      balls.forEach(b => {
        ['A','B'].forEach(led => {
          const rowTop = rowIdx * ROW_H;
          const rowBot = rowTop + ROW_H;
          if (rowBot >= y0 && rowTop <= y1) {
            const arr = steps[b.id+'-'+led] || [];
            arr.forEach(s => {
              const sx = s.start * STEP_W;
              const ex = sx + s.length * STEP_W;
              if (ex >= x0 && sx <= x1) sel.add(s.id);
            });
          }
          rowIdx++;
        });
      });
      setSelectedIds(prev => {
        const next = new Set(prev);
        sel.forEach(id => next.add(id));
        return next;
      });
      if (sel.size === 1) setSelectedStepId([...sel][0]);
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [marquee, balls, steps, setSelectedIds, setSelectedStepId]);

  // cleanup dragging class when marquee ends
  useEffect(() => {
    if (!marquee) document.body.classList.remove('dragging');
  }, [marquee]);

  // Ctrl/Cmd + scroll to zoom (synced via stepW)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setStepW((w) => Math.max(6, Math.min(80, w * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setStepW]);

  return (
    <div className="timeline" ref={gridRef} onScroll={(e) => onScroll && onScroll(e.currentTarget.scrollLeft)}>
      <div className="tl-ruler" onMouseDown={onRulerMouseDown} style={{ width: totalW }}>
        {Array.from({ length: TOTAL_BARS * 4 }).map((_, i) => {
          const isBar = i % 4 === 0;
          return (
            <div key={i} className={"tl-tick " + (isBar?'bar':'beat')} style={{ left: i * STEP_W * 4 }}>
              {isBar && <span className="tl-tick-label mono">{(i/4)+1}</span>}
            </div>
          );
        })}
        <div className="tl-playhead-head" style={{ left: playhead * STEP_W }}>
          <div className="tl-playhead-flag mono">{Math.floor(playhead/16)+1}.{Math.floor((playhead%16)/4)+1}</div>
        </div>
      </div>

      <div className="tl-grid" style={{ width: totalW }} ref={gridRef}>
        {balls.map((b) => (
          <React.Fragment key={b.id}>
            {['A','B'].map((led) => {
              const trackKey = b.id + '-' + led;
              const arr = steps[trackKey] || [];
              return (
                <div key={trackKey} className={"tl-row "+ (led==='A'?'ledA':'ledB')}>
                  <div className="tl-row-label">
                    <span className="tl-row-ball" style={{ color: b.color }}>{b.id}</span>
                    <span className="tl-row-led">LED-{led}</span>
                  </div>
                  <div className="tl-row-cells"
                    style={{
                      backgroundImage: [
                        // sub-divisions: faint
                        `repeating-linear-gradient(90deg, transparent 0, transparent ${subdivStep * STEP_W - 1}px, var(--border) ${subdivStep * STEP_W - 1}px, var(--border) ${subdivStep * STEP_W}px)`,
                        // beats (every 4 sub-divisions when cellsPerBar >= 4)
                        `repeating-linear-gradient(90deg, transparent 0, transparent ${(STEPS_PER_BAR / 4) * STEP_W - 1}px, var(--border-strong) ${(STEPS_PER_BAR / 4) * STEP_W - 1}px, var(--border-strong) ${(STEPS_PER_BAR / 4) * STEP_W}px)`,
                        // bars: strongest
                        `repeating-linear-gradient(90deg, transparent 0, transparent ${STEPS_PER_BAR * STEP_W - 1}px, var(--text-faint) ${STEPS_PER_BAR * STEP_W - 1}px, var(--text-faint) ${STEPS_PER_BAR * STEP_W}px)`,
                      ].join(', '),
                    }}
                    onMouseDown={e => onMouseDownGrid(e, trackKey, e.currentTarget)}
                    onMouseEnter={e => {
                      if (paintDrag && tool === 'paint') {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        onPaint(trackKey, xToSnappedStep(x));
                      }
                    }}>
                    {arr.map(s => (
                      <Clip key={s.id} step={s}
                        STEP_W={STEP_W}
                        selected={selectedStepId === s.id || selectedIds.has(s.id)}
                        playhead={playhead}
                        tool={tool}
                        onSelect={() => { setSelectedStepId(s.id); setSelectedIds(new Set([s.id])); }}
                        onErase={() => onErase(trackKey, s.start)}
                        onMoveStart={(e) => {
                          e.stopPropagation();
                          setSelectedStepId(s.id);
                          setDrag({ stepId: s.id, trackKey, mode: 'move', startX: e.clientX, origStart: s.start, origLength: s.length });
                        }}
                        onResizeStart={(e) => {
                          e.stopPropagation();
                          setSelectedStepId(s.id);
                          setDrag({ stepId: s.id, trackKey, mode: 'resize', startX: e.clientX, origStart: s.start, origLength: s.length });
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div className="tl-playhead" style={{ left: playhead * STEP_W }}/>
        {marquee && (
          <div className="tl-marquee" style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}/>
        )}
      </div>
    </div>
  );
}

function Clip({ step, STEP_W, selected, playhead, tool, onSelect, onErase, onMoveStart, onResizeStart }) {
  const w = step.length * STEP_W;
  const left = step.start * STEP_W;
  const cmd = COMMANDS.find(c => c.id === step.command);

  // Visual fill per command type
  let fill;
  switch (step.command) {
    case 'color':
      fill = step.color;
      break;
    case 'restart':
      fill = `repeating-linear-gradient(45deg, #2a2a2a 0 6px, #1a1a1a 6px 12px)`;
      break;
    case 'breathe':
      fill = `repeating-linear-gradient(90deg, ${step.color} 0px, ${step.color}88 ${Math.max(8, w/(step.rate||4)/2)}px, ${step.color} ${Math.max(16, w/(step.rate||4))}px)`;
      break;
    case 'blink':
      fill = `repeating-linear-gradient(90deg, ${step.color} 0 6px, ${step.colorB||'#000'} 6px 12px)`;
      break;
    case 'fade':
      fill = `linear-gradient(90deg, ${step.color}, ${step.colorB||step.color})`;
      break;
    case 'rainbow':
      fill = `linear-gradient(90deg, #ff3b3b, #ff8a00, #ffc933, #3ddc84, #22d3ee, #3b82f6, #a855f7, #ec4899)`;
      break;
    case 'pingpong':
      fill = `linear-gradient(90deg, ${step.color}22, ${step.color}, ${step.colorB||step.color}22)`;
      break;
    default:
      fill = step.color;
  }

  const handleMouseDown = (e) => {
    e.stopPropagation();
    if (tool === 'erase') { onErase(); return; }
    if (tool === 'select') { onSelect(); return; }
    // paint tool: act as move handle
    onMoveStart(e);
  };
  const cursor = tool === 'erase' ? 'not-allowed' : tool === 'select' ? 'pointer' : 'grab';

  return (
    <div className={"clip " + (selected?'sel':'') + " tool-" + tool}
      style={{ left, width: w, cursor }}
      onMouseDown={handleMouseDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div className="clip-fill" style={{
        background: fill,
        boxShadow: 'inset 0 0 0 1px ' + step.color + ', 0 0 8px ' + step.color + '55',
      }}/>
      <div className="clip-label mono">
        <span className="clip-icon">{cmd?.icon}</span>
        <span>{cmd?.name}</span>
      </div>
      {tool !== 'erase' && <div className="clip-resize" onMouseDown={onResizeStart}/>}
    </div>
  );
}

// ============ PREVIEW ============
function PreviewStage({ balls, litState, layout, glow, cal }) {
  return (
    <div className="preview">
      <div className="preview-head">
        <div className="preview-title">LIVE PREVIEW</div>
        <div className="preview-sub mono">{balls.length} balls · {balls.length*2} LEDs</div>
      </div>
      <div className={"preview-stage layout-"+layout}>
        {balls.map((b, i) => (
          <BallPreview key={b.id} ball={b}
            ledA={litState[b.id+'-A']} ledB={litState[b.id+'-B']}
            glow={glow} index={i} total={balls.length} layout={layout} cal={cal}
          />
        ))}
      </div>
    </div>
  );
}

// LED positions on the orb, % within the canvas (matches the legacy layout —
// LED A on upper-left pole, LED B on lower-right pole).
const A_POS = { x: 0.32, y: 0.28 };
const B_POS = { x: 0.68, y: 0.72 };
const CANVAS_PX = 64; // logical pixels per ball; CSS upscales it

function BallPreview({ ball, ledA, ledB, glow, index, total, layout, cal }) {
  const { useRef, useEffect } = React;
  const canvasRef = useRef(null);

  const linA = ledToLinearRGB(ledA, cal);
  const linB = ledToLinearRGB(ledB, cal);
  const aOn = linA[0] + linA[1] + linA[2] > 0;
  const bOn = linB[0] + linB[1] + linB[2] > 0;

  // Repaint the canvas every time LED state or calibration changes.
  // Real device: two point sources whose photons add inside the diffuser.
  // We model that with two Gaussian splats summed in linear-light, then
  // sRGB-encode for the monitor. This matches the firmware's emission curve
  // (PWM is linear in photons) once display gamma is accounted for.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const N = CANVAS_PX;
    if (cv.width !== N) { cv.width = N; cv.height = N; }
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    const data = img.data;
    const cx = N / 2, cy = N / 2, orbR = N / 2 - 0.5;
    const ax = A_POS.x * N, ay = A_POS.y * N;
    const bx = B_POS.x * N, by = B_POS.y * N;
    const sigma = (cal.diffuser?.sigmaPct || 0.32) * N;
    const twoSigma2 = 2 * sigma * sigma;
    const anyOn = aOn || bOn;

    let p = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // soft circular mask so the canvas blends with the orb shell
        const dx0 = x + 0.5 - cx, dy0 = y + 0.5 - cy;
        const distOrb = Math.sqrt(dx0 * dx0 + dy0 * dy0);
        let mask = 1;
        if (distOrb > orbR) { mask = 0; }
        else if (distOrb > orbR - 1.5) { mask = (orbR - distOrb) / 1.5; }

        let r = 0, g = 0, bl = 0;
        if (anyOn && mask > 0) {
          if (aOn) {
            const dxA = x + 0.5 - ax, dyA = y + 0.5 - ay;
            const wA = Math.exp(-(dxA * dxA + dyA * dyA) / twoSigma2);
            r  += linA[0] * wA;
            g  += linA[1] * wA;
            bl += linA[2] * wA;
          }
          if (bOn) {
            const dxB = x + 0.5 - bx, dyB = y + 0.5 - by;
            const wB = Math.exp(-(dxB * dxB + dyB * dyB) / twoSigma2);
            r  += linB[0] * wB;
            g  += linB[1] * wB;
            bl += linB[2] * wB;
          }
        }

        // Clamp linear-light then gamma-encode for display.
        // Mask multiplies the linear value (acts on photons reaching the
        // monitor), then we encode.
        data[p++] = linearToSrgb8(r  * mask, cal.gamma);
        data[p++] = linearToSrgb8(g  * mask, cal.gamma);
        data[p++] = linearToSrgb8(bl * mask, cal.gamma);
        data[p++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [linA[0], linA[1], linA[2], linB[0], linB[1], linB[2], cal.gamma, cal.diffuser?.sigmaPct]);

  let style = {};
  if (layout === 'circle') {
    const angle = (index / total) * Math.PI * 2 - Math.PI/2;
    const r = 38;
    style = {
      position: 'absolute',
      left: `calc(50% + ${Math.cos(angle)*r}% - 28px)`,
      top: `calc(50% + ${Math.sin(angle)*r}% - 28px)`,
    };
  }

  // Outer halo — light leaking out of the diffuser. Combine the two LEDs in
  // linear-light, encode for display, anchor near the brighter LED.
  const orbRpx = 22;
  const sumLin = [linA[0] + linB[0], linA[1] + linB[1], linA[2] + linB[2]];
  const haloHex = '#' + sumLin.map(c => linearToSrgb8(c, cal.gamma).toString(16).padStart(2,'0')).join('');
  const briTotal = Math.min(1, Math.max(linA[0],linA[1],linA[2]) + Math.max(linB[0],linB[1],linB[2]));
  const briA = Math.max(linA[0], linA[1], linA[2]);
  const briB = Math.max(linB[0], linB[1], linB[2]);
  const wA = briA + briB > 0 ? briA / (briA + briB) : 0;
  const cxPct = A_POS.x * 100 * wA + B_POS.x * 100 * (1 - wA);
  const cyPct = A_POS.y * 100 * wA + B_POS.y * 100 * (1 - wA);
  const offX = (cxPct - 50) / 50 * orbRpx;
  const offY = (cyPct - 50) / 50 * orbRpx;
  const halo = (briTotal > 0 && glow > 0)
    ? `${offX}px ${offY}px ${14 + briTotal * 22}px ${4 + briTotal * 4}px ${haloHex}${Math.round(0.55 * briTotal * glow * 255).toString(16).padStart(2,'0')}`
    : '';

  return (
    <div className="ball-prev" style={style}>
      <div className="ball-orb" style={{
        boxShadow: (halo ? halo + ', ' : '') +
                   'inset 0 -6px 14px rgba(0,0,0,0.55), ' +
                   'inset 0 4px 8px rgba(255,255,255,0.10)',
      }}>
        <div className="ball-body"/>
        <canvas ref={canvasRef} className="ball-light-canvas"/>
        <div className="ball-spec"/>
      </div>
      <div className="ball-prev-label mono">{ball.id}</div>
    </div>
  );
}

// ============ INSPECTOR ============
function Inspector({ step, updateStep, deleteStep, palette }) {
  if (!step) {
    return (
      <div className="inspector empty">
        <div className="ins-title">INSPECTOR</div>
        <div className="ins-empty">
          Select a clip to edit.<br/>
          <span className="ins-empty-sub">Pick a command + color above, then click-drag on the grid. Space = play.</span>
        </div>
      </div>
    );
  }
  const [ballId, led] = step.trackKey.split('-');
  const cmd = COMMANDS.find(c => c.id === step.command);
  const usesColorB = step.command === 'fade' || step.command === 'blink' || step.command === 'pingpong';
  const showsRate = step.command === 'breathe' || step.command === 'blink' || step.command === 'rainbow' || step.command === 'pingpong';

  return (
    <div className="inspector">
      <div className="ins-title">INSPECTOR · <span style={{color: step.color}}>{ballId} · LED-{led}</span></div>

      <div className="ins-section">
        <div className="ins-label">COMMAND</div>
        <div className="ins-cmd-list">
          {COMMANDS.map(c => (
            <button key={c.id}
              className={"ins-cmd " + (step.command===c.id?'on':'')}
              onClick={() => updateStep(step.id, { command: c.id })}>
              <span className="cmd-icon">{c.icon}</span>{c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="ins-section">
        <div className="ins-label">{usesColorB ? 'COLOR A' : 'COLOR'}</div>
        <div className="ins-swatches">
          {palette.map((c, i) => (
            <button key={i}
              className={"ins-sw " + (c.hex.toLowerCase() === step.color.toLowerCase() ? 'on':'')}
              style={{ background: c.hex }}
              onClick={() => updateStep(step.id, { color: c.hex })}/>
          ))}
        </div>
      </div>

      {usesColorB && (
        <div className="ins-section">
          <div className="ins-label">COLOR B</div>
          <div className="ins-swatches">
            {palette.map((c, i) => (
              <button key={i}
                className={"ins-sw " + ((step.colorB||'').toLowerCase() === c.hex.toLowerCase() ? 'on':'')}
                style={{ background: c.hex }}
                onClick={() => updateStep(step.id, { colorB: c.hex })}/>
            ))}
          </div>
        </div>
      )}

      <div className="ins-section">
        <div className="ins-label-row">
          <span className="ins-label">BRIGHTNESS</span>
          <span className="ins-val mono">{Math.round((step.brightness??1)*100)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.01" value={step.brightness??1}
          onChange={e => updateStep(step.id, { brightness: parseFloat(e.target.value) })}/>
      </div>

      {showsRate && (
        <div className="ins-section">
          <div className="ins-label-row">
            <span className="ins-label">RATE</span>
            <span className="ins-val mono">{(step.rate??1).toFixed(1)}×</span>
          </div>
          <input type="range" min="0.25" max="16" step="0.25" value={step.rate??1}
            onChange={e => updateStep(step.id, { rate: parseFloat(e.target.value) })}/>
        </div>
      )}

      <div className="ins-grid">
        <div className="ins-cell">
          <div className="ins-label">START</div>
          <div className="ins-val mono">{step.start.toFixed(2)}</div>
        </div>
        <div className="ins-cell">
          <div className="ins-label">LENGTH</div>
          <div className="ins-val mono">{step.length.toFixed(2)}</div>
        </div>
      </div>

      <button className="ins-del" onClick={() => deleteStep(step.id)}>Delete clip</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
