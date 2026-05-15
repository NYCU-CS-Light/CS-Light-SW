/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio, TweakSelect, TweakToggle, TweakColor, TweakButton */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============ TWEAKS ============
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "gridRes": "1/16",
  "previewLayout": "line",
  "showFade": true,
  "theme": "dark",
  "ballGlow": 0.85,
  "waveStyle": "wave",
  "perfSimEnabled": false,
  "perfSimPattern": "forward",
  "perfSimRadiusPct": 70,
  "perfSimPeriodBars": 1,
  "perfSimHandGapPct": 55,
  "perfSimGuides": true,
  "perfSimTrail": 0.7
}/*EDITMODE-END*/;

// ============ PALETTE SEED ============
// ROYGBIV + white, tuned for what a real RGB LED actually emits. Each swatch
// uses primaries only (no muddying mid-tones), so when the firmware's
// calibration LUT scales the channels, the on-device color reads cleanly as
// the named hue rather than as a wash of all three channels.
const PALETTE_SEED = [
  { name: 'Red',    hex: '#ff0000' },
  { name: 'Orange', hex: '#ff7000' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Green',  hex: '#00ff00' },
  { name: 'Blue',   hex: '#0000ff' },
  { name: 'Indigo', hex: '#3000ff' },
  { name: 'Purple', hex: '#a000ff' },
  { name: 'White',  hex: '#ffffff' },
];
// initialBalls / seedSteps used to seed from PALETTES.chromatic; reuse this
// neutral set so the initial demo content still has a varied appearance.
const SEED_STEP_PALETTE = [
  { name: 'Red',     hex: '#ff3b3b' },
  { name: 'Orange',  hex: '#ff8a00' },
  { name: 'Amber',   hex: '#ffc933' },
  { name: 'Green',   hex: '#3ddc84' },
  { name: 'Cyan',    hex: '#22d3ee' },
  { name: 'Blue',    hex: '#3b82f6' },
  { name: 'Violet',  hex: '#a855f7' },
  { name: 'Magenta', hex: '#ec4899' },
];

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

function defaultRateFor(cmdId) {
  if (cmdId === 'blink') return 8;
  if (cmdId === 'breathe' || cmdId === 'pingpong') return 4;
  return 1;
}

// Firmware-native timing per command: BLINK uses both on/off, BREATHE / PINGPONG
// / RAINBOW use `on` as the full period; everything else has no timing field.
function defaultTimingFor(cmdId) {
  switch (cmdId) {
    case 'blink':    return { on: 125, off: 125 };  // 4 Hz strobe
    case 'breathe':  return { on: 1500, off: 0 };
    case 'pingpong': return { on: 1000, off: 0 };
    case 'rainbow':  return { on: 2000, off: 0 };
    default:         return { on: 0, off: 0 };
  }
}

// Resolve the on-time / off-time of a clip in milliseconds, falling back to
// the legacy `rate` field (cycles/sec for the firmware) so projects saved
// before this refactor still load and play at their original cadence.
function clipOnMs(clip) {
  if (clip.on != null) return clip.on;
  const rate = Math.max(0.1, clip.rate ?? defaultRateFor(clip.command));
  switch (clip.command) {
    case 'blink':    return Math.max(20, Math.round(500 / rate));
    case 'breathe':
    case 'pingpong':
    case 'rainbow':  return Math.max(100, Math.round(1000 / rate));
    default:         return 0;
  }
}
function clipOffMs(clip) {
  if (clip.off != null) return clip.off;
  if (clip.command === 'blink') return clipOnMs(clip);
  return 0;
}

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

// Strip characters that Windows / macOS / Linux refuse in filenames so
// projectName-derived downloads always succeed. Empty input falls back to
// 'Untitled' rather than producing a "" filename.
function sanitizeFilename(s) {
  const cleaned = (s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'Untitled';
}

function seedSteps() {
  const out = {};
  initialBalls.forEach((b) => {
    out[b.id + '-A'] = [];
    out[b.id + '-B'] = [];
  });
  initialBalls.forEach((b, i) => {
    const p = SEED_STEP_PALETTE;
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

// step + playhead position → { color, brightness } or null. `stepsPerSec` is
// (bpm/60)*4 — used to convert the clip-relative position into milliseconds so
// BLINK / BREATHE / PINGPONG / RAINBOW run at the same wall-clock cadence the
// firmware will, instead of cycling N times per clip regardless of duration.
function evalStep(step, playhead, stepsPerSec) {
  if (playhead < step.start || playhead >= step.start + step.length) return null;
  const local = (playhead - step.start) / step.length; // 0..1 within clip
  const elapsedMs = stepsPerSec > 0 ? (playhead - step.start) / stepsPerSec * 1000 : 0;
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
      const period = clipOnMs(step) || 1000;
      const phase = (elapsedMs % period) / period;
      brightness *= 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 - Math.PI / 2);
      break;
    }
    case 'blink': {
      const on = clipOnMs(step);
      const off = clipOffMs(step);
      const period = on + off;
      if (period > 0) {
        const phase = elapsedMs % period;
        color = phase < on ? step.color : (step.colorB || '#000000');
      }
      break;
    }
    case 'fade': {
      color = lerpColor(step.color, step.colorB || step.color, local);
      break;
    }
    case 'rainbow': {
      const period = clipOnMs(step) || 1000;
      const h = ((elapsedMs % period) / period) * 360;
      color = hslToHex(h, 1, 0.55);
      break;
    }
    case 'pingpong': {
      const period = clipOnMs(step) || 1000;
      const phase = (elapsedMs % period) / period;
      // Firmware: a = (1 - cos(2π·t)) / 2 — A at phase 0/1, B at phase 0.5.
      const a = (1 - Math.cos(2 * Math.PI * phase)) * 0.5;
      color = lerpColor(step.color, step.colorB || step.color, a);
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

// Coerce a possibly-missing JSON number to a finite value, defaulting only
// when the input is missing/NaN — not when the user genuinely set 0.
function numOr(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadCalibration() {
  try {
    const raw = localStorage.getItem(CAL_LS_KEY);
    if (!raw) return CAL_DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      gamma:         numOr(parsed.gamma,         CAL_DEFAULTS.gamma),
      channelGain:   {
        r: numOr(parsed.channelGain?.r, CAL_DEFAULTS.channelGain.r),
        g: numOr(parsed.channelGain?.g, CAL_DEFAULTS.channelGain.g),
        b: numOr(parsed.channelGain?.b, CAL_DEFAULTS.channelGain.b),
      },
      maxBrightness: numOr(parsed.maxBrightness, CAL_DEFAULTS.maxBrightness),
      diffuser:      { sigmaPct: numOr(parsed.diffuser?.sigmaPct, CAL_DEFAULTS.diffuser.sigmaPct) },
    };
  } catch { return CAL_DEFAULTS; }
}

// ---- Palette (user-editable, persisted, arbitrary length) ----
const PALETTE_LS_KEY = 'lightseq.palette.v2';
const PALETTE_DEFAULT = PALETTE_SEED.map(c => ({ ...c }));

function sanitizePalette(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const cleaned = parsed
    .filter(c => c && /^#[0-9a-fA-F]{6}$/.test(c.hex))
    .map(c => ({
      name: typeof c.name === 'string' && c.name ? c.name : c.hex,
      hex: c.hex,
    }));
  return cleaned.length ? cleaned : null;
}

function loadPalette() {
  try {
    const raw = localStorage.getItem(PALETTE_LS_KEY);
    if (!raw) return PALETTE_DEFAULT;
    return sanitizePalette(JSON.parse(raw)) || PALETTE_DEFAULT;
  } catch { return PALETTE_DEFAULT; }
}

// Single source of truth for the in-app palette. localStorage acts as the
// per-machine default; .lbproj projects can override transiently via setAll
// without writing back. Returns mutators that all persist to localStorage,
// plus a setAll that does not.
function usePalette() {
  const { useState, useCallback } = React;
  const [pal, setPalState] = useState(() => loadPalette());
  const persist = (next) => {
    try { localStorage.setItem(PALETTE_LS_KEY, JSON.stringify(next)); } catch {}
  };
  const setSwatch = useCallback((index, hex) => {
    setPalState(prev => {
      const next = prev.map((c, i) => i === index ? { ...c, hex, name: hex } : c);
      persist(next);
      return next;
    });
  }, []);
  const addSwatch = useCallback((hex) => {
    setPalState(prev => {
      const next = [...prev, { name: hex, hex }];
      persist(next);
      return next;
    });
  }, []);
  const removeSwatch = useCallback((index) => {
    setPalState(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      persist(next);
      return next;
    });
  }, []);
  // Used when loading a .lbproj — overrides current palette in memory only.
  const setAll = useCallback((arr) => {
    const sanitized = sanitizePalette(arr);
    if (sanitized) setPalState(sanitized);
  }, []);
  return { palette: pal, setSwatch, addSwatch, removeSwatch, setAll };
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
    '#include <avr/pgmspace.h>',
    '// Auto-generated by LightSeq calibration panel.',
    `// Generated: ${stamp}`,
    `// gamma=${cal.gamma.toFixed(2)} (display-only, not in LUT)`,
    `// gainR=${cal.channelGain.r.toFixed(3)}  gainG=${cal.channelGain.g.toFixed(3)}  gainB=${cal.channelGain.b.toFixed(3)}`,
    `// maxBrightness=${cal.maxBrightness.toFixed(3)}`,
    '//',
    '// PROGMEM: keeps the 768 B of LUTs in flash so they don\'t eat AVR SRAM.',
    '// Read via pgm_read_byte(&CAL_LUT_X[i]).',
    '',
    'static const uint8_t CAL_LUT_R[256] PROGMEM = {',
    lutToCArray(lr),
    '};',
    '',
    'static const uint8_t CAL_LUT_G[256] PROGMEM = {',
    lutToCArray(lg),
    '};',
    '',
    'static const uint8_t CAL_LUT_B[256] PROGMEM = {',
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
        gamma:         numOr(parsed.gamma,         CAL_DEFAULTS.gamma),
        channelGain: {
          r: numOr(parsed.channelGain?.r, CAL_DEFAULTS.channelGain.r),
          g: numOr(parsed.channelGain?.g, CAL_DEFAULTS.channelGain.g),
          b: numOr(parsed.channelGain?.b, CAL_DEFAULTS.channelGain.b),
        },
        maxBrightness: numOr(parsed.maxBrightness, CAL_DEFAULTS.maxBrightness),
        diffuser:      { sigmaPct: numOr(parsed.diffuser?.sigmaPct, CAL_DEFAULTS.diffuser.sigmaPct) },
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
  const { palette, setSwatch, addSwatch, removeSwatch, setAll: setPaletteAll } = usePalette();
  const [balls, setBalls] = useState(initialBalls);
  const [steps, setSteps] = useState(seedSteps);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState('breathe');
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [clipboard, setClipboard] = useState(null); // { clips: [{trackKey, start, length, command, color, colorB, brightness, rate}], anchor }
  const [bpm, setBpm] = useState(120);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loop, setLoop] = useState(true);
  const [audio, setAudio] = useState(null); // { name, peaks, durationSec, buffer }
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);
  // When audio is playing, the visual playhead is locked to the AudioContext clock
  // (not requestAnimationFrame dt) so notes stay aligned with the music. Anchor records
  // the (ctx.currentTime, playhead) pair at the moment the buffer source started.
  const audioAnchorRef = useRef(null);
  const [restartTick, setRestartTick] = useState(0); // bumped when Restart clip is hit, retriggers audio
  const [tool, setTool] = useState('paint');
  const [projectName, setProjectName] = useState('Untitled');

  // ---------- Undo / redo ----------
  // Live ref of project state so history helpers don't re-bind every render.
  const projectStateRef = useRef({ balls, steps, bpm, projectName, palette, audio });
  useEffect(() => { projectStateRef.current = { balls, steps, bpm, projectName, palette, audio }; }, [balls, steps, bpm, projectName, palette, audio]);
  const historyRef = useRef({ past: [], future: [] });
  const HISTORY_CAP = 100;
  const pushHistory = useCallback(() => {
    historyRef.current.past.push({ ...projectStateRef.current });
    if (historyRef.current.past.length > HISTORY_CAP) historyRef.current.past.shift();
    historyRef.current.future = [];
  }, []);
  const applySnapshot = useCallback((snap) => {
    setBalls(snap.balls);
    setSteps(snap.steps);
    setBpm(snap.bpm);
    if (typeof snap.projectName === 'string') setProjectName(snap.projectName);
    if (Array.isArray(snap.palette)) setPaletteAll(snap.palette);
    if (snap.audio !== undefined) setAudio(snap.audio);
    setSelectedStepId(null);
    setSelectedIds(new Set());
  }, [setPaletteAll]);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    h.future.push({ ...projectStateRef.current });
    applySnapshot(h.past.pop());
  }, [applySnapshot]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    h.past.push({ ...projectStateRef.current });
    applySnapshot(h.future.pop());
  }, [applySnapshot]);

  const [stepW, setStepW] = useState(22);
  const [scrollLeft, setScrollLeft] = useState(0);
  const gridSubdiv = { '1/2': 2, '1/3': 3, '1/4': 4, '1/6': 6, '1/8': 8, '1/12': 12, '1/16': 16, '1/24': 24, '1/32': 32, '1/64': 64 }[t.gridRes] || 16;
  // 3/4-style (triplet) resolutions imply 3 beats/bar; everything else is 4/4.
  const beatsPerBar = (t.gridRes === '1/3' || t.gridRes === '1/6' || t.gridRes === '1/12' || t.gridRes === '1/24') ? 3 : 4;

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
        let np;
        const anchor = audioAnchorRef.current;
        const ctx = audioCtxRef.current;
        if (anchor && ctx) {
          // If p was changed externally (scrub) since the last tick, re-anchor to it so
          // the visual respects the new position. Audio doesn't seek — that's the existing
          // behavior — but the playhead now reflects where the user clicked.
          if (anchor.lastP != null && Math.abs(p - anchor.lastP) > 0.01) {
            anchor.ctxTime = ctx.currentTime;
            anchor.playhead = p;
          }
          // Audio is the clock — derive playhead from ctx.currentTime so visual and audio
          // can't drift apart and the startup offset between RAF and src.start() vanishes.
          np = anchor.playhead + (ctx.currentTime - anchor.ctxTime) * stepsPerSec;
          anchor.lastP = np;
        } else {
          np = p + dt * stepsPerSec;
        }
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
          if (loop) {
            np = 0;
            // Re-anchor audio so the playhead doesn't immediately re-wrap from a stale ctxTime.
            setRestartTick(t => t + 1);
          } else {
            np = TOTAL_STEPS - 0.001;
            setPlaying(false);
          }
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
    audioAnchorRef.current = null;
    if (!playing) return;
    if (ctx.state === 'suspended') ctx.resume();

    // map current playhead (steps) -> seconds in song
    const stepsPerSec = (bpm / 60) * 4;
    const offsetSec = playhead / stepsPerSec;
    const src = ctx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(ctx.destination);
    const startAt = Math.min(audio.buffer.duration - 0.01, Math.max(0, offsetSec));
    // Schedule a hair into the future so the anchor's ctxTime matches actual playback start.
    const when = ctx.currentTime + 0.05;
    src.start(when, startAt);
    audioSourceRef.current = src;
    audioAnchorRef.current = { ctxTime: when, playhead };

    return () => {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch {}
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      }
      audioAnchorRef.current = null;
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

  // Move a clip across tracks (e.g. drag from B1-A → B2-B). Overlap with
  // clips in the target lane is allowed (visually warned downstream). The
  // `fromTrack` arg is treated as a hint — we always auto-locate the clip by
  // id so a stale hint (fast drags can outrun React's effect re-registration)
  // never silently no-ops.
  const moveStepToTrack = useCallback((id, fromTrack, toTrack, patch) => {
    setSteps(prev => {
      let actualFrom = (prev[fromTrack] && prev[fromTrack].some(s => s.id === id)) ? fromTrack : null;
      if (!actualFrom) {
        for (const k in prev) {
          if ((prev[k] || []).some(s => s.id === id)) { actualFrom = k; break; }
        }
      }
      if (!actualFrom) return prev;
      if (actualFrom === toTrack) {
        const arr = prev[toTrack].map(s => s.id === id ? { ...s, ...(patch || {}) } : s);
        return { ...prev, [toTrack]: arr };
      }
      const clip = prev[actualFrom].find(s => s.id === id);
      const merged = { ...clip, ...(patch || {}) };
      return {
        ...prev,
        [actualFrom]: prev[actualFrom].filter(s => s.id !== id),
        [toTrack]: [...(prev[toTrack] || []).filter(s => s.id !== id), merged],
      };
    });
    return true;
  }, []);

  // Resize every clip in `group` by the same length delta. Per-clip we clamp
  // to ≥1 step and stop the clip from sliding past TOTAL_STEPS so the dragged
  // master can't push the others off the timeline. Single setSteps so the
  // batch lands atomically.
  const bulkResizeGroup = useCallback((group, dLen) => {
    setSteps(prev => {
      const idToNew = new Map();
      for (const m of group) {
        const newLen = Math.max(1, Math.min(TOTAL_STEPS - m.origStart, m.origLength + dLen));
        idToNew.set(m.id, newLen);
      }
      const out = {};
      for (const k in prev) {
        out[k] = prev[k].map(s => idToNew.has(s.id) ? { ...s, length: idToNew.get(s.id) } : s);
      }
      return out;
    });
  }, [TOTAL_STEPS]);

  // Bulk re-place a group of clips for cross-track multi-clip drag. Each member
  // returns to its drag-start clip data, then is repositioned by `dStart` on
  // the time axis and `rdTracks` on the track axis. Done in one setSteps so
  // the timeline doesn't flicker through intermediate states each frame.
  const bulkMoveGroup = useCallback((group, dStart, rdTracks, trackOrder) => {
    setSteps(prev => {
      const ids = new Set(group.map(m => m.id));
      const out = {};
      for (const k in prev) out[k] = prev[k].filter(s => !ids.has(s.id));
      for (const m of group) {
        const targetTrack = trackOrder[m.origTrackIdx + rdTracks];
        if (!targetTrack) continue;
        if (!out[targetTrack]) out[targetTrack] = [];
        out[targetTrack] = [...out[targetTrack], { ...m.clip, start: m.origStart + dStart }];
      }
      return out;
    });
  }, []);

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
    const desiredLen = STEPS_PER_BAR / gridSubdiv;
    setSteps(prev => {
      const arr = prev[trackKey] || [];
      // Overlap is allowed (just visually warned). Only dedupe exact same-start
      // so drag-painting doesn't stack a tower of clips on one cell.
      if (arr.some(s => s.start === startStep)) return prev;
      const length = Math.max(0, Math.min(desiredLen, TOTAL_STEPS - startStep));
      if (length <= 0) return prev;
      const timing = defaultTimingFor(selectedCommand);
      const newStep = {
        id: cryptoId(),
        start: startStep,
        length,
        command: selectedCommand,
        color: palette[selectedColor].hex,
        colorB: palette[(selectedColor + 4) % palette.length].hex,
        brightness: 1,
        on: timing.on,
        off: timing.off,
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
        on: c.on,
        off: c.off,
        rate: c.rate, // kept so legacy clipboard payloads still resolve via clipOnMs fallback
      }));
      setClipboard({ clips: payload });
      return prev;
    });
  }, [selectedIds, selectedStepId]);

  // Paste clipboard at playhead. Each clip lands in its original track at playhead+offset.
  // Overlap with existing clips is allowed (visually warned downstream).
  const pasteClipboard = useCallback(() => {
    if (!clipboard || !clipboard.clips.length) return;
    pushHistory();
    setSteps(prev => {
      const out = { ...prev };
      const newIds = [];
      const anchor = Math.round(playhead);
      const sorted = [...clipboard.clips].sort((a, b) => a.offset - b.offset);
      for (const c of sorted) {
        if (!out[c.trackKey]) continue; // track may have been removed
        const arr = out[c.trackKey];
        const startStep = anchor + c.offset;
        if (startStep >= TOTAL_STEPS) continue;
        const length = Math.max(0, Math.min(c.length, TOTAL_STEPS - startStep));
        if (length <= 0) continue;
        const id = cryptoId();
        newIds.push(id);
        out[c.trackKey] = [...arr, {
          id, start: startStep, length,
          command: c.command, color: c.color, colorB: c.colorB,
          brightness: c.brightness, on: c.on, off: c.off, rate: c.rate,
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
    pushHistory();
    const emptySteps = {};
    initialBalls.forEach((b) => {
      emptySteps[b.id + '-A'] = [];
      emptySteps[b.id + '-B'] = [];
    });
    setBalls(initialBalls);
    setSteps(emptySteps);
    setBpm(120);
    setProjectName('Untitled');
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
      version: 3,
      name: projectName,
      bpm,
      balls,
      steps,
      palette,
      audio: audio ? {
        name: audio.name,
        durationSec: audio.durationSec,
        startStep: audio.startStep ?? 0,
        trimStartSec: audio.trimStartSec ?? 0,
        trimEndSec: audio.trimEndSec ?? 0,
        gain: audio.gain ?? 1,
      } : null,
      tweaks: t,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(projectName) + '.lbproj';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [projectName, bpm, balls, steps, audio, t, palette]);

  // Import a .lbproj. Restores balls/steps/bpm/tweaks; audio must be re-imported separately.
  const importProject = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.kind !== 'lbproj') throw new Error('Not a LightSeq project file.');
        pushHistory();
        if (data.balls) setBalls(data.balls);
        if (data.steps) setSteps(data.steps);
        if (typeof data.bpm === 'number') setBpm(data.bpm);
        // v2 stores name. v1 has no name field — fall back to the file name
        // (minus the extension) so reopened older projects still get something
        // sensible in the title bar.
        if (typeof data.name === 'string' && data.name) {
          setProjectName(data.name);
        } else if (file && file.name) {
          setProjectName(file.name.replace(/\.lbproj$/i, '').replace(/\.json$/i, '') || 'Untitled');
        }
        if (data.tweaks) {
          for (const k in data.tweaks) {
            // paletteMode is a removed v2 tweak; ignore so the imported palette wins.
            if (k === 'paletteMode') continue;
            setTweak(k, data.tweaks[k]);
          }
        }
        // v3+ embeds palette; v1/v2 don't — fall back to current localStorage palette.
        if (Array.isArray(data.palette)) setPaletteAll(data.palette);
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
  }, [setTweak, setPaletteAll]);

  const exportTxt = useCallback(() => {
    // Refuse to export if any track has overlapping clips. The firmware plays
    // commands sequentially per LED, so overlap in the editor would silently
    // export as back-to-back rows with timing that doesn't match the layout.
    const overlapTracks = [];
    for (const k in steps) {
      const arr = steps[k];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.start < b.start + b.length && a.start + a.length > b.start) {
            overlapTracks.push(k);
            i = arr.length; break; // one report per track is enough
          }
        }
      }
    }
    if (overlapTracks.length) {
      alert('Cannot export: overlapping clips on ' + overlapTracks.length +
        ' track(s) — ' + [...new Set(overlapTracks)].join(', ') +
        '.\n\nFix the clips marked with the red ⚠ OVERLAP stripe and try again.');
      return;
    }

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
      const onMs = clipOnMs(clip);
      const offMs = clipOffMs(clip);
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
        case 'blink':
          return emit(1, durMs, Math.max(20, onMs), Math.max(20, offMs), c1, c2);
        case 'fade':
          return emit(2, durMs, 0, 0, c1, c2);
        case 'breathe':
          return emit(3, durMs, Math.max(100, onMs), 0, c1, [0,0,0]);
        case 'pingpong':
          return emit(4, durMs, Math.max(100, onMs), 0, c1, c2);
        case 'rainbow': {
          // Expand into a chain of FADEs across the hue cycle. cyclePeriod = clip.on.
          // Total emitted duration must equal durMs exactly so the clip doesn't
          // bleed into whatever comes after it on the timeline.
          const cyclePeriod = Math.max(600, onMs);
          const stops = 6;
          const segMs = Math.max(40, Math.round(cyclePeriod / stops));
          // Floor (don't round) so we never overshoot, then absorb the
          // remainder into the last segment. Always emit at least one segment.
          const fitSegs = Math.max(1, Math.floor(durMs / segMs));
          const lastSegMs = durMs - segMs * (fitSegs - 1);
          const segs = [];
          for (let i = 0; i < fitSegs; i++) {
            const h1 = (i / stops) % 1;
            const h2 = ((i + 1) / stops) % 1;
            const a = scaleRgb(hsl2rgb(h1, 1, 0.5), clip.brightness ?? 1);
            const b = scaleRgb(hsl2rgb(h2, 1, 0.5), clip.brightness ?? 1);
            const d = (i === fitSegs - 1) ? lastSegMs : segMs;
            if (d <= 0) continue;
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
      a.download = sanitizeFilename(projectName) + '_export.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }, [balls, steps, bpm, projectName]);

  const onEraseAt = useCallback((trackKey, atStep) => {
    setSteps(prev => {
      const arr = (prev[trackKey] || []).filter(s => !(atStep >= s.start && atStep < s.start + s.length));
      return { ...prev, [trackKey]: arr };
    });
  }, []);

  const addBall = () => {
    if (balls.length >= 16) return;
    pushHistory();
    const i = balls.length;
    const id = 'B' + String(i + 1).padStart(2, '0');
    const color = palette[i % palette.length].hex;
    setBalls([...balls, { id, name: 'Ball ' + String(i + 1).padStart(2, '0'), color }]);
    setSteps(prev => ({ ...prev, [id + '-A']: [], [id + '-B']: [] }));
  };
  const removeBall = (ballId) => {
    if (balls.length <= 1) return;
    pushHistory();
    setBalls(balls.filter(b => b.id !== ballId));
    setSteps(prev => {
      const out = { ...prev };
      delete out[ballId + '-A']; delete out[ballId + '-B'];
      return out;
    });
  };

  // Live LED states
  const litState = useMemo(() => {
    const stepsPerSec = (bpm / 60) * 4;
    const out = {};
    balls.forEach(b => {
      ['A', 'B'].forEach(led => {
        const key = b.id + '-' + led;
        const arr = steps[key] || [];
        const active = arr.find(s => playhead >= s.start && playhead < s.start + s.length);
        out[key] = active ? evalStep(active, playhead, stepsPerSec) : null;
      });
    });
    return out;
  }, [playhead, steps, balls, bpm]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      // Undo / redo — keep above copy/paste so the modifier never falls through.
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo(); return;
      }
      if ((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y'))) {
        e.preventDefault(); redo(); return;
      }
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
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const all = new Set();
        for (const k in steps) for (const s of (steps[k] || [])) all.add(s.id);
        setSelectedIds(all);
        setSelectedStepId(all.size === 1 ? [...all][0] : null);
        return;
      }
      if (e.key === 'Escape') {
        if (selectedIds.size > 0 || selectedStepId) {
          setSelectedIds(new Set());
          setSelectedStepId(null);
        }
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          pushHistory();
          selectedIds.forEach(id => deleteStepById(id));
          setSelectedIds(new Set());
          setSelectedStepId(null);
        } else if (selectedStepId) {
          pushHistory();
          deleteStep(selectedStepId);
        }
      }
      if (!mod && e.key >= '1' && e.key <= '8') {
        const idx = parseInt(e.key) - 1;
        if (idx < palette.length) setSelectedColor(idx);
      }
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
  }, [selectedStepId, selectedIds, steps, deleteStep, deleteStepById, copySelected, pasteClipboard, undo, redo, pushHistory, palette.length]);

  return (
    <div className={"app theme-" + t.theme} data-screen-label="Sequencer">
      <TopBar
        bpm={bpm} setBpm={setBpm}
        playing={playing} setPlaying={setPlaying}
        loop={loop} setLoop={setLoop}
        playhead={playhead} setPlayhead={setPlayhead}
        tool={tool} setTool={setTool}
        gridRes={t.gridRes} setGridRes={(v) => setTweak('gridRes', v)}
        snapToGrid={snapToGrid} setSnapToGrid={setSnapToGrid}
        beatsPerBar={beatsPerBar}
        onExport={exportTxt}
        onNewProject={newProject}
        onExportProject={exportProject}
        onImportProject={importProject}
        pushHistory={pushHistory}
        projectName={projectName}
        setProjectName={setProjectName}
      />

      <CommandBar
        commands={COMMANDS}
        selectedCommand={selectedCommand}
        setSelectedCommand={setSelectedCommand}
        palette={palette}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        onSwatchChange={(i, hex) => { pushHistory(); setSwatch(i, hex); }}
        onSwatchAdd={(hex) => { pushHistory(); addSwatch(hex); }}
        onSwatchRemove={(i) => {
          if (palette.length <= 1) return;
          pushHistory();
          removeSwatch(i);
          setSelectedColor(prev => {
            if (prev === i) return Math.max(0, i - 1);
            if (prev > i) return prev - 1;
            return prev;
          });
        }}
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
            bpm={bpm}
            snapToGrid={snapToGrid}
            tool={tool}
            gridSubdiv={gridSubdiv}
            beatsPerBar={beatsPerBar}
            selectedStepId={selectedStepId}
            setSelectedStepId={setSelectedStepId}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onPaint={onPaint}
            onErase={onEraseAt}
            updateStep={updateStep}
            moveStepToTrack={moveStepToTrack}
            bulkMoveGroup={bulkMoveGroup}
            bulkResizeGroup={bulkResizeGroup}
            deleteStepById={deleteStepById}
            totalBars={TOTAL_BARS}
            totalSteps={TOTAL_STEPS}
            stepW={stepW}
            setStepW={setStepW}
            onScroll={setScrollLeft}
            pushHistory={pushHistory}
          />
        </div>

        <div className="right">
          <PreviewStage balls={balls} litState={litState} layout={t.previewLayout} glow={t.ballGlow} cal={cal}
            playhead={playhead} playing={playing}
            perfSim={{
              enabled:     t.perfSimEnabled,
              pattern:     t.perfSimPattern,
              radiusPct:   t.perfSimRadiusPct,
              periodBars:  t.perfSimPeriodBars,
              handGapPct:  t.perfSimHandGapPct,
              guides:      t.perfSimGuides,
              trail:       t.perfSimTrail,
            }}
            onPerfSim={setTweak}
          />
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
            onClick={() => { pushHistory(); loadCalibrationTestPattern({ setBalls, setSteps, setBpm }); }} />
          <TweakButton label="Export firmware header"
            onClick={() => downloadBlob('calibration.h', 'text/x-c', buildFirmwareHeader(cal))} />
          <TweakButton label="Export JSON"
            onClick={() => downloadBlob('calibration.json', 'application/json', JSON.stringify(cal, null, 2))} />
          <TweakButton label="Import JSON"
            onClick={() => importCalibrationJson(setCal)} secondary />
          <TweakButton label="Reset to defaults" onClick={resetCal} secondary />
        </TweakSection>
        <TweakSection title="Style">
          <TweakRadio label="Theme" value={t.theme}
            options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'}]}
            onChange={v => setTweak('theme', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ============ TOP BAR ============
function TopBar({ bpm, setBpm, playing, setPlaying, loop, setLoop, playhead, setPlayhead, tool, setTool, gridRes, setGridRes, snapToGrid, setSnapToGrid, beatsPerBar = 4, onExport, onNewProject, onExportProject, onImportProject, pushHistory, projectName, setProjectName }) {
  const RESOLUTIONS = ['1/2','1/3','1/4','1/6','1/8','1/12','1/16','1/24','1/32','1/64'];
  const stepsPerBeat = 16 / beatsPerBar;
  const bar = Math.floor(playhead / 16) + 1;
  const beat = Math.floor((playhead % 16) / stepsPerBeat) + 1;
  const tick = Math.floor(playhead % stepsPerBeat) + 1;
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
          <input className="project-name mono" type="text"
            value={projectName ?? ''}
            spellCheck={false}
            maxLength={64}
            placeholder="Untitled"
            title="Project name (used as the saved filename)"
            onFocus={() => pushHistory && pushHistory()}
            onChange={(e) => setProjectName && setProjectName(e.target.value)}
            onKeyDown={(e) => {
              // Enter or Esc dismisses the field instead of inserting a newline.
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const v = (e.target.value || '').trim();
              if (!v && setProjectName) setProjectName('Untitled');
            }} />
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
            onFocus={() => pushHistory && pushHistory()}
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
          <div className="ro-value mono">{beatsPerBar}/4</div>
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
        <button className={"tool " + (snapToGrid ? 'on' : '')} onClick={() => setSnapToGrid(v => !v)} title="Snap to Grid">⊞</button>
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
function CommandBar({ commands, selectedCommand, setSelectedCommand, palette, selectedColor, setSelectedColor, onSwatchChange, onSwatchAdd, onSwatchRemove }) {
  const [popover, setPopover] = useState(null); // { index, x, y }
  const popoverRef = useRef(null);
  const addPickerRef = useRef(null);

  useEffect(() => {
    if (!popover) return;
    const onDoc = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setPopover(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPopover(null); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const openAddPicker = () => {
    if (addPickerRef.current) addPickerRef.current.click();
  };

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
              onContextMenu={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setPopover({ index: i, x: rect.left, y: rect.bottom + 4 });
              }}
              title={c.name + (i < 8 ? ' · ' + (i+1) : '') + ' (right-click to edit)'} />
          ))}
          <button
            className="swatch swatch-add"
            onClick={openAddPicker}
            title="Add swatch">+</button>
          <input
            ref={addPickerRef}
            type="color"
            defaultValue="#ffffff"
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => { onSwatchAdd && onSwatchAdd(e.target.value); }}
          />
        </div>
      </div>
      <div className="cmdbar-hint mono">Pick a command + color, then click-drag on the grid to place.</div>
      {popover && (
        <div ref={popoverRef} className="swatch-popover"
          style={{ left: popover.x, top: popover.y }}
          onMouseDown={(e) => e.stopPropagation()}>
          <label className="swatch-popover-row">
            <span className="mono">Color</span>
            <input
              type="color"
              value={palette[popover.index]?.hex || '#000000'}
              onChange={(e) => onSwatchChange && onSwatchChange(popover.index, e.target.value)} />
          </label>
          <button
            className="swatch-popover-remove"
            disabled={palette.length <= 1}
            onClick={() => { onSwatchRemove && onSwatchRemove(popover.index); setPopover(null); }}>
            Remove
          </button>
        </div>
      )}
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
function Timeline({ balls, steps, playhead, setPlayhead, bpm, snapToGrid, tool, gridSubdiv, beatsPerBar = 4, selectedStepId, setSelectedStepId, selectedIds, setSelectedIds, onPaint, onErase, updateStep, moveStepToTrack, bulkMoveGroup, bulkResizeGroup, deleteStepById, totalBars, totalSteps, stepW, setStepW, onScroll, pushHistory }) {
  const TOTAL_STEPS = totalSteps;
  const TOTAL_BARS = totalBars;
  const [drag, setDrag] = useState(null);
  const [paintDrag, setPaintDrag] = useState(false);
  const [marquee, setMarquee] = useState(null); // { x0,y0,x1,y1 }
  // Tracks whether a Ctrl/Cmd modifier is currently held so the cursor can
  // reflect the temporary-Select behavior in Paint mode. Window blur clears
  // the state because the keyup may land on a different page.
  const [modSelect, setModSelect] = useState(false);
  // True while the user is holding the right mouse button in Paint mode —
  // turns the gesture into a brush-erase: hover over any clip while held
  // and it deletes.
  const [rightDelete, setRightDelete] = useState(false);
  const gridRef = useRef(null);
  useEffect(() => {
    const sync = (e) => setModSelect(!!(e.ctrlKey || e.metaKey));
    const clear = () => setModSelect(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Brush-erase while the right mouse button is held in Paint mode. The
  // initial clip under the cursor is deleted by the mousedown that flips
  // this state on; mousemove handles dragging across more clips. body
  // gets a .right-deleting class so the cursor stays as the delete icon
  // even when the pointer is over child elements that would otherwise
  // override it.
  useEffect(() => {
    if (!rightDelete) return;
    document.body.classList.add('right-deleting');
    let lastId = null;
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const clipEl = el && el.closest && el.closest('.clip');
      const id = clipEl && clipEl.dataset && clipEl.dataset.clipId;
      if (id && id !== lastId) {
        deleteStepById(id);
        lastId = id;
      } else if (!id) {
        lastId = null;
      }
    };
    const onUp = (e) => {
      // Any mouseup ends the gesture; if only the left button is somehow
      // released first we still bail — releasing right is the common case.
      if (e.button === 2 || e.button === undefined || !e.buttons) {
        setRightDelete(false);
      }
    };
    const onMenu = (e) => e.preventDefault();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Suppress the browser context menu that would otherwise fire when the
    // right button is released, even though Clip / row handlers already
    // preventDefault — this is a safety net for events bubbling outside
    // those elements (ruler, label gutter, padding, etc).
    window.addEventListener('contextmenu', onMenu);
    return () => {
      document.body.classList.remove('right-deleting');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('contextmenu', onMenu);
    };
  }, [rightDelete, deleteStepById]);

  // Right-mousedown anywhere inside the timeline starts a brush-erase in
  // Paint mode. We hit-test through elementFromPoint so a click on either
  // a clip or empty grid both work, and we push one history entry per
  // gesture (not per clip deleted).
  const onTimelineMouseDown = (e) => {
    if (e.button !== 2 || tool !== 'paint') return;
    e.preventDefault();
    pushHistory && pushHistory();
    setRightDelete(true);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const clipEl = el && el.closest && el.closest('.clip');
    const id = clipEl && clipEl.dataset && clipEl.dataset.clipId;
    if (id) deleteStepById(id);
  };

  const STEP_W = stepW;
  const totalW = STEP_W * TOTAL_STEPS;
  // gridSubdiv is "divisions per bar": 1/4 = 4 cells/bar, 1/16 = 16/bar, 1/64 = 64/bar.
  const cellsPerBar = gridSubdiv;
  const subdivStep = STEPS_PER_BAR / cellsPerBar;
  // Pixels per millisecond — used by Clip to draw stripes at the same wall-clock
  // cadence the firmware will play, so on/off and period changes show up visually.
  const stepsPerSec = (bpm / 60) * 4;
  const pxPerMs = stepsPerSec > 0 ? (STEP_W * stepsPerSec) / 1000 : 0;

  // Flat list of trackKeys in display order — used to map drag-Y → target lane.
  const ROW_H = 30;
  const RULER_H = 28;
  const trackOrder = useMemo(() => {
    const out = [];
    balls.forEach(b => { out.push(b.id + '-A'); out.push(b.id + '-B'); });
    return out;
  }, [balls]);

  const xToStep = (x) => Math.max(0, Math.min(TOTAL_STEPS, x / STEP_W));
  const xToSnappedStep = (x) => {
    const step = xToStep(x);
    return snapToGrid ? Math.floor(step / subdivStep) * subdivStep : step;
  };

  const onMouseDownGrid = (e, trackKey, rowEl) => {
    // Right / middle click is handled by onContextMenu — never paint or erase.
    if (e.button !== 0) return;
    if (e.target.classList.contains('clip') || e.target.closest('.clip')) return;
    const rect = rowEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const start = xToSnappedStep(x);
    // Paint-mode shortcut: holding Ctrl/Cmd temporarily acts as the Select
    // tool so the user can rubber-band without leaving paint.
    const effectiveTool = (tool === 'paint' && (e.ctrlKey || e.metaKey)) ? 'select' : tool;
    if (effectiveTool === 'paint') {
      pushHistory && pushHistory();
      onPaint(trackKey, start);
      setPaintDrag(true);
    } else if (effectiveTool === 'erase') {
      pushHistory && pushHistory();
      onErase(trackKey, xToStep(x));
    } else if (effectiveTool === 'select') {
      // Marquee coords are stored in .tl-grid content space — convert from
      // viewport by adding the timeline's scroll offset and subtracting the
      // sticky ruler that sits above the grid.
      const el = gridRef.current;
      const gridRect = el.getBoundingClientRect();
      const mx = e.clientX - gridRect.left + el.scrollLeft;
      const my = e.clientY - gridRect.top + el.scrollTop - RULER_H;
      setMarquee({ x0: mx, y0: my, x1: mx, y1: my });
      // Shift / Ctrl / Cmd → additive marquee: keep existing selection and
      // union with anything inside the box on mouseup.
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
        setSelectedIds(new Set());
        setSelectedStepId(null);
      }
    }
  };

  const onRulerMouseDown = (e) => {
    if (e.button !== 0) return;
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

  // resize/move. Overlap with neighbours is allowed (visually warned).
  useEffect(() => {
    if (!drag) return;
    document.body.classList.add('dragging');
    const onMove = (e) => {
      const dxSteps = (e.clientX - drag.startX) / STEP_W;
      // Snap-to-grid uses the absolute target position (not origStart + delta)
      // so a clip placed at a finer resolution lands on the current grid as
      // soon as it's moved, instead of preserving its old sub-step offset.
      const snapAbs = (v) => Math.round(v / subdivStep) * subdivStep;
      const targetStart = snapToGrid ? snapAbs(drag.origStart + dxSteps) : drag.origStart + dxSteps;
      if (drag.mode === 'move') {
        // Cursor's current track index (used for both single and group drag).
        let cursorTrackIdx = drag.origTrackIdx;
        if (gridRef.current) {
          const gridRect = gridRef.current.getBoundingClientRect();
          const yInGrid = e.clientY - gridRect.top - RULER_H + (gridRef.current.scrollTop || 0);
          cursorTrackIdx = Math.max(0, Math.min(trackOrder.length - 1, Math.floor(yInGrid / ROW_H)));
        }

        if (drag.group) {
          // Group drag: shift every member by the same time delta and the same
          // row delta so the whole selection translates together.
          let d = targetStart - drag.origStart;
          for (const m of drag.group) {
            d = Math.max(-m.origStart, Math.min(TOTAL_STEPS - m.origLength - m.origStart, d));
          }
          let rd = cursorTrackIdx - drag.origTrackIdx;
          let minRd = -Infinity, maxRd = Infinity;
          for (const m of drag.group) {
            minRd = Math.max(minRd, -m.origTrackIdx);
            maxRd = Math.min(maxRd, trackOrder.length - 1 - m.origTrackIdx);
          }
          rd = Math.max(minRd, Math.min(maxRd, rd));
          bulkMoveGroup(drag.group, d, rd, trackOrder);
          return;
        }

        const ns = Math.max(0, Math.min(TOTAL_STEPS - drag.origLength, targetStart));
        const targetTrack = trackOrder[cursorTrackIdx] || drag.trackKey;
        // Always go through moveStepToTrack: it patches in place when the clip
        // is already in the target lane and moves it otherwise. This keeps the
        // drag effect from re-registering listeners every cross-track frame,
        // which is what made fast drags drop events before.
        moveStepToTrack(drag.stepId, drag.trackKey, targetTrack, { start: ns });
      } else if (drag.mode === 'resize') {
        const maxEnd = TOTAL_STEPS;
        const newEnd = Math.min(maxEnd, snapToGrid ? snapAbs(drag.origStart + drag.origLength + dxSteps) : drag.origStart + drag.origLength + dxSteps);
        const nl = Math.max(subdivStep, newEnd - drag.origStart);
        if (drag.group) {
          // Master clip's snapped end determines the shared length delta; the
          // other clips in the group get the same delta without re-snapping
          // (snapping each clip individually would break their relative
          // lengths). bulkResizeGroup clamps per clip so trailing clips can't
          // run past TOTAL_STEPS.
          bulkResizeGroup(drag.group, nl - drag.origLength);
        } else {
          updateStep(drag.stepId, { length: nl });
        }
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.classList.remove('dragging'); };
  }, [drag, snapToGrid, subdivStep, updateStep, moveStepToTrack, bulkMoveGroup, bulkResizeGroup, trackOrder, TOTAL_STEPS, STEP_W]);

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
      const el = gridRef.current;
      const gridRect = el.getBoundingClientRect();
      const mx = e.clientX - gridRect.left + el.scrollLeft;
      const my = e.clientY - gridRect.top + el.scrollTop - RULER_H;
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
      // Anchor zoom under the cursor: keep the step at cursorX stationary by
      // adjusting scrollLeft once the new step width is applied.
      const rect = el.getBoundingClientRect();
      const cursorX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      // Round to whole pixels — fractional STEP_W makes repeating-linear-gradient
      // stops drift, producing visible gridline misalignment on long songs.
      setStepW((w) => {
        const next = Math.round(w * factor);
        let clamped = Math.max(6, Math.min(80, next));
        // Round-to-int can stall the zoom when w*factor rounds back to w; nudge it.
        if (clamped === w) clamped = Math.max(6, Math.min(80, w + (factor > 1 ? 1 : -1)));
        if (clamped !== w) {
          const worldStep = (el.scrollLeft + cursorX) / w;
          // Apply on the next frame so the timeline has resized first
          // (scrollLeft is clamped to the current scrollWidth).
          const targetScroll = Math.max(0, worldStep * clamped - cursorX);
          requestAnimationFrame(() => { el.scrollLeft = targetScroll; });
        }
        return clamped;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setStepW]);

  return (
    <div className={"timeline tool-" + (
        (tool === 'paint' && rightDelete) ? 'erase' :
        (tool === 'paint' && modSelect) ? 'select' :
        tool
      )}
      ref={gridRef}
      onMouseDown={onTimelineMouseDown}
      onScroll={(e) => onScroll && onScroll(e.currentTarget.scrollLeft)}>
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

      <div className="tl-grid" style={{ width: totalW }}>
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
                        // beats: one line per beat within a bar (4 for 4/4, 3 for 3/4)
                        `repeating-linear-gradient(90deg, transparent 0, transparent ${(STEPS_PER_BAR / beatsPerBar) * STEP_W - 1}px, var(--border-strong) ${(STEPS_PER_BAR / beatsPerBar) * STEP_W - 1}px, var(--border-strong) ${(STEPS_PER_BAR / beatsPerBar) * STEP_W}px)`,
                        // bars: strongest
                        `repeating-linear-gradient(90deg, transparent 0, transparent ${STEPS_PER_BAR * STEP_W - 1}px, var(--text-faint) ${STEPS_PER_BAR * STEP_W - 1}px, var(--text-faint) ${STEPS_PER_BAR * STEP_W}px)`,
                      ].join(', '),
                    }}
                    onMouseDown={e => onMouseDownGrid(e, trackKey, e.currentTarget)}
                    onContextMenu={e => {
                      // The right-mousedown handler on the timeline root
                      // handles the actual brush-erase; here we just suppress
                      // the browser context menu in Paint mode.
                      if (tool === 'paint') e.preventDefault();
                    }}
                    onMouseEnter={e => {
                      if (paintDrag && tool === 'paint') {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        onPaint(trackKey, xToSnappedStep(x));
                      }
                    }}>
                    {(() => {
                      // Mark every clip on this track that overlaps any other clip on the same track.
                      const overlapIds = new Set();
                      for (let i = 0; i < arr.length; i++) {
                        for (let j = i + 1; j < arr.length; j++) {
                          const a = arr[i], b2 = arr[j];
                          if (a.start < b2.start + b2.length && a.start + a.length > b2.start) {
                            overlapIds.add(a.id); overlapIds.add(b2.id);
                          }
                        }
                      }
                      // Render longest clips first so shorter ones (and their warning
                      // stripes) always paint on top and stay visible when contained.
                      const ordered = [...arr].sort((a, b) => b.length - a.length);
                      return ordered.map(s => (
                        <Clip key={s.id} step={s}
                          STEP_W={STEP_W}
                          pxPerMs={pxPerMs}
                          selected={selectedStepId === s.id || selectedIds.has(s.id)}
                          overlapping={overlapIds.has(s.id)}
                          playhead={playhead}
                          tool={tool}
                          onSelect={(ev) => {
                            // Ctrl/Cmd-click → toggle this clip in/out of the
                            // multi-selection; plain click → single-select.
                            if (ev && (ev.ctrlKey || ev.metaKey)) {
                              const had = selectedIds.has(s.id);
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (had) next.delete(s.id); else next.add(s.id);
                                return next;
                              });
                              // `selected` checks selectedStepId OR selectedIds, so
                              // leaving selectedStepId pinned to s.id after a
                              // deselect keeps the clip looking selected. Clear
                              // it on deselect; point it at s.id on select.
                              setSelectedStepId(prev => had ? (prev === s.id ? null : prev) : s.id);
                            } else {
                              setSelectedStepId(s.id);
                              setSelectedIds(new Set([s.id]));
                            }
                          }}
                          onErase={() => { pushHistory && pushHistory(); onErase(trackKey, s.start); }}
                          onMoveStart={(e) => {
                            e.stopPropagation();
                            // Ctrl/Cmd-click on a clip is selection-only; the
                            // click handler below toggles membership. Skip drag
                            // and history push so deselecting doesn't burn an
                            // undo slot.
                            if (e.ctrlKey || e.metaKey) return;
                            pushHistory && pushHistory();
                            // If the grabbed clip is part of a multi-selection, drag the whole
                            // group together — also across LEDs/balls. Otherwise become the
                            // sole selection so single-clip drag behaves as before.
                            const inGroup = selectedIds.has(s.id) && selectedIds.size > 1;
                            let group = null;
                            if (inGroup) {
                              group = [];
                              for (const tk in steps) {
                                const ti = trackOrder.indexOf(tk);
                                if (ti < 0) continue;
                                for (const c of (steps[tk] || [])) {
                                  if (selectedIds.has(c.id)) {
                                    group.push({
                                      id: c.id,
                                      origTrackIdx: ti,
                                      origStart: c.start,
                                      origLength: c.length,
                                      clip: { ...c },
                                    });
                                  }
                                }
                              }
                            } else {
                              setSelectedIds(new Set([s.id]));
                            }
                            setSelectedStepId(s.id);
                            setDrag({
                              stepId: s.id,
                              trackKey,
                              mode: 'move',
                              startX: e.clientX,
                              origStart: s.start,
                              origLength: s.length,
                              origTrackIdx: trackOrder.indexOf(trackKey),
                              group,
                            });
                          }}
                          onResizeStart={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            // If the grabbed edge belongs to a multi-selection,
                            // resize all selected clips by the same delta —
                            // same group-drag idiom as move.
                            const inGroup = selectedIds.has(s.id) && selectedIds.size > 1;
                            let group = null;
                            if (inGroup) {
                              group = [];
                              for (const tk in steps) {
                                for (const c of (steps[tk] || [])) {
                                  if (selectedIds.has(c.id)) {
                                    group.push({ id: c.id, origStart: c.start, origLength: c.length });
                                  }
                                }
                              }
                            }
                            pushHistory && pushHistory();
                            setSelectedStepId(s.id);
                            setDrag({ stepId: s.id, trackKey, mode: 'resize', startX: e.clientX, origStart: s.start, origLength: s.length, group });
                          }}
                        />
                      ));
                    })()}
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

function Clip({ step, STEP_W, pxPerMs, selected, overlapping, playhead, tool, onSelect, onErase, onMoveStart, onResizeStart }) {
  const w = step.length * STEP_W;
  const left = step.start * STEP_W;
  const cmd = COMMANDS.find(c => c.id === step.command);

  // Visual fill per command type. For period-based commands the gradient is
  // derived from the SAME formulas evalStep uses, so the pattern under the
  // playhead matches the preview ball exactly when the user changes period /
  // on / off. Fractional px widths (no Math.round, no min floor) keep the
  // boundaries pixel-accurate; if a cycle is sub-pixel, the gradient blends
  // into an average, which is also what the ball perceptually does.
  const periodPx = (ms) => (pxPerMs || 0) * ms;
  let fill;
  switch (step.command) {
    case 'color':
      fill = step.color;
      break;
    case 'restart':
      fill = `repeating-linear-gradient(45deg, #2a2a2a 0 6px, #1a1a1a 6px 12px)`;
      break;
    case 'breathe': {
      // brightness = (1 - cos(2π·phase))/2 ; sample at N stops, darken color by it.
      const period = Math.max(0.5, periodPx(clipOnMs(step) || 1000));
      const N = 12;
      const stops = [];
      for (let i = 0; i <= N; i++) {
        const phase = i / N;
        const b = (1 - Math.cos(2 * Math.PI * phase)) * 0.5;
        const c = lerpColor('#000000', step.color, b);
        stops.push(`${c} ${(phase * period).toFixed(3)}px`);
      }
      fill = `repeating-linear-gradient(90deg, ${stops.join(', ')})`;
      break;
    }
    case 'blink': {
      const onPx = periodPx(clipOnMs(step));
      const offPx = periodPx(clipOffMs(step));
      const total = onPx + offPx;
      if (total <= 0) { fill = step.color; break; }
      const b = step.colorB || '#000000';
      // Hard transitions at on→off and off→on (matches evalStep's phase compare).
      fill = `repeating-linear-gradient(90deg, ${step.color} 0, ${step.color} ${onPx.toFixed(3)}px, ${b} ${onPx.toFixed(3)}px, ${b} ${total.toFixed(3)}px)`;
      break;
    }
    case 'fade':
      fill = `linear-gradient(90deg, ${step.color}, ${step.colorB||step.color})`;
      break;
    case 'rainbow': {
      // One full hue sweep per cycle period — sample hslToHex(h,1,0.55) to match evalStep.
      const period = Math.max(0.5, periodPx(clipOnMs(step) || 1000));
      const N = 12;
      const stops = [];
      for (let i = 0; i <= N; i++) {
        const phase = i / N;
        stops.push(`${hslToHex(phase * 360, 1, 0.55)} ${(phase * period).toFixed(3)}px`);
      }
      fill = `repeating-linear-gradient(90deg, ${stops.join(', ')})`;
      break;
    }
    case 'pingpong': {
      // a = (1 - cos(2π·phase))/2 — same lerp evalStep uses.
      const period = Math.max(0.5, periodPx(clipOnMs(step) || 1000));
      const a = step.color;
      const bCol = step.colorB || step.color;
      const N = 12;
      const stops = [];
      for (let i = 0; i <= N; i++) {
        const phase = i / N;
        const t = (1 - Math.cos(2 * Math.PI * phase)) * 0.5;
        stops.push(`${lerpColor(a, bCol, t)} ${(phase * period).toFixed(3)}px`);
      }
      fill = `repeating-linear-gradient(90deg, ${stops.join(', ')})`;
      break;
    }
    default:
      fill = step.color;
  }

  const handleMouseDown = (e) => {
    // Non-left buttons go through onContextMenu so right-click never starts
    // a drag or selection.
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'erase') { onErase(); return; }
    // paint and select: act as a move handle. onMoveStart selects the clip;
    // a no-movement mousedown still falls through to onClick below.
    onMoveStart(e);
  };
  const cursor = tool === 'erase' ? 'not-allowed' : 'grab';

  return (
    <div className={"clip " + (selected?'sel ':'') + (overlapping?'overlap ':'') + "tool-" + tool}
      style={{ left, width: w, cursor }}
      data-clip-id={step.id}
      title={overlapping ? 'Overlaps another clip on this track' : undefined}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        // The actual delete happens on right-mousedown at the Timeline
        // level (see rightDelete in Timeline) so the same gesture can
        // brush across multiple clips. Here we only need to suppress the
        // browser's native context menu in Paint mode.
        if (tool === 'paint') { e.preventDefault(); e.stopPropagation(); }
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(e); }}
    >
      <div className="clip-fill" style={{
        background: fill,
        // Mirror evalStep's brightness multiplier so the inspector slider visibly
        // dims the clip the same way it dims the preview ball.
        filter: `brightness(${Math.max(0, Math.min(1, step.brightness ?? 1))})`,
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
// Performer-sim geometry, all in pixels relative to the stage box. Positions
// are slot-aware (each performer owns 1/N of the stage width) and capped so
// adjacent pairs' orbits never intersect.
//
// Returns { xPx, yPx } for one ball in canvas coordinates (origin = stage
// top-left). pivotXPx is the hand pivot for non-weave patterns; centerXPx is
// the performer center for weave (figure-8).
function performerBallPos({ pattern, theta, centerXPx, centerYPx, pivotLPx, pivotRPx, rPx, isLeft }) {
  if (pattern === 'weave') {
    const ph = isLeft ? theta : theta + Math.PI;
    return {
      xPx: centerXPx + Math.cos(ph) * rPx,
      yPx: centerYPx + Math.sin(2 * ph) * rPx * 0.6,
    };
  }
  let angle, pivotXPx;
  if (isLeft) {
    angle = theta;
    pivotXPx = pivotLPx;
  } else if (pattern === 'mirror') {
    angle = -theta;
    pivotXPx = pivotRPx;
  } else if (pattern === 'split') {
    angle = theta + Math.PI;
    pivotXPx = pivotRPx;
  } else {
    angle = theta;
    pivotXPx = pivotRPx;
  }
  return {
    xPx: pivotXPx + Math.cos(angle) * rPx,
    yPx: centerYPx + Math.sin(angle) * rPx,
  };
}

// Inline icon for the settings popover trigger.
function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2"/>
      <path d="M8 1.5v1.8M8 12.7v1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M1.5 8h1.8M12.7 8h1.8M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/>
    </svg>
  );
}

// Persistence-of-vision trail layer. Models four perceptual phenomena that
// dominate how audiences see a moving LED in a dark room:
//
//  1. Persistence of vision (Bidwell): the retina holds a signal for ~50–150ms
//     after light removal, so a fast-moving LED paints a continuous streak.
//     We approximate this by fading the canvas a constant α per frame (gives
//     exponential decay) and drawing the LED's path as an interpolated line.
//  2. Comet head: the *current* position is much brighter than the trail.
//     We draw a multi-pass radial bloom at the head every frame (small hot
//     core + saturated mid + soft outer halo).
//  3. Photopic saturation: bright LEDs desaturate toward white at the core
//     (cone saturation). The hot core is white; the saturated color shows as
//     a ring around it.
//  4. Speed-vs-brightness: a fast LED appears dimmer because its photons are
//     smeared across more retina per integration window. We scale per-frame
//     stroke alpha down for fast motion.
//
// Decoupled from React renders by its own RAF loop — the canvas paints at
// monitor rate even when React isn't re-rendering, which matters when the
// transport is paused (we still want the heads to stay visible) and when
// React batches updates (we don't want frame-skips that break the streak).
function TrailCanvas({ balls, litState, positions, cal, trail, playing, playhead, stageSize, zoom, pan }) {
  const { useRef, useEffect } = React;
  const canvasRef = useRef(null);

  // Refs kept fresh by the parent's renders. The RAF loop reads from these
  // so it can run independently of React's reconciliation cadence.
  const ballsRef     = useRef(balls);
  const litStateRef  = useRef(litState);
  const positionsRef = useRef(positions);
  const calRef       = useRef(cal);
  const trailRef     = useRef(trail);
  const playingRef   = useRef(playing);
  const playheadRef  = useRef(playhead);
  const zoomRef      = useRef(zoom);
  const panRef       = useRef(pan);
  ballsRef.current     = balls;
  litStateRef.current  = litState;
  positionsRef.current = positions;
  calRef.current       = cal;
  trailRef.current     = trail;
  playingRef.current   = playing;
  playheadRef.current  = playhead;
  zoomRef.current      = zoom;
  panRef.current       = pan;

  // Sync internal pixel buffer to current stage CSS size + DPR. Runs whenever
  // the stage resizes (via stageSize prop) so the canvas stays crisp.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !stageSize.w || !stageSize.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w   = Math.round(stageSize.w * dpr);
    const h   = Math.round(stageSize.h * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }, [stageSize.w, stageSize.h]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let raf;
    let lastPlayhead = playheadRef.current;
    const prevHead = {};   // ballId -> {x, y} in canvas px from previous frame

    let lastZoom = zoomRef.current;
    let lastPan  = panRef.current;

    const tick = () => {
      const ctx       = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const cssW = cv.clientWidth || (W ? W : 1);
      const cssH = cv.clientHeight || (H ? H : 1);
      const dpr       = W > 0 && cssW > 0 ? W / cssW : (window.devicePixelRatio || 1);
      const balls     = ballsRef.current;
      const litState  = litStateRef.current;
      const positions = positionsRef.current;
      const cal       = calRef.current;
      const trail     = trailRef.current;
      const playing   = playingRef.current;
      const playhead  = playheadRef.current;
      const zoom      = zoomRef.current;
      const pan       = panRef.current;

      // Detect a seek (loop, scrub, big jump) so we don't paint a misleading
      // streak across the seek discontinuity.
      const dPh  = playhead - lastPlayhead;
      const seek = dPh < 0 || dPh > 4;
      lastPlayhead = playhead;

      // Detect a view change (zoom or pan): old streaks were drawn at the
      // previous transform and would otherwise sit at the wrong world location.
      const viewChanged = (zoom !== lastZoom) || (pan.x !== lastPan.x) || (pan.y !== lastPan.y);
      lastZoom = zoom;
      lastPan  = pan;

      // 1. Fade the canvas in SCREEN space (always identity transform here),
      //    so trails fade uniformly regardless of zoom/pan. Clear instead
      //    of fading on a seek or view change.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      const fadeBase = playing ? (0.45 - 0.43 * trail) : 0.10;
      if (seek || viewChanged) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        for (const k in prevHead) delete prevHead[k];
      } else {
        ctx.fillStyle = `rgba(0,0,0,${fadeBase})`;
        ctx.fillRect(0, 0, W, H);
      }

      // 2. Switch to a transform that maps world (CSS px, the same units
      //    PreviewStage computes positions in) to canvas device pixels with
      //    user zoom + pan applied. From here on everything we draw is in
      //    world units — line widths and gradient radii scale with zoom,
      //    which matches the perceptual "I walked closer" effect.
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, pan.x * dpr, pan.y * dpr);

      // Head sizes in CSS px (world units). Will be scaled by the transform.
      const headR = Math.max(8, cssH * 0.045);   // saturated mid-bloom radius
      const haloR = headR * 3.2;                 // outer ocular glare
      const coreR = headR * 0.35;                // hot white core

      // Additive blend so two LEDs in the same place double up like real photons.
      ctx.globalCompositeOperation = 'lighter';

      balls.forEach(b => {
        const pos = positions && positions[b.id];
        if (!pos) {
          delete prevHead[b.id];
          return;
        }

        const linA = ledToLinearRGB(litState[b.id+'-A'], cal);
        const linB = ledToLinearRGB(litState[b.id+'-B'], cal);
        const lr = Math.max(linA[0], linB[0]);
        const lg = Math.max(linA[1], linB[1]);
        const lb = Math.max(linA[2], linB[2]);
        const briLin = Math.max(lr, lg, lb);
        if (briLin <= 0.001) {
          delete prevHead[b.id];
          return;
        }

        // Positions and prevHead are stored in WORLD CSS px; the transform
        // handles dpr + zoom + pan.
        const xPx = pos.xPx;
        const yPx = pos.yPx;

        // sRGB-encoded color for stroke/fill.
        const r8 = linearToSrgb8(lr, cal.gamma);
        const g8 = linearToSrgb8(lg, cal.gamma);
        const b8 = linearToSrgb8(lb, cal.gamma);

        // 2. Streak: thick gaussian-feathered line from prev head to current head.
        const prev = prevHead[b.id];
        if (prev) {
          const dx = xPx - prev.x, dy = yPx - prev.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          // 4. Speed-vs-brightness: longer per-frame travel → dimmer streak.
          // Reference travel ≈ headR; longer than that gets attenuated.
          const speedAtt = Math.min(1, headR / Math.max(headR * 0.5, dist));
          // Inner sharp line
          ctx.strokeStyle = `rgba(${r8},${g8},${b8},${0.85 * briLin * speedAtt})`;
          ctx.lineWidth   = headR * 0.55;
          ctx.lineCap     = 'round';
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(xPx, yPx);
          ctx.stroke();
          // Outer wide softer line — fakes the perpendicular gaussian width
          // without an expensive blur filter.
          ctx.strokeStyle = `rgba(${r8},${g8},${b8},${0.30 * briLin * speedAtt})`;
          ctx.lineWidth   = headR * 1.4;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(xPx, yPx);
          ctx.stroke();
        }

        // 3a. Outer ocular glare halo. Radius grows weakly with brightness
        //     (Stiles–Holladay style); use sqrt for cheap nonlinearity.
        const haloA = 0.22 * Math.sqrt(briLin);
        const haloGrad = ctx.createRadialGradient(xPx, yPx, 0, xPx, yPx, haloR);
        haloGrad.addColorStop(0,    `rgba(${r8},${g8},${b8},${haloA})`);
        haloGrad.addColorStop(0.35, `rgba(${r8},${g8},${b8},${haloA * 0.4})`);
        haloGrad.addColorStop(1,    `rgba(${r8},${g8},${b8},0)`);
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(xPx, yPx, haloR, 0, Math.PI * 2);
        ctx.fill();

        // 3b. Saturated color mid-bloom.
        const midGrad = ctx.createRadialGradient(xPx, yPx, 0, xPx, yPx, headR);
        midGrad.addColorStop(0,   `rgba(${r8},${g8},${b8},${0.95 * briLin})`);
        midGrad.addColorStop(0.6, `rgba(${r8},${g8},${b8},${0.45 * briLin})`);
        midGrad.addColorStop(1,   `rgba(${r8},${g8},${b8},0)`);
        ctx.fillStyle = midGrad;
        ctx.beginPath();
        ctx.arc(xPx, yPx, headR, 0, Math.PI * 2);
        ctx.fill();

        // 3c. Hot white core — photopic saturation. White core only appears
        //     when the LED is bright enough to saturate cones (~ briLin > 0.3).
        const coreA = Math.max(0, briLin - 0.25) * 1.4;
        if (coreA > 0) {
          const coreGrad = ctx.createRadialGradient(xPx, yPx, 0, xPx, yPx, coreR);
          coreGrad.addColorStop(0, `rgba(255,255,255,${Math.min(1, coreA)})`);
          coreGrad.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.fillStyle = coreGrad;
          ctx.beginPath();
          ctx.arc(xPx, yPx, coreR, 0, Math.PI * 2);
          ctx.fill();
        }

        prevHead[b.id] = { x: xPx, y: yPx };
      });

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);   // single mount/unmount; refs deliver fresh data each frame

  return <canvas ref={canvasRef} className="trail-canvas"/>;
}

function PreviewStage({ balls, litState, layout, glow, cal, playhead, playing, perfSim, onPerfSim }) {
  const simOn = !!perfSim?.enabled;
  const stageClass = simOn ? 'layout-performance' : ('layout-' + layout);

  const stageRef = useRef(null);
  const popoverRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [showSettings, setShowSettings] = useState(false);

  // Zoom + pan state. Pan is in CSS px applied AFTER the zoom scale, so the
  // mapping from "world" (geometry) coords to screen is: screen = world*zoom + pan.
  // Reset to identity whenever sim is toggled off so re-enabling starts fresh.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const ZOOM_MIN = 0.5, ZOOM_MAX = 8;

  // Refs mirror state so the imperative wheel/drag handlers (attached once)
  // always read the latest values without re-attaching.
  const zoomRef  = useRef(zoom);  zoomRef.current  = zoom;
  const panRef   = useRef(pan);   panRef.current   = pan;
  const simOnRef = useRef(simOn); simOnRef.current = simOn;

  // Track stage box in CSS px so geometry can be computed in real units.
  useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageSize(prev => (prev.w === r.width && prev.h === r.height) ? prev : { w: r.width, h: r.height });
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Click-outside to close the settings popover.
  useEffect(() => {
    if (!showSettings) return;
    const onDocClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSettings]);

  // Reset view when sim toggles off so re-enabling starts at 1:1.
  useEffect(() => {
    if (!simOn) { setZoom(1); setPan({ x: 0, y: 0 }); }
  }, [simOn]);

  // Wheel-zoom anchored on the cursor. Cursor world point stays put, so the
  // user feels like they're scaling around their pointer rather than the
  // stage center. Wheel listener has to be {passive:false} to preventDefault.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!simOnRef.current) return;
      e.preventDefault();
      const z = zoomRef.current, p = panRef.current;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // World point under cursor before zoom.
      const wx = (mx - p.x) / z;
      const wy = (my - p.y) / z;
      // Multiplicative zoom feels uniform across the range.
      const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * Math.exp(-e.deltaY * 0.0015)));
      // Recompute pan so cursor world point stays under cursor.
      setZoom(nz);
      setPan({ x: mx - wx * nz, y: my - wy * nz });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag-to-pan with left mouse. Refs avoid re-renders mid-drag for the start
  // anchor; pan itself is state so the BallPreview / guide DOM follows.
  const dragRef = useRef(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onDown = (e) => {
      if (!simOnRef.current || e.button !== 0) return;
      // Don't start a drag if the user clicked on the overlay buttons.
      if (e.target.closest && e.target.closest('.sim-zoom-overlay')) return;
      dragRef.current = { mx: e.clientX, my: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
      el.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      setPan({ x: d.panX + (e.clientX - d.mx), y: d.panY + (e.clientY - d.my) });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (el) el.style.cursor = simOnRef.current ? 'grab' : '';
    };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Cursor styling reflects whether the stage is grab-able right now.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.style.cursor = simOn ? 'grab' : '';
  }, [simOn]);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const viewIdentity = (zoom === 1 && pan.x === 0 && pan.y === 0);

  // Performer geometry — slot-aware, pixel-based.
  // Each performer owns a horizontal slot of width stageW / numPerformers.
  // handGapPct is now % of slot width (so spacing scales with crowding);
  // orbit radius is capped so adjacent pairs' circles never intersect.
  let positions = null;     // ballId -> { xPx, yPx }
  let guides    = null;     // [{ xPx, yPx, dPx, weave? }]
  let numPerf   = 0;
  if (simOn && stageSize.w > 0 && stageSize.h > 0) {
    positions = {};
    guides = [];
    const pairs = [];
    for (let i = 0; i < balls.length; i += 2) pairs.push(balls.slice(i, i + 2));
    numPerf = pairs.length;
    if (numPerf > 0) {
      const slotW = stageSize.w / numPerf;
      const cy = stageSize.h / 2;
      // Hand half-gap: % of slot half-width. At handGapPct=100, pivots sit at
      // the slot edges (no inner room for orbits → radius caps to 0).
      const handHalfPx = (perfSim.handGapPct / 100) * (slotW / 2);
      // Max non-overlapping radius:
      //   • r ≤ handHalfPx  → left/right orbits within a pair don't overlap
      //   • r ≤ slotW/2 - handHalfPx → orbits don't bleed into neighbouring slot
      //   • r ≤ stageH/2 - 6 → orbits don't clip top/bottom
      const maxRpx = Math.max(0, Math.min(handHalfPx, slotW / 2 - handHalfPx, stageSize.h / 2 - 6));
      // User radius is % of that max (so the slider reads as "fill the available space").
      const rPx = (perfSim.radiusPct / 100) * maxRpx;

      const playheadBars = playhead / STEPS_PER_BAR;
      const theta = (playheadBars / Math.max(0.01, perfSim.periodBars)) * Math.PI * 2;

      pairs.forEach((pair, p) => {
        const centerXPx = (p + 0.5) * slotW;
        const pivotLPx  = centerXPx - handHalfPx;
        const pivotRPx  = centerXPx + handHalfPx;
        if (pair.length === 1) {
          positions[pair[0].id] = { xPx: centerXPx, yPx: cy };
        } else {
          positions[pair[0].id] = performerBallPos({
            pattern: perfSim.pattern, theta,
            centerXPx, centerYPx: cy, pivotLPx, pivotRPx, rPx, isLeft: true,
          });
          positions[pair[1].id] = performerBallPos({
            pattern: perfSim.pattern, theta,
            centerXPx, centerYPx: cy, pivotLPx, pivotRPx, rPx, isLeft: false,
          });
          if (perfSim.guides && rPx > 0) {
            if (perfSim.pattern === 'weave') {
              guides.push({ xPx: centerXPx, yPx: cy, dPx: rPx * 2, weave: true });
            } else {
              guides.push({ xPx: pivotLPx, yPx: cy, dPx: rPx * 2 });
              guides.push({ xPx: pivotRPx, yPx: cy, dPx: rPx * 2 });
            }
          }
        }
      });
    }
  }

  const PATTERNS = [
    { value: 'forward', label: 'Fwd'   },
    { value: 'mirror',  label: 'Mir'   },
    { value: 'split',   label: 'Split' },
    { value: 'weave',   label: 'Weave' },
  ];
  const subText = simOn && numPerf > 0
    ? `${balls.length} balls · ${numPerf} performer${numPerf===1?'':'s'} · ${balls.length*2} LEDs`
    : `${balls.length} balls · ${balls.length*2} LEDs`;

  return (
    <div className="preview">
      <div className="preview-head">
        <div className="preview-head-row">
          <div className="preview-title">LIVE PREVIEW</div>
          <div className="preview-sub mono">{subText}</div>
        </div>
        <div className="preview-controls">
          <button className={"sim-toggle" + (simOn ? ' on' : '')}
            onClick={() => onPerfSim('perfSimEnabled', !simOn)}
            title={simOn ? 'Stop performer simulation' : 'Show what an audience would see'}>
            <span className="sim-dot"/> Performance sim
          </button>
          {simOn && (
            <>
              <div className="sim-pattern" role="radiogroup" aria-label="Motion pattern">
                {PATTERNS.map(p => (
                  <button key={p.value} role="radio"
                    aria-checked={perfSim.pattern === p.value}
                    className={"sim-pattern-btn" + (perfSim.pattern === p.value ? ' on' : '')}
                    onClick={() => onPerfSim('perfSimPattern', p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="sim-settings-wrap" ref={popoverRef}>
                <button className={"sim-gear" + (showSettings ? ' on' : '')}
                  onClick={() => setShowSettings(s => !s)}
                  title="Sim settings" aria-label="Sim settings" aria-expanded={showSettings}>
                  <GearIcon/>
                </button>
                {showSettings && (
                  <div className="sim-popover" role="dialog" aria-label="Sim settings">
                    <div className="sim-pop-title mono">SIM SETTINGS</div>
                    <SimSlider label="Radius"   min={0}    max={100} step={1}    value={perfSim.radiusPct}
                      onChange={v => onPerfSim('perfSimRadiusPct', v)}    unit="%" />
                    <SimSlider label="Hand gap" min={0}    max={100} step={1}    value={perfSim.handGapPct}
                      onChange={v => onPerfSim('perfSimHandGapPct', v)}   unit="%" />
                    <SimSlider label="Bars/rev" min={0.25} max={8}   step={0.25} value={perfSim.periodBars}
                      onChange={v => onPerfSim('perfSimPeriodBars', v)} />
                    <SimSlider label="Trail"    min={0}    max={1}   step={0.05} value={perfSim.trail}
                      onChange={v => onPerfSim('perfSimTrail', v)} />
                    <label className="sim-checkbox">
                      <input type="checkbox" checked={!!perfSim.guides}
                        onChange={e => onPerfSim('perfSimGuides', e.target.checked)} />
                      <span>Show orbit guides</span>
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div ref={stageRef} className={"preview-stage " + stageClass}>
        {simOn && (
          <TrailCanvas balls={balls} litState={litState} positions={positions}
            cal={cal} trail={perfSim.trail} playing={playing} playhead={playhead}
            stageSize={stageSize} zoom={zoom} pan={pan}/>
        )}
        {simOn && guides && guides.map((g, i) => (
          <React.Fragment key={'g'+i}>
            <div className={"orbit-guide-ring" + (g.weave ? ' weave' : '')} style={{
              left:   (g.xPx * zoom + pan.x) + 'px',
              top:    (g.yPx * zoom + pan.y) + 'px',
              width:  (g.dPx * zoom) + 'px',
              height: (g.dPx * zoom) + 'px',
            }}/>
            {!g.weave && (
              <div className="orbit-guide-pivot" style={{
                left: (g.xPx * zoom + pan.x) + 'px',
                top:  (g.yPx * zoom + pan.y) + 'px',
              }}/>
            )}
          </React.Fragment>
        ))}
        {balls.map((b, i) => {
          const basePos = positions ? positions[b.id] : null;
          const screenPos = basePos
            ? { xPx: basePos.xPx * zoom + pan.x, yPx: basePos.yPx * zoom + pan.y }
            : null;
          return (
            <BallPreview key={b.id} ball={b}
              ledA={litState[b.id+'-A']} ledB={litState[b.id+'-B']}
              glow={glow} index={i} total={balls.length} layout={layout} cal={cal}
              position={screenPos}
            />
          );
        })}
        {simOn && (
          <div className="sim-zoom-overlay mono"
               onMouseDown={e => e.stopPropagation()}
               title="Wheel to zoom · drag stage to pan">
            <button className="sim-zoom-btn" onClick={() => {
              const z = zoom;
              const cx = stageSize.w / 2, cy = stageSize.h / 2;
              const wx = (cx - pan.x) / z, wy = (cy - pan.y) / z;
              const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * 0.8));
              setZoom(nz); setPan({ x: cx - wx * nz, y: cy - wy * nz });
            }} title="Zoom out" aria-label="Zoom out">−</button>
            <span className="sim-zoom-pct">{Math.round(zoom * 100)}%</span>
            <button className="sim-zoom-btn" onClick={() => {
              const z = zoom;
              const cx = stageSize.w / 2, cy = stageSize.h / 2;
              const wx = (cx - pan.x) / z, wy = (cy - pan.y) / z;
              const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * 1.25));
              setZoom(nz); setPan({ x: cx - wx * nz, y: cy - wy * nz });
            }} title="Zoom in" aria-label="Zoom in">+</button>
            <button className={"sim-zoom-reset" + (viewIdentity ? ' dim' : '')}
                    onClick={resetView}
                    disabled={viewIdentity}
                    title="Reset view (1:1)" aria-label="Reset view">Fit</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact slider used inside the sim settings popover. Plain HTML range so we
// don't depend on the Tweaks panel internals.
function SimSlider({ label, min, max, step, value, onChange, unit }) {
  const display = (typeof value === 'number') ? (Number.isInteger(step) ? value : Number(value).toFixed(2)) : value;
  return (
    <label className="sim-slider">
      <div className="sim-slider-row">
        <span className="sim-slider-lbl">{label}</span>
        <span className="sim-slider-val mono">{display}{unit||''}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

// LED positions on the orb, % within the canvas (matches the legacy layout —
// LED A on upper-left pole, LED B on lower-right pole).
const A_POS = { x: 0.32, y: 0.28 };
const B_POS = { x: 0.68, y: 0.72 };
const CANVAS_PX = 64; // logical pixels per ball; CSS upscales it

function BallPreview({ ball, ledA, ledB, glow, index, total, layout, cal, position }) {
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
  if (position) {
    // Performer simulation overrides any layout positioning. Coordinates are
    // measured stage pixels so orbits stay circular regardless of stage size.
    style = {
      position: 'absolute',
      left: position.xPx + 'px',
      top:  position.yPx + 'px',
      transform: 'translate(-50%, -50%)',
    };
  } else if (layout === 'circle') {
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
  const showsBlinkTiming = step.command === 'blink';
  const showsPeriod = step.command === 'breathe' || step.command === 'pingpong' || step.command === 'rainbow';
  const periodLabel = step.command === 'rainbow' ? 'CYCLE' : 'PERIOD';
  const periodMin = step.command === 'rainbow' ? 200 : 100;
  const periodMax = step.command === 'rainbow' ? 10000 : 5000;

  return (
    <div className="inspector">
      <div className="ins-title">INSPECTOR · <span style={{color: step.color}}>{ballId} · LED-{led}</span></div>

      <div className="ins-section">
        <div className="ins-label">COMMAND</div>
        <div className="ins-cmd-list">
          {COMMANDS.map(c => (
            <button key={c.id}
              className={"ins-cmd " + (step.command===c.id?'on':'')}
              onClick={() => {
                const t = defaultTimingFor(c.id);
                updateStep(step.id, { command: c.id, on: t.on, off: t.off });
              }}>
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

      {showsBlinkTiming && (
        <>
          <div className="ins-section">
            <div className="ins-label-row">
              <span className="ins-label">ON</span>
              <span className="ins-val mono">{clipOnMs(step)} ms</span>
            </div>
            <input type="range" min="20" max="2000" step="5" value={clipOnMs(step)}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const patch = { on: v };
                if (step.off == null) patch.off = clipOffMs(step);
                updateStep(step.id, patch);
              }}/>
          </div>
          <div className="ins-section">
            <div className="ins-label-row">
              <span className="ins-label">OFF</span>
              <span className="ins-val mono">{clipOffMs(step)} ms</span>
            </div>
            <input type="range" min="20" max="2000" step="5" value={clipOffMs(step)}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const patch = { off: v };
                if (step.on == null) patch.on = clipOnMs(step);
                updateStep(step.id, patch);
              }}/>
          </div>
        </>
      )}

      {showsPeriod && (
        <div className="ins-section">
          <div className="ins-label-row">
            <span className="ins-label">{periodLabel}</span>
            <span className="ins-val mono">{clipOnMs(step)} ms</span>
          </div>
          <input type="range" min={periodMin} max={periodMax} step="10" value={clipOnMs(step)}
            onChange={e => updateStep(step.id, { on: parseInt(e.target.value, 10) })}/>
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
