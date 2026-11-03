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
  return { index, search, matrix };
})();
