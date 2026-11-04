// Synthesises a vowel: glottal pulse train through formant resonators.
export function synthVowel({ f0 = 120, formants = [[700, 80], [1200, 90], [2600, 120]], fs = 48000, n = 2048, noise = 0 }) {
  const x = new Float64Array(n);
  const period = Math.round(fs / f0);
  for (let i = 0; i < n; i++) x[i] = i % period === 0 ? 1 : 0;
  let y = x;
  for (const [f, bw] of formants) {
    const r = Math.exp((-Math.PI * bw) / fs);
    const th = (2 * Math.PI * f) / fs;
    const a1 = 2 * r * Math.cos(th), a2 = -r * r;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = y[i] + a1 * (out[i - 1] || 0) + a2 * (out[i - 2] || 0);
    y = out;
  }
  let max = 0;
  for (const v of y) max = Math.max(max, Math.abs(v));
  return Float32Array.from(y, (v) => (0.5 * v) / max + noise * (Math.random() - 0.5));
}
