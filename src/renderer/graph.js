// Kraftgerichteter Graph (d3-force) auf Canvas: leuchtende Knoten, Pan/Zoom/Drag, Klick oeffnet Notiz
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';

const C = { cyan: '#3cf0ff', red: '#ff2d3d', yel: '#f7e733', ghost: '#a090a0' };

export class Graph {
  constructor(canvas, { onOpen, local = false } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onOpen = onOpen;
    this.local = local;
    this.t = { x: 0, y: 0, k: 1 };
    this.nodes = [];
    this.links = [];
    this.byId = new Map();
    this.adj = new Map();
    this.hover = null;
    this.current = null;
    this.sim = forceSimulation().stop().alphaDecay(0.03).velocityDecay(0.35);
    this.sim.on('tick', () => this.draw());
    this.drag = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.bind();
  }

  size() { return { w: this.c.clientWidth, h: this.c.clientHeight }; }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = this.size();
    if (!w || !h) return;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    if (this.wantFit) this.fit();
    this.draw();
  }

  setData(data, current) {
    const old = this.byId;
    const fresh = !old.size;
    this.current = current || null;
    this.nodes = data.nodes.map((n) => {
      const o = old.get(n.id);
      return o ? Object.assign(o, n) : { ...n };
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = data.links.filter((l) => this.byId.has(l.source.id || l.source) && this.byId.has(l.target.id || l.target))
      .map((l) => ({ source: l.source.id || l.source, target: l.target.id || l.target, ghost: l.ghost }));
    this.adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (const l of this.links) { this.adj.get(l.source).add(l.target); this.adj.get(l.target).add(l.source); }
    for (const n of this.nodes) { n.deg = this.adj.get(n.id).size; n.r = n.ghost ? 3.2 : 3.6 + Math.sqrt(n.deg) * 1.9; }
    // Abstand zur aktuellen Notiz (fuer Beschriftungen im lokalen Graphen)
    for (const n of this.nodes) n.dist = Infinity;
    if (this.current && this.byId.has(this.current)) {
      let ring = [this.current];
      this.byId.get(this.current).dist = 0;
      for (let d = 1; ring.length; d++) {
        const next = [];
        for (const id of ring) for (const m of this.adj.get(id)) { const nn = this.byId.get(m); if (nn.dist === Infinity) { nn.dist = d; next.push(m); } }
        ring = next;
      }
    }
    const big = this.nodes.length > 25;
    const iso = (d) => (d.deg ? 0.06 : 0.2);
    this.sim.nodes(this.nodes)
      .force('link', forceLink(this.links).id((d) => d.id).distance(this.local ? (big ? 48 : 60) : 85).strength(0.45))
      .force('charge', forceManyBody().strength(this.local ? (big ? -140 : -190) : -240).distanceMax(500))
      .force('x', forceX(0).strength(iso))
      .force('y', forceY(0).strength(iso))
      .force('collide', forceCollide((d) => d.r + 6));
    if (fresh) {
      this.sim.alpha(1);
      for (let i = 0; i < 300; i++) this.sim.tick();
      this.fit();
      this.sim.alpha(0.02).restart();
    } else this.sim.alpha(0.35).restart();
    this.draw();
  }

  setCurrent(id) { this.current = id; this.draw(); }
  reset() { this.byId = new Map(); this.nodes = []; this.links = []; this.hover = null; }

  fit() {
    const { w, h } = this.size();
    if (!w) { this.wantFit = true; return; }
    this.wantFit = false;
    if (!this.nodes.length) { this.t = { x: 0, y: 0, k: 1 }; this.draw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = this.local ? 40 : 70;
    const k = Math.max(0.15, Math.min(this.local ? 1.6 : 2.2, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
    this.t = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
    this.draw();
  }

  toWorld(px, py) { const { w, h } = this.size(); return { x: (px - w / 2 - this.t.x) / this.t.k, y: (py - h / 2 - this.t.y) / this.t.k }; }
  toScreen(n) { const { w, h } = this.size(); return { x: w / 2 + this.t.x + n.x * this.t.k, y: h / 2 + this.t.y + n.y * this.t.k }; }
  nodeAt(px, py) {
    const p = this.toWorld(px, py);
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 6 / this.t.k && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  bind() {
    const c = this.c;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const n = this.nodeAt(p.x, p.y);
      c.setPointerCapture(e.pointerId);
      this.drag = { n, sx: p.x, sy: p.y, tx: this.t.x, ty: this.t.y, moved: false, ctrl: e.ctrlKey };
      if (n) { n.fx = n.x; n.fy = n.y; }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      const d = this.drag;
      if (d) {
        if (Math.hypot(p.x - d.sx, p.y - d.sy) > 3) d.moved = true;
        if (d.n) { if (d.moved) { const w = this.toWorld(p.x, p.y); d.n.fx = w.x; d.n.fy = w.y; this.sim.alphaTarget(0.25).restart(); } } else { this.t.x = d.tx + p.x - d.sx; this.t.y = d.ty + p.y - d.sy; this.draw(); }
        return;
      }
      const n = this.nodeAt(p.x, p.y);
      if (n !== this.hover) { this.hover = n; c.style.cursor = n ? 'pointer' : 'grab'; this.draw(); }
    });
    const up = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.n) { d.n.fx = null; d.n.fy = null; this.sim.alphaTarget(0); if (!d.moved && this.onOpen) this.onOpen(d.n, e); }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.draw(); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const { w, h } = this.size();
      const mx = p.x - w / 2;
      const my = p.y - h / 2;
      const k2 = Math.max(0.1, Math.min(6, this.t.k * Math.exp(-e.deltaY * 0.0015)));
      const wx = (mx - this.t.x) / this.t.k;
      const wy = (my - this.t.y) / this.t.k;
      this.t = { k: k2, x: mx - wx * k2, y: my - wy * k2 };
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => this.fit());
  }

  zoom(f) { this.t.k = Math.max(0.1, Math.min(6, this.t.k * f)); this.t.x *= f; this.t.y *= f; this.draw(); }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
    // Fallback, falls rAF gedrosselt ist (verdecktes Fenster, headless)
    setTimeout(() => { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; this.paint(); } }, 120);
  }

  paint() {
    const { ctx, c } = this;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = this.size();
    if (!w || !h) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const { k } = this.t;
    const focus = this.hover || (this.current && this.byId.get(this.current)) || null;
    const near = focus ? this.adj.get(focus.id) || new Set() : null;
    const dimming = !!this.hover;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w / 2 + this.t.x), dpr * (h / 2 + this.t.y));

    // Links
    for (const l of this.links) {
      const a = l.source, b = l.target;
      if (a.x == null || b.x == null) continue;
      const hot = focus && (a === focus || b === focus);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (hot) { ctx.strokeStyle = 'rgba(255,45,61,.9)'; ctx.lineWidth = 1.6 / k; } else if (l.ghost) { ctx.strokeStyle = dimming ? 'rgba(122,106,120,.12)' : 'rgba(122,106,120,.35)'; ctx.lineWidth = 0.8 / k; } else { ctx.strokeStyle = dimming ? 'rgba(60,240,255,.08)' : 'rgba(60,240,255,.3)'; ctx.lineWidth = 0.9 / k; }
      ctx.setLineDash(l.ghost && !hot ? [3 / k, 3 / k] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Knoten mit Leuchten
    for (const n of this.nodes) {
      if (n.x == null) continue;
      const isCur = n.id === this.current;
      const isHover = n === this.hover;
      const isNear = near && near.has(n.id);
      let col = n.ghost ? C.ghost : C.cyan;
      if (isNear) col = C.red;
      if (isCur) col = C.yel;
      if (isHover) col = '#ffffff';
      const alpha = dimming && !isHover && !isNear && !isCur ? 0.25 : 1;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = col;
      ctx.shadowBlur = (isCur || isHover ? 22 : 12) * dpr;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (isCur ? 1.35 : 1), 0, Math.PI * 2);
      if (n.ghost) { ctx.fillStyle = '#07020a'; ctx.fill(); ctx.lineWidth = 1.2 / k; ctx.strokeStyle = col; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
      if (isCur) { ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.35 + 4 / k, 0, Math.PI * 2); ctx.lineWidth = 1 / k; ctx.strokeStyle = 'rgba(247,231,51,.7)'; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Beschriftung in Bildschirmkoordinaten (scharf)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zoomAlpha = Math.max(0, Math.min(1, (k - (this.local ? 1.5 : 0.95)) / 0.5));
    ctx.font = '13px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of this.nodes) {
      if (n.x == null) continue;
      const strong = n === this.hover || n.id === this.current || (near && near.has(n.id) && this.hover);
      let a = strong ? 1 : zoomAlpha * (dimming ? 0.25 : 0.85);
      if (!strong && !this.local && n.deg >= 6 && k > 0.6) a = Math.max(a, 0.7);
      if (!strong && this.local && n.dist <= 1) a = Math.max(a, dimming ? 0.25 : 0.9);
      if (a <= 0.02) continue;
      const s = this.toScreen(n);
      const label = n.name.length > 34 ? n.name.slice(0, 32) + '…' : n.name;
      ctx.globalAlpha = a;
      ctx.fillStyle = strong ? '#ffffff' : n.ghost ? '#9a8a98' : '#cfe9ee';
      ctx.shadowColor = '#07020a';
      ctx.shadowBlur = 4;
      ctx.fillText(label, s.x, s.y + n.r * k + 4);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  destroy() { this.sim.stop(); this.ro.disconnect(); }
}

// Lokaler Graph: Nachbarschaft bis Tiefe 1-2 aus dem globalen Graphen
export function localGraph(data, id, depth = 1, ghosts = true) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const l of data.links) { if (!ghosts && l.ghost) continue; add(l.source.id || l.source, l.target.id || l.target); add(l.target.id || l.target, l.source.id || l.source); }
  const keep = new Set([id]);
  let ring = [id];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const x of ring) for (const y of adj.get(x) || []) if (!keep.has(y)) { keep.add(y); next.push(y); }
    ring = next;
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id) && (ghosts || !n.ghost)),
    links: data.links.filter((l) => keep.has(l.source.id || l.source) && keep.has(l.target.id || l.target) && (ghosts || !l.ghost)),
  };
}

export function filterGhosts(data, ghosts) {
  if (ghosts) return data;
  return { nodes: data.nodes.filter((n) => !n.ghost), links: data.links.filter((l) => !l.ghost) };
}
