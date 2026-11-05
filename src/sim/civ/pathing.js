// Weighted grid A* used by the civilization: villagers prefer roads, avoid
// trampling crops and never cut through buildings. Also used to plan roads.
// Returns tile indices excluding the start, or null.

let N = 0;
let g = null,
  from = null,
  seen = null,
  done = null,
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
export function civPath(world, sx, sy, gx, gy, cost, maxNodes = 4000, minCost = 0.5, goalTest = null) {
  const W = world.w;
  ensure(world.size);
  stampId++;
  heapN = 0;
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
    if (done[cur] === stampId) continue;
    done[cur] = stampId;
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
      if (ny < 0 || ny >= world.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (done[ni] === stampId) continue;
        const c = ni === goal ? Math.min(cost(ni), 2) : cost(ni);
        if (c === Infinity) continue;
        if (dx && dy) {
          if (cost(cy * W + nx) === Infinity || cost(ny * W + cx) === Infinity) continue;
        }
        const ng = gc + c * (dx && dy ? SQ2 : 1);
        if (seen[ni] !== stampId || ng < g[ni]) {
          seen[ni] = stampId;
          g[ni] = ng;
          from[ni] = cur;
          const hh = h(ni);
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
