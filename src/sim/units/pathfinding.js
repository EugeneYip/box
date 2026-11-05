// Grid A* with 8-neighbour moves, a binary heap and a node budget.
// Returns an array of tile indices (excluding the start) or null.
const heapF = [];
let gScore = null,
  cameFrom = null,
  stamp = null,
  closed = null,
  curStamp = 0,
  allocSize = 0;

function ensure(n) {
  if (allocSize === n) return;
  gScore = new Float32Array(n);
  cameFrom = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  allocSize = n;
  curStamp = 0;
}

const SQRT2 = Math.SQRT2;

export function findPath(world, sx, sy, gx, gy, passable, maxNodes = 3000) {
  const W = world.w;
  ensure(world.size);
  curStamp++;
  if (!passable(gx, gy)) {
    // search for nearest passable goal tile in a small ring
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
  const h = (i) => {
    const x = i % W,
      y = (i / W) | 0;
    const dx = Math.abs(x - gx),
      dy = Math.abs(y - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  heapF.length = 0;
  const push = (i, f) => {
    heapF.push([f, i]);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p][0] <= heapF[c][0]) break;
      [heapF[p], heapF[c]] = [heapF[c], heapF[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heapF[0];
    const last = heapF.pop();
    if (heapF.length) {
      heapF[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1,
          r = l + 1;
        let m = c;
        if (l < heapF.length && heapF[l][0] < heapF[m][0]) m = l;
        if (r < heapF.length && heapF[r][0] < heapF[m][0]) m = r;
        if (m === c) break;
        [heapF[m], heapF[c]] = [heapF[c], heapF[m]];
        c = m;
      }
    }
    return top;
  };
  stamp[start] = curStamp;
  gScore[start] = 0;
  cameFrom[start] = -1;
  push(start, h(start));
  let expanded = 0;
  let best = start,
    bestH = h(start);
  while (heapF.length) {
    const [, cur] = pop();
    if (closed[cur] === curStamp) continue;
    closed[cur] = curStamp;
    if (cur === goal) break;
    if (++expanded > maxNodes) break;
    const cx = cur % W,
      cy = (cur / W) | 0;
    const ch = world.height[cur];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx,
          ny = cy + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed[ni] === curStamp) continue;
        const climb = Math.max(0, world.height[ni] - ch);
        const g = gScore[cur] + (dx && dy ? SQRT2 : 1) + climb * 0.6;
        if (stamp[ni] !== curStamp || g < gScore[ni]) {
          stamp[ni] = curStamp;
          gScore[ni] = g;
          cameFrom[ni] = cur;
          const hh = h(ni);
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
