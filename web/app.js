// WM+ ↔ BHX — giao diện. Tính khoảng cách ngay trên trình duyệt (nearby.js, cùng công thức với wm_bhx_match.py).
(function () {
  const CFG = window.APP_CONFIG;
  const API = CFG.mode === "demo" ? window.DemoAPI : window.GasAPI;
  const R_MAX = 30, TOP_MIN = 10, TABLE_CELLS = 200000;
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
  let S = { user: null, wm: [], all: [], bhx: [], chains: new Set(["BHX"]), compStatus: {}, near: null, nearIdx: null, pairsBy: null, Rcalc: 0, R: 1, topBy: null, topN: 5,
    mien: new Set(), vung: new Set(), tinh: new Set(), quan: new Set(), phuong: new Set(), khu: new Set(), chuoi: "", q: "", sel: null, sortK: "n", sortDir: -1 };

  // ---------- Tính toán ----------
  // Lưu sẵn các cặp WM–BHX trong bán kính Rcalc (≥ 5 km, tự tăng khi kéo R lớn hơn) và K đối thủ gần nhất, không phụ thuộc R.
  function computeAll() {
    S.Rcalc = Math.max(CFG.maxRadiusKm, Math.ceil(S.R));
    S.topK = Math.max(TOP_MIN, S.topN);
    const r = Nearby.matrix(S.wm, S.bhx, S.topK, S.Rcalc);
    S.near = r.near; S.nearIdx = r.nearIdx; S.pairsBy = r.pairsBy; S.topBy = r.topBy;
    nearB = null;
  }
  const countIn = (list, R) => { let k = 0; while (k < list.length && list[k][1] <= R) k++; return k; };
  // Khoá tỉnh: bỏ dấu, bỏ tiền tố "Tỉnh/TP./Thành phố" → "TP. Hồ Chí Minh" (BHX) khớp "Hồ Chí Minh" (file WM+).
  const provKey = (t) => plain(t).replace(/^\s*(thanh pho|tinh|tp\.?|t\.)\s*/, "").replace(/[^a-z0-9]/g, "").replace(/^hcm$/, "hochiminh");
  // Miền, Vùng lấy từ các cột cùng tên của file WM+. Đối thủ không có các cột này nên suy theo tỉnh: tỉnh thuộc 1 vùng → vùng đó;
  // tỉnh chia nhiều vùng → vùng của WM gần nhất trong tỉnh; tỉnh không có WM → chưa rõ ("-"). Miền tính độc lập theo cùng quy tắc.
  let WM_IN_PROV = {};
  function regionAt(x, dim) {
    const list = WM_IN_PROV[dim].get(provKey(x.tinh));
    return list ? nearestOf(x, list, dim) : "-";
  }
  function nearestOf(x, list, dim) {
    const c = Math.cos(x.lat * Math.PI / 180);
    let best = list[0], min = Infinity;
    if (list.some((w) => w[dim] !== best[dim])) list.forEach((w) => {
      const d = (w.lat - x.lat) ** 2 + ((w.lng - x.lng) * c) ** 2;
      if (d < min) { min = d; best = w; }
    });
    return best[dim];
  }
  const byViName = (a, b) => a.t.localeCompare(b.t, "vi", { numeric: true });
  const optList = (wms, rows, dim) => [...new Set(wms.map((w) => w[dim]))].filter((v) => v !== "-").map((v) => ({ v, t: v })).sort(byViName)
    .concat(rows.some((x) => x[dim] === "-") ? [{ v: "-", t: "Chưa rõ" }] : []);
  const toOptions = (list) => `<option value="">Tất cả</option>` + list.map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("");
  // Tên quận, phường trong file WM+ dạng biểu thức tìm trong địa chỉ. Tên chỉ 1 từ hoặc là số thì giữ cả chữ "Quận", "Phường", kẻo khớp nhầm số nhà, tên đường.
  function namesRe(wms, dim) {
    return [...new Set(wms.map((w) => w[dim]))].sort((a, b) => b.length - a.length).map((name) => {
      const full = plain(name).trim(), short = full.replace(/^(quan|huyen|thi xa|thanh pho|tp\.?|phuong|xa|thi tran)\s+/, "");
      const pick = short.includes(" ") ? short : full;
      return { name, re: new RegExp("(^|[^a-z0-9])" + pick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])") };
    });
  }
  // Quận, phường của đối thủ: ưu tiên tên ghi trong địa chỉ (theo file WM+ của tỉnh đó), không có thì theo WM gần nhất.
  // Phường chỉ xét trong quận của đối thủ, vì tên như "Phường 1" lặp lại giữa các quận.
  function assignQuanPhuong() {
    const quanRe = new Map(), inQ = new Map();
    WM_IN_PROV.quan.forEach((wms, k) => quanRe.set(k, namesRe(wms, "quan")));
    WM_IN_PROV.phuong.forEach((wms, k) => {
      inQ.set(k, { wms, re: namesRe(wms, "phuong") });
      const byQ = new Map();
      wms.forEach((w) => { if (!byQ.has(w.quan)) byQ.set(w.quan, []); byQ.get(w.quan).push(w); });
      byQ.forEach((list, q) => inQ.set(k + "|" + q, { wms: list, re: namesRe(list, "phuong") }));
    });
    S.all.forEach((b) => {
      const k = provKey(b.tinh), a = plain(b.dia_chi), found = (list) => (a && list ? (list.find((q) => q.re.test(a)) || {}).name : undefined);
      b.quan = found(quanRe.get(k)) || regionAt(b, "quan");
      const box = inQ.get(k + "|" + b.quan) || inQ.get(k);
      b.phuong = box ? found(box.re) || nearestOf(b, box.wms, "phuong") : "-";
    });
  }
  function buildRegions() {
    ["mien", "vung", "quan", "phuong"].forEach((dim) => {
      const m = WM_IN_PROV[dim] = new Map();
      S.wm.forEach((w) => { if (w[dim] === "-") return; const k = provKey(w.tinh); if (!m.has(k)) m.set(k, []); m.get(k).push(w); });
      if (dim === "mien" || dim === "vung") S.all.forEach((b) => (b[dim] = regionAt(b, dim)));
    });
    assignQuanPhuong();
    const rows = S.wm.concat(S.all);
    OPT.mien = optList(S.wm, rows, "mien");
    $("#c-mien").innerHTML = toOptions(OPT.mien);
    $("#c-vung").innerHTML = toOptions(optList(S.wm, rows, "vung"));
    // Khu vực: liệt kê đúng các giá trị có trong file, kèm số cửa hàng, để không có giá trị nào bị lọc mất.
    const nKhu = new Map();
    S.wm.forEach((w) => nKhu.set(w.khu_vuc || "-", (nKhu.get(w.khu_vuc || "-") || 0) + 1));
    OPT.khu = [...nKhu].sort((a, b) => (a[0] === "-") - (b[0] === "-") || a[0].localeCompare(b[0])).map(([v, n]) => ({ v, t: `${v === "-" ? "Chưa phân loại" : v} (${fmt(n)})` }));
  }
  // Các ô lọc chọn được nhiều giá trị (S[dim] là Set, rỗng = tất cả). OPT giữ danh sách đang chọn được,
  // các ô sau chỉ liệt kê phần thuộc ô trước; giá trị không còn trong danh sách thì bỏ.
  const OPT = { mien: [], vung: [], quan: [], phuong: [], khu: [] };
  const inSet = (set, v) => !set.size || set.has(v);
  const setKey = (set) => [...set].sort().join(",");
  const optLabels = (dim) => OPT[dim].filter((o) => S[dim].has(o.v)).map((o) => o.t);
  const boxText = (set, labels) => (set.size > 1 ? `${fmt(set.size)} đã chọn` : labels[0] || "");
  // Đang mở danh sách thì ô để trống cho gõ tìm; đóng lại mới hiện giá trị đã chọn.
  function syncBox(dim) {
    const el = $(`#${dim}-q`);
    if (!el.dataset.open) el.value = boxText(S[dim], optLabels(dim));
  }
  function syncTinh() {
    const el = $("#tinh-q");
    if (!el.dataset.open) el.value = boxText(S.tinh, [...S.tinh].map(provName));
  }
  function setOpts(dim, list) {
    OPT[dim] = list;
    const have = new Set(list.map((o) => o.v));
    S[dim].forEach((v) => { if (!have.has(v)) S[dim].delete(v); });
    syncBox(dim);
  }
  function fillVung() {
    const inM = (x) => inSet(S.mien, x.mien);
    setOpts("mien", OPT.mien); setOpts("khu", OPT.khu);
    setOpts("vung", optList(S.wm.filter(inM), S.wm.concat(S.all).filter(inM), "vung"));
  }
  // Tên khu vực đang lọc cho dòng chú thích: tối đa 2 tên, nhiều hơn thì ghi số lượng.
  const listName = (names) => (names.length > 2 ? `${names.slice(0, 2).join(", ")} và ${fmt(names.length - 2)} nơi khác` : names.join(", "));
  const whereName = () => {
    const pick = S.phuong.size ? optLabels("phuong") : S.quan.size ? optLabels("quan") : S.tinh.size ? [...S.tinh].map(provName) : optLabels("vung").concat(optLabels("mien"));
    return listName(pick.map((t) => (t === "Chưa rõ" ? "nơi chưa rõ" : t)));
  };
  const inVung = (x) => inSet(S.mien, x.mien) && inSet(S.vung, x.vung);
  const inTinh = (x) => inSet(S.tinh, provKey(x.tinh));
  // Các tỉnh còn lại sau khi lọc Miền/Vùng
  const provsInRegion = () => new Set(S.wm.concat(S.all).filter(inVung).map((x) => provKey(x.tinh)));
  // Tên quận trùng nhau giữa các tỉnh nên khoá gồm cả tỉnh.
  const quanKey = (x) => provKey(x.tinh) + "|" + x.quan;
  const inQuan = (x) => !S.quan.size || S.quan.has(x.quan === "-" ? "-" : quanKey(x));
  // Tên phường trùng giữa các quận, các tỉnh nên khoá gồm cả tỉnh và quận.
  const phuongKey = (x) => quanKey(x) + "|" + x.phuong;
  const inPhuong = (x) => !S.phuong.size || S.phuong.has(x.phuong === "-" ? "-" : phuongKey(x));
  const keyedOpts = (rows, dim, keyOf, labelOf) => {
    const names = new Map();
    rows.forEach((x) => { if (x[dim] !== "-" && x.chuoi) names.set(keyOf(x), labelOf(x)); });   // chỉ WM mới có cột chuoi; danh sách lấy theo file WM+
    return [...names].map(([v, t]) => ({ v, t })).sort(byViName).concat(rows.some((x) => x[dim] === "-") ? [{ v: "-", t: "Chưa rõ" }] : []);
  };
  function fillQuan() {
    const ok = (x) => inVung(x) && inTinh(x);
    setOpts("quan", keyedOpts(S.wm.concat(S.all).filter(ok), "quan", quanKey, (w) => w.quan + (S.tinh.size === 1 ? "" : " · " + provName(provKey(w.tinh)))));
    fillPhuong();
  }
  function fillPhuong() {
    const ok = (x) => inVung(x) && inQuan(x) && inTinh(x);
    setOpts("phuong", keyedOpts(S.wm.concat(S.all).filter(ok), "phuong", phuongKey, (w) => w.phuong
      + (S.quan.size === 1 || w.quan === "-" ? "" : " · " + w.quan) + (S.tinh.size === 1 ? "" : " · " + provName(provKey(w.tinh)))));
  }
  const inProv = (x) => inVung(x) && inQuan(x) && inPhuong(x) && inTinh(x);
  const wmAttrOk = (w) => (!S.chuoi || w.chuoi === S.chuoi) && inSet(S.khu, w.khu_vuc || "-");
  const pressOk = (w) => !S.chuoi || w.chuoi === S.chuoi;   // Pressure lọc theo chuỗi, bỏ qua Khu vực
  const scopeIdx = () => S.wm.map((_, i) => i).filter((i) => wmAttrOk(S.wm[i]) && inProv(S.wm[i]));
  const bhxScope = () => S.bhx.map((_, j) => j).filter((j) => inProv(S.bhx[j]));
  const hit = (q, ...f) => !q || f.some((v) => plain(v).includes(q));

  // Với mỗi BHX: WM gần nhất (theo Chuỗi/Khu vực đang lọc, mọi tỉnh) — dùng cho bảng BHX, popup, xuất CSV.
  let nearB = null, nearBKey = "";
  function bhxNearest() {
    const key = S.chuoi + "|" + setKey(S.khu);
    if (nearB && nearBKey === key) return nearB;
    const W = S.wm.map((w, i) => i).filter((i) => wmAttrOk(S.wm[i])), grid = Nearby.index(W.map((i) => S.wm[i]));
    const d = new Float64Array(S.bhx.length).fill(Infinity), ix = new Int32Array(S.bhx.length).fill(-1);
    S.bhx.forEach((b, j) => {
      const best = Nearby.search(grid, b.lat, b.lng, 1, 0)[0];
      if (best) { d[j] = best[1]; ix[j] = W[best[0]]; }
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
  // Mở trong tab mới; web không gọi Google cho tới khi người dùng bấm. Không ghi đường dẫn trang này vào Referer.
  const gmapLinks = (s) => `<div class="gmap-links"><a href="https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lng}" target="_blank" rel="noopener noreferrer">Xem trên Google Maps</a>`
    + `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat}%2C${s.lng}" target="_blank" rel="noopener noreferrer">Street View</a></div>`;
  function bhxInfo(j) {
    const b = S.bhx[j], nb = bhxNearest(), w = nb.ix[j] >= 0 ? S.wm[nb.ix[j]] : null;
    return `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><br>${esc(b.dia_chi)}<br><span class="muted">${esc(b.tinh)}</span><hr>`
      + `WM trong ${fmt(S.R, S.R % 1 ? 1 : 0)} km: <b>${CNT_B ? CNT_B[j] : 0}</b><br>`
      + (w ? `WM gần nhất: <b>${esc(w.ma)}</b> (${esc(w.chuoi)}) · ${fmt(nb.d[j], 2)} km` : "Chưa có WM trong bộ lọc") + gmapLinks(b);
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
    map = L.map("map", { preferCanvas: true, renderer: L.canvas({ tolerance: 5 }), scrollWheelZoom: false }).setView([20.8, 106.2], 9);
    wheelGuard();
    // OSM chặn tile (403) nếu thiếu Referer; trang đặt no-referrer → riêng tile gửi origin (chỉ tên miền, không đường dẫn).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 18, attribution: "© OpenStreetMap", referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
    bhxLayer = L.layerGroup().addTo(map); ringLayer = L.layerGroup().addTo(map); noteLayer = L.layerGroup().addTo(map);
    map.on("popupclose", () => (popupClosedAt = Date.now()));
    syncPick(); rtHint();
  }
  // Lăn chuột là cuộn trang, không làm bản đồ đổi cỡ. Phóng to/thu nhỏ: giữ Ctrl khi lăn, chụm 2 ngón trên touchpad, nút +/−, hoặc lăn tự do khi toàn màn hình.
  function wheelGuard() {
    let timer = 0;
    map.getContainer().addEventListener("wheel", (e) => {
      const hint = $("#map-hint");
      if (e.ctrlKey || e.metaKey || $("#map-card").classList.contains("map-max")) {
        e.preventDefault(); map.scrollWheelZoom.enable(); hint.hidden = true; return;
      }
      map.scrollWheelZoom.disable();
      hint.hidden = false; clearTimeout(timer); timer = setTimeout(() => (hint.hidden = true), 1500);
    }, { capture: true, passive: false });
  }
  // Ghi chú trên bản đồ: % WM có đối thủ trong R và Pressure của từng tỉnh, đặt ở tâm các WM của tỉnh đó. Bấm để lọc tỉnh.
  let noteLayer, showNotes = true;
  function renderNotes(scope) {
    noteLayer.clearLayers();
    if (!showNotes) return;
    const nBhx = new Map(), nWm = new Map(), inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    S.bhx.filter((b) => inVung(b) && inQuan(b) && inPhuong(b)).forEach((b) => inc(nBhx, provKey(b.tinh)));
    S.wm.filter((w) => pressOk(w) && inVung(w) && inQuan(w) && inPhuong(w)).forEach((w) => inc(nWm, provKey(w.tinh)));
    const by = new Map();
    scope.forEach((i) => {
      const w = S.wm[i], k = provKey(w.tinh);
      if (!by.has(k)) by.set(k, { hit: 0, n: 0, lat: 0, lng: 0 });
      const p = by.get(k); p.n++; p.lat += w.lat; p.lng += w.lng; if (S.near[i] <= S.R) p.hit++;
    });
    by.forEach((p, k) => L.tooltip({ permanent: true, interactive: true, direction: "center", className: "prov-note" })
      .setLatLng([p.lat / p.n, p.lng / p.n])
      .setContent(`${esc(provName(k))}<br><small>Có đối thủ</small> <b>${pct(p.hit / p.n)}</b> <small>${fmt(p.hit)}/${fmt(p.n)} WM</small>`
        + `<br><small>Pressure</small> <b>${nWm.get(k) ? pct((nBhx.get(k) || 0) / nWm.get(k)) : "–"}</b> <small>${fmt(nBhx.get(k) || 0)} ÷ ${fmt(nWm.get(k) || 0)}</small>`)
      .on("click", () => toggleProv(k)).addTo(noteLayer));
  }
  // Lớp nền: toàn bộ BHX đang mở (chấm xám) — luôn hiện, kể cả khi chưa có WM+; lọc theo tỉnh. Bấm → popup thông tin.
  function buildBhxAll() {
    if (bhxAllLayer) bhxAllLayer.remove();
    // BHX rất nhiều nên chấm nhỏ, nhạt; các chuỗi khác ít hơn nên chấm to, viền trắng để không bị lẫn (BHX vẽ trước, nằm dưới).
    bhxAllMarkers = S.bhx.map((b, j) => L.circleMarker([b.lat, b.lng], (b.chain === "BHX"
      ? { radius: 3, weight: 0, fillOpacity: 0.45, bubblingMouseEvents: false } : { radius: 5, weight: 1, color: "#fff", fillOpacity: 0.85, bubblingMouseEvents: false }))
      .setStyle({ fillColor: (CHAINS[b.chain] || CHAINS.BHX).color })
      .bindTooltip(storeTip(b)).bindPopup(() => bhxInfo(j)));
    bhxAllLayer = L.layerGroup().addTo(map);          // thêm trước WM+ → nằm dưới
  }
  function renderBhxAll() {
    bhxAllLayer.clearLayers();
    S.bhx.forEach((b, j) => { if (inProv(b)) bhxAllLayer.addLayer(bhxAllMarkers[j]); });
  }
  // Thu phóng vừa bộ lọc (WM + đối thủ của tỉnh); không lọc tỉnh → vừa WM, chưa có WM thì vừa toàn bộ đối thủ.
  function fitScope() {
    let pts = scopeIdx().map((i) => S.wm[i]);
    if (S.tinh.size || S.quan.size || S.phuong.size || S.mien.size || S.vung.size) pts = pts.concat(S.bhx.filter(inProv)); else if (!pts.length) pts = S.bhx;
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [20, 20], maxZoom: 14 });
  }
  // Đổi khu vực lọc: đang có tuyến thì buildRoute đã lo khung nhìn. Đang tích trong danh sách chọn nhiều thì đợi đóng danh sách mới đưa bản đồ tới, một lần.
  let pendingFit = false;
  const listOpen = () => !!document.activeElement && document.activeElement.dataset.open === "1";
  function areaFit() {
    if (listOpen()) { pendingFit = true; return; }
    if (!RT || !RT.stops.length) fitScope();
  }
  function afterListClose() {
    if (RT && RT.key !== routeKey()) buildRoute(RT.start, RT.name, true);
    if (pendingFit) { pendingFit = false; areaFit(); }
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
  function clearRegion() { S.mien.clear(); S.vung.clear(); fillVung(); fillQuan(); }
  function regionChanged() {
    S.sel = null; fillVung();
    const keep = provsInRegion();
    S.tinh.forEach((k) => { if (!keep.has(k)) S.tinh.delete(k); });   // tỉnh đang chọn không thuộc miền/vùng mới
    syncTinh(); fillQuan(); renderOverview(); areaFit();
  }
  function provsChanged() { S.sel = null; syncTinh(); fillQuan(); renderOverview(); areaFit(); }
  // Chọn tỉnh ngoài vùng (bấm ghi chú, bấm thanh %, tìm cửa hàng) → bỏ lọc vùng.
  function toggleProv(k) {
    if (S.tinh.has(k)) S.tinh.delete(k);
    else { if (!provsInRegion().has(k)) clearRegion(); S.tinh.add(k); }
    provsChanged();
  }
  function setProv(k) {
    S.tinh.clear();
    if (k) { if (!provsInRegion().has(k)) clearRegion(); S.tinh.add(k); }
    provsChanged();
  }
  function buildWmMarkers() {                         // gọi lại mỗi khi danh sách WM+ đổi (upload)
    wmMarkers.forEach((mk) => mk.remove());
    wmMarkers = S.wm.map((w, i) => L.circleMarker([w.lat, w.lng], { radius: 5, weight: w.chuoi === "WMT" ? 2.5 : 1, color: w.chuoi === "WMT" ? getVar("--wmt") : "#fff", fillOpacity: 0.9, bubblingMouseEvents: false })
      .bindTooltip(() => wmInfo(i)).on("click", () => select(i, true)));
  }
  function renderMap(scope) {
    const inScope = new Set(scope);
    wmMarkers.forEach((mk, i) => {
      if (!inScope.has(i)) { mk.remove(); return; }
      mk.addTo(map).setStyle({ fillColor: S.near[i] <= S.R ? getVar("--wm-hit") : getVar("--wm-free"), radius: S.sel === i ? 9 : 5 });
    });
    if (RT && RT.key !== routeKey() && !listOpen()) buildRoute(RT.start, RT.name, true);     // đổi bộ lọc thì tính lại tuyến từ cùng điểm xuất phát; đang tích nhiều mục thì đợi đóng danh sách
    renderNotes(scope); renderBhxAll(); bhxLayer.clearLayers(); ringLayer.clearLayers();
    const src = S.sel != null ? [S.sel] : scope, seen = new Set();
    src.forEach((i) => S.pairsBy[i].forEach(([j, d]) => {
      if (d > S.R || seen.has(j)) return; seen.add(j);
      const b = S.bhx[j];
      L.circleMarker([b.lat, b.lng], { radius: b.chain === "BHX" ? 4 : 6, weight: b.chain === "BHX" ? 0 : 1.5, color: "#fff", fillColor: (CHAINS[b.chain] || CHAINS.BHX).color, fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(storeTip(b)).bindPopup(() => bhxInfo(j)).addTo(bhxLayer);
    }));
    if (S.sel != null) {
      const w = S.wm[S.sel];
      L.circle([w.lat, w.lng], { radius: S.R * 1000, color: getVar("--wm-hit"), weight: 1.5, fillOpacity: 0.05, interactive: false }).addTo(ringLayer);
    }
  }
  const getVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- Lập tuyến ----------
  // Chọn N cửa hàng (WM, đối thủ đang bật, hoặc cả hai) gần điểm xuất phát nhất trong bộ lọc, rồi xếp thứ tự đi ngắn nhất theo đường thẳng (không gửi toạ độ đi đâu).
  // Mỗi link Google nhận tối đa 10 điểm nên tuyến dài chia thành nhiều chặng.
  const GMAP_STOPS = 10;
  const RT_HINT = "Nhập điểm xuất phát rồi bấm Lập tuyến, hoặc bấm một điểm trên bản đồ.";
  let RT = null, rtLayer = null, popupClosedAt = 0;
  const filterKey = () => [S.mien, S.vung, S.tinh, S.quan, S.phuong, S.khu].map(setKey).concat(S.chuoi).join("|");
  const routeKey = () => [filterKey(), S.R, [...S.chains].sort().join(), $("#rt-n").value, $("#rt-nc").value, $("#rt-mode").value].join("|");
  const rtHint = () => ($("#rt-msg").textContent = RT_HINT);
  // Mỗi lần bấm chỗ trống trên bản đồ là lập lại tuyến từ điểm đó; bấm để đóng popup thì bỏ qua. Bấm đúp là phóng to, không lập tuyến.
  function syncPick() {
    $("#map").classList.add("rt-arm");
    let timer = 0;
    map.on("click", (e) => {
      clearTimeout(timer);
      if (Date.now() - popupClosedAt > 300) timer = setTimeout(() => buildRoute({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }, "", true), 280);
    });
    map.on("dblclick", () => clearTimeout(timer));
  }
  function clearRoute() {
    RT = null;
    if (rtLayer) rtLayer.clearLayers();
    $("#rt-result").hidden = true; $("#rt-clear").hidden = true; rtHint();
  }
  // N điểm gần xuất phát nhất trong list. Số WM và số đối thủ chọn riêng, tổng không quá ROUTE_MAX (giới hạn của backend).
  const ROUTE_MAX = 50;
  const nearestStops = (list, start, n) => (n ? Nearby.search(Nearby.index(list.map((t) => t.s)), start.lat, start.lng, n, 0).slice(0, n).map(([k]) => list[k]) : []);
  function routeTargets(start) {
    const count = (id, max) => { const n = Math.max(0, Math.min(max, Math.floor(+$(id).value) || 0)); $(id).value = n; return n; };
    const nW = count("#rt-n", ROUTE_MAX), nC = count("#rt-nc", ROUTE_MAX - nW);
    const wm = scopeIdx().filter((i) => S.wm[i] !== start).map((i) => ({ s: S.wm[i], i }));
    // Đối thủ lấy đúng các chấm đang hiện trên bản đồ: trong bộ lọc, hoặc trong bán kính của WM đang lọc.
    const shown = new Set(bhxScope());
    scopeIdx().forEach((i) => { for (const [j, d] of S.pairsBy[i]) { if (d > S.R) break; shown.add(j); } });
    const comp = [...shown].filter((j) => S.bhx[j] !== start).map((j) => ({ s: S.bhx[j], i: -1 }));
    return nearestStops(wm, start, nW).concat(nearestStops(comp, start, nC));
  }
  const stopCount = () => {
    const w = RT.stops.filter((x) => x.i >= 0).length, c = RT.stops.length - w;
    return [w ? `${fmt(w)} WM` : "", c ? `${fmt(c)} đối thủ` : ""].filter(Boolean).join(" + ");
  };
  // Toạ độ gõ tay hoặc nằm trong link Google Maps (@vĩ,kinh hoặc !3d vĩ !4d kinh); ngoài Việt Nam thì bỏ qua.
  function parseLatLng(s) {
    const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s) || /(-?\d{1,2}\.\d+)(?:\s*,\s*|%2C|\s+)(-?\d{2,3}\.\d+)/i.exec(s);
    if (!m) return null;
    const lat = +m[1], lng = +m[2];
    return lat >= 8 && lat <= 24.5 && lng >= 102 && lng <= 110 ? { lat, lng } : null;
  }
  // Chỉ gửi đúng chuỗi người dùng gõ, và chỉ khi họ bấm tìm. Không gửi danh sách hay toạ độ cửa hàng.
  let rtGeo = { q: "", list: [] }, geoTicket = 0;
  // Không thấy địa chỉ đầy đủ thì bỏ dần phần đầu (số nhà, thôn), tối đa 3 lần; khoảng nghỉ theo giới hạn 1 yêu cầu/giây của dịch vụ. Kết quả khi đó ghi rõ là gần đúng.
  async function geocode(q) {
    const msg = $("#rt-msg"), ticket = ++geoTicket;
    let parts = q.split(",").map((s) => s.trim()).filter(Boolean);
    msg.textContent = "Đang tìm địa chỉ trên OpenStreetMap…";
    try {
      for (let tried = 0; tried < 3 && parts.length; tried++) {
        if (tried) await new Promise((ok) => setTimeout(ok, 1100));
        const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=vn&limit=5&accept-language=vi&q=" + encodeURIComponent(parts.join(", ")),
          { credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
        if (ticket !== geoTicket) return;
        if (!r.ok) throw new Error();
        const list = await r.json();
        if (ticket !== geoTicket) return;
        const near = tried ? "Gần đúng, không thấy địa chỉ đầy đủ: " : "";
        if (list.length === 1) { buildRoute({ lat: +list[0].lat, lng: +list[0].lon }, near + list[0].display_name); return; }
        if (list.length) {
          rtGeo = { q, list: list.map((g) => ({ ...g, display_name: near + g.display_name })) };
          msg.textContent = "Chọn đúng địa chỉ trong danh sách.";
          $("#rt-addr").focus();
          $("#rt-addr").dispatchEvent(new Event("input"));   // ô đã có sẵn focus thì focus() không vẽ lại danh sách
          return;
        }
        parts = parts.slice(1);
      }
      msg.textContent = "Không tìm thấy địa chỉ này. Hãy dán link hoặc toạ độ từ Google Maps, hoặc bấm một điểm trên bản đồ.";
    } catch (_) { if (ticket === geoTicket) msg.textContent = "Chưa tìm được địa chỉ. Thử lại, dán link hoặc toạ độ từ Google Maps, hoặc bấm một điểm trên bản đồ."; }
  }
  // quiet: lập từ thao tác trên bản đồ hoặc đổi bộ lọc, không cuộn trang.
  function buildRoute(start, name, quiet) {
    const near = routeTargets(start), r = Nearby.route(start, near.map((t) => t.s));
    RT = { key: routeKey(), start, name: name || "", stops: r.order.map((k) => near[k]), legs: r.legs, total: r.total, exact: r.exact };
    $("#rt-msg").textContent = near.length ? "" : "Không có cửa hàng nào trong bộ lọc để đi tới.";
    $("#rt-clear").hidden = false;
    drawRoute(quiet ? "inside" : "all");
    if (!quiet) $("#rt-card").scrollIntoView({ behavior: "smooth", block: "start" });
    if (near.length && $("#rt-mode").value !== "line") roadRoute(RT);
  }
  // Đường đi thực tế: gửi điểm xuất phát và các điểm dừng cho Google qua backend. Lỗi thì giữ tuyến đường thẳng và báo rõ.
  async function roadRoute(rt) {
    const msg = $("#rt-msg");
    msg.textContent = "Đang tính đường đi thực tế…";
    try {
      const res = await API.getRoute([rt.start].concat(rt.stops.map((x) => x.s)).map((p) => ({ lat: p.lat, lng: p.lng })));
      if (rt !== RT) return;                           // đã có tuyến mới hơn
      RT.stops = res.order.map((k) => rt.stops[k]);
      RT.legs = res.legs.map((l) => l.km); RT.mins = res.legs.map((l) => l.min); RT.path = res.path;
      RT.total = RT.legs.reduce((a, b) => a + b, 0);
      RT.totalMin = RT.mins.reduce((a, b) => a + b, 0);
      msg.textContent = "";
      drawRoute("keep");                               // đã có đường thực tế: giữ nguyên khung đang xem
    } catch (err) {
      if (rt === RT) msg.textContent = `Chưa tính được đường thực tế, đang hiện đường thẳng. ${err.message}`;
    }
  }
  // "all": đưa cả tuyến vào khung, dùng khi người dùng yêu cầu. "inside": điểm dừng đã nằm trong khung thì giữ nguyên, thiếu thì chỉ thu nhỏ vừa đủ, không phóng to.
  function fitRoute(view) {
    const stops = [RT.start].concat(RT.stops.map((x) => x.s)).map((p) => [p.lat, p.lng]);
    if (view === "all") map.fitBounds(L.latLngBounds(RT.path || stops), { padding: [40, 40], maxZoom: 15 });
    else if (view === "inside" && !map.getBounds().contains(L.latLngBounds(stops))) map.fitBounds(L.latLngBounds(stops), { padding: [40, 40], maxZoom: map.getZoom() });
  }
  const numIcon = (t, cls = "") => L.divIcon({ className: "rt-num " + cls, html: t, iconSize: [22, 22] });
  function gmapDirLinks() {
    const pt = (p) => `${p.lat}%2C${p.lng}`, stops = RT.stops.map((x) => x.s), out = [];
    for (let a = 0; a < stops.length; a += GMAP_STOPS) {
      const part = stops.slice(a, a + GMAP_STOPS), mid = part.slice(0, -1).map(pt).join("%7C"), from = a ? stops[a - 1] : RT.start;
      const mode = $("#rt-mode").value === "line" ? "" : `&travelmode=${$("#rt-mode").value}`;
      const url = `https://www.google.com/maps/dir/?api=1&origin=${pt(from)}&destination=${pt(part[part.length - 1])}${mid ? "&waypoints=" + mid : ""}${mode}`;
      out.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${stops.length > GMAP_STOPS ? `Chặng ${fmt(a + 1)}–${fmt(a + part.length)}` : "Mở chỉ đường trên Google Maps"}</a>`);
    }
    return `<div class="gmap-links">${out.join("")}</div>`;
  }
  function drawRoute(view) {
    if (!rtLayer) rtLayer = L.layerGroup().addTo(map);
    rtLayer.clearLayers();
    const pts = [RT.start].concat(RT.stops.map((x) => x.s)).map((p) => [p.lat, p.lng]);
    L.polyline(RT.path || pts, RT.path ? { color: "#0b6bcb", weight: 4, opacity: 0.85, interactive: false } : { color: "#0b6bcb", weight: 3, dashArray: "6 6", interactive: false }).addTo(rtLayer);
    L.marker(pts[0], { icon: numIcon("A", "start"), keyboard: false }).bindTooltip(() => esc(RT.name || "Điểm xuất phát")).addTo(rtLayer);
    RT.stops.forEach((st, x) => {
      const mk = L.marker(pts[x + 1], { icon: numIcon(x + 1), keyboard: false }).bindTooltip(() => (st.i >= 0 ? wmInfo(st.i) : storeTip(st.s))).addTo(rtLayer);
      if (st.i >= 0) mk.on("click", () => select(st.i, true));
    });
    fitRoute(view);
    const box = $("#rt-result");
    box.hidden = !RT.stops.length;
    if (!RT.stops.length) return;
    const gotW = RT.stops.filter((x) => x.i >= 0).length, gotC = RT.stops.length - gotW, wantW = +$("#rt-n").value, wantC = +$("#rt-nc").value;
    const notes = [gotW < wantW ? `Bạn nhập ${fmt(wantW)} WM, bộ lọc hiện chỉ có ${fmt(gotW)} WM.` : "",
      gotC < wantC ? `Bạn nhập ${fmt(wantC)} đối thủ, bản đồ hiện chỉ có ${fmt(gotC)}.` : "",
      !wantC ? "Tuyến không ghé đối thủ vì Số đối thủ đang là 0." : ""].filter(Boolean).join(" ");
    box.innerHTML = (RT.name ? `<p>Xuất phát: <b>${esc(RT.name)}</b></p>` : "") + (notes ? `<p class="rt-note">${notes}</p>` : "") + (RT.path
        ? `<p><b>${stopCount()} · ${fmt(RT.total, 1)} km đường bộ · khoảng ${fmt(RT.totalMin)} phút.</b> Google tính theo đường ô tô, chưa gồm giờ dừng.`
          + ($("#rt-mode").value === "two-wheeler" ? " Xe máy có thể đi đường khác (hẻm, không đi cao tốc): bấm link để xem đúng đường xe máy." : "") + `</p>`
        : `<p><b>${stopCount()} · khoảng ${fmt(RT.total, 1)} km đường thẳng.</b> `
          + (RT.exact ? "Thứ tự ngắn nhất theo đường thẳng." : "Thứ tự gần ngắn nhất theo đường thẳng.") + ` Đường đi thật dài hơn.</p>`) + gmapDirLinks()
      + `<details><summary>Danh sách ${fmt(RT.stops.length)} điểm dừng theo thứ tự</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>Chuỗi</th><th>Mã CH</th><th>Tên CH</th><th>Phường/Xã</th><th>Quận</th><th>Tỉnh</th><th>Địa chỉ</th><th class="num">Từ điểm trước (km)</th></tr></thead><tbody>`
      + RT.stops.map((st, x) => { const w = st.s; return `<tr><td>${x + 1}</td><td>${esc(st.i >= 0 ? w.chuoi : chainName(w.chain))}</td><td>${esc(w.ma)}</td><td>${esc(w.ten)}</td><td>${esc(w.phuong === "-" ? "" : w.phuong)}</td><td>${esc(w.quan === "-" ? "" : w.quan)}</td><td>${esc(w.tinh)}</td><td class="addr">${esc(w.dia_chi)}</td><td class="num">${fmt(RT.legs[x], 2)}${RT.mins ? ` · ${fmt(RT.mins[x])} phút` : ""}</td></tr>`; }).join("")
      + `</tbody></table></div></details>`;
  }

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
    $("#k-nwm-sub").textContent = `Đếm WM theo bộ lọc: WM+ ${fmt(byChain["WM+"])} + WMT ${fmt(byChain.WMT)}`;
    $("#k-nbhx").textContent = fmt(bScope.length);
    const byComp = {}; bScope.forEach((j) => { const c = S.bhx[j].chain; byComp[c] = (byComp[c] || 0) + 1; });
    const Rt = `${fmt(R, R % 1 ? 1 : 0)} km`, L = lab();
    $("#k-nbhx-sub").textContent = `Đếm ${L} có địa chỉ trong khu vực; ` + (S.chains.size > 1 ? Object.entries(byComp).map(([c, k]) => `${chainName(c)} ${fmt(k)}`).join(" · ") + " · " : "")
      + (whereName() ? `trong ${whereName()}` : "cả nước, đang mở");
    // Pressure = số đối thủ ÷ số WM, theo tỉnh và chuỗi; bỏ qua Khu vực vì đối thủ không có Urban/Rural. Không phụ thuộc R.
    const nPress = S.wm.filter((w) => inProv(w) && pressOk(w)).length;
    $("#k-press").textContent = nPress ? pct(bScope.length / nPress) : "–";
    $("#k-press-sub").textContent = `${fmt(bScope.length)} ${lab()} ÷ ${fmt(nPress)} WM` + (S.khu.size ? " · không lọc theo Khu vực" : "");
    $("#k-cov").textContent = scope.length ? pct(cov / scope.length) : "–";
    $("#k-cov-sub").textContent = `${fmt(cov)} WM có ${L} trong ${Rt} ÷ ${fmt(scope.length)} WM`;
    $("#k-uniq").textContent = fmt(uniq.size);
    $("#k-uniq-sub").textContent = `${L} cách WM tối đa ${Rt}, gồm cả ngoài khu vực lọc; mỗi cửa hàng đếm 1 lần`;
    $("#k-avg").textContent = scope.length ? fmt(tot / scope.length, 2) : "–";
    $("#k-avg-sub").textContent = `${fmt(tot)} lượt trong ${Rt} ÷ ${fmt(scope.length)} WM; 1 ${L} gần nhiều WM được đếm nhiều lần`;
    $("#k-med").textContent = isNaN(med) ? "–" : fmt(med, 2) + " km";
    $("#k-med-sub").textContent = `Trung vị khoảng cách từ mỗi WM tới ${L} gần nhất, đường thẳng; không phụ thuộc bán kính`;

    // Thanh % theo tỉnh (theo Miền/Vùng/Chuỗi/Khu vực, hiện đủ tỉnh trong vùng để so sánh)
    const by = {};
    S.wm.forEach((w, i) => { if (!wmAttrOk(w) || !inVung(w)) return; (by[w.tinh] ||= [0, 0]); by[w.tinh][1]++; if (S.near[i] <= R) by[w.tinh][0]++; });
    $("#bars").innerHTML = Object.entries(by).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([t, [c, n]]) =>
      `<div class="bar-row${S.tinh.has(provKey(t)) ? " sel" : ""}" data-t="${esc(provKey(t))}" title="${c}/${n} WM"><span class="bar-name">${esc(t)}</span>
       <div class="bar-track"><div class="bar-fill" style="width:${(c / n) * 100}%"></div></div><span class="bar-val">${pct(c / n)}</span></div>`).join("")
      || `<p class="muted small">Chưa có WM trong bộ lọc.</p>`;

    renderWmTable(scope); $("#bhx-count").textContent = `(${fmt(bhxRows().length)})`; renderMap(scope); renderArea();
  }
  // Số nhập ở ô "Hiện … đối thủ" không có trần; chỉ không vượt quá số đối thủ đang bật.
  const topN = () => Math.max(1, Math.min(S.topN, S.bhx.length));
  // pct: trong N đối thủ gần nhất, bao nhiêu % nằm trong bán kính R.
  function wmRows(scope) {
    const q = S.q, N = topN();
    return scope.filter((i) => hit(q, S.wm[i].ma, S.wm[i].ten, S.wm[i].dia_chi)).map((i) => {
      const w = S.wm[i], n = countIn(S.pairsBy[i], S.R), chains = new Set();
      for (let k = 0; k < n; k++) chains.add(S.bhx[S.pairsBy[i][k][0]].chain);
      return { i, w, ma: w.ma, ten: w.ten, chuoi: w.chuoi, khu_vuc: w.khu_vuc, tinh: w.tinh, quan: w.quan === "-" ? "" : w.quan, phuong: w.phuong === "-" ? "" : w.phuong, n, near: S.near[i], pct: Math.min(n, N) / N, top: S.topBy[i].slice(0, N), nChains: chains.size };
    });
  }
  const WM_PAGE = 100;
  let wmPage = 0, wmPageKey = "", wmJump = false;
  const activeChains = () => new Set(S.bhx.map((b) => b.chain)).size;
  const storeShort = (b) => `${chainName(b.chain)} ${b.ten || b.ma}`;
  function renderWmTable(scope) {
    const rows = wmRows(scope).sort((a, b) => (a[S.sortK] > b[S.sortK] ? 1 : a[S.sortK] < b[S.sortK] ? -1 : 0) * S.sortDir), N = topN(), L = esc(lab());
    // Chia trang cho trình duyệt đỡ nặng (bớt dòng nếu N rất lớn), file Xuất WM vẫn đủ.
    const size = Math.max(1, Math.min(WM_PAGE, Math.floor(TABLE_CELLS / (11 + N)))), pages = Math.max(1, Math.ceil(rows.length / size)), totalChains = activeChains();
    const key = [filterKey(), S.q, S.sortK, S.sortDir].join("|");
    if (key !== wmPageKey) { wmPageKey = key; wmPage = 0; }                 // đổi lọc hoặc sắp xếp → về trang đầu
    if (wmJump) { wmJump = false; const at = rows.findIndex((r) => r.i === S.sel); if (at >= 0) wmPage = Math.floor(at / size); }   // chọn WM trên bản đồ → tới trang có dòng đó
    wmPage = Math.min(wmPage, pages - 1);
    const shown = rows.slice(wmPage * size, (wmPage + 1) * size);
    $("#wm-pager").innerHTML = pages < 2 ? "" : `<span class="muted">Dòng ${fmt(wmPage * size + 1)}–${fmt(wmPage * size + shown.length)} / ${fmt(rows.length)}</span>`
      + `<button class="link" data-p="${wmPage - 1}"${wmPage ? "" : " disabled"}>‹ Trước</button><span>Trang ${fmt(wmPage + 1)} / ${fmt(pages)}</span><button class="link" data-p="${wmPage + 1}"${wmPage < pages - 1 ? "" : " disabled"}>Sau ›</button>`;
    $("#wm-count").textContent = `(${fmt(rows.length)})`;
    $("#wm-hint").innerHTML = S.sel != null
      ? `Đang xem WM <b>${esc(S.wm[S.sel].ma)}</b> trên bản đồ · <button class="link" id="clear-sel">bỏ chọn</button>`
      : `Bấm 1 dòng để xem cửa hàng đó trên bản đồ. Khoảng cách tô đậm: đối thủ nằm trong bán kính ${fmt(S.R, S.R % 1 ? 1 : 0)} km. Cột % = trong ${fmt(N)} đối thủ gần nhất, bao nhiêu % nằm trong bán kính.${pages > 1 ? ` Bảng chia trang; bấm Xuất WM để lấy đủ ${fmt(rows.length)} dòng.` : ""}`;
    $("#t-wm thead").innerHTML = `<tr><th data-k="ma">Mã CH</th><th data-k="ten">Tên CH</th><th data-k="chuoi">Chuỗi</th><th data-k="khu_vuc">Khu vực</th><th>Địa chỉ</th><th data-k="tinh">Tỉnh</th><th data-k="quan">Quận</th><th data-k="phuong">Phường/Xã</th>`
      + `<th data-k="n" class="num">${L} trong R</th><th data-k="pct">% top ${fmt(N)} trong R</th><th data-k="nChains" class="num" title="Trong các chuỗi đối thủ đang bật, bao nhiêu chuỗi có cửa hàng trong bán kính R">Số chuỗi trong R</th>`
      + Array.from({ length: N }, (_, k) => `<th${k ? "" : ' data-k="near"'}>${L} #${k + 1}</th>`).join("") + `</tr>`;
    $("#t-wm tbody").innerHTML = shown.map((r) =>
      `<tr data-i="${r.i}"${r.i === S.sel ? ' class="sel"' : ""}><td>${esc(r.ma)}</td><td>${esc(r.ten)}</td><td>${esc(r.chuoi)}</td><td>${esc(r.khu_vuc)}</td><td class="addr">${esc(r.w.dia_chi)}</td><td>${esc(r.tinh)}</td><td>${esc(r.quan)}</td><td>${esc(r.phuong)}</td>`
      + `<td class="num">${r.n}</td><td><div class="pbar"><div class="pbar-track"><div class="pbar-fill" style="width:${r.pct * 100}%"></div></div><span>${fmt(r.pct * 100, 0)}%</span></div></td><td class="num">${r.nChains}/${totalChains}</td>`
      + Array.from({ length: N }, (_, k) => {
        const t = r.top[k]; if (!t) return "<td></td>";
        const b = S.bhx[t[0]];
        return `<td class="top ${t[1] <= S.R ? "in" : "out"}" title="${esc(b.dia_chi)}"><b>${fmt(t[1], 2)} km</b> <small>${esc(storeShort(b))}</small></td>`;
      }).join("") + `</tr>`).join("")
      || `<tr><td colspan="${11 + N}" class="muted">Chưa có WM trong bộ lọc (chưa tải file WM+ lên, hoặc file đã tự xoá sau 48 giờ).</td></tr>`;
  }
  function bhxRows() {
    const nb = bhxNearest();
    return bhxScope().filter((j) => hit(S.q, S.bhx[j].ma, S.bhx[j].ten, S.bhx[j].dia_chi)).map((j) => {
      const w = nb.ix[j] >= 0 ? S.wm[nb.ix[j]] : null;
      return { j, b: S.bhx[j], n: CNT_B[j], w, d: w ? Math.round(nb.d[j] * 1000) / 1000 : null };
    });
  }
  // fromMap: bấm ngay trên bản đồ thì điểm đó đang nhìn thấy, không cần di chuyển bản đồ.
  function select(i, fromMap) {
    S.sel = S.sel === i ? null : i; wmJump = S.sel != null;
    if (S.sel != null && !fromMap) map.setView([S.wm[i].lat, S.wm[i].lng], Math.max(map.getZoom(), 13));
    renderOverview();
  }
  // ---------- Thẻ đặc điểm khu vực (bấm 1 WM) ----------
  const CUSTOMER = [["chung_cu", "Cư dân chung cư"], ["cong_nhan", "Công nhân, nhà máy, KCN"], ["hoc_sinh", "Học sinh, phụ huynh (trường học)"], ["sinh_vien", "Sinh viên (ĐH, CĐ)"],
    ["benh_vien", "Bệnh nhân, người nhà (BV, phòng khám)"], ["van_phong", "Nhân viên văn phòng, cơ quan"], ["du_lich", "Khách du lịch, khách sạn"]];
  const AGE_LABEL = ["0–14", "15–24", "25–44", "45–64", "65+"];
  // Nhóm có mặt: mở sẵn, liệt kê tên và khoảng cách (gần trước) để khỏi phải tra bản đồ.
  const placeRow = (label, list) => {
    const named = list.filter((p) => p.name), unnamed = list.length - named.length;
    return `<details open><summary>${esc(label)} <b>${fmt(list.length)}</b></summary><ul>${named.map((p) => `<li>${esc(p.name)} · ${fmt(p.d, 2)} km</li>`).join("")}</ul>`
      + (unnamed ? `<small class="muted area-unnamed">${named.length ? "và " : ""}${fmt(unnamed)} điểm chưa có tên trên bản đồ</small>` : "") + `</details>`;
  };
  let areaTicket = 0;
  async function renderArea() {
    const el = $("#area-panel"), i = S.sel, ticket = ++areaTicket;
    if (i == null) { el.hidden = true; return; }
    const w = S.wm[i], R = S.R, Rt = fmt(R, R % 1 ? 1 : 0);
    const head = `<div class="area-head"><div><b>${esc(w.chuoi)} ${esc(w.ma)}</b><br><span class="muted">Khu vực trong bán kính ${Rt} km</span>${gmapLinks(w)}</div><button class="link" id="area-close" title="Đóng">✕</button></div>`;
    el.hidden = false;
    if (!window.POP_GRID || !window.POI_DATA) el.innerHTML = head + `<p class="muted">Đang tải dữ liệu khu vực…</p>`;
    try { await AreaInfo.load(); } catch (err) { if (ticket === areaTicket) el.innerHTML = head + `<p class="err">${esc(err.message)}</p>`; return; }
    if (ticket !== areaTicket) return;
    const a = AreaInfo.compute(w.lat, w.lng, R), p = a.pop, t = p.total, m = t ? p.male / t : 0;
    const bar = (label, share) => `<div class="area-row"><span>${label}</span><div class="pbar-track"><div class="pbar-fill" style="width:${share * 100}%"></div></div><span>${fmt(share * 100, 0)}%</span></div>`;
    const present = (rows) => rows.filter(([c]) => (a.places[c] || []).length).map(([c, label]) => placeRow(label, a.places[c])).join("");
    const groups = present(CUSTOMER), gt = present([["cho", "Chợ"], ["tap_hoa", "Tạp hóa, cửa hàng nhỏ (dữ liệu thiếu nhiều)"]]);
    el.innerHTML = head
      + `<h4>Nhóm đối tượng trong bán kính</h4>${groups || `<p class="muted">Bản đồ công khai chưa ghi nhận điểm nào.</p>`}`
      + `<h4>Chợ, tạp hóa</h4>${gt || `<p class="muted">Bản đồ công khai chưa ghi nhận điểm nào.</p>`}`
      + `<h4>${esc(lab())} trong bán kính: <b>${fmt(countIn(S.pairsBy[i], R))}</b></h4>`
      + `<details><summary>Dân số, giới tính, độ tuổi (ước tính) <b>${fmt(Math.round(t / 100) * 100)} người</b></summary>`
      + (t ? bar("Nam", m) + bar("Nữ", 1 - m) + p.ages.map((v, k) => bar(AGE_LABEL[k], v / t)).join("") : "")
      + (R < 1 ? `<small class="muted">Bán kính dưới 1 km sai số lớn vì lưới dân số mỗi ô khoảng 1 km.</small>` : "") + `</details>`
      + `<div class="area-src">Danh sách theo bản đồ công khai, có thể thiếu: không thấy không có nghĩa là không có.<br>Nguồn: <a href="https://hub.worldpop.org/geodata/summary?id=98656" target="_blank" rel="noopener">WorldPop</a> ${a.year} (CC BY 4.0, ước tính bằng mô hình) · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL), dữ liệu ngày ${esc(a.poiDate)}.</div>`;
  }
  function setR(v) {
    v = Math.min(R_MAX, Math.max(0.1, Math.round(+v * 10) / 10 || 1));
    S.R = v; $("#r-num").value = v;
    if (v > S.Rcalc) computeAll();
    renderOverview();
  }
  // Mở cửa hàng tìm được: đưa bộ lọc về đúng tỉnh (và bỏ lọc Chuỗi/Khu vực nếu cửa hàng bị lọc mất), zoom tới, mở popup.
  function focusStore(kind, k) {
    const s = kind === "wm" ? S.wm[k] : S.bhx[k];
    if (kind === "wm" && !wmAttrOk(s)) { S.chuoi = ""; S.khu.clear(); $("#chuoi").value = ""; syncBox("khu"); }
    if (!inVung(s)) clearRegion();
    const qOut = !inQuan(s) || !inPhuong(s);
    if (qOut) { S.quan.clear(); S.phuong.clear(); fillQuan(); }
    if (!inProv(s)) setProv(provKey(s.tinh)); else if (qOut && kind !== "wm") renderOverview();
    if (kind === "wm") { S.sel = null; select(k); }
    map.setView([s.lat, s.lng], 16);
    L.popup().setLatLng([s.lat, s.lng]).setContent(kind === "wm" ? wmInfo(k) + gmapLinks(s) : bhxInfo(k)).openOn(map);
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
    // opts.multi: chọn xong danh sách vẫn mở để chọn tiếp, ô để trống cho gõ tìm; bấm ra ngoài hoặc Esc thì đóng.
    const pick = (k) => {
      if (!opts.multi) { list.hidden = true; cur[k] && cur[k].pick(); return; }
      const top = list.scrollTop;
      if (cur[k]) cur[k].pick();
      draw(input.value); list.scrollTop = top; hi(k);
    };
    const done = () => { if (!opts.multi) input.blur(); };
    input.addEventListener("input", () => draw(input.value));
    input.addEventListener("focus", () => {
      if (opts.multi) { input.dataset.open = "1"; input.value = ""; }
      input.select(); draw(opts.showAllOnFocus ? "" : input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { if (list.hidden) draw(input.value); else hi(on + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hi(on - 1); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); if (!list.hidden) { pick(on); done(); } }
      else if (e.key === "Escape") { list.hidden = true; input.blur(); }
    });
    list.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const d = e.target.closest("[data-k]"); if (d) { pick(+d.dataset.k); done(); }
    });
    input.addEventListener("blur", () => { list.hidden = true; delete input.dataset.open; opts.onBlur && opts.onBlur(); if (opts.multi) afterListClose(); });
  }
  const checkMark = (on, html) => `<span class="chk${on ? " on" : ""}">${on ? "✓" : ""}</span>${html}`;
  combo($("#tinh-q"), $("#tinh-list"), (q) => {
    const cW = {}, cB = {};
    S.wm.forEach((w) => { if (wmAttrOk(w) && inVung(w)) { const k = provKey(w.tinh); cW[k] = (cW[k] || 0) + 1; } });
    S.bhx.forEach((b) => { if (inVung(b)) { const k = provKey(b.tinh); cB[k] = (cB[k] || 0) + 1; } });
    const cLab = lab();
    const keep = provsInRegion(), inV = PROVS.filter((p) => keep.has(p.key));
    const all = { html: `<b>${S.tinh.size ? "Bỏ chọn tất cả" : "Tất cả"}</b><small>${fmt(inV.length)} tỉnh</small>`, pick: () => setProv("") };
    return (q ? [] : [all]).concat(inV.filter((p) => !q || plain(p.name).includes(q) || p.key.includes(q.replace(/[^a-z0-9]/g, "")))
      .map((p) => ({ html: checkMark(S.tinh.has(p.key), `${esc(p.name)}<small>${fmt(cW[p.key] || 0)} WM · ${fmt(cB[p.key] || 0)} ${esc(cLab)}</small>`), pick: () => toggleProv(p.key) })));
  }, { showAllOnFocus: true, multi: true, onBlur: syncTinh });
  // Miền, Vùng, Quận, Phường/Xã, Khu vực: gõ để tìm, chọn được nhiều. Danh sách dài chỉ vẽ phần đầu cho đỡ nặng.
  const COMBO_MAX = 300;
  ["mien", "vung", "quan", "phuong", "khu"].forEach((dim) => combo($(`#${dim}-q`), $(`#${dim}-list`), (q) => {
    const toggle = (v) => () => { if (S[dim].has(v)) S[dim].delete(v); else S[dim].add(v); regionChanged(); };
    const found = OPT[dim].filter((o) => !q || plain(o.t).includes(q));
    return (q ? [] : [{ html: `<b>${S[dim].size ? "Bỏ chọn tất cả" : "Tất cả"}</b><small>${fmt(OPT[dim].length)} mục</small>`, pick: () => { S[dim].clear(); regionChanged(); } }])
      .concat(found.slice(0, COMBO_MAX).map((o) => ({ html: checkMark(S[dim].has(o.v), esc(o.t)), pick: toggle(o.v) })))
      .concat(found.length > COMBO_MAX ? [{ html: `<small>Còn ${fmt(found.length - COMBO_MAX)} mục, gõ thêm để lọc</small>`, pick: () => {} }] : []);
  }, { showAllOnFocus: true, multi: true, onBlur: () => syncBox(dim) }));
  combo($("#q"), $("#q-list"), (q) => {
    if (!q) return [];
    const out = [];
    S.wm.forEach((w, i) => { if (out.length < 8 && hit(q, w.ma, w.ten, w.dia_chi)) out.push({ html: `<b>${esc(w.chuoi)} ${esc(w.ma)}</b> ${esc(w.ten !== w.ma ? w.ten : "")}<small>${esc(w.dia_chi || w.tinh)}</small>`, pick: () => focusStore("wm", i) }); });
    const n = out.length;
    S.bhx.forEach((b, j) => { if (out.length < n + 12 && hit(q, b.ma, b.ten, b.dia_chi)) out.push({ html: `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><small>${esc(b.dia_chi)}</small>`, pick: () => focusStore("bhx", j) }); });
    return out;
  }, { hideEmpty: true });

  // Ô điểm xuất phát: toạ độ hoặc link dán vào, cửa hàng đã có trên web, cuối cùng là tìm địa chỉ trên OpenStreetMap khi người dùng chọn.
  combo($("#rt-addr"), $("#rt-addr-list"), (q) => {
    const raw = $("#rt-addr").value.trim();
    if (!q) return [];
    if (rtGeo.q === raw && rtGeo.list.length) return rtGeo.list.map((g) => ({ html: `${esc(g.display_name)}<small>© OpenStreetMap</small>`, pick: () => buildRoute({ lat: +g.lat, lng: +g.lon }, g.display_name) }));
    const out = [], ll = parseLatLng(raw);
    if (ll) out.push({ html: `<b>Toạ độ ${ll.lat}, ${ll.lng}</b>`, pick: () => buildRoute(ll, `Toạ độ ${ll.lat}, ${ll.lng}`) });
    let n = 0;
    S.wm.forEach((w) => { if (n < 6 && hit(q, w.ma, w.ten, w.dia_chi)) { n++; out.push({ html: `<b>${esc(w.chuoi)} ${esc(w.ma)}</b> ${esc(w.ten !== w.ma ? w.ten : "")}<small>${esc(w.dia_chi || w.tinh)}</small>`, pick: () => buildRoute(w, `${w.chuoi} ${w.ma}`) }); } });
    n = 0;
    S.all.forEach((b) => { if (n < 4 && hit(q, b.ma, b.ten, b.dia_chi)) { n++; out.push({ html: `<b>${esc(chainName(b.chain))} ${esc(b.ten || b.ma)}</b><small>${esc(b.dia_chi)}</small>`, pick: () => buildRoute(b, `${chainName(b.chain)} ${b.ten || b.ma}`) }); } });
    if (!ll) out.push({ html: `<b>Tìm địa chỉ “${esc(raw)}” trên OpenStreetMap</b><small>Gửi đúng nội dung bạn gõ cho OpenStreetMap</small>`, pick: () => geocode(raw) });
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
  // Tên file: 1 giá trị thì ghi tên (phần cuối của khoá), nhiều giá trị thì ghi số lượng.
  const fileSlug = (set, name) => (!set.size ? "" : set.size > 1 ? `${set.size}_${name}` : [...set][0] === "-" ? `chua_ro_${name}` : plain([...set][0].split("|").pop()).replace(/[^a-z0-9]+/g, "_"));
  const fileTag = () => [S.chains.size === 1 ? [...S.chains][0].toLowerCase() : "nhieu_chuoi", fileSlug(S.mien, "mien"), fileSlug(S.vung, "vung"), S.tinh.size || S.mien.size || S.vung.size ? fileSlug(S.tinh, "tinh") : "tat_ca_tinh", fileSlug(S.quan, "quan"), fileSlug(S.phuong, "phuong"), S.chuoi && S.chuoi.replace("+", "plus"), fileSlug(S.khu, "khu_vuc")].filter(Boolean).join("_") + `_R${S.R}km`;

  // ---------- Thay đổi BHX ----------
  let CH = [];
  async function loadChanges(pre) {
    const grid = Nearby.index(S.wm);
    CH = (pre || await API.getChanges()).map((e) => {
      const list = Nearby.search(grid, e.lat, e.lng, 1, 2), n2 = list.filter((x) => x[1] <= 2).length, best = list.length ? list[0][1] : Infinity;
      return { ...e, chain: e.chain || "BHX", n2, near: best, mien: regionAt(e, "mien"), vung: regionAt(e, "vung") };
    });
    const ts = [...new Set(CH.map((e) => e.tinh))].sort();
    $("#c-tinh").innerHTML = `<option value="">Tất cả</option>` + ts.map((t) => `<option>${esc(t)}</option>`).join("");
    $("#c-chain").innerHTML = `<option value="">Tất cả</option>` + Object.entries(CHAINS).map(([c, v]) => `<option value="${c}">${esc(v.name)}</option>`).join("");
    renderChanges();
  }
  const TYPE = { open: "Mở mới", close: "Đóng cửa", move: "Dời vị trí" };
  function changeRows() {
    const t = $("#c-type").value, f = $("#c-from").value, p = $("#c-tinh").value, c = $("#c-chain").value, v = $("#c-vung").value, m = $("#c-mien").value;
    return CH.filter((e) => (!t || e.type === t) && (!f || e.date >= f) && (!p || e.tinh === p) && (!c || e.chain === c) && (!v || e.vung === v) && (!m || e.mien === m));
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
  const EVENT = { login: "Đăng nhập", resume: "Mở lại phiên", logout: "Đăng xuất", denied: '<span class="tag close">Bị từ chối — chưa cấp quyền</span>', login_fail: '<span class="tag close">Sai mật khẩu</span>', pw_change: "Đổi mật khẩu", pw_reset: "Cấp mật khẩu tạm" };
  async function renderLog() {
    $("#t-log tbody").innerHTML = (await API.getAccessLog()).map((r) =>
      `<tr><td>${esc(new Date(r.at).toLocaleString("vi-VN"))}</td><td>${esc(r.email)}</td><td>${EVENT[r.event] || esc(r.event)}</td></tr>`).join("");
  }
  async function renderUsers() {
    $("#t-users tbody").innerHTML = (await API.listUsers()).map((u) =>
      `<tr><td>${esc(u.email)}</td><td>${u.role === "admin" ? "Admin" : "Viewer"}</td><td>${esc(u.added)}</td>
       <td>${u.email === S.user.email ? '<span class="muted small">bạn</span>' : `<button class="link" data-pw="${esc(u.email)}">Cấp lại mật khẩu</button> <button class="link" data-rm="${esc(u.email)}">Thu hồi</button>`}</td></tr>`).join("");
  }

  // ---------- Khởi động ----------
  function show(view) {
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "overview") setTimeout(() => map.invalidateSize(), 0);
    if (view === "price") WMPrice.open(API, S.user.role === "admin");
    if (view === "wm") { WMUpload.ensureLib().catch(() => {}); openOnce("wm", () => [renderVersions()]); }
    if (view === "admin") openOnce("admin", () => [renderUsers(), renderLog()]);
  }
  // Tab của Admin chỉ tải khi mở lần đầu; lỗi thì lần mở sau thử lại.
  const opened = {};
  function openOnce(tab, load) {
    if (opened[tab]) return;
    opened[tab] = true;
    Promise.all(load()).catch(() => { opened[tab] = false; });
  }
  async function start(user) {
    S.user = user;
    $("#login").hidden = true; $("#app").hidden = false;
    $("#demo-banner").hidden = API.mode !== "demo";
    $("#user-email").textContent = user.email;
    $("#user-role").textContent = user.role === "admin" ? "Admin" : "Viewer";
    document.querySelectorAll("[data-admin]").forEach((b) => (b.hidden = user.role !== "admin"));
    const boot = await API.getBoot();
    applySettings(boot.settings);
    initMap();
    await loadData(boot.snapshot, boot.changes);
  }
  async function loadData(preSnap, preChanges) {
    const snap = preSnap || await API.getSnapshot();
    S.wm = snap.wm.map((w) => ({ ...w, chuoi: w.chuoi || "WM+", khu_vuc: w.khu_vuc || "", dia_chi: w.dia_chi || "", vung: w.vung || "-", mien: w.mien || "-", quan: w.quan || "-", phuong: w.phuong || "-" }));
    S.all = snap.bhx.map((b) => ({ ...b, chain: "BHX" })).concat(snap.comp || []);
    buildRegions(); clearRoute(); S.quan.clear(); S.phuong.clear(); S.khu.clear();
    S.bhx = S.all.filter((b) => S.chains.has(b.chain)); S.sel = null; S.tinh.clear(); syncTinh(); clearRegion();
    try { S.compStatus = JSON.parse(snap.compStatus || "{}"); } catch (_) { S.compStatus = {}; }
    const left = snap.wmExpires ? (snap.wmExpires - Date.now()) / 3600e3 : 0;
    $("#snap-info").textContent = `${fmt(S.wm.length)} WM (${snap.wmVersion}`
      + (snap.wmExpires ? `, tự xoá ${snap.wmExpires.toLocaleString("vi-VN")} — còn ${fmt(Math.max(left, 0), 0)} giờ` : "")
      + `) · ${fmt(snap.bhx.length)} BHX, cập nhật ${snap.bhxUpdated}`
      + ((snap.comp || []).length ? ` · ${fmt(snap.comp.length)} cửa hàng chuỗi khác, cập nhật ${snap.compUpdated}` : "");
    computeAll(); fillProvinces(); fillQuan();
    buildBhxAll(); buildWmMarkers(); renderOverview(); fitScope();
    if (!S.wm.length && !S.all.length) $("#snap-info").textContent = "Chưa có dữ liệu WM+ (chưa upload hoặc đã tự xoá sau 48 giờ) — Admin vào tab WM+ (upload) để tải file lên.";
    loadChanges(preChanges);
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
      + (p.mapping.khu_vuc === undefined ? ` · <span class="muted">không có cột Khu vực → để trống</span>` : "")
      + (p.mapping.mien === undefined ? ` · <span class="err">không có cột Miền → không lọc được theo miền</span>` : "")
      + (p.mapping.vung === undefined ? ` · <span class="err">không có cột Vùng → không lọc được theo vùng</span>` : "")
      + (p.mapping.quan === undefined ? ` · <span class="err">không có cột Quận → không lọc được theo quận</span>` : "")
      + (p.mapping.phuong === undefined ? ` · <span class="err">không có cột Phường/Xã → không lọc được theo phường, xã</span>` : "");
    const v = WMUpload.validate(p, $("#up-chuoi").value), d = WMUpload.diff(S.wm, v.ok);
    UP.valid = v.ok; UP.diff = d;
    const cnt = (f) => v.ok.filter(f).length;
    $("#up-kpis").innerHTML = [["Dòng hợp lệ", v.ok.length], ["Dòng lỗi (không đưa lên)", v.bad.length], ["Trùng mã", v.dups.length],
      ["Thêm mới", d.added.length], ["Không còn trong file", d.removed.length], ["Dời > 50 m", d.moved.length]]
      .map(([k, n]) => `<div class="card kpi"><span>${k}</span><b>${fmt(n)}</b></div>`).join("")
      + `<p class="small muted" style="grid-column:1/-1;margin:0">WM+ ${fmt(cnt((r) => r.chuoi === "WM+"))} · WMT ${fmt(cnt((r) => r.chuoi === "WMT"))} · Urban ${fmt(cnt((r) => r.khu_vuc === "Urban"))} · Rural ${fmt(cnt((r) => r.khu_vuc === "Rural"))} · chưa phân loại ${fmt(cnt((r) => !r.khu_vuc))}`
      + [["mien", "Miền"], ["vung", "Vùng"]].map(([k, label]) => `<br>${label}: ${[...new Set(v.ok.map((r) => r[k]))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true })).map((g) => `${esc(g || "để trống")} ${fmt(cnt((r) => r[k] === g))}`).join(" · ")}`).join("") + `</p>`;
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
      await WMUpload.ensureLib();
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
      const r = await API.publishWm(UP.valid.map(({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi, vung, mien, quan, phuong }) => ({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi, vung, mien, quan, phuong })));
      $("#up-msg").textContent = `Đã lưu ${r.version}: ${fmt(r.rows)} WM.`;
      UP = null; $("#up-file").value = "";
      await loadData(); renderVersions();
    } catch (err) { $("#up-msg").textContent = "Lỗi: " + err.message; $("#up-apply").disabled = false; }
  });

  // Quyền xuất CSV: Admin luôn được; Viewer theo cài đặt. Chỉ là ẩn nút — Viewer vẫn xem được dữ liệu trên màn hình.
  function applySettings(st) {
    const viewerExport = st.viewer_can_export !== false;
    const can = S.user.role === "admin" || viewerExport;
    document.querySelectorAll("#exp-wm, #exp-bhx, #exp-changes, #p-export").forEach((b) => (b.hidden = !can));
    $("#s-export").checked = viewerExport;
  }

  // Sự kiện
  let newPwStep = false;
  function setNewPwStep(on, msg = "") {
    newPwStep = on; $("#new-pw-row").hidden = !on; $("#login-reset").hidden = !on;
    $("#login-email").disabled = on; $("#login-pw").disabled = on;
    $("#login-new").required = on; $("#login-new2").required = on;
    $("#login-new").value = ""; $("#login-new2").value = "";
    if (!on) $("#login-pw").value = "";
    $("#login-btn").textContent = on ? "Lưu mật khẩu và vào" : "Đăng nhập"; $("#login-msg").textContent = msg;
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim().toLowerCase(), pw = $("#login-pw").value, btn = $("#login-btn");
    btn.disabled = true;
    try {
      if (!newPwStep) {
        const u = await API.signIn(email, pw);
        if (!u.mustChange) { await start(u); return; }
        setNewPwStep(true, "Đây là mật khẩu tạm. Hãy đặt mật khẩu của riêng bạn để vào web.");
        $("#login-new").focus();
      } else {
        if ($("#login-new").value !== $("#login-new2").value) throw new Error("Hai lần nhập mật khẩu mới không khớp.");
        await start(await API.changePassword(email, pw, $("#login-new").value));
      }
    } catch (err) { $("#login-msg").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("#login-reset").addEventListener("click", () => setNewPwStep(false));
  if (API.mode === "demo") $("#login-msg").textContent = 'Demo: mật khẩu bất kỳ. Nhập "tam" để xem bước đặt mật khẩu mới.';
  $("#pw-open").addEventListener("click", () => { $("#pw-form").reset(); $("#pw-msg").textContent = ""; $("#pw-dialog").showModal(); });
  $("#pw-cancel").addEventListener("click", () => $("#pw-dialog").close());
  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#pw-save");
    if ($("#pw-new").value !== $("#pw-new2").value) { $("#pw-msg").textContent = "Hai lần nhập mật khẩu mới không khớp."; return; }
    btn.disabled = true;
    try { await API.changePassword(S.user.email, $("#pw-old").value, $("#pw-new").value); $("#pw-dialog").close(); }
    catch (err) { $("#pw-msg").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("#log-refresh").addEventListener("click", renderLog);
  $("#s-export").addEventListener("change", async (e) => { await API.setSetting("viewer_can_export", e.target.checked); $("#u-msg").textContent = "Đã lưu cài đặt."; });
  $("#logout").addEventListener("click", async () => { await API.signOut(); location.reload(); });
  $("#tabs").addEventListener("click", (e) => { if (e.target.dataset.view) show(e.target.dataset.view); });
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
  $("#rt-clear").addEventListener("click", clearRoute);
  ["#rt-n", "#rt-nc", "#rt-mode"].forEach((s) => $(s).addEventListener("change", () => { if (RT) buildRoute(RT.start, RT.name, true); }));
  $("#rt-go").addEventListener("click", () => {
    const msg = $("#rt-msg"), raw = $("#rt-addr").value.trim(), ll = parseLatLng(raw);
    if (ll) buildRoute(ll, `Toạ độ ${ll.lat}, ${ll.lng}`);
    else if (raw) geocode(raw);
    else if (S.sel != null) { const w = S.wm[S.sel]; buildRoute(w, `${w.chuoi} ${w.ma}`); }   // ô trống mà đang chọn 1 WM thì đi từ WM đó
    else { msg.textContent = RT_HINT; $("#rt-addr").focus(); }
  });
  $("#rt-gps").addEventListener("click", () => {
    const msg = $("#rt-msg");
    msg.textContent = "Đang lấy vị trí của bạn…";
    navigator.geolocation.getCurrentPosition((p) => buildRoute({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }, "Vị trí của tôi"),
      () => (msg.textContent = "Không lấy được vị trí. Hãy cho phép trình duyệt dùng vị trí, hoặc nhập địa chỉ."), { timeout: 10000 });
  });
  $("#chuoi").addEventListener("change", (e) => { S.chuoi = e.target.value; S.sel = null; renderOverview(); });
  $("#q").addEventListener("input", (e) => { S.q = plain(e.target.value.trim()); renderWmTable(scopeIdx()); $("#bhx-count").textContent = `(${fmt(bhxRows().length)})`; });
  $("#top-n").addEventListener("change", (e) => {
    S.topN = Math.max(1, Math.floor(+e.target.value) || 5);
    if (S.topN > S.topK && S.topK < S.bhx.length) computeAll();
    S.topN = topN(); e.target.value = S.topN; renderWmTable(scopeIdx());
  });
  $("#area-panel").addEventListener("click", (e) => { if (e.target.id === "area-close") select(S.sel); });
  $("#map-notes").addEventListener("click", (e) => {
    showNotes = !showNotes; e.target.textContent = showNotes ? "Ẩn ghi chú tỉnh" : "Hiện ghi chú tỉnh"; renderNotes(scopeIdx());
  });
  // Phủ kín cửa sổ bằng CSS, không phụ thuộc quyền fullscreen của trình duyệt.
  function setMapMax(on) {
    $("#map-card").classList.toggle("map-max", on);
    document.body.style.overflow = on ? "hidden" : "";
    $("#map-full").textContent = on ? "✕ Thoát toàn màn hình" : "⛶ Toàn màn hình";
    setTimeout(() => map.invalidateSize(), 50);
  }
  $("#map-fit").addEventListener("click", () => { if (RT && RT.stops.length) fitRoute("all"); else fitScope(); });
  $("#map-full").addEventListener("click", () => setMapMax(!$("#map-card").classList.contains("map-max")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#map-card").classList.contains("map-max")) setMapMax(false); });
  $("#bars").addEventListener("click", (e) => {
    const r = e.target.closest(".bar-row"); if (!r) return;
    toggleProv(r.dataset.t);
  });
  $("#t-wm").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (th) { S.sortDir = S.sortK === th.dataset.k ? -S.sortDir : (["n", "pct", "nChains"].includes(th.dataset.k) ? -1 : 1); S.sortK = th.dataset.k; renderWmTable(scopeIdx()); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) select(+tr.dataset.i);
  });
  $("#wm-pager").addEventListener("click", (e) => {
    if (!e.target.dataset.p) return;
    wmPage = Math.max(0, +e.target.dataset.p); renderWmTable(scopeIdx());
    $("#t-wm").closest(".table-wrap").scrollTop = 0;
  });
  $("#wm-hint").addEventListener("click", (e) => { if (e.target.id === "clear-sel") select(S.sel); });
  // Mỗi WM 1 dòng, khối đối thủ #1..#N theo template MASTER (Code / Address / Distance).
  $("#exp-wm").addEventListener("click", () => {
    const N = topN(), blocks = [];
    for (let k = 1; k <= N; k++) blocks.push(`Chain_${k}`, `Code_${k}`, `Name_${k}`, `Address_${k}`, `Distance_${k} (km)`);
    downloadCsv(`wm_top${N}_${fileTag()}.csv`, ["Mã CH", "Tên CH", "Chuỗi", "Khu vực", "Địa chỉ", "Tỉnh", "Quận", "Phường/Xã", "Lat WM", "Lng WM", "Bán kính (km)", "Số đối thủ trong R", `% top ${N} trong R`, "Số chuỗi trong R", "Số chuỗi đang bật", ...blocks],
      wmRows(scopeIdx()).map((r) => [r.ma, r.ten, r.chuoi, r.khu_vuc, r.w.dia_chi, r.tinh, r.quan, r.phuong, r.w.lat, r.w.lng, S.R, r.n, Math.round(r.pct * 100) + "%", r.nChains, activeChains(),
        ...Array.from({ length: N }, (_, k) => { const t = r.top[k], b = t && S.bhx[t[0]]; return b ? [chainName(b.chain), b.ma, b.ten || "", b.dia_chi, t[1]] : ["", "", "", "", ""]; }).flat()]));
  });
  $("#exp-bhx").addEventListener("click", () => downloadCsv(`doithu_${fileTag()}.csv`, ["Đối thủ", "Mã", "Tên", "Địa chỉ", "Tỉnh", "Lat", "Lng", "Bán kính (km)", "Số WM trong R", "WM gần nhất", "Chuỗi WM gần nhất", "Khoảng cách WM gần nhất (km)"],
    bhxRows().map((r) => [chainName(r.b.chain), r.b.ma, r.b.ten || "", r.b.dia_chi, r.b.tinh, r.b.lat, r.b.lng, S.R, r.n, r.w ? r.w.ma : "", r.w ? r.w.chuoi : "", r.d ?? ""])));
  ["#c-chain", "#c-type", "#c-from", "#c-mien", "#c-vung", "#c-tinh"].forEach((s) => $(s).addEventListener("input", renderChanges));
  $("#exp-changes").addEventListener("click", () => downloadCsv("bhx_thay_doi.csv", ["Ngày", "Đối thủ", "Loại", "Mã", "Địa chỉ", "Tỉnh", "WM+ trong 2 km", "WM+ gần nhất (km)", "Lat", "Lng"],
    changeRows().map((e) => [e.date, chainName(e.chain), TYPE[e.type], e.ma, e.dia_chi, e.tinh, e.n2, e.near.toFixed(3), e.lat, e.lng])));
  $("#add-user").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#u-email").value.trim().toLowerCase();
    try { showTempPw(email, (await API.addUser(email, $("#u-role").value)).tempPassword); $("#u-email").value = ""; renderUsers(); }
    catch (err) { $("#u-msg").textContent = err.message; }
  });
  const showTempPw = (email, pw) => { $("#u-msg").textContent = `Mật khẩu tạm của ${email}: ${pw} — chỉ hiện lần này, hạn 7 ngày. Hãy gửi riêng cho người đó; lần đầu vào họ sẽ phải đặt mật khẩu mới.`; };
  $("#t-users").addEventListener("click", async (e) => {
    const pwEm = e.target.dataset.pw;
    if (pwEm) {
      if (!confirm(`Cấp mật khẩu tạm mới cho ${pwEm}? Mật khẩu cũ sẽ hết hiệu lực và người đó bị đăng xuất.`)) return;
      try { showTempPw(pwEm, (await API.resetPassword(pwEm)).tempPassword); }
      catch (err) { $("#u-msg").textContent = err.message; }
      return;
    }
    const em = e.target.dataset.rm; if (!em || !confirm(`Thu hồi quyền của ${em}?`)) return;
    try { await API.removeUser(em); $("#u-msg").textContent = "Đã thu hồi quyền."; renderUsers(); }
    catch (err) { $("#u-msg").textContent = err.message; }
  });

  // Còn phiên đăng nhập (trong cùng tab) → vào thẳng
  $("#login-retry-btn").addEventListener("click", () => location.reload());
  API.currentUser().then((u) => u && start(u)).catch((err) => {
    $("#login-form").hidden = true; $("#login-retry").hidden = false; $("#login-retry-msg").textContent = err.message;
  });
})();
