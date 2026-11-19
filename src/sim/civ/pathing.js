// Weighted grid A* used by the civilization: villagers prefer roads, avoid
// trampling crops and never cut through buildings. Also used to plan roads.
// Returns tile indices excluding the start, or null.

let N = 0;
let g = null,
  from = null,
  seen = null,
  done = null,
  cstamp = null,
  cval = null,
  stampId = 0;
let heapI = new Int32Array(1024),
  heapF = new Float32Array(1024),
  heapN = 0;

function ensure(n) {
  if (N === n) return;
  N = n;
  g = new Float32Array(n);
  from = new Int32Array(n);
  seen = new Uint32Array(n);
  done = new Uint32Array(n);
  // each tile's step cost, asked once per search (a tile is a neighbour of up
  // to eight expanded tiles and a corner of four diagonal steps)
  cstamp = new Uint32Array(n);
  cval = new Float64Array(n);
  stampId = 0;
}
function hpush(i, f) {
  if (heapN >= heapI.length) {
    const ni = new Int32Array(heapI.length * 2);
    ni.set(heapI);
    heapI = ni;
    const nf = new Float32Array(heapF.length * 2);
    nf.set(heapF);
    heapF = nf;
  }
  let c = heapN++;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (heapF[p] <= f) break;
    heapI[c] = heapI[p];
    heapF[c] = heapF[p];
    c = p;
  }
  heapI[c] = i;
  heapF[c] = f;
}
function hpop() {
  const top = heapI[0];
  const li = heapI[--heapN],
    lf = heapF[heapN];
  let c = 0;
  for (;;) {
    const l = c * 2 + 1;
    if (l >= heapN) break;
    let m = l;
    if (l + 1 < heapN && heapF[l + 1] < heapF[l]) m = l + 1;
    if (heapF[m] >= lf) break;
    heapI[c] = heapI[m];
    heapF[c] = heapF[m];
    c = m;
  }
  heapI[c] = li;
  heapF[c] = lf;
  return top;
}

const SQ2 = Math.SQRT2;

// cost(i) -> step cost multiplier (>= minCost) or Infinity for impassable.
// goalTest(i) optional: accept any tile satisfying it as the goal.
export function civPath(world, sx, sy, gx, gy, rawCost, maxNodes = 4000, minCost = 0.5, goalTest = null) {
  const W = world.w;
  ensure(world.size);
  stampId++;
  const cs = cstamp,
    cv = cval,
    stamp = stampId;
  const cost = (i) => {
    if (cs[i] === stamp) return cv[i];
    cs[i] = stamp;
    return (cv[i] = rawCost(i));
  };
  heapN = 0;
  const Hh = world.h;
  const start = sy * W + sx;
  const goal = gy * W + gx;
  if (start === goal) return [goal];
  const hk = minCost * 1.15;
  const h = (i) => {
    const x = i % W,
      y = (i / W) | 0;
    const dx = Math.abs(x - gx),
      dy = Math.abs(y - gy);
    return (dx + dy + (SQ2 - 2) * Math.min(dx, dy)) * hk;
  };
  seen[start] = stampId;
  g[start] = 0;
  from[start] = -1;
  hpush(start, h(start));
  let expanded = 0;
  let found = -1;
  let best = start,
    bestH = h(start);
  while (heapN) {
    const cur = hpop();
    if (done[cur] === stamp) continue;
    done[cur] = stamp;
    if (cur === goal || (goalTest && goalTest(cur))) {
      found = cur;
      break;
    }
    if (++expanded > maxNodes) break;
    const cx = cur % W,
      cy = (cur / W) | 0;
    const gc = g[cur];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= Hh) continue;
      const ady = Math.abs(ny - gy);
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (done[ni] === stamp) continue;
        let c;
        if (cs[ni] === stamp) c = cv[ni];
        else {
          cs[ni] = stamp;
          c = cv[ni] = rawCost(ni);
        }
        if (ni === goal) c = Math.min(c, 2);
        if (c === Infinity) continue;
        if (dx && dy) {
          // (a diagonal step never cuts a blocked corner)
          if (cost(cy * W + nx) === Infinity || cost(ny * W + cx) === Infinity) continue;
        }
        const ng = gc + c * (dx && dy ? SQ2 : 1);
        if (seen[ni] !== stamp || ng < g[ni]) {
          seen[ni] = stamp;
          g[ni] = ng;
          from[ni] = cur;
          const adx = Math.abs(nx - gx);
          const hh = (adx + ady + (SQ2 - 2) * Math.min(adx, ady)) * hk;
          if (hh < bestH) {
            bestH = hh;
            best = ni;
          }
          hpush(ni, ng + hh);
        }
      }
    }
  }
  let end = found;
  if (end < 0) {
    // partial path only if we got reasonably close
    if (bestH > 6 * hk) return null;
    end = best;
  }
  if (end === start) return null;
  const path = [];
  for (let i = end; i !== start && i !== -1; i = from[i]) path.push(i);
  path.reverse();
  return path;
}

// Path that must reach the goal exactly (no partial results).
export function civPathStrict(world, sx, sy, gx, gy, cost, maxNodes, minCost = 0.5, goalTest = null) {
  const p = civPath(world, sx, sy, gx, gy, cost, maxNodes, minCost, goalTest);
  if (!p || !p.length) return null;
  const last = p[p.length - 1];
  if (goalTest ? !goalTest(last) && last !== gy * world.w + gx : last !== gy * world.w + gx) return null;
  return p;
}
