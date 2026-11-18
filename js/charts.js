// Tiny dependency-free SVG charts (single series line chart with hover tooltip).

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/**
 * points: [{label, value, tip}] ; values in [min, max].
 */
export function lineChart(container, points, { min = 0, max = 100, height = 180, unit = "", ticks = [0, 50, 100] } = {}) {
  container.innerHTML = "";
  container.classList.add("chart");
  if (!points.length) {
    container.innerHTML = `<div class="empty">No data yet</div>`;
    return;
  }
  const W = 600, H = height, padL = 34, padR = 12, padT = 12, padB = 24;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const x = (i) => (points.length === 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (points.length - 1));
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  for (const t of ticks) {
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: y(t), y2: y(t), stroke: "var(--border)", "stroke-width": 1 }));
    const tx = el("text", { x: padL - 6, y: y(t) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    tx.textContent = t + unit;
    svg.appendChild(tx);
  }
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  svg.appendChild(el("path", { d, fill: "none", stroke: "var(--chart)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  points.forEach((p, i) => {
    svg.appendChild(el("circle", { cx: x(i), cy: y(p.value), r: 4, fill: "var(--chart)", stroke: "var(--surface)", "stroke-width": 2 }));
  });
  // first/last x labels
  const lab = (i, anchor) => {
    const t = el("text", { x: x(i), y: H - 6, "text-anchor": anchor, "font-size": 11, fill: "var(--muted)" });
    t.textContent = points[i].label;
    svg.appendChild(t);
  };
  lab(0, points.length === 1 ? "middle" : "start");
  if (points.length > 1) lab(points.length - 1, "end");
  // hover layer
  const guide = el("line", { y1: padT, y2: H - padB, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
  svg.appendChild(guide);
  const hit = el("rect", { x: padL - 10, y: 0, width: W - padL - padR + 20, height: H, fill: "transparent" });
  svg.appendChild(hit);
  container.appendChild(svg);
  const tip = document.createElement("div");
  tip.className = "tip hidden";
  container.appendChild(tip);
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    points.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } });
    guide.setAttribute("x1", x(best));
    guide.setAttribute("x2", x(best));
    guide.setAttribute("visibility", "visible");
    tip.textContent = points[best].tip || `${points[best].label}: ${points[best].value}${unit}`;
    tip.style.left = `${(x(best) / W) * 100}%`;
    tip.style.top = `${(y(points[best].value) / H) * rect.height}px`;
    tip.classList.remove("hidden");
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => { tip.classList.add("hidden"); guide.setAttribute("visibility", "hidden"); });
}

/** Score ring (0–100). */
export function ring(value, label = "") {
  const r = 44, c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color = value == null ? "var(--muted)" : v >= 80 ? "var(--good)" : v >= 60 ? "var(--warn)" : "var(--bad)";
  return `<div class="ring" role="img" aria-label="${label} ${value ?? "n/a"}">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${(c * v) / 100} ${c}"/></svg>
    <div class="val"><div>${value ?? "–"}<small>${label}</small></div></div></div>`;
}
