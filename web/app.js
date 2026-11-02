// WM+ ↔ BHX — giao diện. Tính khoảng cách ngay trên trình duyệt (haversine, cùng công thức với wm_bhx_match.py).
(function () {
  const CFG = window.APP_CONFIG;
  const API = CFG.mode === "demo" ? window.DemoAPI : window.GasAPI;
  const EARTH_R_KM = 6371.0088, R_MAX = 30;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x, d = 0) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x) => fmt(x * 100, 1) + "%";
  // Bỏ dấu để tìm kiếm: "ha noi" khớp "Hà Nội", "le loi" khớp "Lê Lợi"
  const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

  // Đối thủ: nút lọc & màu trên bản đồ. Khi có dữ liệu chuỗi mới chỉ cần backend trả về đúng mã này.
  const CHAINS = { BHX: { name: "BHX", color: "#1c7ed6" }, COOP: { name: "Co.opmart", color: "#0ca5b5" }, GO: { name: "GO!/Big C/Tops", color: "#e6a700" },
    EMART: { name: "Emart", color: "#495057" }, KFM: { name: "Kingfood", color: "#8d5524" }, LOTTE: { name: "LOTTE", color: "#e64980" } };
  const chainName = (c) => (CHAINS[c] || { name: c }).name;
  // S.all: mọi đối thủ đã tải; S.bhx: phần đang bật ở nút lọc — toàn bộ phép tính khoảng cách chỉ dùng S.bhx.
  let S = { user: null, wm: [], all: [], bhx: [], chains: new Set(["BHX"]), compStatus: {}, near: null, nearIdx: null, pairsBy: null, Rcalc: 0, R: 1,
    tinh: "", chuoi: "", khu: "", q: "", sel: null, sortK: "n", sortDir: -1 };

  // ---------- Tính toán ----------
  function haversine(la1, lo1, cla1, la2, lo2, cla2) {
    const a = Math.sin((la2 - la1) / 2) ** 2 + cla1 * cla2 * Math.sin((lo2 - lo1) / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
  }
  // Lưu sẵn các cặp WM–BHX trong bán kính Rcalc (≥ 5 km, tự tăng khi kéo R lớn hơn).
  function computeAll() {
    const rad = Math.PI / 180, wm = S.wm, bhx = S.bhx, n = wm.length, m = bhx.length;
    S.Rcalc = Math.max(CFG.maxRadiusKm, Math.ceil(S.R));
    const bLa = new Float64Array(m), bLo = new Float64Array(m), bC = new Float64Array(m);
    for (let j = 0; j < m; j++) { bLa[j] = bhx[j].lat * rad; bLo[j] = bhx[j].lng * rad; bC[j] = Math.cos(bLa[j]); }
    S.near = new Float64Array(n); S.nearIdx = new Int32Array(n); S.pairsBy = [];
    for (let i = 0; i < n; i++) {
      const la = wm[i].lat * rad, lo = wm[i].lng * rad, c = Math.cos(la), list = [];
      let best = Infinity, bi = -1;
      for (let j = 0; j < m; j++) {
        const d = haversine(la, lo, c, bLa[j], bLo[j], bC[j]);
        if (d < best) { best = d; bi = j; }
        if (d <= S.Rcalc) list.push([j, Math.round(d * 1000) / 1000]);
      }
      list.sort((a, b) => a[1] - b[1]);
      S.near[i] = Math.round(best * 1000) / 1000; S.nearIdx[i] = bi; S.pairsBy.push(list);
    }
    nearB = null;
  }
  const countIn = (list, R) => { let k = 0; while (k < list.length && list[k][1] <= R) k++; return k; };
  // Khoá tỉnh: bỏ dấu, bỏ tiền tố "Tỉnh/TP./Thành phố" → "TP. Hồ Chí Minh" (BHX) khớp "Hồ Chí Minh" (file WM+).
  const provKey = (t) => plain(t).replace(/^\s*(thanh pho|tinh|tp\.?|t\.)\s*/, "").replace(/[^a-z0-9]/g, "").replace(/^hcm$/, "hochiminh");
  const inProv = (x) => !S.tinh || provKey(x.tinh) === S.tinh;
  const wmAttrOk = (w) => (!S.chuoi || w.chuoi === S.chuoi) && (!S.khu || (S.khu === "-" ? !w.khu_vuc : w.khu_vuc === S.khu));
  const scopeIdx = () => S.wm.map((_, i) => i).filter((i) => wmAttrOk(S.wm[i]) && inProv(S.wm[i]));
  const bhxScope = () => S.bhx.map((_, j) => j).filter((j) => inProv(S.bhx[j]));
  const hit = (q, ...f) => !q || f.some((v) => plain(v).includes(q));

  // Với mỗi BHX: WM gần nhất (theo Chuỗi/Khu vực đang lọc, mọi tỉnh) — dùng cho bảng BHX, popup, xuất CSV.
  let nearB = null, nearBKey = "";
  function bhxNearest() {
    const key = S.chuoi + "|" + S.khu;
    if (nearB && nearBKey === key) return nearB;
    const rad = Math.PI / 180, W = S.wm.map((w, i) => i).filter((i) => wmAttrOk(S.wm[i]));
    const wLa = W.map((i) => S.wm[i].lat * rad), wLo = W.map((i) => S.wm[i].lng * rad), wC = wLa.map(Math.cos);
    const d = new Float64Array(S.bhx.length).fill(Infinity), ix = new Int32Array(S.bhx.length).fill(-1);
    S.bhx.forEach((b, j) => {
      const la = b.lat * rad, lo = b.lng * rad, c = Math.cos(la);
      for (let k = 0; k < W.length; k++) { const x = haversine(la, lo, c, wLa[k], wLo[k], wC[k]); if (x < d[j]) { d[j] = x; ix[j] = W[k]; } }
    });
    nearBKey = key; return (nearB = { d, ix });
  }
  // Số WM (theo Chuỗi/Khu vực) trong bán kính R của từng BHX
  function bhxCountInR() {
    const cnt = new Int32Array(S.bhx.length);
    S.wm.forEach((w, i) => { if (wmAttrOk(w)) for (const [j, d] of S.pairsBy[i]) { if (d > S.R) break; cnt[j]++; } });
    return cnt;
  }
  let CNT_B = null;
  function bhxInfo(j) {
    const b = S.bhx[j], nb = bhxNearest(), w = nb.ix[j] >= 0 ? S.wm[nb.ix[j]] : null;
    return `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><br>${esc(b.dia_chi)}<br><span class="muted">${esc(b.tinh)}</span><hr>`
      + `WM trong ${fmt(S.R, S.R % 1 ? 1 : 0)} km: <b>${CNT_B ? CNT_B[j] : 0}</b><br>`
      + (w ? `WM gần nhất: <b>${esc(w.ma)}</b> (${esc(w.chuoi)}) · ${fmt(nb.d[j], 2)} km` : "Chưa có WM trong bộ lọc");
  }
  function wmInfo(i) {
    const w = S.wm[i];
    return `<b>${esc(w.chuoi)} ${esc(w.ma)}</b> · ${esc(w.ten)}<br>${w.dia_chi ? esc(w.dia_chi) + "<br>" : ""}${esc(w.tinh)}${w.khu_vuc ? " · " + esc(w.khu_vuc) : ""}`
      + `<br>${esc(lab())} trong ${fmt(S.R, S.R % 1 ? 1 : 0)} km: <b>${countIn(S.pairsBy[i], S.R)}</b> · gần nhất ${fmt(S.near[i], 3)} km`;
  }
  const lab = () => (S.chains.size === 1 ? chainName([...S.chains][0]) : "đối thủ");
  const storeTip = (b) => `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><br>${esc(b.dia_chi)}`;
  // Nút lọc đối thủ: số trong ngoặc theo tỉnh đang chọn. Chuỗi chưa có dữ liệu thì khoá nút; lần kéo gần nhất lỗi thì cảnh báo.
  function renderChips() {
    const n = {}, tot = {};
    S.all.forEach((b) => { tot[b.chain] = (tot[b.chain] || 0) + 1; if (inProv(b)) n[b.chain] = (n[b.chain] || 0) + 1; });
    const has = Object.keys(CHAINS).filter((c) => tot[c]), allOn = has.every((c) => S.chains.has(c));
    $("#chips").innerHTML = `<button class="chip${allOn ? " on" : ""}" data-all="1">Tất cả</button>` + Object.entries(CHAINS).map(([c, v]) => {
      const st = S.compStatus[c], bad = st && st.ok === false;
      const title = !tot[c] ? "Chưa có dữ liệu" : bad ? `Lần cập nhật ${st.at} bị lỗi, đang hiện dữ liệu cũ: ${st.msg}` : st ? `Cập nhật ${st.at}: ${st.msg}` : "";
      return `<button class="chip${S.chains.has(c) ? " on" : ""}${bad ? " warn" : ""}" data-c="${c}" style="--chip:${v.color}" title="${esc(title)}"${tot[c] ? "" : " disabled"}>`
        + `<i style="background:${v.color}"></i>${esc(v.name)} <small>${tot[c] ? fmt(n[c] || 0) : "chưa có"}${bad ? " ⚠" : ""}</small></button>`;
    }).join("");
    document.querySelectorAll(".lab").forEach((el) => (el.textContent = lab()));
  }
  // Đổi chuỗi đang bật → tính lại khoảng cách và vẽ lại các chấm đối thủ.
  function applyChains() {
    S.bhx = S.all.filter((b) => S.chains.has(b.chain)); S.sel = null;
    computeAll(); buildBhxAll(); renderOverview();
  }

  // ---------- Bản đồ ----------
  let map, wmMarkers = [], bhxLayer, ringLayer, bhxAllLayer, bhxAllMarkers = [];
  function initMap() {
    map = L.map("map", { preferCanvas: true, renderer: L.canvas({ tolerance: 5 }) }).setView([20.8, 106.2], 9);
    // OSM chặn tile (403) nếu thiếu Referer; trang đặt no-referrer → riêng tile gửi origin (chỉ tên miền, không đường dẫn).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 18, attribution: "© OpenStreetMap", referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
    bhxLayer = L.layerGroup().addTo(map); ringLayer = L.layerGroup().addTo(map);
  }
  // Lớp nền: toàn bộ BHX đang mở (chấm xám) — luôn hiện, kể cả khi chưa có WM+; lọc theo tỉnh. Bấm → popup thông tin.
  function buildBhxAll() {
    if (bhxAllLayer) bhxAllLayer.remove();
    bhxAllMarkers = S.bhx.map((b, j) => L.circleMarker([b.lat, b.lng],
      { radius: 3, weight: 0, fillColor: (CHAINS[b.chain] || CHAINS.BHX).color, fillOpacity: 0.4 })
      .bindTooltip(storeTip(b)).bindPopup(() => bhxInfo(j)));
    bhxAllLayer = L.layerGroup().addTo(map);          // thêm trước WM+ → nằm dưới
  }
  function renderBhxAll() {
    bhxAllLayer.clearLayers();
    S.bhx.forEach((b, j) => { if (inProv(b)) bhxAllLayer.addLayer(bhxAllMarkers[j]); });
  }
  // Thu phóng vừa bộ lọc (WM + BHX của tỉnh); không lọc tỉnh → vừa WM, chưa có WM thì vừa toàn bộ BHX.
  function fitScope() {
    let pts = scopeIdx().map((i) => S.wm[i]);
    if (S.tinh) pts = pts.concat(S.bhx.filter(inProv)); else if (!pts.length) pts = S.bhx;
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [20, 20], maxZoom: 14 });
  }
  // Danh sách tỉnh: hợp các tỉnh có WM hoặc có đối thủ (mọi chuỗi, kể cả chuỗi đang tắt).
  let PROVS = [];
  function fillProvinces() {
    const P = new Map();
    const add = (t) => { const key = provKey(t); if (key && !P.has(key)) P.set(key, String(t).replace(/^\s*(tỉnh|thành phố|tp\.?|t\.)\s*/i, "")); };
    S.wm.forEach((w) => add(w.tinh));                 // tên theo file WM+ được ưu tiên hiển thị
    S.all.forEach((b) => add(b.tinh));
    PROVS = [...P].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }
  const provName = (k) => (PROVS.find((p) => p.key === k) || {}).name || "";
  function setProv(k) { S.tinh = k; S.sel = null; $("#tinh-q").value = provName(k); renderOverview(); fitScope(); }
  function buildWmMarkers() {                         // gọi lại mỗi khi danh sách WM+ đổi (upload)
    wmMarkers.forEach((mk) => mk.remove());
    wmMarkers = S.wm.map((w, i) => L.circleMarker([w.lat, w.lng], { radius: 5, weight: w.chuoi === "WMT" ? 2.5 : 1, color: w.chuoi === "WMT" ? getVar("--wmt") : "#fff", fillOpacity: 0.9 })
      .bindTooltip(() => wmInfo(i)).on("click", () => select(i)));
  }
  function renderMap(scope) {
    const inScope = new Set(scope);
    wmMarkers.forEach((mk, i) => {
      if (!inScope.has(i)) { mk.remove(); return; }
      mk.addTo(map).setStyle({ fillColor: S.near[i] <= S.R ? getVar("--wm-hit") : getVar("--wm-free"), radius: S.sel === i ? 9 : 5 });
    });
    renderBhxAll(); bhxLayer.clearLayers(); ringLayer.clearLayers();
    const src = S.sel != null ? [S.sel] : scope, seen = new Set();
    src.forEach((i) => S.pairsBy[i].forEach(([j, d]) => {
      if (d > S.R || seen.has(j)) return; seen.add(j);
      const b = S.bhx[j];
      L.circleMarker([b.lat, b.lng], { radius: 4, weight: 0, fillColor: (CHAINS[b.chain] || CHAINS.BHX).color, fillOpacity: 0.95 })
        .bindTooltip(storeTip(b)).bindPopup(() => bhxInfo(j)).addTo(bhxLayer);
    }));
    if (S.sel != null) {
      const w = S.wm[S.sel];
      L.circle([w.lat, w.lng], { radius: S.R * 1000, color: getVar("--wm-hit"), weight: 1.5, fillOpacity: 0.05, interactive: false }).addTo(ringLayer);
    }
  }
  const getVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- Tổng quan ----------
  function renderOverview() {
    const R = S.R, scope = scopeIdx(), bScope = bhxScope();
    CNT_B = bhxCountInR(); renderChips();
    let cov = 0, tot = 0; const uniq = new Set(), nears = [], byChain = { "WM+": 0, WMT: 0 };
    scope.forEach((i) => {
      if (S.near[i] <= R) cov++;
      const k = countIn(S.pairsBy[i], R); tot += k;
      for (let t = 0; t < k; t++) uniq.add(S.pairsBy[i][t][0]);
      nears.push(S.near[i]); byChain[S.wm[i].chuoi] = (byChain[S.wm[i].chuoi] || 0) + 1;
    });
    nears.sort((a, b) => a - b);
    const med = nears.length ? (nears.length % 2 ? nears[(nears.length - 1) / 2] : (nears[nears.length / 2 - 1] + nears[nears.length / 2]) / 2) : NaN;
    $("#k-nwm").textContent = fmt(scope.length);
    $("#k-nwm-sub").textContent = `WM+ ${fmt(byChain["WM+"])} · WMT ${fmt(byChain.WMT)}`;
    $("#k-nbhx").textContent = fmt(bScope.length);
    const byComp = {}; bScope.forEach((j) => { const c = S.bhx[j].chain; byComp[c] = (byComp[c] || 0) + 1; });
    $("#k-nbhx-sub").textContent = (S.chains.size > 1 ? Object.entries(byComp).map(([c, k]) => `${chainName(c)} ${fmt(k)}`).join(" · ") + " · " : "")
      + (S.tinh ? `trong ${provName(S.tinh)}` : "cả nước, đang mở");
    $("#k-cov").textContent = scope.length ? pct(cov / scope.length) : "–";
    $("#k-cov-sub").textContent = `${fmt(cov)} / ${fmt(scope.length)} WM`;
    $("#k-uniq").textContent = fmt(uniq.size);
    $("#k-avg").textContent = scope.length ? fmt(tot / scope.length, 2) : "–";
    $("#k-med").textContent = isNaN(med) ? "–" : fmt(med, 2) + " km";

    // Thanh % theo tỉnh (theo Chuỗi/Khu vực, luôn hiện đủ tỉnh để so sánh)
    const by = {};
    S.wm.forEach((w, i) => { if (!wmAttrOk(w)) return; (by[w.tinh] ||= [0, 0]); by[w.tinh][1]++; if (S.near[i] <= R) by[w.tinh][0]++; });
    $("#bars").innerHTML = Object.entries(by).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([t, [c, n]]) =>
      `<div class="bar-row${provKey(t) === S.tinh ? " sel" : ""}" data-t="${esc(provKey(t))}" title="${c}/${n} WM"><span class="bar-name">${esc(t)}</span>
       <div class="bar-track"><div class="bar-fill" style="width:${(c / n) * 100}%"></div></div><span class="bar-val">${pct(c / n)}</span></div>`).join("")
      || `<p class="muted small">Chưa có WM trong bộ lọc.</p>`;

    renderWmTable(scope); renderBhxTable(); renderPairs(scope); renderMap(scope);
  }
  function wmRows(scope) {
    const q = S.q;
    return scope.filter((i) => hit(q, S.wm[i].ma, S.wm[i].ten, S.wm[i].dia_chi))
      .map((i) => ({ i, ma: S.wm[i].ma, ten: S.wm[i].ten, chuoi: S.wm[i].chuoi, khu_vuc: S.wm[i].khu_vuc, tinh: S.wm[i].tinh, n: countIn(S.pairsBy[i], S.R), near: S.near[i] }));
  }
  function renderWmTable(scope) {
    const rows = wmRows(scope).sort((a, b) => (a[S.sortK] > b[S.sortK] ? 1 : a[S.sortK] < b[S.sortK] ? -1 : 0) * S.sortDir);
    $("#wm-count").textContent = `(${fmt(rows.length)})`;
    $("#t-wm tbody").innerHTML = rows.map((r) =>
      `<tr data-i="${r.i}"${r.i === S.sel ? ' class="sel"' : ""}><td>${esc(r.ma)}</td><td>${esc(r.chuoi)}</td><td>${esc(r.khu_vuc)}</td><td>${esc(r.tinh)}</td><td class="num">${r.n}</td><td class="num">${fmt(r.near, 3)}</td></tr>`).join("");
  }
  function bhxRows() {
    const nb = bhxNearest();
    return bhxScope().filter((j) => hit(S.q, S.bhx[j].ma, S.bhx[j].ten, S.bhx[j].dia_chi)).map((j) => {
      const w = nb.ix[j] >= 0 ? S.wm[nb.ix[j]] : null;
      return { j, b: S.bhx[j], n: CNT_B[j], w, d: w ? Math.round(nb.d[j] * 1000) / 1000 : null };
    });
  }
  function renderBhxTable() {
    const rows = bhxRows().sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)), LIM = 500;
    $("#bhx-count").textContent = `(${fmt(rows.length)})`;
    $("#t-bhx tbody").innerHTML = rows.slice(0, LIM).map((r) =>
      `<tr data-j="${r.j}"><td>${esc(chainName(r.b.chain))}</td><td>${esc(r.b.ma)}</td><td>${esc(r.b.dia_chi)}</td><td>${esc(r.b.tinh)}</td><td class="num">${r.n}</td><td class="num">${r.d == null ? "–" : fmt(r.d, 3)}</td></tr>`).join("")
      + (rows.length > LIM ? `<tr><td colspan="6" class="muted">Đang hiện ${LIM} cửa hàng gần WM nhất — bấm Xuất CSV để lấy đủ ${fmt(rows.length)}.</td></tr>` : "");
  }
  function pairRows(scope) {
    const src = S.sel != null ? [S.sel] : scope, out = [];
    src.forEach((i) => S.pairsBy[i].forEach(([j, d]) => { if (d <= S.R) out.push({ wm: S.wm[i], b: S.bhx[j], d }); }));
    return out.sort((a, b) => a.d - b.d);
  }
  function renderPairs(scope) {
    const rows = pairRows(scope), LIM = 300;
    $("#pair-count").textContent = `(${fmt(rows.length)})`;
    $("#pair-hint").innerHTML = S.sel != null
      ? `Đang xem WM <b>${esc(S.wm[S.sel].ma)}</b> · <button class="link" id="clear-sel">bỏ chọn</button>`
      : `Bấm 1 WM (bảng hoặc bản đồ) để xem đối thủ quanh cửa hàng đó.${rows.length > LIM ? ` Đang hiện ${LIM} cặp gần nhất; Xuất CSV để lấy đủ.` : ""}`;
    $("#t-pairs tbody").innerHTML = rows.slice(0, LIM).map((r) =>
      `<tr><td>${esc(r.wm.ma)}</td><td>${esc(chainName(r.b.chain))}</td><td>${esc(r.b.ma)}</td><td>${esc(r.b.dia_chi)}</td><td class="num">${fmt(r.d, 3)}</td></tr>`).join("");
  }
  function select(i) {
    S.sel = S.sel === i ? null : i;
    if (S.sel != null) map.setView([S.wm[i].lat, S.wm[i].lng], Math.max(map.getZoom(), 13));
    renderOverview();
  }
  function setR(v) {
    v = Math.min(R_MAX, Math.max(0.1, Math.round(+v * 10) / 10 || 1));
    S.R = v; $("#r").value = Math.min(v, 20); if (document.activeElement !== $("#r-num")) $("#r-num").value = v;
    if (v > S.Rcalc) computeAll();
    renderOverview();
  }
  // Mở cửa hàng tìm được: đưa bộ lọc về đúng tỉnh (và bỏ lọc Chuỗi/Khu vực nếu cửa hàng bị lọc mất), zoom tới, mở popup.
  function focusStore(kind, k) {
    const s = kind === "wm" ? S.wm[k] : S.bhx[k];
    if (kind === "wm" && !wmAttrOk(s)) { S.chuoi = S.khu = ""; $("#chuoi").value = $("#khu").value = ""; }
    if (!inProv(s)) setProv(provKey(s.tinh));
    if (kind === "wm") { S.sel = null; select(k); }
    map.setView([s.lat, s.lng], 16);
    L.popup().setLatLng([s.lat, s.lng]).setContent(kind === "wm" ? wmInfo(k) : bhxInfo(k)).openOn(map);
    $("#map-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Ô chọn có gõ tìm (tỉnh, cửa hàng): ↑/↓ chọn, Enter mở, Esc đóng.
  function combo(input, list, items, opts = {}) {
    let cur = [], on = 0;
    const draw = (q) => {
      cur = items(plain(q.trim())); on = 0;
      if (!cur.length && opts.hideEmpty && !q.trim()) { list.hidden = true; return; }
      list.innerHTML = cur.length ? cur.map((it, k) => `<div data-k="${k}"${k ? "" : ' class="on"'}>${it.html}</div>`).join("") : `<div class="empty">Không tìm thấy</div>`;
      list.hidden = false;
    };
    const hi = (k) => {
      on = Math.max(0, Math.min(cur.length - 1, k));
      list.querySelectorAll("[data-k]").forEach((d, x) => d.classList.toggle("on", x === on));
      list.children[on] && list.children[on].scrollIntoView({ block: "nearest" });
    };
    const pick = (k) => { list.hidden = true; cur[k] && cur[k].pick(); };
    input.addEventListener("input", () => draw(input.value));
    input.addEventListener("focus", () => { input.select(); draw(opts.showAllOnFocus ? "" : input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { if (list.hidden) draw(input.value); else hi(on + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hi(on - 1); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); if (!list.hidden) { pick(on); input.blur(); } }
      else if (e.key === "Escape") { list.hidden = true; input.blur(); }
    });
    list.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const d = e.target.closest("[data-k]"); if (d) { pick(+d.dataset.k); input.blur(); }
    });
    input.addEventListener("blur", () => { list.hidden = true; opts.onBlur && opts.onBlur(); });
  }
  combo($("#tinh-q"), $("#tinh-list"), (q) => {
    const cW = {}, cB = {};
    S.wm.forEach((w) => { if (wmAttrOk(w)) { const k = provKey(w.tinh); cW[k] = (cW[k] || 0) + 1; } });
    S.bhx.forEach((b) => { const k = provKey(b.tinh); cB[k] = (cB[k] || 0) + 1; });
    const cLab = lab();
    const all = { html: `<b>Tất cả</b><small>${fmt(PROVS.length)} tỉnh</small>`, pick: () => setProv("") };
    return (q ? [] : [all]).concat(PROVS.filter((p) => !q || plain(p.name).includes(q) || p.key.includes(q.replace(/[^a-z0-9]/g, "")))
      .map((p) => ({ html: `${esc(p.name)}<small>${fmt(cW[p.key] || 0)} WM · ${fmt(cB[p.key] || 0)} ${esc(cLab)}</small>`, pick: () => setProv(p.key) })));
  }, { showAllOnFocus: true, onBlur: () => ($("#tinh-q").value = provName(S.tinh)) });
  combo($("#q"), $("#q-list"), (q) => {
    if (!q) return [];
    const out = [];
    S.wm.forEach((w, i) => { if (out.length < 8 && hit(q, w.ma, w.ten, w.dia_chi)) out.push({ html: `<b>${esc(w.chuoi)} ${esc(w.ma)}</b> ${esc(w.ten !== w.ma ? w.ten : "")}<small>${esc(w.dia_chi || w.tinh)}</small>`, pick: () => focusStore("wm", i) }); });
    const n = out.length;
    S.bhx.forEach((b, j) => { if (out.length < n + 12 && hit(q, b.ma, b.ten, b.dia_chi)) out.push({ html: `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><small>${esc(b.dia_chi)}</small>`, pick: () => focusStore("bhx", j) }); });
    return out;
  }, { hideEmpty: true });

  // ---------- CSV ----------
  function downloadCsv(name, header, rows) {
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileTag = () => [S.chains.size === 1 ? [...S.chains][0].toLowerCase() : "nhieu_chuoi", S.tinh || "tat_ca_tinh", S.chuoi && S.chuoi.replace("+", "plus"), S.khu && (S.khu === "-" ? "chua_phan_loai" : S.khu)].filter(Boolean).join("_") + `_R${S.R}km`;

  // ---------- Thay đổi BHX ----------
  let CH = [];
  async function loadChanges() {
    const rad = Math.PI / 180;
    CH = (await API.getChanges()).map((e) => {
      const la = e.lat * rad, lo = e.lng * rad, c = Math.cos(la);
      let n2 = 0, best = Infinity;
      S.wm.forEach((w) => { const d = haversine(la, lo, c, w.lat * rad, w.lng * rad, Math.cos(w.lat * rad)); if (d <= 2) n2++; if (d < best) best = d; });
      return { ...e, chain: e.chain || "BHX", n2, near: best };
    });
    const ts = [...new Set(CH.map((e) => e.tinh))].sort();
    $("#c-tinh").innerHTML = `<option value="">Tất cả</option>` + ts.map((t) => `<option>${esc(t)}</option>`).join("");
    $("#c-chain").innerHTML = `<option value="">Tất cả</option>` + Object.entries(CHAINS).map(([c, v]) => `<option value="${c}">${esc(v.name)}</option>`).join("");
    renderChanges();
  }
  const TYPE = { open: "Mở mới", close: "Đóng cửa", move: "Dời vị trí" };
  function changeRows() {
    const t = $("#c-type").value, f = $("#c-from").value, p = $("#c-tinh").value, c = $("#c-chain").value;
    return CH.filter((e) => (!t || e.type === t) && (!f || e.date >= f) && (!p || e.tinh === p) && (!c || e.chain === c));
  }
  function renderChanges() {
    const rows = changeRows(), cnt = { open: 0, close: 0, move: 0 };
    rows.forEach((e) => cnt[e.type]++);
    $("#c-kpis").innerHTML = ["open", "close", "move"].map((k) => `<div class="card kpi"><span>${TYPE[k]}</span><b>${cnt[k]}</b></div>`).join("")
      + `<div class="card kpi"><span>Mở mới sát WM+ (≤ 2 km)</span><b>${rows.filter((e) => e.type === "open" && e.n2 > 0).length}</b><small>cần theo dõi</small></div>`;
    $("#t-changes tbody").innerHTML = rows.map((e) =>
      `<tr><td>${esc(e.date)}</td><td>${esc(chainName(e.chain))}</td><td><span class="tag ${e.type}">${TYPE[e.type]}</span></td><td>${esc(e.ma)}</td><td>${esc(e.dia_chi)}</td><td>${esc(e.tinh)}</td>
       <td class="num">${e.n2}</td><td class="num">${fmt(e.near, 3)}</td></tr>`).join("");
  }

  // ---------- Upload / Phân quyền ----------
  async function renderVersions() {
    $("#t-versions tbody").innerHTML = (await API.getVersions()).map((v) =>
      `<tr><td>${esc(v.version)}</td><td>${esc(v.uploaded)}</td><td>${esc(v.by)}</td><td class="num">${fmt(v.rows)}</td><td class="num">${v.added}</td><td class="num">${v.removed}</td><td class="num">${v.moved}</td><td>${esc(v.status)}</td></tr>`).join("");
  }
  const EVENT = { login: "Đăng nhập", resume: "Mở lại phiên", logout: "Đăng xuất", denied: '<span class="tag close">Bị từ chối — chưa cấp quyền</span>' };
  async function renderLog() {
    $("#t-log tbody").innerHTML = (await API.getAccessLog()).map((r) =>
      `<tr><td>${esc(new Date(r.at).toLocaleString("vi-VN"))}</td><td>${esc(r.email)}</td><td>${EVENT[r.event] || esc(r.event)}</td></tr>`).join("");
  }
  async function renderUsers() {
    $("#t-users tbody").innerHTML = (await API.listUsers()).map((u) =>
      `<tr><td>${esc(u.email)}</td><td>${u.role === "admin" ? "Admin" : "Viewer"}</td><td>${esc(u.added)}</td>
       <td>${u.email === S.user.email ? '<span class="muted small">bạn</span>' : `<button class="link" data-rm="${esc(u.email)}">Thu hồi</button>`}</td></tr>`).join("");
  }

  // ---------- Khởi động ----------
  function show(view) {
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "overview") setTimeout(() => map.invalidateSize(), 0);
  }
  async function start(user) {
    S.user = user;
    $("#login").hidden = true; $("#app").hidden = false;
    $("#demo-banner").hidden = API.mode !== "demo";
    $("#user-email").textContent = user.email;
    $("#user-role").textContent = user.role === "admin" ? "Admin" : "Viewer";
    document.querySelectorAll("[data-admin]").forEach((b) => (b.hidden = user.role !== "admin"));
    await applySettings();
    initMap();
    await loadData();
    if (user.role === "admin") { renderVersions(); renderUsers(); renderLog(); }
  }
  async function loadData() {
    const snap = await API.getSnapshot();
    S.wm = snap.wm.map((w) => ({ ...w, chuoi: w.chuoi || "WM+", khu_vuc: w.khu_vuc || "", dia_chi: w.dia_chi || "" }));
    S.all = snap.bhx.map((b) => ({ ...b, chain: "BHX" })).concat(snap.comp || []);
    S.bhx = S.all.filter((b) => S.chains.has(b.chain)); S.sel = null; S.tinh = ""; $("#tinh-q").value = "";
    try { S.compStatus = JSON.parse(snap.compStatus || "{}"); } catch (_) { S.compStatus = {}; }
    const left = snap.wmExpires ? (snap.wmExpires - Date.now()) / 3600e3 : 0;
    $("#snap-info").textContent = `${fmt(S.wm.length)} WM (${snap.wmVersion}`
      + (snap.wmExpires ? `, tự xoá ${snap.wmExpires.toLocaleString("vi-VN")} — còn ${fmt(Math.max(left, 0), 0)} giờ` : "")
      + `) · ${fmt(snap.bhx.length)} BHX, cập nhật ${snap.bhxUpdated}`
      + ((snap.comp || []).length ? ` · ${fmt(snap.comp.length)} cửa hàng chuỗi khác, cập nhật ${snap.compUpdated}` : "");
    computeAll(); fillProvinces();
    buildBhxAll(); buildWmMarkers(); renderOverview(); fitScope();
    if (!S.wm.length && !S.all.length) $("#snap-info").textContent = "Chưa có dữ liệu WM+ (chưa upload hoặc đã tự xoá sau 48 giờ) — Admin vào tab WM+ (upload) để tải file lên.";
    loadChanges();
  }

  // ---------- Upload WM+ ----------
  let UP = null;                                       // { wb, valid, diff }
  const listTable = (title, rows, cols) => !rows.length ? "" :
    `<details class="small"><summary>${title} (${fmt(rows.length)})</summary><div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>`
    + rows.slice(0, 300).map((r) => `<tr>${cols.map((c) => `<td>${esc(c[1](r))}</td>`).join("")}</tr>`).join("")
    + `</tbody></table></div>${rows.length > 300 ? `<p class="muted">Hiện 300 dòng đầu.</p>` : ""}</details>`;
  function analyzeSheet() {
    const p = WMUpload.parseSheet(UP.wb.Sheets[$("#up-sheet").value]);
    $("#up-result").hidden = false; $("#up-msg").textContent = "";
    if (p.error || p.missing.length) {
      const names = { ma: "Mã", tinh: "Tỉnh", lat: "Vĩ độ", lng: "Kinh độ" };
      $("#up-map").innerHTML = `<span class="err">${esc(p.error || "Thiếu cột: " + p.missing.map((k) => names[k]).join(", "))}</span>`;
      ["#up-kpis", "#up-issues", "#up-diff"].forEach((s) => ($(s).innerHTML = ""));
      $("#up-apply").disabled = true; return;
    }
    $("#up-map").innerHTML = `Tiêu đề ở dòng ${p.headerRow}. Cột dùng: ` + Object.entries(p.mapping).map(([k, ix]) => `<b>${k}</b> = <code>${esc(p.header[ix])}</code>`).join(" · ")
      + (p.mapping.ten === undefined ? ` · <span class="muted">không có cột Tên → dùng Mã làm Tên</span>` : "")
      + (p.mapping.chuoi === undefined ? ` · <span class="muted">không có cột Chuỗi → tất cả là ${esc($("#up-chuoi").value)}</span>` : "")
      + (p.mapping.khu_vuc === undefined ? ` · <span class="muted">không có cột Khu vực → để trống</span>` : "");
    const v = WMUpload.validate(p, $("#up-chuoi").value), d = WMUpload.diff(S.wm, v.ok);
    UP.valid = v.ok; UP.diff = d;
    const cnt = (f) => v.ok.filter(f).length;
    $("#up-kpis").innerHTML = [["Dòng hợp lệ", v.ok.length], ["Dòng lỗi (không đưa lên)", v.bad.length], ["Trùng mã", v.dups.length],
      ["Thêm mới", d.added.length], ["Không còn trong file", d.removed.length], ["Dời > 50 m", d.moved.length]]
      .map(([k, n]) => `<div class="card kpi"><span>${k}</span><b>${fmt(n)}</b></div>`).join("")
      + `<p class="small muted" style="grid-column:1/-1;margin:0">WM+ ${fmt(cnt((r) => r.chuoi === "WM+"))} · WMT ${fmt(cnt((r) => r.chuoi === "WMT"))} · Urban ${fmt(cnt((r) => r.khu_vuc === "Urban"))} · Rural ${fmt(cnt((r) => r.khu_vuc === "Rural"))} · chưa phân loại ${fmt(cnt((r) => !r.khu_vuc))}</p>`;
    $("#up-issues").innerHTML =
      listTable("Dòng lỗi — sẽ KHÔNG được đưa lên", v.bad, [["Dòng Excel", (r) => r.line], ["Mã", (r) => r.ma], ["Lý do", (r) => r.why], ["Lat", (r) => r.lat], ["Lng", (r) => r.lng]])
      + listTable("Trùng mã — phải sửa file trước khi áp dụng", v.dups, [["Dòng Excel", (r) => r.line], ["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh], ["Lat", (r) => r.lat], ["Lng", (r) => r.lng]]);
    $("#up-diff").innerHTML =
      listTable("WM thêm mới", d.added, [["Mã", (r) => r.ma], ["Chuỗi", (r) => r.chuoi], ["Tỉnh", (r) => r.tinh]])
      + listTable("WM không còn trong file (sẽ bỏ)", d.removed, [["Mã", (r) => r.ma], ["Chuỗi", (r) => r.chuoi], ["Tỉnh", (r) => r.tinh]])
      + listTable("WM dời vị trí > 50 m", d.moved, [["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh], ["Dời (km)", (r) => r.km.toFixed(3)]]);
    const block = v.dups.length ? "Có mã trùng — sửa file rồi chọn lại." : !v.ok.length ? "Không có dòng hợp lệ." : "";
    $("#up-apply").disabled = !!block; $("#up-msg").textContent = block;
  }
  $("#up-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      UP = { wb: WMUpload.readWorkbook(await f.arrayBuffer()) };
      $("#up-sheet").innerHTML = UP.wb.SheetNames.map((n) => `<option>${esc(n)}</option>`).join("");
      $("#up-sheet").disabled = UP.wb.SheetNames.length < 2;
      // Chọn sheet đầu tiên dò được đủ cột
      $("#up-sheet").value = UP.wb.SheetNames.find((n) => { const p = WMUpload.parseSheet(UP.wb.Sheets[n]); return !p.error && !p.missing.length; }) || UP.wb.SheetNames[0];
      analyzeSheet();
    } catch (err) { $("#up-result").hidden = false; $("#up-map").innerHTML = `<span class="err">Không đọc được file: ${esc(err.message)}</span>`; }
  });
  $("#up-sheet").addEventListener("change", analyzeSheet);
  $("#up-chuoi").addEventListener("change", () => UP && analyzeSheet());
  $("#up-cancel").addEventListener("click", () => { UP = null; $("#up-file").value = ""; $("#up-sheet").innerHTML = ""; $("#up-result").hidden = true; });
  $("#up-apply").addEventListener("click", async () => {
    const d = UP.diff, n = UP.valid.length;
    if (!confirm(`Lưu ${fmt(n)} WM thành phiên bản mới (thay toàn bộ danh sách cũ)?\nThêm ${d.added.length} · bỏ ${d.removed.length} · dời ${d.moved.length}.\nDữ liệu tự xoá sau 48 giờ.`)) return;
    $("#up-apply").disabled = true; $("#up-msg").textContent = "Đang lưu…";
    try {
      const r = await API.publishWm(UP.valid.map(({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi }) => ({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi })));
      $("#up-msg").textContent = `Đã lưu ${r.version}: ${fmt(r.rows)} WM.`;
      UP = null; $("#up-file").value = "";
      await loadData(); renderVersions();
    } catch (err) { $("#up-msg").textContent = "Lỗi: " + err.message; $("#up-apply").disabled = false; }
  });

  // Quyền xuất CSV: Admin luôn được; Viewer theo cài đặt. Chỉ là ẩn nút — Viewer vẫn xem được dữ liệu trên màn hình.
  async function applySettings() {
    const st = await API.getSettings();
    const viewerExport = st.viewer_can_export !== false;
    const can = S.user.role === "admin" || viewerExport;
    document.querySelectorAll("#exp-wm, #exp-bhx, #exp-pairs, #exp-changes").forEach((b) => (b.hidden = !can));
    $("#s-export").checked = viewerExport;
  }

  // Sự kiện
  let otpStep = false;
  function resetLogin(msg = "") {
    otpStep = false; $("#otp-row").hidden = true; $("#login-reset").hidden = true;
    $("#login-email").disabled = false; $("#login-otp").value = "";
    $("#login-btn").textContent = "Gửi mã đăng nhập"; $("#login-msg").textContent = msg;
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim().toLowerCase(), btn = $("#login-btn");
    btn.disabled = true;
    try {
      if (!otpStep) {
        await API.requestOtp(email);
        otpStep = true; $("#otp-row").hidden = false; $("#login-reset").hidden = false; $("#login-email").disabled = true;
        btn.textContent = "Đăng nhập"; $("#login-otp").focus();
        $("#login-msg").textContent = API.mode === "demo" ? "Demo: không gửi mail, nhập mã bất kỳ." : "Đã gửi mã tới email. Kiểm tra cả mục Spam; mã hết hạn sau ít phút.";
      } else {
        await start(await API.signIn(email, $("#login-otp").value.trim()));
      }
    } catch (err) {
      // Lỗi "chưa được cấp quyền" → quay về bước nhập email
      if (/cấp quyền/.test(err.message)) resetLogin(err.message); else $("#login-msg").textContent = err.message;
    } finally { btn.disabled = false; }
  });
  $("#login-reset").addEventListener("click", () => resetLogin());
  $("#log-refresh").addEventListener("click", renderLog);
  $("#s-export").addEventListener("change", async (e) => { await API.setSetting("viewer_can_export", e.target.checked); $("#u-msg").textContent = "Đã lưu cài đặt."; });
  $("#logout").addEventListener("click", async () => { await API.signOut(); location.reload(); });
  $("#tabs").addEventListener("click", (e) => { if (e.target.dataset.view) show(e.target.dataset.view); });
  $("#r").addEventListener("input", (e) => setR(e.target.value));
  $("#r-num").addEventListener("change", (e) => setR(e.target.value));
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.all) {                               // Tất cả ↔ về lại chỉ BHX
      const has = Object.keys(CHAINS).filter((c) => S.all.some((x) => x.chain === c));
      S.chains = new Set(has.every((c) => S.chains.has(c)) ? ["BHX"] : has);
    } else if (S.chains.has(b.dataset.c)) { if (S.chains.size > 1) S.chains.delete(b.dataset.c); }   // luôn giữ ít nhất 1 chuỗi
    else S.chains.add(b.dataset.c);
    applyChains();
  });
  $("#chuoi").addEventListener("change", (e) => { S.chuoi = e.target.value; S.sel = null; renderOverview(); fitScope(); });
  $("#khu").addEventListener("change", (e) => { S.khu = e.target.value; S.sel = null; renderOverview(); fitScope(); });
  $("#q").addEventListener("input", (e) => { S.q = plain(e.target.value.trim()); renderWmTable(scopeIdx()); renderBhxTable(); });
  // Phủ kín cửa sổ bằng CSS, không phụ thuộc quyền fullscreen của trình duyệt.
  function setMapMax(on) {
    $("#map-card").classList.toggle("map-max", on);
    document.body.style.overflow = on ? "hidden" : "";
    $("#map-full").textContent = on ? "✕ Thoát toàn màn hình" : "⛶ Toàn màn hình";
    setTimeout(() => map.invalidateSize(), 50);
  }
  $("#map-full").addEventListener("click", () => setMapMax(!$("#map-card").classList.contains("map-max")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#map-card").classList.contains("map-max")) setMapMax(false); });
  $("#bars").addEventListener("click", (e) => {
    const r = e.target.closest(".bar-row"); if (!r) return;
    setProv(S.tinh === r.dataset.t ? "" : r.dataset.t);
  });
  $("#t-wm").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (th) { S.sortDir = S.sortK === th.dataset.k ? -S.sortDir : (th.dataset.k === "n" ? -1 : 1); S.sortK = th.dataset.k; renderWmTable(scopeIdx()); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) select(+tr.dataset.i);
  });
  $("#t-bhx").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-j]"); if (tr) focusStore("bhx", +tr.dataset.j); });
  $("#pair-hint").addEventListener("click", (e) => { if (e.target.id === "clear-sel") select(S.sel); });
  $("#exp-wm").addEventListener("click", () => downloadCsv(`wm_${fileTag()}.csv`, ["Mã WM", "Tên WM", "Chuỗi", "Khu vực", "Địa chỉ", "Tỉnh", "Bán kính (km)", `Số ${lab()} trong R`, `${lab()} gần nhất (km)`, "Lat WM", "Lng WM"],
    wmRows(scopeIdx()).map((r) => [r.ma, r.ten, r.chuoi, r.khu_vuc, S.wm[r.i].dia_chi, r.tinh, S.R, r.n, r.near, S.wm[r.i].lat, S.wm[r.i].lng])));
  $("#exp-bhx").addEventListener("click", () => downloadCsv(`doithu_${fileTag()}.csv`, ["Đối thủ", "Mã", "Tên", "Địa chỉ", "Tỉnh", "Lat", "Lng", "Bán kính (km)", "Số WM trong R", "WM gần nhất", "Chuỗi WM gần nhất", "Khoảng cách WM gần nhất (km)"],
    bhxRows().map((r) => [chainName(r.b.chain), r.b.ma, r.b.ten || "", r.b.dia_chi, r.b.tinh, r.b.lat, r.b.lng, S.R, r.n, r.w ? r.w.ma : "", r.w ? r.w.chuoi : "", r.d ?? ""])));
  $("#exp-pairs").addEventListener("click", () => downloadCsv(`pairs_${fileTag()}.csv`, ["Mã WM", "Chuỗi", "Khu vực", "Tỉnh", "Đối thủ", "Mã đối thủ", "Địa chỉ đối thủ", "Khoảng cách (km)", "Lat đối thủ", "Lng đối thủ"],
    pairRows(scopeIdx()).map((r) => [r.wm.ma, r.wm.chuoi, r.wm.khu_vuc, r.wm.tinh, chainName(r.b.chain), r.b.ma, r.b.dia_chi, r.d, r.b.lat, r.b.lng])));
  ["#c-chain", "#c-type", "#c-from", "#c-tinh"].forEach((s) => $(s).addEventListener("input", renderChanges));
  $("#exp-changes").addEventListener("click", () => downloadCsv("bhx_thay_doi.csv", ["Ngày", "Đối thủ", "Loại", "Mã", "Địa chỉ", "Tỉnh", "WM+ trong 2 km", "WM+ gần nhất (km)", "Lat", "Lng"],
    changeRows().map((e) => [e.date, chainName(e.chain), TYPE[e.type], e.ma, e.dia_chi, e.tinh, e.n2, e.near.toFixed(3), e.lat, e.lng])));
  $("#add-user").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await API.addUser($("#u-email").value.trim().toLowerCase(), $("#u-role").value); $("#u-email").value = ""; $("#u-msg").textContent = "Đã cấp quyền."; renderUsers(); }
    catch (err) { $("#u-msg").textContent = err.message; }
  });
  $("#t-users").addEventListener("click", async (e) => {
    const em = e.target.dataset.rm; if (!em || !confirm(`Thu hồi quyền của ${em}?`)) return;
    try { await API.removeUser(em); $("#u-msg").textContent = "Đã thu hồi quyền."; renderUsers(); }
    catch (err) { $("#u-msg").textContent = err.message; }
  });

  // Còn phiên đăng nhập (trong cùng tab) → vào thẳng
  API.currentUser().then((u) => u && start(u)).catch((err) => ($("#login-msg").textContent = err.message));
})();
