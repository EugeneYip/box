// Grid A* with 8-neighbour moves, a typed-array binary heap and a node budget.
// Returns an array of tile indices (excluding the start) or null.
//
//   findPath(world, sx, sy, gx, gy, passable(tx,ty)->bool, maxNodes=3000, cost?(tx,ty)->extra)
//
// `cost` (optional) adds a per-tile penalty, e.g. to make wading through
// shallow water possible but less attractive than walking on land.
let gScore = null,
  cameFrom = null,
  stamp = null,
  closed = null,
  curStamp = 0,
  allocSize = 0;
let heapF = new Float32Array(4096),
  heapI = new Int32Array(4096),
  heapN = 0;

function ensure(n) {
  if (allocSize === n) return;
  gScore = new Float32Array(n);
  cameFrom = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  allocSize = n;
  curStamp = 0;
}

function push(i, f) {
  if (heapN >= heapF.length) {
    const nf = new Float32Array(heapF.length * 2);
    nf.set(heapF);
    heapF = nf;
    const ni = new Int32Array(heapI.length * 2);
    ni.set(heapI);
    heapI = ni;
  }
  let c = heapN++;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (heapF[p] <= f) break;
    heapF[c] = heapF[p];
    heapI[c] = heapI[p];
    c = p;
  }
  heapF[c] = f;
  heapI[c] = i;
}

function pop() {
  const top = heapI[0];
  heapN--;
  if (heapN > 0) {
    const f = heapF[heapN],
      i = heapI[heapN];
    let c = 0;
    for (;;) {
      const l = c * 2 + 1;
      if (l >= heapN) break;
      const r = l + 1;
      const m = r < heapN && heapF[r] < heapF[l] ? r : l;
      if (heapF[m] >= f) break;
      heapF[c] = heapF[m];
      heapI[c] = heapI[m];
      c = m;
    }
    heapF[c] = f;
    heapI[c] = i;
  }
  return top;
}

const SQRT2 = Math.SQRT2;

export function findPath(world, sx, sy, gx, gy, passable, maxNodes = 3000, cost = null) {
  const W = world.w;
  ensure(world.size);
  curStamp++;
  if (curStamp > 4e9) {
    stamp.fill(0);
    closed.fill(0);
    curStamp = 1;
  }
  if (!passable(gx, gy)) {
    // search for the nearest passable goal tile in a small ring
    let found = false;
    for (let r = 1; r <= 3 && !found; r++)
      for (let dy = -r; dy <= r && !found; dy++)
        for (let dx = -r; dx <= r && !found; dx++)
          if (passable(gx + dx, gy + dy)) {
            gx += dx;
            gy += dy;
            found = true;
          }
    if (!found) return null;
  }
  const start = sy * W + sx,
    goal = gy * W + gx;
  if (start === goal) return [goal];
  const h = (x, y) => {
    const dx = Math.abs(x - gx),
      dy = Math.abs(y - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  heapN = 0;
  stamp[start] = curStamp;
  gScore[start] = 0;
  cameFrom[start] = -1;
  push(start, h(sx, sy));
  let expanded = 0;
  let best = start,
    bestH = h(sx, sy);
  const height = world.height;
  while (heapN > 0) {
    const cur = pop();
    if (closed[cur] === curStamp) continue;
    closed[cur] = curStamp;
    if (cur === goal) break;
    if (++expanded > maxNodes) break;
    const cx = cur % W,
      cy = (cur / W) | 0;
    const ch = height[cur];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed[ni] === curStamp) continue;
        const climb = Math.max(0, height[ni] - ch);
        let g = gScore[cur] + (dx && dy ? SQRT2 : 1) + climb * 0.6;
        if (cost) g += cost(nx, ny);
        if (stamp[ni] !== curStamp || g < gScore[ni]) {
          stamp[ni] = curStamp;
          gScore[ni] = g;
          cameFrom[ni] = cur;
          const hh = h(nx, ny);
          if (hh < bestH) {
            bestH = hh;
            best = ni;
          }
          push(ni, g + hh * 1.05);
        }
      }
  }
  const end = closed[goal] === curStamp ? goal : best;
  if (end === start) return null;
  const path = [];
  for (let i = end; i !== start && i !== -1; i = cameFrom[i]) path.push(i);
  path.reverse();
  return path;
}
