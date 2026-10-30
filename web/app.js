// WM+ ↔ BHX — giao diện. Tính khoảng cách ngay trên trình duyệt (haversine, cùng công thức với wm_bhx_match.py).
(function () {
  const CFG = window.APP_CONFIG;
  const API = CFG.mode === "demo" ? window.DemoAPI : window.GasAPI;
  const EARTH_R_KM = 6371.0088;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x, d = 0) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x) => fmt(x * 100, 1) + "%";

  let S = { user: null, wm: [], bhx: [], near: null, nearIdx: null, pairsBy: null, R: 1, tinh: "", q: "", sel: null, sortK: "n", sortDir: -1 };

  // ---------- Tính toán ----------
  function haversine(la1, lo1, cla1, la2, lo2, cla2) {
    const a = Math.sin((la2 - la1) / 2) ** 2 + cla1 * cla2 * Math.sin((lo2 - lo1) / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
  }
  function computeAll() {
    const rad = Math.PI / 180, wm = S.wm, bhx = S.bhx, n = wm.length, m = bhx.length;
    const bLa = new Float64Array(m), bLo = new Float64Array(m), bC = new Float64Array(m);
    for (let j = 0; j < m; j++) { bLa[j] = bhx[j].lat * rad; bLo[j] = bhx[j].lng * rad; bC[j] = Math.cos(bLa[j]); }
    S.near = new Float64Array(n); S.nearIdx = new Int32Array(n); S.pairsBy = [];
    for (let i = 0; i < n; i++) {
      const la = wm[i].lat * rad, lo = wm[i].lng * rad, c = Math.cos(la), list = [];
      let best = Infinity, bi = -1;
      for (let j = 0; j < m; j++) {
        const d = haversine(la, lo, c, bLa[j], bLo[j], bC[j]);
        if (d < best) { best = d; bi = j; }
        if (d <= CFG.maxRadiusKm) list.push([j, Math.round(d * 1000) / 1000]);
      }
      list.sort((a, b) => a[1] - b[1]);
      S.near[i] = Math.round(best * 1000) / 1000; S.nearIdx[i] = bi; S.pairsBy.push(list);
    }
  }
  const countIn = (list, R) => { let k = 0; while (k < list.length && list[k][1] <= R) k++; return k; };
  const scopeIdx = () => S.wm.map((_, i) => i).filter((i) => !S.tinh || S.wm[i].tinh === S.tinh);

  // ---------- Bản đồ ----------
  let map, wmMarkers = [], bhxLayer, ringLayer, bhxAllLayer;
  function initMap() {
    map = L.map("map", { preferCanvas: true }).setView([20.8, 106.2], 9);
    // OSM chặn tile (403) nếu thiếu Referer; trang đặt no-referrer → riêng tile gửi origin (chỉ tên miền, không đường dẫn).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 18, attribution: "© OpenStreetMap", referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
    bhxLayer = L.layerGroup().addTo(map); ringLayer = L.layerGroup().addTo(map);
  }
  // Lớp nền: toàn bộ BHX đang mở (chấm xám nhỏ) — luôn hiện, kể cả khi chưa có WM+.
  function buildBhxAll() {
    if (bhxAllLayer) bhxAllLayer.remove();
    bhxAllLayer = L.layerGroup(S.bhx.map((b) => L.circleMarker([b.lat, b.lng],
      { radius: 2.5, weight: 0, fillColor: getVar("--bhx-all"), fillOpacity: 0.7 })
      .bindTooltip(`<b>BHX ${esc(b.ma)}</b><br>${esc(b.dia_chi)}`))).addTo(map);   // thêm trước WM+ → nằm dưới
  }
  function buildWmMarkers() {                         // gọi lại mỗi khi danh sách WM+ đổi (upload)
    wmMarkers.forEach((mk) => mk.remove());
    wmMarkers = S.wm.map((w, i) => L.circleMarker([w.lat, w.lng], { radius: 5, weight: 1, color: "#fff", fillOpacity: 0.9 })
      .bindTooltip(() => `<b>${esc(w.ma)}</b> · ${esc(w.tinh)}<br>BHX trong ${S.R} km: ${countIn(S.pairsBy[i], S.R)}<br>Gần nhất: ${fmt(S.near[i], 3)} km`)
      .on("click", () => select(i)));
  }
  function renderMap(scope) {
    const inScope = new Set(scope);
    wmMarkers.forEach((mk, i) => {
      if (!inScope.has(i)) { mk.remove(); return; }
      mk.addTo(map).setStyle({ fillColor: S.near[i] <= S.R ? getVar("--wm-hit") : getVar("--wm-free"), radius: S.sel === i ? 9 : 5 });
    });
    bhxLayer.clearLayers(); ringLayer.clearLayers();
    const src = S.sel != null ? [S.sel] : scope, seen = new Set();
    src.forEach((i) => S.pairsBy[i].forEach(([j, d]) => {
      if (d > S.R || seen.has(j)) return; seen.add(j);
      const b = S.bhx[j];
      L.circleMarker([b.lat, b.lng], { radius: 3.5, weight: 0, fillColor: getVar("--bhx"), fillOpacity: 0.85 })
        .bindTooltip(`<b>BHX ${esc(b.ma)}</b><br>${esc(b.dia_chi)}`).addTo(bhxLayer);
    }));
    if (S.sel != null) {
      const w = S.wm[S.sel];
      L.circle([w.lat, w.lng], { radius: S.R * 1000, color: getVar("--wm-hit"), weight: 1.5, fillOpacity: 0.05 }).addTo(ringLayer);
    }
  }
  const getVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- Tổng quan ----------
  function renderOverview() {
    const R = S.R, scope = scopeIdx();
    let cov = 0, tot = 0; const uniq = new Set(), nears = [];
    scope.forEach((i) => {
      if (S.near[i] <= R) cov++;
      const k = countIn(S.pairsBy[i], R); tot += k;
      for (let t = 0; t < k; t++) uniq.add(S.pairsBy[i][t][0]);
      nears.push(S.near[i]);
    });
    nears.sort((a, b) => a - b);
    const med = nears.length ? (nears.length % 2 ? nears[(nears.length - 1) / 2] : (nears[nears.length / 2 - 1] + nears[nears.length / 2]) / 2) : NaN;
    $("#k-cov").textContent = scope.length ? pct(cov / scope.length) : "–";
    $("#k-cov-sub").textContent = `${fmt(cov)} / ${fmt(scope.length)} WM+`;
    $("#k-uniq").textContent = fmt(uniq.size);
    $("#k-avg").textContent = scope.length ? fmt(tot / scope.length, 2) : "–";
    $("#k-med").textContent = isNaN(med) ? "–" : fmt(med, 2) + " km";

    // Thanh % theo tỉnh (luôn hiện đủ tỉnh để so sánh)
    const by = {};
    S.wm.forEach((w, i) => { (by[w.tinh] ||= [0, 0]); by[w.tinh][1]++; if (S.near[i] <= R) by[w.tinh][0]++; });
    $("#bars").innerHTML = Object.entries(by).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([t, [c, n]]) =>
      `<div class="bar-row${t === S.tinh ? " sel" : ""}" data-t="${esc(t)}" title="${c}/${n} WM+"><span class="bar-name">${esc(t)}</span>
       <div class="bar-track"><div class="bar-fill" style="width:${(c / n) * 100}%"></div></div><span class="bar-val">${pct(c / n)}</span></div>`).join("");

    renderWmTable(scope); renderPairs(scope); renderMap(scope);
  }
  function wmRows(scope) {
    const q = S.q.toLowerCase();
    return scope.filter((i) => !q || S.wm[i].ma.toLowerCase().includes(q) || S.wm[i].ten.toLowerCase().includes(q))
      .map((i) => ({ i, ma: S.wm[i].ma, ten: S.wm[i].ten, tinh: S.wm[i].tinh, n: countIn(S.pairsBy[i], S.R), near: S.near[i] }));
  }
  function renderWmTable(scope) {
    const rows = wmRows(scope).sort((a, b) => (a[S.sortK] > b[S.sortK] ? 1 : a[S.sortK] < b[S.sortK] ? -1 : 0) * S.sortDir);
    $("#wm-count").textContent = `(${fmt(rows.length)})`;
    $("#t-wm tbody").innerHTML = rows.map((r) =>
      `<tr data-i="${r.i}"${r.i === S.sel ? ' class="sel"' : ""}><td>${esc(r.ma)}</td><td>${esc(r.tinh)}</td><td class="num">${r.n}</td><td class="num">${fmt(r.near, 3)}</td></tr>`).join("");
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
      ? `Đang xem WM+ <b>${esc(S.wm[S.sel].ma)}</b> · <button class="link" id="clear-sel">bỏ chọn</button>`
      : `Bấm 1 WM+ (bảng hoặc bản đồ) để xem BHX quanh cửa hàng đó.${rows.length > LIM ? ` Đang hiện ${LIM} cặp gần nhất; Xuất CSV để lấy đủ.` : ""}`;
    $("#t-pairs tbody").innerHTML = rows.slice(0, LIM).map((r) =>
      `<tr><td>${esc(r.wm.ma)}</td><td>${esc(r.b.ma)}</td><td>${esc(r.b.dia_chi)}</td><td class="num">${fmt(r.d, 3)}</td></tr>`).join("");
  }
  function select(i) {
    S.sel = S.sel === i ? null : i;
    if (S.sel != null) map.setView([S.wm[i].lat, S.wm[i].lng], Math.max(map.getZoom(), 13));
    renderOverview();
  }

  // ---------- CSV ----------
  function downloadCsv(name, header, rows) {
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Thay đổi BHX ----------
  let CH = [];
  async function loadChanges() {
    const rad = Math.PI / 180;
    CH = (await API.getChanges()).map((e) => {
      const la = e.lat * rad, lo = e.lng * rad, c = Math.cos(la);
      let n2 = 0, best = Infinity;
      S.wm.forEach((w) => { const d = haversine(la, lo, c, w.lat * rad, w.lng * rad, Math.cos(w.lat * rad)); if (d <= 2) n2++; if (d < best) best = d; });
      return { ...e, n2, near: best };
    });
    const ts = [...new Set(CH.map((e) => e.tinh))].sort();
    $("#c-tinh").innerHTML = `<option value="">Tất cả</option>` + ts.map((t) => `<option>${esc(t)}</option>`).join("");
    renderChanges();
  }
  const TYPE = { open: "Mở mới", close: "Đóng cửa", move: "Dời vị trí" };
  function changeRows() {
    const t = $("#c-type").value, f = $("#c-from").value, p = $("#c-tinh").value;
    return CH.filter((e) => (!t || e.type === t) && (!f || e.date >= f) && (!p || e.tinh === p));
  }
  function renderChanges() {
    const rows = changeRows(), cnt = { open: 0, close: 0, move: 0 };
    rows.forEach((e) => cnt[e.type]++);
    $("#c-kpis").innerHTML = ["open", "close", "move"].map((k) => `<div class="card kpi"><span>${TYPE[k]}</span><b>${cnt[k]}</b></div>`).join("")
      + `<div class="card kpi"><span>Mở mới sát WM+ (≤ 2 km)</span><b>${rows.filter((e) => e.type === "open" && e.n2 > 0).length}</b><small>cần theo dõi</small></div>`;
    $("#t-changes tbody").innerHTML = rows.map((e) =>
      `<tr><td>${esc(e.date)}</td><td><span class="tag ${e.type}">${TYPE[e.type]}</span></td><td>${esc(e.ma)}</td><td>${esc(e.dia_chi)}</td><td>${esc(e.tinh)}</td>
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
    S.wm = snap.wm; S.bhx = snap.bhx; S.sel = null; S.tinh = "";
    const left = snap.wmExpires ? (snap.wmExpires - Date.now()) / 3600e3 : 0;
    $("#snap-info").textContent = `${fmt(S.wm.length)} WM+ (${snap.wmVersion}`
      + (snap.wmExpires ? `, tự xoá ${snap.wmExpires.toLocaleString("vi-VN")} — còn ${fmt(Math.max(left, 0), 0)} giờ` : "")
      + `) · ${fmt(S.bhx.length)} BHX, cập nhật ${snap.bhxUpdated}`;
    computeAll();
    const ts = [...new Set(S.wm.map((w) => w.tinh))].sort();
    $("#tinh").innerHTML = `<option value="">Tất cả</option>` + ts.map((t) => `<option>${esc(t)}</option>`).join("");
    buildBhxAll(); buildWmMarkers(); renderOverview();
    const pts = (S.wm.length ? S.wm : S.bhx).map((w) => [w.lat, w.lng]);   // chưa có WM+ → nhìn toàn bộ BHX
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
    else $("#snap-info").textContent = "Chưa có dữ liệu WM+ (chưa upload hoặc đã tự xoá sau 48 giờ) — Admin vào tab WM+ (upload) để tải file lên.";
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
      + (p.mapping.ten === undefined ? ` · <span class="muted">không có cột Tên → dùng Mã làm Tên</span>` : "");
    const v = WMUpload.validate(p), d = WMUpload.diff(S.wm, v.ok);
    UP.valid = v.ok; UP.diff = d;
    $("#up-kpis").innerHTML = [["Dòng hợp lệ", v.ok.length], ["Dòng lỗi (không đưa lên)", v.bad.length], ["Trùng mã", v.dups.length],
      ["Thêm mới", d.added.length], ["Không còn trong file", d.removed.length], ["Dời > 50 m", d.moved.length]]
      .map(([k, n]) => `<div class="card kpi"><span>${k}</span><b>${fmt(n)}</b></div>`).join("");
    $("#up-issues").innerHTML =
      listTable("Dòng lỗi — sẽ KHÔNG được đưa lên", v.bad, [["Dòng Excel", (r) => r.line], ["Mã", (r) => r.ma], ["Lý do", (r) => r.why], ["Lat", (r) => r.lat], ["Lng", (r) => r.lng]])
      + listTable("Trùng mã — phải sửa file trước khi áp dụng", v.dups, [["Dòng Excel", (r) => r.line], ["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh], ["Lat", (r) => r.lat], ["Lng", (r) => r.lng]]);
    $("#up-diff").innerHTML =
      listTable("WM+ thêm mới", d.added, [["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh]])
      + listTable("WM+ không còn trong file (sẽ bỏ)", d.removed, [["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh]])
      + listTable("WM+ dời vị trí > 50 m", d.moved, [["Mã", (r) => r.ma], ["Tỉnh", (r) => r.tinh], ["Dời (km)", (r) => r.km.toFixed(3)]]);
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
  $("#up-cancel").addEventListener("click", () => { UP = null; $("#up-file").value = ""; $("#up-sheet").innerHTML = ""; $("#up-result").hidden = true; });
  $("#up-apply").addEventListener("click", async () => {
    const d = UP.diff, n = UP.valid.length;
    if (!confirm(`Lưu ${fmt(n)} WM+ thành phiên bản mới?\nThêm ${d.added.length} · bỏ ${d.removed.length} · dời ${d.moved.length}.\nDữ liệu tự xoá sau 48 giờ.`)) return;
    $("#up-apply").disabled = true; $("#up-msg").textContent = "Đang lưu…";
    try {
      const r = await API.publishWm(UP.valid.map(({ ma, ten, tinh, lat, lng }) => ({ ma, ten, tinh, lat, lng })));
      $("#up-msg").textContent = `Đã lưu ${r.version}: ${fmt(r.rows)} WM+.`;
      UP = null; $("#up-file").value = "";
      await loadData(); renderVersions();
    } catch (err) { $("#up-msg").textContent = "Lỗi: " + err.message; $("#up-apply").disabled = false; }
  });

  // Quyền xuất CSV: Admin luôn được; Viewer theo cài đặt. Chỉ là ẩn nút — Viewer vẫn xem được dữ liệu trên màn hình.
  async function applySettings() {
    const st = await API.getSettings();
    const viewerExport = st.viewer_can_export !== false;
    const can = S.user.role === "admin" || viewerExport;
    document.querySelectorAll("#exp-wm, #exp-pairs, #exp-changes").forEach((b) => (b.hidden = !can));
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
  $("#r").addEventListener("input", (e) => { S.R = +e.target.value; $("#r-val").textContent = fmt(S.R, S.R % 1 ? 1 : 0); renderOverview(); });
  $("#tinh").addEventListener("change", (e) => { S.tinh = e.target.value; S.sel = null; renderOverview(); });
  $("#q").addEventListener("input", (e) => { S.q = e.target.value; renderWmTable(scopeIdx()); });
  $("#bars").addEventListener("click", (e) => {
    const r = e.target.closest(".bar-row"); if (!r) return;
    S.tinh = S.tinh === r.dataset.t ? "" : r.dataset.t; $("#tinh").value = S.tinh; S.sel = null; renderOverview();
  });
  $("#t-wm").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (th) { S.sortDir = S.sortK === th.dataset.k ? -S.sortDir : (th.dataset.k === "n" ? -1 : 1); S.sortK = th.dataset.k; renderWmTable(scopeIdx()); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) select(+tr.dataset.i);
  });
  $("#pair-hint").addEventListener("click", (e) => { if (e.target.id === "clear-sel") select(S.sel); });
  $("#exp-wm").addEventListener("click", () => downloadCsv(`wm_R${S.R}km.csv`, ["Mã WM+", "Tên WM+", "Tỉnh", "Bán kính (km)", "Số BHX trong R", "BHX gần nhất (km)", "Lat WM+", "Lng WM+"],
    wmRows(scopeIdx()).map((r) => [r.ma, r.ten, r.tinh, S.R, r.n, r.near, S.wm[r.i].lat, S.wm[r.i].lng])));
  $("#exp-pairs").addEventListener("click", () => downloadCsv(`pairs_R${S.R}km.csv`, ["Mã WM+", "Tỉnh", "Mã BHX", "Địa chỉ BHX", "Khoảng cách (km)", "Lat BHX", "Lng BHX"],
    pairRows(scopeIdx()).map((r) => [r.wm.ma, r.wm.tinh, r.b.ma, r.b.dia_chi, r.d, r.b.lat, r.b.lng])));
  ["#c-type", "#c-from", "#c-tinh"].forEach((s) => $(s).addEventListener("input", renderChanges));
  $("#exp-changes").addEventListener("click", () => downloadCsv("bhx_thay_doi.csv", ["Ngày", "Loại", "Mã BHX", "Địa chỉ", "Tỉnh", "WM+ trong 2 km", "WM+ gần nhất (km)", "Lat", "Lng"],
    changeRows().map((e) => [e.date, TYPE[e.type], e.ma, e.dia_chi, e.tinh, e.n2, e.near.toFixed(3), e.lat, e.lng])));
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
