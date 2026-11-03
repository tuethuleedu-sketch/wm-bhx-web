// Tìm điểm gần theo ô lưới: chỉ đo khoảng cách tới các ô quanh điểm cần tìm, kết quả giống hệt cách đo tới mọi điểm.
// Haversine cùng công thức với wm_bhx_match.py. Kiểm chứng: gas/test/nearby_test.html so với cách đo tới mọi điểm.
window.Nearby = (function () {
  const EARTH_R_KM = 6371.0088, RAD = Math.PI / 180;
  const CELL = 0.05;                                   // độ, khoảng 5 km
  const RINGS = 8;                                     // quá số vòng này (khoảng 40 km) thì đo hết phần còn lại, tránh dò nhiều ô trống ở nơi thưa
  function haversine(la1, lo1, cla1, la2, lo2, cla2) {
    const a = Math.sin((la2 - la1) / 2) ** 2 + cla1 * cla2 * Math.sin((lo2 - lo1) / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
  }
  const byDist = (a, b) => a[1] - b[1] || a[0] - b[0];  // trùng khoảng cách: điểm đứng trước trong danh sách lên trước

  function index(pts) {
    const n = pts.length, la = new Float64Array(n), lo = new Float64Array(n), c = new Float64Array(n), cells = new Map();
    pts.forEach((p, k) => {
      la[k] = p.lat * RAD; lo[k] = p.lng * RAD; c[k] = Math.cos(la[k]);
      const row = Math.floor(p.lat / CELL), col = Math.floor(p.lng / CELL), key = row * 1e5 + col + 1e4;
      if (!cells.has(key)) cells.set(key, { row, col, ids: [] });
      cells.get(key).ids.push(k);
    });
    return { n, la, lo, c, cells };
  }

  // Trả [[k, km], ...] xếp gần trước, chắc chắn có K điểm gần nhất và mọi điểm trong minKm (có thể dư vài điểm xa hơn).
  function search(ix, lat, lng, K, minKm) {
    const qa = lat * RAD, qo = lng * RAD, qc = Math.cos(qa), row = Math.floor(lat / CELL), col = Math.floor(lng / CELL), out = [];
    const visit = (cell) => { if (cell) for (const k of cell.ids) out.push([k, haversine(qa, qo, qc, ix.la[k], ix.lo[k], ix.c[k])]); };
    let done = false;
    for (let r = 0; r <= RINGS && !done; r++) {
      for (let y = row - r; y <= row + r; y++) {
        const edge = y === row - r || y === row + r, step = edge || !r ? 1 : 2 * r;      // hàng giữa chỉ có 2 ô ở hai đầu
        for (let x = col - r; x <= col + r; x += step) visit(ix.cells.get(y * 1e5 + x + 1e4));
      }
      if (out.length === ix.n) { done = true; break; }
      if (out.length < K) continue;
      // Điểm chưa đo nằm ngoài khối (2r+1) ô: cách ít nhất từng này km (khoảng cách tới kinh tuyến lệch r ô, luôn nhỏ hơn theo vĩ tuyến).
      const safe = EARTH_R_KM * Math.asin(qc * Math.sin(Math.min(r * CELL * RAD, Math.PI / 2))) - 1e-9;
      if (safe <= minKm) continue;
      out.sort(byDist);
      if (safe > out[K - 1][1]) done = true;
    }
    if (!done) ix.cells.forEach((cell) => { if (Math.max(Math.abs(cell.row - row), Math.abs(cell.col - col)) > RINGS) visit(cell); });
    return out.sort(byDist);
  }

  // Với mỗi điểm trong pts: điểm gần nhất, các điểm trong Rcalc km và K điểm gần nhất của targets. Khoảng cách làm tròn tới mét.
  function matrix(pts, targets, K, Rcalc) {
    const ix = index(targets), n = pts.length, round = (d) => Math.round(d * 1000) / 1000;
    const near = new Float64Array(n), nearIdx = new Int32Array(n), pairsBy = [], topBy = [];
    pts.forEach((p, i) => {
      const list = search(ix, p.lat, p.lng, K, Rcalc), pairs = [];
      near[i] = list.length ? round(list[0][1]) : Infinity; nearIdx[i] = list.length ? list[0][0] : -1;
      for (const [k, d] of list) { if (d > Rcalc) break; pairs.push([k, round(d)]); }
      pairsBy.push(pairs.sort(byDist));                // sau khi làm tròn có thể trùng nhau
      topBy.push(list.slice(0, K).map(([k, d]) => [k, round(d)]));
    });
    return { near, nearIdx, pairsBy, topBy };
  }
  // Thứ tự đi ngắn nhất từ start qua mọi điểm trong pts (không quay về), theo đường thẳng.
  // Tới 12 điểm: tìm chính xác (quy hoạch động). Nhiều hơn: thử mỗi điểm làm điểm đầu, đi láng giềng gần nhất rồi đảo đoạn,
  // chuyển điểm tới khi hết cải thiện, lấy kết quả ngắn nhất.
  const EXACT_MAX = 12;
  function route(start, pts) {
    const km = (a, b) => { const la = a.lat * RAD, lb = b.lat * RAD; return haversine(la, a.lng * RAD, Math.cos(la), lb, b.lng * RAD, Math.cos(lb)); };
    const n = pts.length, from = pts.map((p) => km(start, p)), d = pts.map((p) => pts.map((q) => km(p, q)));
    const order = n <= EXACT_MAX ? exactPath(n, from, d) : greedyPath(n, from, d);
    const legs = order.map((k, x) => (x ? d[order[x - 1]][k] : from[k]));
    return { order, legs, total: legs.reduce((a, b) => a + b, 0), exact: n <= EXACT_MAX };
  }
  function exactPath(n, from, d) {
    if (!n) return [];
    const size = 1 << n, best = new Float64Array(size * n).fill(Infinity), prev = new Int8Array(size * n).fill(-1);
    for (let k = 0; k < n; k++) best[(1 << k) * n + k] = from[k];
    for (let mask = 1; mask < size; mask++) for (let k = 0; k < n; k++) {
      const cur = best[mask * n + k];
      if (cur === Infinity) continue;
      for (let t = 0; t < n; t++) {
        if (mask & (1 << t)) continue;
        const m2 = mask | (1 << t), c = cur + d[k][t];
        if (c < best[m2 * n + t]) { best[m2 * n + t] = c; prev[m2 * n + t] = k; }
      }
    }
    let last = 0, mask = size - 1;
    for (let k = 1; k < n; k++) if (best[mask * n + k] < best[mask * n + last]) last = k;
    const order = [];
    while (last >= 0) { order.unshift(last); const p = prev[mask * n + last]; mask ^= 1 << last; last = p; }
    return order;
  }
  function greedyPath(n, from, d) {
    const len = (o) => o.reduce((t, k, x) => t + (x ? d[o[x - 1]][k] : from[k]), 0);
    let best = null, min = Infinity;
    for (let first = 0; first < n; first++) {
      const o = improvePath(n, from, d, first), t = len(o);
      if (t < min - 1e-9) { min = t; best = o; }
    }
    return best;
  }
  function improvePath(n, from, d, first) {
    const left = new Set(pts0(n)), order = [first];
    left.delete(first);
    let cur = first;
    while (left.size) {
      let next = -1, min = Infinity;
      left.forEach((k) => { const c = cur < 0 ? from[k] : d[cur][k]; if (c < min) { min = c; next = k; } });
      order.push(next); left.delete(next); cur = next;
    }
    const at = (x) => (x < 0 ? null : order[x]), dist = (a, b) => (a === null ? from[b] : d[a][b]), EPS = 1e-9;
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {              // đảo đoạn i..j
        const delta = dist(at(i - 1), order[j]) - dist(at(i - 1), order[i])
          + (j < n - 1 ? d[order[i]][order[j + 1]] - d[order[j]][order[j + 1]] : 0);
        if (delta < -EPS) { for (let a = i, b = j; a < b; a++, b--) [order[a], order[b]] = [order[b], order[a]]; improved = true; }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {                      // chuyển điểm i tới sau vị trí j
        if (j === i || j === i - 1) continue;
        const k = order[i], before = at(i - 1), after = i < n - 1 ? order[i + 1] : null;
        const removed = dist(before, k) + (after === null ? 0 : d[k][after]) - (after === null ? 0 : dist(before, after));
        const prevJ = order[j], nextJ = j < n - 1 ? order[j + 1] : null;
        const added = d[prevJ][k] + (nextJ === null ? 0 : d[k][nextJ]) - (nextJ === null ? 0 : d[prevJ][nextJ]);
        if (added - removed < -EPS) { order.splice(i, 1); order.splice(j < i ? j + 1 : j, 0, k); improved = true; }
      }
    }
    return order;
  }
  const pts0 = (n) => Array.from({ length: n }, (_, k) => k);
  return { index, search, matrix, route };
})();
