// Worldseed audio — offline measurement helpers (loaded lazily by the debug
// hooks only; never on the normal play path).
import { Biquad } from './dsp.js';

// Loudest 400 ms window of a mono signal after a filter chain (dB).
function shortTerm(mono, sr, stages) {
  const fs = stages.map(([type, f, q, g]) => new Biquad(type, f, q, sr, g));
  const win = Math.floor(sr * 0.4);
  const sq = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    let v = mono[i];
    for (const b of fs) v = b.run(v);
    sq[i] = v * v;
  }
  let w = 0,
    wmax = 0;
  for (let i = 0; i < sq.length; i++) {
    w += sq[i];
    if (i >= win) w -= sq[i - win];
    if (w > wmax) wmax = w;
  }
  return 10 * Math.log10(wmax / Math.min(win, mono.length) + 1e-20);
}

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

// In-place radix-2 FFT (re, im of length 2^k).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j,
          b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Level, balance, DC, click and spectral metrics for a rendered buffer.
export function analyze(buf) {
  const sr = buf.sampleRate;
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const n = chs[0].length;
  const mono = new Float32Array(n);
  for (const d of chs) for (let i = 0; i < n; i++) mono[i] += d[i] / chs.length;
  let peak = 0,
    sum = 0,
    clipped = 0,
    maxStep = 0;
  const dc = [];
  for (const d of chs) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const v = d[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      s += v;
      sum += v * v;
      if (i) {
        const st = Math.abs(v - d[i - 1]);
        if (st > maxStep) maxStep = st;
      }
    }
    dc.push(s / n);
  }
  // audible span (above -60 dB re peak) and its RMS
  const thr = peak * 0.001;
  let a0 = 0,
    a1 = n - 1;
  while (a0 < n && Math.abs(mono[a0]) < thr) a0++;
  while (a1 > a0 && Math.abs(mono[a1]) < thr) a1--;
  let as = 0;
  for (let i = a0; i <= a1; i++) as += mono[i] * mono[i];
  const rmsActive = Math.sqrt(as / Math.max(1, a1 - a0 + 1));
  // loudest 400 ms window (short-term loudness proxy)
  const win = Math.floor(sr * 0.4);
  let w = 0,
    wmax = 0;
  for (let i = 0; i < n; i++) {
    w += mono[i] * mono[i];
    if (i >= win) w -= mono[i - win] * mono[i - win];
    if (w > wmax) wmax = w;
  }
  const st = Math.sqrt(wmax / Math.min(win, n));
  // energy-weighted spectral centroid
  const N = 2048;
  let cen = 0,
    ew = 0;
  const re = new Float32Array(N),
    im = new Float32Array(N);
  for (let o = 0; o + N <= n; o += N) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[o + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    let e = 0,
      fe = 0;
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      e += p;
      fe += p * ((k * sr) / N);
    }
    if (e > 0) {
      cen += fe;
      ew += e;
    }
  }
  const edge = (from) => {
    let m = 0;
    for (const d of chs) for (let i = from; i < from + 32 && i < n; i++) m = Math.max(m, Math.abs(d[i]));
    return m;
  };
  return {
    seconds: r1(n / sr),
    peakDb: r1(db(peak)),
    rmsDb: r1(db(Math.sqrt(sum / (n * chs.length)))),
    rmsActiveDb: r1(db(rmsActive)),
    shortTermDb: r1(db(st)),
    // BS.1770-style K-weighting (high shelf + 38 Hz high-pass): LUFS-like
    lufsST: r1(shortTerm(mono, sr, [['peaking', 1681, 0.71, 4], ['highpass', 38, 0.5]]) - 0.691),
    // what survives a small laptop / phone speaker (>~200 Hz)
    spkST: r1(shortTerm(mono, sr, [['highpass', 200, 0.7], ['highpass', 200, 0.7]])),
    crestDb: r1(db(peak) - db(rmsActive)),
    dc: dc.map((v) => Math.round(v * 1e5) / 1e5),
    startAbs: Math.round(edge(0) * 1e4) / 1e4,
    endAbs: Math.round(edge(Math.max(0, n - 32)) * 1e4) / 1e4,
    maxStep: Math.round(maxStep * 1000) / 1000,
    clipped,
    centroidHz: Math.round(ew ? cen / ew : 0),
    audible: [r1(a0 / sr), r1(a1 / sr)],
  };
}
