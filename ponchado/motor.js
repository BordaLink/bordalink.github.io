/* BordaLink · Motor de ponchado automático (reglas de Argil Mondragón A.)
   Corre en el navegador o en Node, sin servidor. Unidad de trabajo: 1 px = 0.1 mm.
   Entrada: imagen RGBA {width,height,data}, ancho en mm y ajustes por capa.
   Salida: capas (para el menú de edición), plan de puntadas, DST y semáforo. */
(function (root) {
'use strict';

// ---------------- utilidades de raster ----------------
function edt1d(f, n, d, v, z) { // Felzenszwalb
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break; }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
// distancia (en px) de cada pixel "fuera" (mask=0) al pixel "dentro" (mask=1) más cercano
function edt(mask, W, H) {
  const INF = 1e12, g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? 0 : INF;
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; edt1d(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1d(f, W, d, v, z); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]); }
  return g;
}
function inv(m) { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; }
function dilate(m, W, H, r) { const d = edt(m, W, H), o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = d[i] <= r ? 1 : 0; return o; }
function erode(m, W, H, r) { const d = edt(inv(m), W, H), o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = d[i] > r ? 1 : 0; return o; }
function andm(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && b[i] ? 1 : 0; return o; }
function sub(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0; return o; }
function count(m) { let c = 0; for (let i = 0; i < m.length; i++) c += m[i]; return c; }

function components(m, W, H) { // 8-conexo
  const lab = new Int32Array(W * H).fill(-1), comps = [], st = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    const id = comps.length; let sp = 0; st[sp++] = i; lab[i] = id;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; const px = [];
    while (sp) {
      const p = st[--sp], x = p % W, y = (p / W) | 0; px.push(p); n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (m[q] && lab[q] < 0) { lab[q] = id; st[sp++] = q; }
      }
    }
    comps.push({ id, px, n, x0, y0, x1, y1 });
  }
  return { lab, comps };
}

// pieza recortada a su caja (con margen) para trabajar rápido
function crop(comp, W, pad) {
  const x0 = comp.x0 - pad, y0 = comp.y0 - pad, w = comp.x1 - comp.x0 + 1 + 2 * pad, h = comp.y1 - comp.y0 + 1 + 2 * pad;
  const m = new Uint8Array(w * h);
  for (const p of comp.px) { const x = p % W - x0, y = ((p / W) | 0) - y0; m[y * w + x] = 1; }
  return { m, w, h, x0, y0 };
}

function zhangSuen(m, w, h) {
  const s = Uint8Array.from(m); let changed = true; const del = [];
  const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : s[y * w + x];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!s[y * w + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]; let A = 0; for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (pass === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; } else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
        del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) s[i] = 0; }
    }
  }
  return s;
}

function branches(sk, w, h) { // esqueleto -> ramas (listas de [x,y]); nodos por número de cruces
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && sk[y * w + x];
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const cross = (x, y) => { let A = 0, B = 0; for (let k = 0; k < 8; k++) { const a = on(x + ring[k][0], y + ring[k][1]), b = on(x + ring[(k + 1) % 8][0], y + ring[(k + 1) % 8][1]); if (!a && b) A++; if (a) B++; } return B === 0 ? 0 : (B === 1 ? 1 : A); };
  const pts = []; for (let i = 0; i < w * h; i++) if (sk[i]) pts.push(i);
  const isNode = new Uint8Array(w * h); for (const p of pts) { const c = cross(p % w, (p / w) | 0); if (c !== 2) isNode[p] = 1; }
  const vis = new Uint8Array(w * h), out = [];
  const nbrs = (p) => { const x = p % w, y = (p / w) | 0, o = []; for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) if (on(x + dx, y + dy)) o.push((y + dy) * w + x + dx); return o; };
  const walk = (start, first) => {
    const path = [start, first]; if (!isNode[first]) vis[first] = 1;
    let prev = start, cur = first;
    while (!isNode[cur]) {
      const nx = nbrs(cur).filter(q => q !== prev && (isNode[q] ? q !== start || path.length > 3 : !vis[q]));
      if (!nx.length) break; const q = nx[0]; path.push(q); if (!isNode[q]) vis[q] = 1; prev = cur; cur = q;
    }
    return path;
  };
  for (const p of pts) if (isNode[p]) for (const q of nbrs(p)) { if (isNode[q] ? q > p : !vis[q]) out.push(walk(p, q)); }
  for (const p of pts) if (!isNode[p] && !vis[p]) { vis[p] = 1; const n = nbrs(p); if (n.length) { const path = walk(p, n[0]); out.push(path); } }
  return out.filter(b => b.length > 1).map(b => b.map(p => [p % w, (p / w) | 0]));
}
function smooth(line, k) {
  if (line.length <= 2 * k) return line;
  const o = line.map((_, i) => { let sx = 0, sy = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(line.length - 1, i + k); j++) { sx += line[j][0]; sy += line[j][1]; c++; } return [sx / c, sy / c]; });
  o[0] = line[0]; o[o.length - 1] = line[line.length - 1]; return o;
}
function polyLen(l) { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; }
function resample(l, step) { // puntos cada "step" px a lo largo de la línea, con tangente
  const out = []; let acc = 0, i = 1, t = 0;
  const L = polyLen(l); if (L < 1) return out;
  for (let s = 0; s <= L + 1e-6; s += step) {
    while (i < l.length && acc + Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]) < s) { acc += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); i++; }
    if (i >= l.length) break;
    const a = l[i - 1], b = l[i], sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; t = (s - acc) / sl;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / sl, ty: (b[1] - a[1]) / sl });
  }
  return out;
}

// ---------------- generadores de puntada (en coords de la pieza recortada) ----------------
function rowSegments(m, w, h, y, vertical) { // segmentos [a,b] dentro de la máscara en la fila/columna y (subpixel)
  const segs = []; const len = vertical ? h : w, yy = Math.round(y);
  if (yy < 0 || yy >= (vertical ? w : h)) return segs;
  let inside = false, a = 0;
  for (let i = 0; i <= len; i++) {
    const v = i < len ? (vertical ? m[i * w + yy] : m[yy * w + i]) : 0;
    if (v && !inside) { inside = true; a = i; } else if (!v && inside) { inside = false; if (i - a >= 1.5) segs.push([a + 0.2, i - 0.8]); }
  }
  return segs;
}
function blocksOf(rows) {
  const used = rows.map(r => r.map(() => false)), out = [];
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows[i].length; j++) {
    if (used[i][j]) continue; const blk = []; let ci = i, cj = j;
    while (true) {
      used[ci][cj] = true; const [a, b, y] = rows[ci][cj]; blk.push(rows[ci][cj]); let nxt = -1;
      if (ci + 1 < rows.length) for (let k = 0; k < rows[ci + 1].length; k++) { const [c, d] = rows[ci + 1][k]; if (!used[ci + 1][k] && c < b && d > a) { nxt = k; break; } }
      if (nxt < 0) break; ci++; cj = nxt;
    }
    out.push(blk);
  }
  return out;
}
function tatami(m, w, h, spacing, length, vertical) {
  const rows = []; const lim = vertical ? w : h;
  for (let y = spacing / 2; y < lim; y += spacing) rows.push(rowSegments(m, w, h, y, vertical).map(([a, b]) => [a, b, y]));
  const runs = [];
  for (const blk of blocksOf(rows)) {
    let pts = [];
    blk.forEach(([a, b, y], r) => {
      const off = (Math.round(y / spacing) % 3) * length / 3; const xs = [a];
      for (let k = Math.ceil((a - off) / length); k <= Math.floor((b - off) / length); k++) { const x = k * length + off; if (x > a + 3 && x < b - 3) xs.push(x); }
      xs.push(b); if (r % 2) xs.reverse();
      const row = xs.map(x => vertical ? [y, x] : [x, y]);
      if (pts.length && Math.hypot(row[0][0] - pts[pts.length - 1][0], row[0][1] - pts[pts.length - 1][1]) > Math.max(30, spacing * 3)) { runs.push(pts); pts = []; }
      pts = pts.concat(row);
    });
    if (pts.length > 1) runs.push(pts);
  }
  return runs;
}
function edgeAlong(m, w, h, x, y, nx, ny, maxd) { // camina desde (x,y) en dirección n hasta salir de la máscara
  let last = 0;
  for (let d = 0; d <= maxd; d += 0.5) {
    const xx = Math.round(x + nx * d), yy = Math.round(y + ny * d);
    if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) return last;
    last = d;
  }
  return last;
}
function satinBranch(mask, w, h, line, step, frac) {
  const pts = []; let side = 0;
  for (const s of resample(line, step)) {
    const nx = -s.ty, ny = s.tx;
    if (!mask[Math.round(s.y) * w + Math.round(s.x)]) continue;
    let da = edgeAlong(mask, w, h, s.x, s.y, nx, ny, 70), db = edgeAlong(mask, w, h, s.x, s.y, -nx, -ny, 70);
    if (da + db < 2) continue;
    const mid = (da - db) / 2, half = (da + db) / 2 * frac;
    const a = [s.x + nx * (mid + half), s.y + ny * (mid + half)], b = [s.x + nx * (mid - half), s.y + ny * (mid - half)];
    pts.push(side ? b : a); side ^= 1;
  }
  return pts;
}
function runBranch(line, len) {
  const L = polyLen(line), n = Math.max(1, Math.round(L / len));
  const rs = resample(line, L / n).map(s => [s.x, s.y]); if (rs.length < 2) return [];
  return rs.concat(rs.slice(0, -1).reverse());
}
function skeletonLines(m, w, h) {
  const sk = zhangSuen(m, w, h);
  return branches(sk, w, h).map(b => smooth(b, 3)).filter(l => polyLen(l) > 8);
}

// recorrido por dentro de la pieza (BFS en rejilla de 2 px); null si sería demasiado largo
function travelInside(m, w, h, a, b) {
  const dd = Math.hypot(b[0] - a[0], b[1] - a[1]); if (dd < 3) return [b];
  const inside = (x, y) => { const xx = Math.round(x), yy = Math.round(y); return xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]; };
  let ok = true; for (let t = 0; t <= 1; t += 1 / Math.ceil(dd)) if (!inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) { ok = false; break; }
  if (ok && dd <= 50) { const n = Math.max(1, Math.ceil(dd / 25)), o = []; for (let i = 1; i <= n; i++) o.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return o; }
  const G = 2, gw = Math.ceil(w / G), gh = Math.ceil(h / G), prev = new Int32Array(gw * gh).fill(-2);
  const gi = (x, y) => Math.min(gh - 1, Math.max(0, Math.round(y / G))) * gw + Math.min(gw - 1, Math.max(0, Math.round(x / G)));
  const s = gi(a[0], a[1]), t = gi(b[0], b[1]); const q = [s]; prev[s] = -1; let qi = 0, found = false;
  const ok2 = (c) => { const x = (c % gw) * G, y = ((c / gw) | 0) * G; return inside(x, y); };
  while (qi < q.length) {
    const c = q[qi++]; if (c === t) { found = true; break; }
    const cx = c % gw, cy = (c / gw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const n = ny * gw + nx; if (prev[n] !== -2) continue; if (!ok2(n) && n !== t) continue; prev[n] = c; q.push(n);
    }
  }
  if (!found) return null;
  const path = []; for (let c = t; c >= 0; c = prev[c]) path.push([(c % gw) * G, ((c / gw) | 0) * G]); path.reverse();
  if (polyLen(path) > Math.max(100, 2.5 * dd)) return null;
  const rs = resample(path, 25).map(p => [p.x, p.y]); rs.push(b); return rs;
}
function chainRuns(m, w, h, runs) {
  runs = runs.filter(r => r.length > 1); if (!runs.length) return [];
  const res = []; let out = runs.shift().slice();
  while (runs.length) {
    const e = out[out.length - 1]; let best = null;
    runs.forEach((r, i) => { for (const o of [r, r.slice().reverse()]) { const d = Math.hypot(o[0][0] - e[0], o[0][1] - e[1]); if (!best || d < best[0]) best = [d, i, o]; } });
    runs.splice(best[1], 1); const t = travelInside(m, w, h, e, best[2][0]);
    if (t === null) { res.push(out); out = best[2].slice(); } else out = out.concat(t, best[2].slice(1));
  }
  res.push(out); return res;
}

// ---------------- colores ----------------
function kmeans(px, k, iters) {
  const n = px.length / 3, C = [];
  C.push([px[0], px[1], px[2]]);
  const dmin = new Float64Array(n).fill(1e18);
  while (C.length < k) { // el punto más lejano (determinista)
    const c = C[C.length - 1]; let bi = 0, bd = -1;
    for (let i = 0; i < n; i++) { const d = (px[3 * i] - c[0]) ** 2 + (px[3 * i + 1] - c[1]) ** 2 + (px[3 * i + 2] - c[2]) ** 2; if (d < dmin[i]) dmin[i] = d; if (dmin[i] > bd) { bd = dmin[i]; bi = i; } }
    if (bd < 200) break; C.push([px[3 * bi], px[3 * bi + 1], px[3 * bi + 2]]);
  }
  const lab = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { let b = 0, bd = 1e18; for (let j = 0; j < C.length; j++) { const d = (px[3 * i] - C[j][0]) ** 2 + (px[3 * i + 1] - C[j][1]) ** 2 + (px[3 * i + 2] - C[j][2]) ** 2; if (d < bd) { bd = d; b = j; } } lab[i] = b; S[b][0] += px[3 * i]; S[b][1] += px[3 * i + 1]; S[b][2] += px[3 * i + 2]; S[b][3]++; }
    C.forEach((c, j) => { if (S[j][3]) { c[0] = S[j][0] / S[j][3]; c[1] = S[j][1] / S[j][3]; c[2] = S[j][2] / S[j][3]; } });
  }
  const cnt = C.map(() => 0); for (let i = 0; i < n; i++) cnt[lab[i]]++;
  return C.map((c, j) => ({ rgb: c, n: cnt[j] }));
}
const HILOS = [ // nombres de hilo comunes para mostrar
  ['blanco', [250, 250, 250]], ['negro', [20, 20, 20]], ['gris', [128, 128, 128]], ['azul marino', [25, 45, 80]], ['azul', [30, 90, 200]], ['azul cielo', [100, 170, 230]],
  ['rojo', [200, 40, 45]], ['vino', [120, 25, 40]], ['naranja', [240, 130, 30]], ['amarillo', [245, 200, 60]], ['oro', [200, 160, 60]], ['beige', [215, 200, 160]],
  ['café', [110, 70, 35]], ['verde oscuro', [20, 95, 60]], ['verde', [55, 165, 80]], ['verde claro', [145, 195, 115]], ['morado', [110, 50, 150]], ['rosa', [235, 120, 170]], ['turquesa', [30, 170, 170]]];
function nombreHilo(rgb) { let b = HILOS[0], bd = 1e18; for (const h of HILOS) { const d = (h[1][0] - rgb[0]) ** 2 + (h[1][1] - rgb[1]) ** 2 + (h[1][2] - rgb[2]) ** 2; if (d < bd) { bd = d; b = h; } } return b[0]; }
const hex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function resizeRGBA(src, sw, sh, x0, y0, cw, ch, dw, dh) { // bilineal de la región (x0,y0,cw,ch)
  const out = new Uint8ClampedArray(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const fy = y0 + (y + 0.5) * ch / dh - 0.5, iy = Math.max(0, Math.min(sh - 2, Math.floor(fy))), ty = Math.max(0, Math.min(1, fy - iy));
    for (let x = 0; x < dw; x++) {
      const fx = x0 + (x + 0.5) * cw / dw - 0.5, ix = Math.max(0, Math.min(sw - 2, Math.floor(fx))), tx = Math.max(0, Math.min(1, fx - ix));
      for (let c = 0; c < 3; c++) {
        const a = src[(iy * sw + ix) * 4 + c], b = src[(iy * sw + ix + 1) * 4 + c], d = src[((iy + 1) * sw + ix) * 4 + c], e = src[((iy + 1) * sw + ix + 1) * 4 + c];
        out[(y * dw + x) * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

// ---------------- análisis: imagen -> capas ----------------
function analizar(img, anchoMM, opts) {
  opts = opts || {};
  const sw = img.width, sh = img.height, S = img.data;
  // fondo = color más común en la orilla
  const bmap = new Map(); const qk = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  const edge = []; for (let x = 0; x < sw; x++) edge.push([x, 0], [x, sh - 1]); for (let y = 0; y < sh; y++) edge.push([0, y], [sw - 1, y]);
  for (const [x, y] of edge) { const i = (y * sw + x) * 4; if (S[i + 3] < 128) continue; const k = qk(S[i], S[i + 1], S[i + 2]); bmap.set(k, (bmap.get(k) || 0) + 1); }
  let bk = -1, bc = -1; for (const [k, c] of bmap) if (c > bc) { bc = c; bk = k; }
  let transp = 0; for (const [x, y] of edge) if (S[(y * sw + x) * 4 + 3] < 128) transp++;
  const fondoTransparente = transp > edge.length / 2;   // PNG sin fondo: el blanco sí es parte del diseño
  let bg = bk < 0 ? [255, 255, 255] : [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
  // promedio real de los pixeles de orilla con ese color
  if (fondoTransparente) bg = [255, 0, 255];
  else { let sr = 0, sg = 0, sb = 0, n = 0; for (const [x, y] of edge) { const i = (y * sw + x) * 4; if (S[i + 3] >= 128 && qk(S[i], S[i + 1], S[i + 2]) === bk) { sr += S[i]; sg += S[i + 1]; sb += S[i + 2]; n++; } } if (n) bg = [sr / n, sg / n, sb / n]; }
  const isBg = (i) => S[i + 3] < 128 || (S[i] - bg[0]) ** 2 + (S[i + 1] - bg[1]) ** 2 + (S[i + 2] - bg[2]) ** 2 < 45 * 45;
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (!isBg((y * sw + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) throw new Error('No se encontró diseño en la imagen');
  const pad = Math.round((x1 - x0) * 0.03); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(sw - 1, x1 + pad); y1 = Math.min(sh - 1, y1 + pad);
  const designW = (x1 - x0 + 1) - 2 * pad;
  const scale = anchoMM * 10 / designW; // px finales por px original
  const W = Math.round((x1 - x0 + 1) * scale), H = Math.round((y1 - y0 + 1) * scale);
  if (W * H > 9e6) throw new Error('Diseño demasiado grande');
  // transparente -> fondo
  const S2 = new Uint8ClampedArray(S); for (let i = 0; i < S2.length; i += 4) if (S2[i + 3] < 128) { S2[i] = bg[0]; S2[i + 1] = bg[1]; S2[i + 2] = bg[2]; S2[i + 3] = 255; }
  const rgb = resizeRGBA(S2, sw, sh, x0, y0, x1 - x0 + 1, y1 - y0 + 1, W, H);
  // paleta
  const step = Math.max(1, Math.floor(Math.sqrt(W * H / 25000))); const smp = [];
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = (y * W + x) * 3; smp.push(rgb[i], rgb[i + 1], rgb[i + 2]); }
  let cl = kmeans(smp, opts.maxColores ? opts.maxColores + 4 : 14, 10).sort((a, b) => b.n - a.n);
  const total = smp.length / 3, pal = [];
  for (const c of cl) { if (c.n / total < 0.002) continue; if (pal.some(p => (p[0] - c.rgb[0]) ** 2 + (p[1] - c.rgb[1]) ** 2 + (p[2] - c.rgb[2]) ** 2 < 28 * 28)) continue; pal.push(c.rgb); }
  // el fondo siempre en la paleta
  let bgi = pal.findIndex(p => (p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2 < 45 * 45);
  if (bgi < 0) { pal.push(bg); bgi = pal.length - 1; }
  // descartar colores de "borde borroso": los que están entre dos colores de la paleta
  const keep = pal.map(() => true);
  for (let i = 0; i < pal.length; i++) for (let a = 0; a < pal.length; a++) for (let b = a + 1; b < pal.length; b++) {
    if (i === a || i === b || i === bgi) continue;
    const A = pal[a], B = pal[b], P = pal[i]; const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; if (!L2) continue;
    const t = ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / L2; if (t < 0.3 || t > 0.7) continue;
    const d = Math.hypot(A[0] + ab[0] * t - P[0], A[1] + ab[1] * t - P[1], A[2] + ab[2] * t - P[2]);
    const idx = cl.findIndex(c => c.rgb === P); const share = idx >= 0 ? cl[idx].n / total : 0;
    if (d < 12 && share < 0.015) keep[i] = false;
  }
  const PAL = pal.filter((_, i) => keep[i]); const BG = PAL.findIndex(p => (p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2 < 45 * 45);
  // asignar pixeles; los muy lejanos de todo color = borde borroso -> se reparten al vecino
  const lab = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let b = 0, bd = 1e18; for (let j = 0; j < PAL.length; j++) { const d = (rgb[3 * i] - PAL[j][0]) ** 2 + (rgb[3 * i + 1] - PAL[j][1]) ** 2 + (rgb[3 * i + 2] - PAL[j][2]) ** 2; if (d < bd) { bd = d; b = j; } }
    lab[i] = bd > 50 * 50 ? -1 : b;
  }
  for (let it = 0; it < 30; it++) { // relleno de desconocidos con la mayoría de vecinos
    let left = 0; const nl = Int16Array.from(lab);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (lab[i] >= 0) continue; const cnt = {}; let best = -1, bc2 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const v = lab[yy * W + xx]; if (v < 0) continue; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc2) { bc2 = cnt[v]; best = v; } }
      if (best >= 0) nl[i] = best; else left++;
    }
    lab.set(nl); if (!left) break;
  }
  for (let i = 0; i < W * H; i++) if (lab[i] < 0) lab[i] = BG;
  // colores que solo existen como orilla borrosa (< 0.7 mm de ancho casi siempre) o muy poquitos: se reparten a sus vecinos
  { let changed = false;
    for (let k = 0; k < PAL.length; k++) {
      if (k === BG) continue; const m = new Uint8Array(W * H); let n = 0; for (let i = 0; i < W * H; i++) if (lab[i] === k) { m[i] = 1; n++; }
      if (!n) continue; const dt = edt(inv(m), W, H); let thin = 0; for (let i = 0; i < W * H; i++) if (m[i] && dt[i] < 3.5) thin++;
      if ((thin / n > 0.8 && n / (W * H) < 0.03) || n < 1500) { for (let i = 0; i < W * H; i++) if (m[i]) lab[i] = -1; changed = true; }
    }
    if (changed) for (let it = 0; it < 60; it++) {
      let left = 0; const nl = Int16Array.from(lab);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (lab[i] >= 0) continue; const cnt = {}; let best = -1, bc2 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const v = lab[yy * W + xx]; if (v < 0) continue; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc2) { bc2 = cnt[v]; best = v; } }
        if (best >= 0) nl[i] = best; else left++;
      }
      lab.set(nl); if (!left) break;
    }
    for (let i = 0; i < W * H; i++) if (lab[i] < 0) lab[i] = BG;
  }
  // filtro de mayoría 7x7 (quita basura del JPG)
  { const R = 3, K = PAL.length, out = new Int16Array(W * H), I = [];
    for (let k = 0; k < K; k++) { const ii = new Int32Array((W + 1) * (H + 1)); for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) { s += lab[y * W + x] === k ? 1 : 0; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + s; } } I.push(ii); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - R), xb = Math.min(W, x + R + 1), ya = Math.max(0, y - R), yb = Math.min(H, y + R + 1); let best = lab[y * W + x], bv = -1;
      for (let k = 0; k < K; k++) { const ii = I[k]; const v = ii[yb * (W + 1) + xb] - ii[ya * (W + 1) + xb] - ii[yb * (W + 1) + xa] + ii[ya * (W + 1) + xa]; if (v > bv) { bv = v; best = k; } }
      out[y * W + x] = best;
    }
    lab.set(out);
  }
  // capas
  const capas = [];
  for (let k = 0; k < PAL.length; k++) {
    if (k === BG && !opts.bordarFondo) continue;
    let n = 0; for (let i = 0; i < W * H; i++) if (lab[i] === k) n++;
    if (n < 150) continue;
    capas.push({ id: k, rgb: PAL[k].map(Math.round), hex: hex(PAL[k]), nombre: nombreHilo(PAL[k]), area_mm2: Math.round(n / 100), incluir: true, refuerzo: 'auto', tire: 'medio', relleno: 'alto' });
  }
  return { W, H, lab, PAL, BG, capas, anchoMM, altoMM: Math.round(H / scale / 10 * scale * 10) / 10 };
}

// ---------------- ponchado: capas -> puntadas ----------------
const TIRE = { bajo: 0.75, medio: 1.5, alto: 2.25 };          // px por lado (0.15 / 0.30 / 0.45 mm total)
const RELLENO = { alto: 3.5, medio: 4.5, bajo: 6.0 };          // separación de filas (0.35 / 0.45 / 0.60 mm)
const ENCIME = 3, TAT_LEN = 40, RUN_LEN = 20;

function ponchar(an, progreso) {
  const { W, H, lab, PAL, BG } = an; const tell = progreso || (() => {});
  const capas = an.capas.filter(c => c.incluir);
  // orden de capas: de atrás hacia adelante (área con huecos rellenos, mayor primero); contornos (el más oscuro y delgado) al final
  const info = capas.map(c => {
    const m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = lab[i] === c.id ? 1 : 0;
    const er = erode(m, W, H, 20), thick = andm(dilate(er, W, H, 21), m);
    // relleno de huecos (área que "cubre")
    const outside = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); } for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
    while (st.length) { const p = st.pop(); if (outside[p] || m[p]) continue; outside[p] = 1; const x = p % W, y = (p / W) | 0; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W); }
    let cover = 0; for (let i = 0; i < W * H; i++) if (!outside[i]) cover++;
    const nm = count(m), nt = count(thick);
    return { c, m, thick, cover, thinFrac: nm ? 1 - nt / nm : 0, dark: lum(c.rgb) };
  });
  // borde exterior: pixeles del diseño que tocan el fondo
  const bordeCnt = new Map(); let bordeTot = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, v = lab[i]; if (v === BG) continue; if (lab[i - 1] === BG || lab[i + 1] === BG || lab[i - W] === BG || lab[i + W] === BG) { bordeCnt.set(v, (bordeCnt.get(v) || 0) + 1); bordeTot++; } }
  info.forEach(L => { L.esBorde = bordeTot > 0 && (bordeCnt.get(L.c.id) || 0) / bordeTot > 0.6; });
  const outline = info.length > 1 ? info.reduce((a, b) => (b.dark < a.dark ? b : a)) : null;
  const isOutline = (x) => outline && x === outline && outline.thinFrac > 0.35;
  const alFinal = (x) => (isOutline(x) || x.esBorde) ? 1 : 0;   // contornos y borde exterior: al final, encima de todo
  info.sort((a, b) => alFinal(a) - alFinal(b) || b.cover - a.cover);

  const plan = []; const orden = new Map(info.map((L, i) => [L.c.id, i])); const islas = new Map(); const thickOf = new Map(info.map(L => [L.c.id, L.thick]));
  info.forEach((L, li) => {
    tell(`Capa ${li + 1} de ${info.length}: ${L.c.nombre}`);
    const c = L.c, sp = RELLENO[c.relleno] || 3.5, satStep = sp * 0.543, tire = TIRE[c.tire] || 1.5;
    const thin = sub(L.m, L.thick);
    const piezas = [];
    const addPieces = (mask, kind) => { for (const cp of components(mask, W, H).comps) if (cp.n >= 250) piezas.push({ cp, kind }); };
    addPieces(L.thick, 'grueso'); addPieces(thin, 'delgado');
    // figura de cada pieza = color vecino dominante (fondo = "borde"); para contornos se decide por el centro del trazo
    const figuraDe = (cp) => {
      const cr = crop(cp, W, 8), d = dilate(cr.m, cr.w, cr.h, 6), ring = sub(d, cr.m); const cnt = new Map(); let tot = 0;
      for (let y = 0; y < cr.h; y++) for (let x = 0; x < cr.w; x++) { if (!ring[y * cr.w + x]) continue; const X = x + cr.x0, Y = y + cr.y0; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const v = lab[Y * W + X]; tot++; if (v !== c.id) cnt.set(v, (cnt.get(v) || 0) + 1); }
      if (tot && (cnt.get(BG) || 0) / tot > 0.35) return 'borde';
      let best = 'borde', bv = 0; for (const [v, n] of cnt) { if (v === BG) continue; if (n > bv) { bv = n; best = 'c' + v; } }
      return best;
    };
    const islaDe = (cp) => { // pieza rodeada por un RELLENO de un color que va después: se borda encima (como las letras de Argil)
      const cr = crop(cp, W, 8);
      // rellenar huecos de la pieza: solo cuenta lo que la rodea por fuera
      const out = new Uint8Array(cr.w * cr.h), st = [];
      for (let x = 0; x < cr.w; x++) st.push(x, (cr.h - 1) * cr.w + x); for (let y = 0; y < cr.h; y++) st.push(y * cr.w, y * cr.w + cr.w - 1);
      while (st.length) { const p = st.pop(); if (out[p] || cr.m[p]) continue; out[p] = 1; const x = p % cr.w, y = (p / cr.w) | 0; if (x > 0) st.push(p - 1); if (x < cr.w - 1) st.push(p + 1); if (y > 0) st.push(p - cr.w); if (y < cr.h - 1) st.push(p + cr.w); }
      const solid = inv(out), d = dilate(solid, cr.w, cr.h, 5), ring = sub(d, solid); const cnt = new Map(), thickCnt = new Map(); let tot = 0;
      for (let y = 0; y < cr.h; y++) for (let x = 0; x < cr.w; x++) { if (!ring[y * cr.w + x]) continue; const X = x + cr.x0, Y = y + cr.y0; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const I = Y * W + X, v = lab[I]; tot++; cnt.set(v, (cnt.get(v) || 0) + 1); const th = thickOf.get(v); if (th && th[I]) thickCnt.set(v, (thickCnt.get(v) || 0) + 1); }
      let best = -1, bv = 0; for (const [v, n] of cnt) if (v !== c.id && n > bv) { bv = n; best = v; }
      const tgt = info.find(L => L.c.id === best);
      if (best >= 0 && best !== BG && tot && bv / tot > 0.7 && orden.has(best) && orden.get(best) > li && tgt && !isOutline(tgt)) return best;
      return -1;
    };
    // la prueba de isla se hace sobre la figura completa del color (antes de partir en grueso/delgado)
    const full = components(L.m, W, H); const islaComp = full.comps.map(cp => cp.n >= 150 ? islaDe(cp) : -1);
    const objs = [];
    for (const { cp, kind } of piezas) {
      const cr = crop(cp, W, 12); const { m, w, h } = cr;
      const dt = edt(inv(m), w, h); let mx = 0; for (let i = 0; i < w * h; i++) if (dt[i] > mx) mx = dt[i];
      const maxw = 2 * mx; const big = Math.max(cp.x1 - cp.x0, cp.y1 - cp.y0);
      // forma alargada: relación de ejes por PCA
      let sx = 0, sy = 0; for (const p of cp.px) { sx += p % W; sy += (p / W) | 0; } const mxx = sx / cp.n, myy = sy / cp.n; let a = 0, b = 0, d = 0;
      for (const p of cp.px) { const x = p % W - mxx, y = ((p / W) | 0) - myy; a += x * x; b += x * y; d += y * y; }
      a /= cp.n; b /= cp.n; d /= cp.n; const tr = a + d, det = a * d - b * b, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const asp = Math.sqrt(l1 / Math.max(l2, 1e-6)); const fill = cp.n / Math.max(1, (cp.x1 - cp.x0 + 1) * (cp.y1 - cp.y0 + 1));
      const refOn = c.refuerzo === 'si' || (c.refuerzo === 'auto' && big >= 400);
      let runs = [], tipo;
      if (maxw < 8) {
        tipo = 'corrido'; const md = dilate(m, w, h, 1);
        runs = chainRuns(md, w, h, skeletonLines(m, w, h).map(l => runBranch(l, RUN_LEN)));
      } else if (maxw < 40 && (asp > 2.5 || fill < 0.25)) {
        tipo = 'plumetis'; const g = dilate(m, w, h, ENCIME / 2 + tire); const lines = skeletonLines(m, w, h);
        const under = (refOn && maxw >= 20) ? chainRuns(g, w, h, lines.map(l => satinBranch(g, w, h, l, 25, 0.7))) : [];
        const top = chainRuns(g, w, h, lines.map(l => satinBranch(g, w, h, l, satStep, 1)));
        runs = (under.length && top.length) ? chainRuns(g, w, h, under.concat(top)) : under.concat(top);
      } else {
        tipo = 'tatami'; const g = dilate(m, w, h, ENCIME + tire * 0.5);
        const under = refOn ? chainRuns(g, w, h, tatami(erode(g, w, h, 6), w, h, 25, TAT_LEN, true)) : [];
        const top = chainRuns(g, w, h, tatami(g, w, h, sp, TAT_LEN, false));
        runs = (under.length && top.length) ? chainRuns(g, w, h, under.concat(top)) : under.concat(top);
      }
      runs = runs.filter(r => r.length > 1).map(r => r.map(([x, y]) => [x + cr.x0, y + cr.y0]));
      if (runs.length) {
        const isla = islaComp[full.lab[cp.px[0]]] ?? -1;
        if (isla >= 0) { if (!islas.has(isla)) islas.set(isla, new Map()); const g = islas.get(isla); if (!g.has(c.id)) g.set(c.id, { capa: c, objs: [] }); g.get(c.id).objs.push({ fig: 'isla', tipo, runs, size: big }); }
        else objs.push({ fig: figuraDe(cp), tipo, runs, size: big, cp, cr });
      }
    }
    // contornos: los trazos delgados de una pieza grande que toca varias figuras se separan por el centro del trazo
    if (isOutline(L)) {
      const out2 = [];
      for (const o of objs) {
        if (o.tipo === 'tatami' || o.size < 120) { out2.push(o); continue; }
        // figura de cada punto del recorrido según vecinos a 3 mm
        const famAt = (x, y) => { const cnt = new Map(); for (let a = 0; a < 16; a++) { const ang = a * Math.PI / 8; for (const r of [10, 20, 30]) { const X = Math.round(x + Math.cos(ang) * r), Y = Math.round(y + Math.sin(ang) * r); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const v = lab[Y * W + X]; if (v === c.id) continue; const wgt = v === BG ? 1 : 2; cnt.set(v, (cnt.get(v) || 0) + wgt); } } let b = BG, bv = -1; for (const [v, n] of cnt) if (n > bv) { bv = n; b = v; } return b === BG ? 'borde' : 'c' + b; };
        // cortar los recorridos donde cambia la figura
        for (const r of o.runs) {
          let cur = null, seg = [];
          for (let i = 0; i < r.length; i++) {
            const f = (i % 6 === 0 || cur === null) ? famAt(r[i][0], r[i][1]) : cur;
            if (cur !== null && f !== cur && seg.length > 12) { out2.push({ ...o, fig: cur, runs: [seg] }); seg = [seg[seg.length - 1]]; }
            cur = f; seg.push(r[i]);
          }
          if (seg.length > 1) out2.push({ ...o, fig: cur, runs: [seg] });
        }
      }
      objs.length = 0; objs.push(...out2);
    }
    // piezas chicas (< 3 mm) con la figura grande más cercana
    const bigs = objs.filter(o => o.size >= 30);
    for (const o of objs) if (o.size < 30 && bigs.length) { const p = o.runs[0][0]; let best = bigs[0], bd = 1e18; for (const b of bigs) { const q = b.runs[0][0]; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = b; } } o.fig = best.fig; }
    plan.push({ capa: c, objs, mask: dilate(L.m, W, H, 3), W, H, id: c.id });
  });
  // las islas (ej. letras blancas sobre la cinta roja) van justo después del color que las rodea
  const final = plan.filter(P => P.objs.length);
  const grupos = []; for (const [tgt, g] of islas) for (const I of g.values()) grupos.push({ tgt, I, done: false });
  let moved = true;
  while (moved) { // cada grupo de islas va después de la ÚLTIMA aparición del color que lo rodea (en cascada: letras sobre cinta sobre azul)
    moved = false;
    for (const G of grupos) {
      if (G.done) continue; let pos = -1; final.forEach((P, k) => { if (P.id === G.tgt) pos = k; });
      if (pos < 0) continue;
      const mk = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) mk[i] = lab[i] === G.I.capa.id ? 1 : 0;
      final.splice(pos + 1, 0, { capa: G.I.capa, objs: G.I.objs, mask: dilate(mk, W, H, 3), W, H, id: G.I.capa.id }); G.done = true; moved = true;
    }
  }
  return ordenar(final.filter(P => P.objs.length));
}

function rev(runs) { return runs.slice().reverse().map(r => r.slice().reverse()); }
function ordenar(plan) {
  // regla de Argil: terminar cada figura completa antes de brincar a otra; dentro, la pieza más cercana
  let pos = null; const out = [];
  for (const { capa, objs, mask, W, H } of plan) {
    const lineInside = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= 1; t += 1 / Math.max(1, Math.ceil(d / 2))) { const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t); if (x < 0 || y < 0 || x >= W || y >= H || !mask[y * W + x]) return false; } return true; };
    const groups = new Map(); for (const o of objs) { if (!groups.has(o.fig)) groups.set(o.fig, []); groups.get(o.fig).push(o); }
    let pend = [...groups.values()]; const runsCapa = [];
    while (pend.length) {
      let gi = 0, gd = 1e18;
      pend.forEach((g, k) => { for (const o of g) for (const r of [o.runs[0][0], o.runs[o.runs.length - 1][o.runs[o.runs.length - 1].length - 1]]) { const d = pos ? Math.hypot(r[0] - pos[0], r[1] - pos[1]) : 0; if (d < gd) { gd = d; gi = k; } } });
      const grp = pend.splice(gi, 1)[0];
      while (grp.length) {
        let best = null;
        grp.forEach((o, k) => { for (const rr of [o.runs, rev(o.runs)]) { const d = pos ? Math.hypot(rr[0][0][0] - pos[0], rr[0][0][1] - pos[1]) : 0; if (!best || d < best[0]) best = [d, k, rr, o]; } });
        const [d, k, rr] = best; grp.splice(k, 1);
        const lastR = runsCapa.length ? runsCapa[runsCapa.length - 1] : null;
        if (lastR && d <= 60 && lineInside(lastR[lastR.length - 1], rr[0][0])) { // recorrido corto, solo si va por encima del mismo color
          const last = lastR; const e = last[last.length - 1], s = rr[0][0];
          const n = Math.max(1, Math.ceil(d / 25)); for (let i = 1; i < n; i++) last.push([e[0] + (s[0] - e[0]) * i / n, e[1] + (s[1] - e[1]) * i / n]);
          last.push(...rr[0]); for (let i = 1; i < rr.length; i++) runsCapa.push(rr[i].slice());
        } else for (const r of rr) runsCapa.push(r.slice());
        const lr = runsCapa[runsCapa.length - 1]; pos = lr[lr.length - 1];
      }
    }
    out.push({ capa, runs: runsCapa.map(limpiar).filter(r => r.length > 1) });
  }
  return out;
}
function limpiar(run) { // sin puntadas < 0.3 mm ni > 4.5 mm
  const o = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const p = run[i], q = o[o.length - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < 3) continue;
    if (d > 45) { const n = Math.ceil(d / 40); for (let k = 1; k < n; k++) o.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]); }
    o.push(p);
  }
  return o;
}

// ---------------- DST (Tajima) ----------------
function dstBytes(plan, titulo) {
  // comandos: [tipo, dx, dy]  tipo: 0 puntada, 1 salto, 2 cambio de color, 3 fin
  const cmds = []; let cx = 0, cy = 0;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const L of plan) for (const r of L.runs) for (const p of r) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
  const ox = (minx + maxx) / 2, oy = (miny + maxy) / 2;
  const T = (p) => [Math.round(p[0] - ox), Math.round(-(p[1] - oy))]; // DST: Y hacia arriba
  const moveTo = (x, y, type) => { // parte movimientos largos en tramos de <=121
    let dx = x - cx, dy = y - cy;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 121));
    let px = cx, py = cy;
    for (let i = 1; i <= n; i++) { const tx = Math.round(cx + dx * i / n), ty = Math.round(cy + dy * i / n); cmds.push([type, tx - px, ty - py]); px = tx; py = ty; }
    cx = x; cy = y;
  };
  let first = true, cortes = 0, saltos = 0, puntadas = 0;
  plan.forEach((L, li) => {
    if (li > 0) { cmds.push([1, 2, 2], [1, -4, -4], [1, 2, 2]); cmds.push([2, 0, 0]); cortes++; }
    L.runs.forEach((r, ri) => {
      const [x, y] = T(r[0]);
      const d = Math.hypot(x - cx, y - cy);
      if (first || d > 0.5) {
        if (!first && d > 20 && ri > 0) { cmds.push([1, 2, 2], [1, -4, -4], [1, 2, 2]); cortes++; } // corte = 3 saltos seguidos (Tajima/Dahao)
        moveTo(x, y, 1); saltos++; first = false;
      }
      for (let i = 1; i < r.length; i++) { const [px, py] = T(r[i]); moveTo(px, py, 0); puntadas++; }
    });
  });
  cmds.push([3, 0, 0]);
  const enc = (t, dx, dy) => {
    let b0 = 0, b1 = 0, b2 = 3;
    const bit = (v, p, n) => { if (v > 40) { v -= 81; p[0] |= n[0]; } if (v < -40) { v += 81; p[0] |= n[1]; } if (v > 13) { v -= 27; p[1] |= n[2]; } if (v < -13) { v += 27; p[1] |= n[3]; } if (v > 4) { v -= 9; p[2] |= n[4]; } if (v < -4) { v += 9; p[2] |= n[5]; } if (v > 1) { v -= 3; p[3] |= n[6]; } if (v < -1) { v += 3; p[3] |= n[7]; } if (v > 0) { v -= 1; p[4] |= n[8]; } if (v < 0) { v += 1; p[4] |= n[9]; } };
    // tabla Tajima: x
    let x = dx, y = dy;
    if (x > 40) { b2 |= 0x04; x -= 81; } if (x < -40) { b2 |= 0x08; x += 81; }
    if (x > 13) { b1 |= 0x04; x -= 27; } if (x < -13) { b1 |= 0x08; x += 27; }
    if (x > 4) { b0 |= 0x04; x -= 9; } if (x < -4) { b0 |= 0x08; x += 9; }
    if (x > 1) { b1 |= 0x01; x -= 3; } if (x < -1) { b1 |= 0x02; x += 3; }
    if (x > 0) { b0 |= 0x01; x -= 1; } if (x < 0) { b0 |= 0x02; x += 1; }
    if (y > 40) { b2 |= 0x20; y -= 81; } if (y < -40) { b2 |= 0x10; y += 81; }
    if (y > 13) { b1 |= 0x20; y -= 27; } if (y < -13) { b1 |= 0x10; y += 27; }
    if (y > 4) { b0 |= 0x20; y -= 9; } if (y < -4) { b0 |= 0x10; y += 9; }
    if (y > 1) { b1 |= 0x80; y -= 3; } if (y < -1) { b1 |= 0x40; y += 3; }
    if (y > 0) { b0 |= 0x80; y -= 1; } if (y < 0) { b0 |= 0x40; y += 1; }
    if (t === 1) b2 |= 0x80; if (t === 2) b2 |= 0xC0; if (t === 3) { b0 = 0; b1 = 0; b2 = 0xF3; }
    return [b0, b1, b2];
  };
  const body = []; for (const [t, dx, dy] of cmds) body.push(...enc(t, dx, dy));
  // encabezado de 512 bytes
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  const st = cmds.filter(c => c[0] !== 3).length, cc = plan.length - 1;
  const hx = Math.round((maxx - minx) / 2), hy = Math.round((maxy - miny) / 2);
  let head = 'LA:' + pad((titulo || 'BORDALINK').slice(0, 16), 16) + '\r' + 'ST:' + String(st).padStart(7, ' ') + '\r' + 'CO:' + String(cc).padStart(3, ' ') + '\r' +
    '+X:' + String(hx).padStart(5, ' ') + '\r' + '-X:' + String(hx).padStart(5, ' ') + '\r' + '+Y:' + String(hy).padStart(5, ' ') + '\r' + '-Y:' + String(hy).padStart(5, ' ') + '\r' +
    'AX:+    0\r' + 'AY:+    0\r' + 'MX:+    0\r' + 'MY:+    0\r' + 'PD:******\r';
  const H = new Uint8Array(512).fill(0x20); for (let i = 0; i < head.length; i++) H[i] = head.charCodeAt(i); H[head.length] = 0x1A;
  const out = new Uint8Array(512 + body.length); out.set(H, 0); out.set(body, 512);
  return { bytes: out, puntadas, cortes, saltos };
}

// ---------------- semáforo ----------------
function revisar(plan, agujas) {
  let n = 0, largas = 0, imposibles = 0, cortas = 0;
  for (const L of plan) for (const r of L.runs) for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); n++; if (d > 70) largas++; if (d > 121) imposibles++; if (d < 3) cortas++; }
  const colores = new Set(plan.map(L => L.capa.hex)).size, cambios = plan.length - 1, avisos = []; let nivel = 'VERDE';
  if (imposibles) { avisos.push('Hay puntadas de más de 12 mm'); nivel = 'ROJO'; }
  if (colores > agujas) { avisos.push(`${colores} colores y la máquina tiene ${agujas} agujas`); nivel = 'ROJO'; }
  if (nivel !== 'ROJO') {
    if (largas > 20) { avisos.push('Plumetis muy largo: puede quedar flojo'); nivel = 'AMARILLO'; }
    if (cortas > 0.02 * n) { avisos.push('Muchas puntadas muy cortas: riesgo de romper hilo'); nivel = 'AMARILLO'; }
  }
  return { nivel, avisos, puntadas: n, colores, cambios, minutos: Math.round((n / 650 + cambios * 0.2) * 10) / 10 };
}

const Motor = { analizar, ponchar, dstBytes, revisar, RELLENO, TIRE, nombreHilo, _int: { zhangSuen, branches, smooth, skeletonLines, satinBranch, resample, polyLen, dilate, erode, tatami, edt } };
if (typeof module !== 'undefined' && module.exports) module.exports = Motor; else root.BordaLinkMotor = Motor;
})(typeof self !== 'undefined' ? self : this);
