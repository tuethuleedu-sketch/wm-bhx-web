// Tab "Giá đối thủ": Admin tải file Excel do notebook lấy giá xuất ra (BHX_gia_theo_tinh_*.xlsx), hệ thống lưu lâu dài theo tỉnh để xem xu hướng và so sánh.
// Chỉ lưu giá công khai của đối thủ, không có giá WM. Web không tự gọi API của đối thủ và không giữ token nào.
window.WMPrice = (function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x, d = 0) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x, d = 1) => fmt(x * 100, d) + "%";
  const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.-]/g, "")); return isFinite(n) ? n : 0; };
  const yes = (v) => v === true || v === 1 || /^(true|1|yes)$/i.test(String(v ?? "").trim());
  const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const dayVN = (d) => d.split("-").reverse().join("/");
  const PAGE = 100, UNKNOWN = "Chưa rõ", MAX_POINTS = 26;
  const NEED = ["ID", "SKU_Name", "Price_Normal", "Province", "Store_ID", "Crawl_Date", "Crawl_Complete"];

  let API = null, D = null, C = null, pending = null, wired = false, ADMIN = false, F = { chain: "BHX", mien: "", vung: "", tinh: "", khu: "", l1: "", l2: "", cat: "", brand: "", promo: false, out: false, q: "", page: 0 };

  // Nơi lấy giá: Thành thị giữ đúng tên tỉnh (khớp dữ liệu cũ), Nông thôn thêm " · Nông thôn".
  // Chuỗi khác BHX thêm mã chuỗi ở đầu, ví dụ "KFM: Hồ Chí Minh". BHX giữ nguyên tên tỉnh để khớp dữ liệu cũ.
  const URBAN = "Thành thị", RURAL = "Nông thôn", SUFFIX = " · " + RURAL;
  const CHAINS = { BHX: "Bách Hóa Xanh", COOP: "Co.opmart / Co.op Food", GO: "GO! / Big C / Tops", KFM: "Kingfoodmart", LOTTE: "LOTTE Mart" };
  const CHAIN_RE = /^([A-Z]{2,8}): /;
  const chainOf = (loc) => { const m = CHAIN_RE.exec(loc); return m ? m[1] : "BHX"; };
  const provOf = (loc) => { const s = loc.replace(CHAIN_RE, ""); return s.endsWith(SUFFIX) ? s.slice(0, -SUFFIX.length) : s; };
  const khuOf = (loc) => (loc.endsWith(SUFFIX) ? RURAL : URBAN);
  const locKey = (prov, khu, chain = F.chain || "BHX") => (chain === "BHX" ? "" : chain + ": ") + (khu === RURAL ? prov + SUFFIX : prov);

  // Miền, Vùng theo file WM+ của công ty: tỉnh nào thuộc miền/vùng nào lấy theo số WM nhiều nhất trong tỉnh.
  // Chỉ giữ bảng tỉnh → miền/vùng (không giữ mã, toạ độ WM), để vẫn dùng được khi WM+ đã tự xoá sau 48 giờ.
  // Tỉnh cũ (trước 1/7/2025) → tỉnh mới, để file WM+ ghi tên tỉnh cũ vẫn khớp với tên tỉnh BHX đang dùng.
  const MERGED = { hagiang: "tuyenquang", yenbai: "laocai", backan: "thainguyen", vinhphuc: "phutho", hoabinh: "phutho", bacgiang: "bacninh", thaibinh: "hungyen", haiduong: "haiphong",
    hanam: "ninhbinh", namdinh: "ninhbinh", quangbinh: "quangtri", quangnam: "danang", kontum: "quangngai", binhdinh: "gialai", ninhthuan: "khanhhoa", daknong: "lamdong", binhthuan: "lamdong",
    phuyen: "daklak", binhduong: "hochiminh", bariavungtau: "hochiminh", binhphuoc: "dongnai", longan: "tayninh", soctrang: "cantho", haugiang: "cantho", bentre: "vinhlong", travinh: "vinhlong",
    tiengiang: "dongthap", baclieu: "camau", kiengiang: "angiang", thuathienhue: "hue" };
  const provKey = (s) => { const k = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/^\s*(thanh pho|tinh|tp\.?|t\.)\s*/, "").replace(/[^a-z0-9]/g, ""); return MERGED[k] || k; };
  let REG = {}, regSaved = null;
  const regionOf = (prov) => REG[provKey(prov)] || { mien: "", vung: "" };
  function setRegions(wm) {
    const count = {};
    (wm || []).forEach((w) => {
      const k = provKey(w.tinh), m = w.mien && w.mien !== "-" ? w.mien : "", v = w.vung && w.vung !== "-" ? w.vung : "";
      if (!k || (!m && !v)) return;
      const c = (count[k] = count[k] || {}), key = m + "|" + v;
      c[key] = (c[key] || 0) + 1;
    });
    const next = {};
    Object.entries(count).forEach(([k, c]) => { const [m, v] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0].split("|"); next[k] = { mien: m, vung: v }; });
    if (!Object.keys(next).length) return;
    REG = next;
    saveRegions();
    if (D) { pickProvince(); fillSelects(); render(); }
  }
  // Admin lưu bảng tỉnh → miền/vùng để Viewer và các lần sau dùng được.
  function saveRegions() {
    if (!ADMIN || !API || !API.savePriceRegions || !Object.keys(REG).length || JSON.stringify(REG) === regSaved) return;
    regSaved = JSON.stringify(REG);
    API.savePriceRegions(REG).catch(() => { regSaved = null; });
  }
  // Dòng tổng theo miền (chưa lọc miền) hoặc theo vùng (đã lọc miền): trung bình chỉ số và % khuyến mãi của các tỉnh trong nhóm.
  function regionRows(P, common, iF, iB, ok, mark) {
    const key = F.mien ? "vung" : "mien", groups = new Map();
    P.forEach((p, k) => { const g = regionOf(p.prov)[key]; if (!g) return; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); });
    if (!groups.size || F.vung) return "";
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    return [...groups].sort((a, b) => a[0].localeCompare(b[0], "vi")).map(([g, ks]) => {
      const km = avg(ks.map((k) => { const l = P[k].active.filter(ok); return l.length ? l.filter((x) => x.promo).length / l.length : NaN; }).filter((v) => !isNaN(v)));
      return `<tr class="p-sum"><td><b>${esc(g)}</b></td><td class="muted">${fmt(ks.length)} tỉnh</td><td></td><td></td><td></td><td class="num">${isNaN(km) ? "–" : pct(km)}</td><td class="num">${(() => { const v = avg(ks.map((k) => { const l = P[k].active.filter(ok); return l.length ? l.filter((x) => !x.can).length / l.length : NaN; }).filter((v) => !isNaN(v))); return isNaN(v) ? "–" : pct(v); })()}</td><td class="num">${common.length ? mark(avg(ks.map((k) => iF[k]))) : "–"}</td><td class="num">${common.length ? mark(avg(ks.map((k) => iB[k]))) : "–"}</td></tr>`;
    }).join("");
  }
  // Thành thị so với nông thôn trong từng tỉnh: chỉ tính SKU có giá ở cả 2 cửa hàng. 100 = bằng giá thành thị.
  function renderArea(ok) {
    const rows = [];
    [...D.byT.values()].filter((p) => p.khu === URBAN && inRegion(p)).forEach((u) => {
      const r = D.byT.get(locKey(u.prov, RURAL)); if (!r) return;
      const ru = new Map(r.active.filter((x) => x.final && x.base && ok(x)).map((x) => [x.id, x]));
      const pairs = u.active.filter((x) => x.final && x.base && ok(x) && ru.has(x.id)).map((x) => [x, ru.get(x.id)]);
      const sum = (k, i) => pairs.reduce((a, p) => a + p[i][k], 0), lu = u.active.filter(ok), lr = r.active.filter(ok);
      rows.push({ prov: u.prov, n: pairs.length, iF: pairs.length ? (sum("final", 1) / sum("final", 0)) * 100 : NaN, iB: pairs.length ? (sum("base", 1) / sum("base", 0)) * 100 : NaN,
        ku: lu.length ? lu.filter((x) => x.promo).length / lu.length : NaN, kr: lr.length ? lr.filter((x) => x.promo).length / lr.length : NaN, diff: pairs.filter((p) => p[0].final !== p[1].final).length, dates: u.latest !== r.latest });
    });
    const mark = (v) => (isNaN(v) ? "–" : v >= 101 ? `<span class="p-hi">▲ ${fmt(v, 1)}</span>` : v <= 99 ? `<span class="p-lo">▼ ${fmt(v, 1)}</span>` : fmt(v, 1));
    $("#p-area-note").textContent = rows.length
      ? "Chỉ tính SKU có giá ở cả 2 cửa hàng của tỉnh. 100 = bằng giá cửa hàng thành thị; trên 100 là nông thôn đắt hơn. Mỗi khu vực chỉ 1 cửa hàng nên đây là tham khảo." + (rows.some((r) => r.dates) ? " Có tỉnh lấy giá 2 cửa hàng ở 2 ngày khác nhau." : "")
      : "Chưa có tỉnh nào có giá của cả cửa hàng thành thị và nông thôn. Admin chọn Cả thành thị và nông thôn rồi bấm Cập nhật giá.";
    $("#t-p-area tbody").innerHTML = rows.map((r) => `<tr><td>${esc(r.prov)}${r.dates ? " *" : ""}</td><td>${esc(regionOf(r.prov).vung || "–")}</td><td class="num">${fmt(r.n)}</td><td class="num">${mark(r.iF)}</td><td class="num">${mark(r.iB)}</td><td class="num">${isNaN(r.ku) ? "–" : pct(r.ku)}</td><td class="num">${isNaN(r.kr) ? "–" : pct(r.kr)}</td><td class="num">${r.n ? `${fmt(r.diff)} (${pct(r.diff / r.n)})` : "–"}</td></tr>`).join("");
  }

  // Một dòng của file → dòng để lưu. Mức giảm tính từ giá; không tính được mới dùng cột % của file.
  function toRow(r) {
    const price = num(r.Price_Normal), flash = num(r.Flashsale_Price), sys = num(r.Sys_Price_Original);
    const final = flash > 0 && flash < price ? flash : price, base = sys > final ? sys : price;
    let off = base > 0 && final > 0 ? 1 - final / base : 0;
    if (off < 0.005) off = num(r.Flashsale_DiscountPercent || r.Discount_Percent) / 100;
    if (!(off > 0 && off < 1)) off = 0;
    const title = String(r.Promotion_Title ?? "").trim(), url = String(r.SKU_URL ?? "");
    return {
      tinh: String(r.Province ?? "").trim(), store: String(r.Store_ID ?? "").trim(), id: String(r.ID ?? "").trim(), code: String(r.Product_Code_Barcode ?? "").trim(), name: String(r.SKU_Name ?? "").trim(),
      cat: String(r.Category_Name || r.Category_Name_Mapping || "").trim(), brand: String(r.Brand_Name ?? "").trim(), unit: String(r.Unit_Name ?? "").trim(),
      url: /^https:\/\/www\.bachhoaxanh\.com\//.test(url) ? url : "", final, base, off, title, promo: off > 0 || title !== "" || yes(r.Is_Flashsale),
      can: r.Is_Can_Buy == null || r.Is_Can_Buy === "" ? true : yes(r.Is_Can_Buy),
    };
  }
  // Dữ liệu đã lưu → số liệu dùng chung. D giữ mọi tỉnh; C là tỉnh đang xem.
  function prepare(raw) {
    if (!raw.runs.length) return null;
    const sku = new Map(raw.skus.map((s) => [s.id, s])), series = new Map(), byT = new Map();
    [...raw.hist].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).forEach(([d, tinh, id, final, base]) => { const k = tinh + "|" + id; if (!series.has(k)) series.set(k, []); series.get(k).push([d, final, base]); });
    const items = raw.items.map((x) => { const s = sku.get(x.id) || {}; return { ...x, code: s.code || "", name: s.name || x.id, unit: s.unit || "", url: s.url || "", cat: s.cat || UNKNOWN, grp: s.grp || "", brand: s.brand || UNKNOWN }; })
      .map((x) => { const ch = chainOf(x.tinh), [l1, l2] = ch === "BHX" ? CatTree.of(x.cat) : CatTree.ofGroup(ch, x.grp); return { ...x, l1, l2 }; });
    [...new Set(raw.runs.map((r) => r.tinh))].sort((a, b) => a.localeCompare(b, "vi")).forEach((tinh) => {
      const runs = raw.runs.filter((r) => r.tinh === tinh), dates = [...new Set(runs.map((r) => r.date))].sort().slice(-MAX_POINTS), latest = dates[dates.length - 1], mine = items.filter((x) => x.tinh === tinh);
      byT.set(tinh, { tinh, chain: chainOf(tinh), prov: provOf(tinh), khu: khuOf(tinh), items: mine, active: mine.filter((x) => x.last_seen === latest), dates, latest, prev: dates[dates.length - 2] || "", run: runs.filter((r) => r.date === latest).pop(), stores: new Set(runs.map((r) => r.store).filter(Boolean)) });
    });
    return { byT, series, runs: raw.runs };
  }
  // Giá của SKU tại một ngày ở tỉnh đang xem: dòng lịch sử gần nhất không muộn hơn ngày đó.
  function priceAt(id, date) {
    const s = D.series.get(C.tinh + "|" + id); let hit = null;
    if (s) for (const row of s) { if (row[0] > date) break; hit = row; }
    return hit;
  }
  // Chọn nơi lấy giá theo Miền › Vùng › Tỉnh › Khu vực. Mỗi tỉnh có tối đa 2 nơi: Thành thị và Nông thôn.
  const opt = (v, cur, label = v) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  function pickProvince() {
    if (!D) { C = null; return; }
    const chains = [...new Set([...D.byT.values()].map((p) => p.chain))].sort((a, b) => (a === "BHX" ? -1 : b === "BHX" ? 1 : a.localeCompare(b)));
    if (!chains.includes(F.chain)) F.chain = chains[0];
    $("#p-chain").innerHTML = chains.map((c) => opt(c, F.chain, CHAINS[c] || c)).join("");
    const locs = [...D.byT.values()].filter((p) => p.chain === F.chain);
    const meens = [...new Set(locs.map((p) => regionOf(p.prov).mien).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    if (!meens.includes(F.mien)) F.mien = "";
    const inM = locs.filter((p) => !F.mien || regionOf(p.prov).mien === F.mien);
    const vungs = [...new Set(inM.map((p) => regionOf(p.prov).vung).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    if (!vungs.includes(F.vung)) F.vung = "";
    const inR = inM.filter((p) => !F.vung || regionOf(p.prov).vung === F.vung);
    const provs = [...new Set(inR.map((p) => p.prov))].sort((a, b) => a.localeCompare(b, "vi"));
    if (!provs.includes(F.tinh)) F.tinh = provs[0];
    const khus = [URBAN, RURAL].filter((k) => D.byT.has(locKey(F.tinh, k)));
    if (!khus.includes(F.khu)) F.khu = khus[0];
    C = D.byT.get(locKey(F.tinh, F.khu));
    $("#p-mien").innerHTML = opt("", F.mien, meens.length ? "Tất cả" : "Chưa có (cần file WM+)") + meens.map((v) => opt(v, F.mien)).join("");
    $("#p-vung").innerHTML = opt("", F.vung, "Tất cả") + vungs.map((v) => opt(v, F.vung)).join("");
    $("#p-tinh").innerHTML = provs.map((v) => opt(v, F.tinh)).join("");
    $("#p-khu").innerHTML = khus.map((v) => opt(v, F.khu)).join("");
  }
  // Nơi cùng Miền/Vùng đang lọc (dùng cho bảng so sánh).
  const inRegion = (p) => p.chain === C.chain && (!F.mien || regionOf(p.prov).mien === F.mien) && (!F.vung || regionOf(p.prov).vung === F.vung);
  async function reload() {
    const msg = $("#p-msg");
    try { const raw = await API.getPrices(); if (raw.regions && !Object.keys(REG).length) REG = raw.regions; regSaved = raw.regions ? JSON.stringify(raw.regions) : null; D = prepare(raw); saveRegions(); }
    catch (err) { msg.textContent = `Chưa tải được dữ liệu giá: ${err.message}`; return; }
    pickProvince(); fillSelects(); await ensureHist(); render();
  }
  // Bản Firebase chỉ tải lịch sử của tỉnh đang xem.
  async function ensureHist() {
    if (!C || !API.getPriceHist || C.histLoaded) return;
    C.histLoaded = true;
    try {
      (await API.getPriceHist(C.tinh)).forEach(([d, tinh, id, final, base]) => { const k = tinh + "|" + id; if (!D.series.has(k)) D.series.set(k, []); D.series.get(k).push([d, final, base]); });
      D.series.forEach((s, k) => { if (k.startsWith(C.tinh + "|")) s.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); });
    } catch (err) { C.histLoaded = false; $("#p-msg").textContent = `Chưa tải được lịch sử giá: ${err.message}`; }
  }
  async function readFile(file) {
    const msg = $("#p-msg"), save = $("#p-save");
    pending = null; save.hidden = true;
    msg.textContent = `Đang đọc ${file.name}…`;
    try {
      await WMUpload.ensureLib();
      const wb = WMUpload.readWorkbook(await file.arrayBuffer());
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
      const miss = NEED.filter((c) => !raw.length || !(c in raw[0]));
      if (miss.length) { msg.textContent = `File không đúng mẫu của notebook, thiếu cột: ${miss.join(", ")}. Chưa lưu gì.`; return; }
      const rows = raw.map(toRow).filter((x) => x.id && x.name && x.tinh);
      if (raw.some((r) => !yes(r.Crawl_Complete))) { msg.textContent = "File này là bản chạy thử hoặc lấy chưa đủ (có ngành bị lỗi, token hết hạn...). Hãy chạy lại notebook. Chưa lưu gì."; return; }
      const dates = [...new Set(raw.map((r) => String(r.Crawl_Date ?? "").trim()))];
      if (dates.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0])) { msg.textContent = "Cột Crawl_Date phải có đúng một ngày dạng năm-tháng-ngày. Chưa lưu gì."; return; }
      // Chỉ lưu lâu dài giá đối thủ: file không có link BHX thì không nhận, tránh tải nhầm file giá nội bộ.
      if (rows.filter((x) => x.url).length < rows.length / 2) { msg.textContent = "Phần lớn SKU trong file không có link bachhoaxanh.com nên không giống file giá BHX. Chưa lưu gì."; return; }
      const noPrice = rows.filter((x) => !x.final).length, noCat = rows.filter((x) => !x.cat).length;
      pending = { rows, file: file.name, date: dates[0] };
      save.hidden = false;
      const count = new Map(); rows.forEach((x) => count.set(x.tinh, (count.get(x.tinh) || 0) + 1));
      msg.textContent = `Giá ngày ${dayVN(dates[0])}: ` + [...count].map(([t, n]) => `${t} ${fmt(n)} SKU`).join(", ") + (noPrice || noCat ? `; có ${fmt(noPrice)} dòng không có giá, ${fmt(noCat)} dòng không có tên ngành` : "") + `. Dữ liệu sẽ được lưu lâu dài, kiểm tra rồi bấm Lưu.`;
    } catch (err) { msg.textContent = `Không đọc được file: ${err.message}`; }
  }
  async function savePending(force) {
    const msg = $("#p-msg"), save = $("#p-save");
    if (!pending) return;
    save.disabled = true; msg.textContent = "Đang lưu…";
    try {
      const s = await API.publishPrices(pending.rows, { file: pending.file, date: pending.date }, force);
      pending = null; save.hidden = true;
      msg.textContent = "Đã lưu. " + s.provinces.map((p) => `${p.tinh}: ${fmt(p.rows)} SKU, mới ${fmt(p.added)}, tăng ${fmt(p.up)}, giảm ${fmt(p.down)}, không còn ${fmt(p.gone)}`).join(". ") + ".";
      F = { tinh: F.tinh, l1: "", l2: "", cat: "", brand: "", promo: false, out: false, q: "", page: 0 };
      $("#p-q").value = ""; $("#p-q-sku").value = ""; $("#p-promo").checked = false; $("#p-out").checked = false;
      await reload();
    } catch (err) {
      if (err.code === "PRICE_SHRINK" && !force && window.confirm(`${err.message} File có thể bị thiếu do lấy giá lỗi giữa chừng. Vẫn lưu?`)) { save.disabled = false; return savePending(true); }
      msg.textContent = `Chưa lưu: ${err.message}`;
    }
    save.disabled = false;
  }

  // Lọc ngành theo 3 cấp: ngành lớn › nhóm › ngành BHX.
  const inCat = (x) => (!F.l1 || x.l1 === F.l1) && (!F.l2 || x.l2 === F.l2) && (!F.cat || x.cat === F.cat);
  const filtered = () => {
    const q = plain(F.q);
    return C.active.filter((x) => inCat(x) && (!F.brand || x.brand === F.brand) && (!F.promo || x.promo) && (!F.out || !x.can) && (!q || plain(x.name).includes(q) || plain(x.code).includes(q)));
  };
  // Biểu đồ và bảng theo ngành gom ở cấp ngay dưới cấp đang lọc: chưa chọn gì thì theo ngành lớn, chọn ngành lớn thì theo nhóm, chọn nhóm thì theo ngành.
  const LV = { l1: "ngành lớn", l2: "nhóm", cat: "ngành" };
  const groupKey = () => (!F.l1 ? "l1" : !F.l2 ? "l2" : "cat");
  function fillSelects() {
    const pool = C ? C.active : [];
    const opts = (rows, key, sorter) => [...new Set(rows.map((x) => x[key]))].sort(sorter).map((v) => `<option>${esc(v)}</option>`).join("");
    const byName = (a, b) => a.localeCompare(b, "vi");
    const fill = (el, key, rows, sorter = byName) => { el.innerHTML = `<option value="">Tất cả</option>` + opts(rows, key, sorter); if ([...el.options].some((o) => o.value === F[key])) el.value = F[key]; else { F[key] = ""; el.value = ""; } };
    fill($("#p-l1"), "l1", pool, (a, b) => CatTree.rank(a) - CatTree.rank(b));
    const in1 = pool.filter((x) => !F.l1 || x.l1 === F.l1);
    fill($("#p-l2"), "l2", in1, (a, b) => { const x = in1.find((r) => r.l2 === a), y = in1.find((r) => r.l2 === b); return CatTree.rank(x.l1, a) - CatTree.rank(y.l1, b); });
    fill($("#p-cat"), "cat", in1.filter((x) => !F.l2 || x.l2 === F.l2));
    fill($("#p-brand"), "brand", pool);
  }
  // Chọn một cấp thì xoá lựa chọn ở các cấp dưới.
  function setLevel(key, v) {
    F[key] = v; if (key === "l1") { F.l2 = ""; F.cat = ""; } if (key === "l2") F.cat = "";
    fillSelects();
  }
  function group(rows, key) {
    const m = new Map();
    rows.forEach((x) => { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); });
    return [...m].map(([name, list]) => {
      const promo = list.filter((x) => x.promo).length, offs = list.filter((x) => x.off > 0).map((x) => x.off);
      return { name, n: list.length, promo, rate: promo / list.length, out: list.filter((x) => !x.can).length / list.length, off: median(offs), price: median(list.filter((x) => x.final).map((x) => x.final)) };
    });
  }
  const bar = (label, value, text, title, attr = "") => `<div class="bar-row p-bar" ${attr} title="${esc(title)}"><span class="bar-name">${esc(label)}</span>`
    + `<div class="pbar-track"><div class="pbar-fill p-fill" style="width:${Math.min(100, value * 100)}%"></div></div><span class="p-val">${text}</span></div>`;

  // ---------- Tổng quan: KPI có so với lần trước, và các điểm cần chú ý ----------
  // "Giảm giá" = giá bán thấp hơn giá gốc. Dùng định nghĩa này khi so với lần trước vì lịch sử chỉ lưu giá, không lưu nhãn khuyến mãi.
  const isDisc = (final, base) => final > 0 && base > final;
  const share = (a, b) => (b ? a / b : NaN);
  // Số liệu của các SKU (theo bộ lọc ngành, thương hiệu) tại mốc trước, dựng lại từ lịch sử giá.
  function prevStats(keyOf) {
    if (!C.prev) return null;
    const d = C.prev, list = [];
    C.items.forEach((x) => {
      if (!inCat(x) || (F.brand && x.brand !== F.brand) || x.first_seen > d || x.last_seen < d) return;
      const h = priceAt(x.id, d); if (!h || !h[1]) return;
      list.push({ x, final: h[1], base: h[2] });
    });
    const stat = (l) => { const offs = l.filter((r) => isDisc(r.final, r.base)).map((r) => 1 - r.final / r.base); return { n: l.length, disc: share(offs.length, l.length), off: median(offs) }; };
    const out = { all: stat(list) };
    if (keyOf) { const g = new Map(); list.forEach((r) => { const k = keyOf(r.x); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }); out.by = new Map([...g].map(([k, l]) => [k, stat(l)])); }
    return out;
  }
  const nowStat = (rows) => { const offs = rows.filter((x) => isDisc(x.final, x.base)).map((x) => 1 - x.final / x.base); return { n: rows.length, disc: share(offs.length, rows.filter((x) => x.final).length), off: median(offs) }; };
  // Mũi tên so với lần trước. Tăng tô đỏ (BHX mạnh tay hơn), giảm tô xanh.
  const delta = (now, before, unit = "điểm") => {
    if (!isFinite(now) || !isFinite(before)) return "";
    const d = (now - before) * 100;
    if (Math.abs(d) < 0.05) return `<em class="p-delta">không đổi so với ${dayVN(C.prev)}</em>`;
    return `<em class="p-delta ${d > 0 ? "p-hi" : "p-lo"}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d), 1)} ${unit} so với ${dayVN(C.prev)}</em>`;
  };
  function locIndex() {
    const cmp = compareCalc(), k = cmp.P.indexOf(C);
    if (cmp.P.length < 2 || k < 0 || !cmp.common.length) return null;
    const order = cmp.P.map((p, i) => [p, cmp.iF[i]]).sort((a, b) => a[1] - b[1]);
    return { iF: cmp.iF[k], iB: cmp.iB[k], rank: order.findIndex((o) => o[0] === C) + 1, of: cmp.P.length, cheapest: order[0][0].prov, dearest: order[order.length - 1][0].prov, common: cmp.common.length };
  }
  function oosRuns() {
    const byDate = new Map();
    D.runs.filter((r) => r.tinh === C.tinh && r.n && r.oos !== undefined).forEach((r) => byDate.set(r.date, r));
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function renderKpis(rows, s) {
    const n = rows.length, now = nowStat(rows), prev = prevStats(), idx = locIndex(), runs = oosRuns();
    const noCatFilter = !F.l1 && !F.l2 && !F.cat && !F.brand && !F.q && !F.promo && !F.out;
    const oosNow = share(s.out, n), oosPrev = noCatFilter && runs.length >= 2 && runs[runs.length - 1].date === C.latest ? runs[runs.length - 2] : null;
    const kpi = (label, value, sub, d = "") => `<div class="card kpi"><span>${label}</span><b>${value}</b>${d}<small>${sub}</small></div>`;
    $("#p-kpis").innerHTML = [
      kpi("% SKU đang giảm giá", isFinite(now.disc) ? pct(now.disc) : "–", `${fmt(n)} SKU trong bộ lọc; có KM tính cả nhãn quà tặng: ${pct(share(s.promo, n))}`, prev ? delta(now.disc, prev.all.disc) : ""),
      kpi("Mức giảm trung vị", s.offs.length ? pct(median(s.offs)) : "–", `trên ${fmt(s.offs.length)} SKU có giảm; ${fmt(s.deep)} SKU giảm từ 30%`, prev ? delta(now.off, prev.all.off) : ""),
      kpi("% SKU không mua được", isFinite(oosNow) ? pct(oosNow) : "–", `${fmt(s.out)} SKU hết hàng hoặc ngừng bán tại cửa hàng này`, oosPrev ? delta(oosNow, oosPrev.oos / oosPrev.n) : ""),
      kpi("Chỉ số giá bán", idx ? fmt(idx.iF, 1) : "–", idx ? `so với trung bình ${fmt(idx.of)} tỉnh (= 100), cùng khu vực; rẻ thứ ${fmt(idx.rank)}/${fmt(idx.of)}` : "cần giá của ít nhất 2 tỉnh cùng khu vực"),
    ].join("");
  }
  // Nhận định tự động: chỉ nêu khi vượt ngưỡng, xếp theo độ lớn. Mỗi nhận định có việc gợi ý và chỗ xem chi tiết.
  const TH = { disc: 0.05, discAll: 0.03, idx: 2, area: 1, oos: 0.02, minN: 10, minCommon: 30 };
  function renderInsights(rows) {
    const out = [], gk = groupKey(), lv = LV[gk], scope = F.l2 || F.l1 || "";
    const add = (score, tag, text, act, go) => out.push({ score, tag, text, act, go });
    const prev = prevStats((x) => x[gk]);
    if (prev) {
      const now = nowStat(rows), d = now.disc - prev.all.disc;
      if (Math.abs(d) >= TH.discAll) add(Math.abs(d) * 100, "Khuyến mãi", `${scope ? esc(scope) + ": " : ""}% SKU đang giảm giá ${d > 0 ? "tăng" : "giảm"} từ ${pct(prev.all.disc)} lên ${pct(now.disc)} so với ${dayVN(C.prev)}.`,
        d > 0 ? "BHX đang tăng cường khuyến mãi. Rà lại chương trình khuyến mãi của WM ở cùng nhóm hàng và khu vực." : "BHX đang rút bớt khuyến mãi. Có thể là thời điểm giữ giá, không cần chạy theo.", "promo");
      const moves = group(rows, gk).map((g) => { const p = prev.by.get(g.name); const nd = nowStat(rows.filter((x) => x[gk] === g.name)); return p && g.n >= TH.minN && p.n >= TH.minN ? { name: g.name, now: nd.disc, before: p.disc, d: nd.disc - p.disc } : null; })
        .filter((m) => m && Math.abs(m.d) >= TH.disc).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
      moves.forEach((m) => add(Math.abs(m.d) * 100, "Khuyến mãi", `<b>${esc(m.name)}</b>: % SKU đang giảm giá ${m.d > 0 ? "tăng" : "giảm"} từ ${pct(m.before)} lên ${pct(m.now)} (${m.d > 0 ? "+" : ""}${fmt(m.d * 100, 1)} điểm).`,
        m.d > 0 ? `BHX đang đẩy ${lv} này. Đội ngành hàng nên xem lại giá và khuyến mãi của WM cho ${lv} này.` : `BHX giảm khuyến mãi ở ${lv} này.`, "promo"));
      // Giá gốc tăng mới là tăng giá thật
      const upBase = rows.filter((x) => { const h = priceAt(x.id, C.prev); return h && h[2] && x.base > h[2] * 1.005; });
      if (upBase.length >= Math.max(10, rows.length * 0.03)) {
        const top = group(upBase, gk).sort((a, b) => b.n - a.n)[0];
        add(upBase.length / rows.length * 100, "Giá", `<b>${fmt(upBase.length)} SKU tăng giá gốc</b> so với ${dayVN(C.prev)} (tăng giá thật, không phải hết khuyến mãi), nhiều nhất ở ${esc(top.name)} (${fmt(top.n)} SKU).`,
          "Cơ hội giữ hoặc điều chỉnh giá WM ở các SKU này. Xem danh sách ở tab Xu hướng.", "trend");
      }
    }
    const idx = locIndex();
    if (idx && idx.common >= TH.minCommon && Math.abs(idx.iF - 100) >= TH.idx) {
      const viaPromo = Math.abs(idx.iB - 100) < TH.idx;
      add(Math.abs(idx.iF - 100), "So sánh vùng", `${esc(C.prov)} (${esc(C.khu.toLowerCase())}) có chỉ số giá bán <b>${fmt(idx.iF, 1)}</b>, ${idx.iF < 100 ? "rẻ" : "đắt"} hơn trung bình ${fmt(idx.of)} tỉnh${viaPromo ? `, chủ yếu do khuyến mãi (giá gốc ${fmt(idx.iB, 1)})` : ` (giá gốc ${fmt(idx.iB, 1)})`}. Rẻ nhất: ${esc(idx.cheapest)}, đắt nhất: ${esc(idx.dearest)}.`,
        idx.iF < 100 ? (viaPromo ? "BHX cạnh tranh bằng khuyến mãi ở đây, không phải hạ giá gốc. Theo dõi khi khuyến mãi kết thúc." : "Mặt bằng giá BHX ở đây thấp. Cân nhắc khi định giá WM cho tỉnh này.") : "BHX đang để giá cao hơn ở đây. Có dư địa cạnh tranh về giá cho WM.", "region");
    }
    const other = D.byT.get(locKey(C.prov, C.khu === URBAN ? RURAL : URBAN));
    if (other) {
      const u = C.khu === URBAN ? C : other, r = C.khu === URBAN ? other : C, ok = (x) => inCat(x) && (!F.brand || x.brand === F.brand);
      const rm = new Map(r.active.filter((x) => x.final && ok(x)).map((x) => [x.id, x])), pairs = u.active.filter((x) => x.final && ok(x) && rm.has(x.id)).map((x) => [x.final, rm.get(x.id).final]);
      if (pairs.length >= TH.minCommon) {
        const v = (pairs.reduce((a, p) => a + p[1], 0) / pairs.reduce((a, p) => a + p[0], 0)) * 100;
        if (Math.abs(v - 100) >= TH.area) add(Math.abs(v - 100), "So sánh vùng", `Ở ${esc(C.prov)}, cửa hàng nông thôn ${v < 100 ? "rẻ" : "đắt"} hơn thành thị <b>${fmt(Math.abs(v - 100), 1)}%</b> trên ${fmt(pairs.length)} SKU chung.`,
          v < 100 ? "BHX định giá riêng cho nông thôn. Cân nhắc mặt bằng giá riêng cho WM vùng nông thôn." : "Nông thôn không rẻ hơn. WM nông thôn có thể cạnh tranh bằng giá.", "region");
      }
    }
    const deep = rows.filter((x) => x.off >= 0.3);
    if (deep.length >= 5) {
      const top = group(deep, gk).sort((a, b) => b.n - a.n)[0];
      add(Math.min(5, deep.length / 10), "Khuyến mãi", `<b>${fmt(deep.length)} SKU giảm từ 30%</b> trở lên, nhiều nhất ở ${esc(top.name)} (${fmt(top.n)} SKU).`, "Danh sách SKU giảm sâu để đội ngành hàng đối chiếu, nằm ở tab Danh sách SKU.", "sku");
    }
    const runs = oosRuns();
    if (runs.length >= 2 && runs[runs.length - 1].date === C.latest) {
      const a = runs[runs.length - 2], b = runs[runs.length - 1], d = b.oos / b.n - a.oos / a.n;
      if (Math.abs(d) >= TH.oos) {
        const nowOut = C.active.filter((x) => !x.can), top = nowOut.length ? group(nowOut, "l2").sort((x, y) => y.n - x.n)[0] : null;
        add(Math.abs(d) * 100, "Hết hàng", `% SKU không mua được ${d > 0 ? "tăng" : "giảm"} từ ${pct(a.oos / a.n)} lên ${pct(b.oos / b.n)}${top ? `; nhiều nhất ở ${esc(top.name)} (${fmt(top.n)} SKU)` : ""}.`,
          d > 0 ? "BHX đang thiếu hàng ở cửa hàng này. Cơ hội để WM gần đó đảm bảo đủ hàng ở các nhóm này." : "BHX đã bổ sung hàng.", "trend");
      }
    }
    out.sort((a, b) => b.score - a.score);
    $("#p-insights").innerHTML = out.slice(0, 6).map((i) => `<li><span class="p-tag">${i.tag}</span><p>${i.text}</p><p class="p-act">→ ${esc(i.act)}</p><button class="link small" data-go="${i.go}">Xem chi tiết</button></li>`).join("")
      || `<li class="muted">Chưa có thay đổi nào vượt ngưỡng${C.prev ? ` so với ${dayVN(C.prev)}` : ""}.${C.prev ? "" : " Cần ít nhất 2 lần lấy giá ở 2 ngày khác nhau để so sánh."}${D.byT.size < 2 ? " Cần giá của ít nhất 2 tỉnh để so sánh vùng." : ""}</li>`;
  }
  // Tab con: nhớ tab đang mở trên máy này.
  function setTab(name) {
    const ok = ["overview", "promo", "region", "trend", "sku"].includes(name) ? name : "overview";
    document.querySelectorAll("#p-tabs [data-ptab]").forEach((b) => { b.classList.toggle("on", b.dataset.ptab === ok); b.setAttribute("aria-selected", b.dataset.ptab === ok); });
    document.querySelectorAll("#view-price .p-pane").forEach((p) => (p.hidden = p.dataset.pane !== ok));
    try { localStorage.setItem("wmbhx_ptab", ok); } catch (_) {}
  }

  function render() {
    const has = !!D;
    $("#p-empty").hidden = has; $("#p-report").hidden = !has;
    if (!has) return;
    const rows = filtered(), promo = rows.filter((x) => x.promo), offs = rows.filter((x) => x.off > 0).map((x) => x.off), deep = rows.filter((x) => x.off >= 0.3).length, out = rows.filter((x) => !x.can).length;
    const n = rows.length, share = (k) => (n ? k / n : 0), run = C.run;
    $("#p-source").innerHTML = `<b>${esc(CHAINS[C.chain] || C.chain)}</b> · <b>${esc(C.prov)}</b> · ${esc(C.khu.toLowerCase())}${regionOf(C.prov).vung ? ` · ${esc(regionOf(C.prov).vung)}` : ""} · giá ngày <b>${dayVN(C.latest)}</b>${run.at ? ` (cập nhật lúc ${esc(new Date(run.at).toLocaleString("vi-VN"))})` : ""}${run.store ? ` · cửa hàng ${esc(run.store)}${run.addr ? ` (${esc(run.addr)})` : ""}` : ""}${run.file ? ` · ${esc(run.file)}` : ""} · ${fmt(C.dates.length)} mốc giá. Giá website của 1 cửa hàng, chưa đại diện cho cả tỉnh.`
      + (C.stores.size > 1 ? ` <b>Tỉnh này đã dùng ${fmt(C.stores.size)} cửa hàng khác nhau nên xu hướng có thể không so sánh được.</b>` : "");
    const noPrice = C.active.filter((x) => !x.final).length, noCat = C.active.filter((x) => x.cat === UNKNOWN).length, noBrand = C.active.filter((x) => x.brand === UNKNOWN).length;
    const warn = [noPrice && `${fmt(noPrice)} SKU không có giá`, noCat && `${fmt(noCat)} SKU không có tên ngành`, noBrand && `${fmt(noBrand)} SKU không có thương hiệu`].filter(Boolean);
    $("#p-quality").hidden = !warn.length;
    $("#p-quality").textContent = warn.length ? `Cần kiểm tra file: ${warn.join(", ")}.` : "";
    const hiddenOn = [F.brand, F.q, F.promo, F.out].filter(Boolean).length;   // bộ lọc đang bật nhưng nằm trong phần thu gọn
    if ($("#p-more").hidden) $("#p-more-btn").textContent = hiddenOn ? `Thêm bộ lọc (${hiddenOn} đang bật)` : "Thêm bộ lọc";
    renderKpis(rows, { promo: promo.length, offs, deep, out });
    renderInsights(rows);
    const gk = groupKey(), cats = group(rows, gk).sort((a, b) => b.rate - a.rate);
    $("#p-cats-title").textContent = `% SKU có khuyến mãi theo ${LV[gk]}`;
    $("#p-cats-note").textContent = `${cats.length > 15 ? `15 ${LV[gk]} cao nhất` : `Tất cả ${LV[gk]}`}${F.l1 ? ` trong ${F.l2 || F.l1}` : ""}. Bấm một dòng để xem chi tiết bên trong.`;
    $("#p-cat-head").textContent = LV[gk][0].toUpperCase() + LV[gk].slice(1);
    $("#p-cat-title").textContent = `Chi tiết theo ${LV[gk]}`;
    $("#p-cats").innerHTML = cats.slice(0, 15).map((g) => bar(g.name, g.rate, pct(g.rate, 0), `${g.name}: ${fmt(g.promo)}/${fmt(g.n)} SKU có khuyến mãi. Bấm để lọc.`, `data-lv="${gk}" data-cat="${esc(g.name)}"`)).join("") || `<p class="muted small">Không có SKU nào.</p>`;
    const BUCKET = [["Dưới 10%", 0, 0.1], ["10–19%", 0.1, 0.2], ["20–29%", 0.2, 0.3], ["30–49%", 0.3, 0.5], ["Từ 50%", 0.5, 1]];
    const counts = BUCKET.map(([, a, b]) => offs.filter((v) => v >= a && v < b).length), top = Math.max(1, ...counts);
    $("#p-dist").innerHTML = BUCKET.map(([t], k) => bar(t, counts[k] / top, fmt(counts[k]), `${t}: ${fmt(counts[k])} SKU`)).join("");
    $("#t-p-cat tbody").innerHTML = cats.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(g.n)}</td><td class="num">${pct(g.rate)}</td><td class="num">${isNaN(g.off) ? "–" : pct(g.off)}</td><td class="num">${isNaN(g.price) ? "–" : fmt(g.price)}</td><td class="num">${pct(g.out)}</td></tr>`).join("");
    const brands = group(rows, "brand").filter((g) => g.promo).sort((a, b) => b.promo - a.promo || b.rate - a.rate).slice(0, 10);
    $("#t-p-brand tbody").innerHTML = brands.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(g.promo)}</td><td class="num">${fmt(g.n)}</td><td class="num">${pct(g.rate)}</td><td class="num">${isNaN(g.off) ? "–" : pct(g.off)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Không có thương hiệu nào đang khuyến mãi.</td></tr>`;
    renderCompare();
    renderOut();
    renderTrend(rows);
    renderChanges(rows);
    renderSku(rows);
    $("#t-p-runs tbody").innerHTML = [...D.runs].reverse().slice(0, 60).map((r) => `<tr><td>${dayVN(r.date)}</td><td>${esc(r.tinh)}</td><td>${esc(r.file)}</td><td>${esc(r.store)}</td><td>${esc(r.by)}</td><td class="num">${fmt(r.n)}</td><td class="num">${fmt(r.added)}</td><td class="num">${fmt(r.up)}</td><td class="num">${fmt(r.down)}</td><td class="num">${fmt(r.gone)}</td></tr>`).join("");
  }
  // So sánh dùng rổ chung: chỉ SKU có giá ở mọi tỉnh, để chỉ số không lệch vì mỗi tỉnh bán danh mục khác nhau. Trung bình các tỉnh = 100.
  function compareCalc() {
    const P = [...D.byT.values()].filter((p) => p.khu === F.khu && inRegion(p));
    const ok = (x) => inCat(x) && (!F.brand || x.brand === F.brand);
    const map = new Map();
    P.forEach((p, k) => p.active.forEach((x) => { if (!x.final || !x.base || !ok(x)) return; if (!map.has(x.id)) map.set(x.id, { x, at: new Array(P.length).fill(null) }); map.get(x.id).at[k] = x; }));
    const common = [...map.values()].filter((m) => m.at.every(Boolean));
    const indexOf = (list, key) => {
      const sum = P.map((_, k) => list.reduce((a, m) => a + m.at[k][key], 0)), avg = sum.reduce((a, b) => a + b, 0) / P.length;
      return sum.map((v) => (avg ? (v / avg) * 100 : NaN));
    };
    return { P, ok, common, indexOf, iF: indexOf(common, "final"), iB: indexOf(common, "base") };
  }
  // Tỷ lệ SKU không mua được (hết hàng hoặc ngừng bán) qua các lần lấy giá của nơi đang xem. Chỉ có từ khi hệ thống bắt đầu ghi số này.
  function renderOut() {
    const runs = D.runs.filter((r) => r.tinh === C.tinh && r.n && r.oos !== undefined);
    const byDate = new Map(); runs.forEach((r) => byDate.set(r.date, r));
    const list = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-12);
    const top = list.length ? Math.max(...list.map((r) => r.oos / r.n)) || 1 : 1;
    $("#p-out-trend").innerHTML = list.length
      ? list.map((r) => bar(dayVN(r.date), r.oos / r.n / top, `${pct(r.oos / r.n)} (${fmt(r.oos)}/${fmt(r.n)})`, `${dayVN(r.date)}: ${fmt(r.oos)} trên ${fmt(r.n)} SKU không mua được`)).join("")
      : `<p class="muted small">Chưa có số liệu. Từ lần cập nhật giá tiếp theo, mỗi lần lấy giá sẽ ghi số SKU không mua được của cửa hàng.</p>`;
  }
  function renderCompare() {
    const { P, ok, common, indexOf, iF, iB } = compareCalc(), many = P.length >= 2;
    $("#p-compare-title").textContent = `So sánh giá giữa các tỉnh · cửa hàng ${F.khu.toLowerCase()}`;
    renderArea(ok);
    $("#p-compare-need").hidden = many; $("#p-compare-body").hidden = !many && !$("#t-p-area tbody").children.length;
    $("#p-compare-need").textContent = `Cần dữ liệu cửa hàng ${F.khu.toLowerCase()} của ít nhất 2 tỉnh${F.mien || F.vung ? " trong vùng đang lọc" : ""}.`;
    ["#t-p-prov", "#t-p-matrix", "#t-p-gap"].forEach((s) => ($(s).closest(".table-wrap").hidden = !many));
    if (!many) return;
    const dates = new Set(P.map((p) => p.latest));
    $("#p-compare-note").innerHTML = `Chỉ so cửa hàng <b>${esc(F.khu.toLowerCase())}</b>${F.vung ? ` trong vùng ${esc(F.vung)}` : F.mien ? ` trong ${esc(F.mien)}` : ""}. Rổ chung ${fmt(common.length)} SKU có giá ở cả ${fmt(P.length)} tỉnh; trung bình các tỉnh = 100. Trên 100 là đắt hơn trung bình. Giá gốc cho thấy mặt bằng giá; giá bán đã gồm khuyến mãi.`
      + (dates.size > 1 ? ` <b>Các tỉnh có ngày lấy giá khác nhau nên so sánh chỉ mang tính tham khảo.</b>` : "");
    const mark = (v) => (isNaN(v) ? "–" : v >= 102 ? `<span class="p-hi">▲ ${fmt(v, 1)}</span>` : v <= 98 ? `<span class="p-lo">▼ ${fmt(v, 1)}</span>` : fmt(v, 1));
    $("#t-p-prov tbody").innerHTML = P.map((p, k) => {
      const list = p.active.filter(ok), on = list.filter((x) => x.promo).length;
      return `<tr><td>${esc(p.prov)}</td><td>${esc(regionOf(p.prov).vung || "–")}</td><td>${esc(p.run.store)}</td><td>${dayVN(p.latest)}</td><td class="num">${fmt(list.length)}</td><td class="num">${list.length ? pct(on / list.length) : "–"}</td><td class="num">${list.length ? pct(list.filter((x) => !x.can).length / list.length) : "–"}</td><td class="num">${common.length ? mark(iF[k]) : "–"}</td><td class="num">${common.length ? mark(iB[k]) : "–"}</td></tr>`;
    }).join("") + regionRows(P, common, iF, iB, ok, mark);
    const cats = [...new Set(common.map((m) => m.x.cat))].sort((a, b) => a.localeCompare(b, "vi"));
    $("#t-p-matrix thead").innerHTML = `<tr><th>Chỉ số giá bán theo ngành</th>${P.map((p) => `<th class="num">${esc(p.prov)}</th>`).join("")}</tr>`;
    $("#t-p-matrix tbody").innerHTML = cats.map((c) => { const v = indexOf(common.filter((m) => m.x.cat === c), "final"); return `<tr><td>${esc(c)}</td>${v.map((a) => `<td class="num">${mark(a)}</td>`).join("")}</tr>`; }).join("") || `<tr><td class="muted">Không có SKU chung.</td></tr>`;
    const gaps = common.map((m) => { const f = m.at.map((x) => x.final), lo = Math.min(...f), hi = Math.max(...f); return { m, gap: hi / lo - 1, lo, hi }; }).filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 15);
    $("#t-p-gap thead").innerHTML = `<tr><th>SKU</th><th>Ngành</th>${P.map((p) => `<th class="num">${esc(p.prov)} (đ)</th>`).join("")}<th class="num">Chênh cao/thấp</th></tr>`;
    $("#t-p-gap tbody").innerHTML = gaps.map((g) => `<tr><td>${esc(g.m.x.name)}</td><td>${esc(g.m.x.cat)}</td>${g.m.at.map((x) => `<td class="num">${x.final === g.hi ? `<span class="p-hi">${fmt(x.final)}</span>` : x.final === g.lo ? `<span class="p-lo">${fmt(x.final)}</span>` : fmt(x.final)}</td>`).join("")}<td class="num">${pct(g.gap)}</td></tr>`).join("") || `<tr><td colspan="${P.length + 3}" class="muted">Không có SKU chênh giá.</td></tr>`;
  }
  // Rổ cố định: SKU trong bộ lọc có giá ở mọi mốc, nên chỉ số không đổi vì SKU mới vào hay SKU biến mất.
  function trendCalc(rows) {
    const ds = C.dates, sum = ds.map(() => [0, 0]);
    let basket = 0;
    rows.forEach((x) => {
      const at = ds.map((d) => priceAt(x.id, d));
      if (at.some((h) => !h || !h[1] || !h[2])) return;
      basket++; at.forEach((h, k) => { sum[k][0] += h[1]; sum[k][1] += h[2]; });
    });
    const scope = C.items.filter((x) => inCat(x) && (!F.brand || x.brand === F.brand));
    const rate = ds.map((d) => {
      let on = 0, all = 0;
      scope.forEach((x) => { if (x.first_seen > d || x.last_seen < d) return; const h = priceAt(x.id, d); if (!h || !h[1]) return; all++; if (h[2] > h[1]) on++; });
      return all ? (on / all) * 100 : 0;
    });
    return { sum, basket, rate };
  }
  function renderTrend(rows) {
    const ds = C.dates, enough = ds.length >= 2;
    $("#p-trend-need").hidden = enough; $("#p-trend-body").hidden = !enough;
    if (!enough) return;
    const { sum, basket, rate } = trendCalc(rows);
    $("#p-basket-n").textContent = `Rổ cố định ${fmt(basket)} SKU; lần đầu = 100.`;
    lineChart($("#p-index"), basket ? [{ name: "Giá bán", cls: "bhx", v: sum.map((s) => (s[0] / sum[0][0]) * 100) }, { name: "Giá gốc", cls: "base", v: sum.map((s) => (s[1] / sum[0][1]) * 100) }] : [], (v) => fmt(v, 1));
    lineChart($("#p-rate"), [{ name: "% SKU giảm giá", cls: "bhx", v: rate }], (v) => fmt(v, 1) + "%");
  }
  function lineChart(el, series, label) {
    if (!series.length) { el.innerHTML = `<p class="muted small">Không có SKU nào có giá ở mọi mốc.</p>`; return; }
    const ds = C.dates, w = 620, h = 210, L = 44, R = series.length > 1 ? 104 : 60, T = 12, B = 26, all = series.flatMap((s) => s.v);
    let lo = Math.min(...all), hi = Math.max(...all); const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
    const X = (i) => L + (i * (w - L - R)) / (ds.length - 1), Y = (v) => T + ((hi - v) * (h - T - B)) / (hi - lo);
    const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3), every = Math.ceil(ds.length / 6);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="p-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="p-axis">${fmt(v, 1)}</text>`).join("");
    const xs = ds.map((d, i) => ((ds.length - 1 - i) % every ? "" : `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" class="p-axis">${dayVN(d).slice(0, 5)}</text>`)).join("");
    const end = ds.length - 1, ends = series.map((s) => Y(s.v[end]));
    if (ends.length === 2 && Math.abs(ends[0] - ends[1]) < 14) { const m = (ends[0] + ends[1]) / 2, up = ends[0] <= ends[1] ? -7 : 7; ends[0] = m + up; ends[1] = m - up; }
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.name).join(", "))} theo thời gian">${grid}${xs}`
      + series.map((s, k) => `<path d="${s.v.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("")}" class="p-line ${s.cls}"/>`
        + s.v.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4" class="p-dot ${s.cls}"><title>${dayVN(ds[i])}, ${esc(s.name)}: ${label(v)}</title></circle>`).join("")
        + (series.length > 1 ? `<text x="${X(end) + 10}" y="${ends[k] + 4}" class="p-label">${esc(s.name)} ${label(s.v[end])}</text>` : `<text x="${X(end) + 10}" y="${ends[k] + 4}" class="p-label">${label(s.v[end])}</text>`)).join("") + `</svg>`
      + (series.length > 1 ? `<div class="legend small">${series.map((s) => `<span><i class="dot p-key ${s.cls}"></i>${esc(s.name)}</span>`).join("")}</div>` : "");
  }
  const changeOf = (x) => {
    if (!C.prev) return null;
    const h = priceAt(x.id, C.prev);
    return h && h[1] && x.final && h[1] !== x.final ? { from: h[1], to: x.final, d: x.final / h[1] - 1 } : null;
  };
  function renderChanges(rows) {
    const has = !!C.prev;
    $("#p-change-need").hidden = has; $("#p-change-body").hidden = !has;
    if (!has) return;
    const moved = rows.map((x) => ({ x, c: changeOf(x) })).filter((r) => r.c), up = moved.filter((r) => r.c.d > 0).length;
    const fresh = rows.filter((x) => x.first_seen === C.latest).length;
    const gone = C.items.filter((x) => x.last_seen === C.prev && inCat(x) && (!F.brand || x.brand === F.brand)).length;
    $("#p-change-sum").textContent = `So với ${dayVN(C.prev)}: ${fmt(up)} SKU tăng giá, ${fmt(moved.length - up)} SKU giảm giá, ${fmt(fresh)} SKU mới, ${fmt(gone)} SKU không còn trong file. Tính theo giá bán, gồm cả khuyến mãi.`;
    $("#t-p-change tbody").innerHTML = moved.sort((a, b) => Math.abs(b.c.d) - Math.abs(a.c.d)).slice(0, 10).map(({ x, c }) => `<tr><td>${esc(x.name)}</td><td>${esc(x.cat)}</td><td class="num">${fmt(c.from)}</td><td class="num">${fmt(c.to)}</td><td class="num">${c.d > 0 ? "+" : ""}${pct(c.d)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Không có SKU nào đổi giá.</td></tr>`;
  }
  function renderSku(rows) {
    const sorted = [...rows].sort((a, b) => b.off - a.off || a.name.localeCompare(b.name, "vi")), pages = Math.max(1, Math.ceil(sorted.length / PAGE));
    F.page = Math.min(F.page, pages - 1);
    $("#p-count").textContent = `(${fmt(sorted.length)})`;
    $("#t-p-sku tbody").innerHTML = sorted.slice(F.page * PAGE, (F.page + 1) * PAGE).map((x) => {
      const c = changeOf(x);
      return `<tr><td>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>` : esc(x.name)}</td><td>${esc(x.cat)}</td><td>${esc(x.brand)}</td><td>${esc(x.unit)}</td>`
        + `<td class="num">${x.final ? fmt(x.final) : "–"}</td><td class="num">${x.base > x.final ? fmt(x.base) : ""}</td><td class="num">${x.off ? pct(x.off, 0) : ""}</td><td class="num">${c ? (c.d > 0 ? "+" : "") + pct(c.d) : ""}</td><td>${esc(x.title)}</td><td>${x.can ? "" : "Không mua được"}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="muted">Không có SKU nào trong bộ lọc.</td></tr>`;
    $("#p-pager").innerHTML = pages > 1 ? `<span class="muted">Trang ${fmt(F.page + 1)}/${fmt(pages)}</span><button class="link" data-p="-1"${F.page ? "" : " disabled"}>Trước</button><button class="link" data-p="1"${F.page < pages - 1 ? "" : " disabled"}>Sau</button>` : "";
  }
  // Tên SKU lấy từ web ngoài: chặn ô bị Excel hiểu là công thức khi mở file CSV.
  function exportCsv() {
    const safe = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["Tỉnh", "Cửa hàng", "Ngày giá", "Mã", "Tên SKU", "Ngành", "Thương hiệu", "Đơn vị", "Giá hiện tại", "Giá gốc", "% giảm", "Khuyến mãi", "Mua được", "Link"];
    const body = filtered().map((x) => [x.tinh, x.store, C.latest, x.code, x.name, x.cat, x.brand, x.unit, x.final, x.base, x.off ? +(x.off * 100).toFixed(1) : "", x.title, x.can ? "Có" : "Không", x.url]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...body].map((r) => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `gia_bhx_${plain(C.tinh).replace(/[^a-z0-9]+/g, "_")}_${C.latest}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function wire() {
    if (wired) return; wired = true;
    const refresh = () => { F.page = 0; if (D) render(); };
    $("#p-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) readFile(f); });
    $("#p-save").addEventListener("click", () => savePending(false));
    const relocate = (key) => async (e) => { F[key] = e.target.value; F.page = 0; pickProvince(); fillSelects(); await ensureHist(); render(); };
    $("#p-chain").addEventListener("change", relocate("chain"));
    $("#p-mien").addEventListener("change", relocate("mien"));
    $("#p-vung").addEventListener("change", relocate("vung"));
    $("#p-tinh").addEventListener("change", relocate("tinh"));
    $("#p-khu").addEventListener("change", relocate("khu"));
    $("#p-l1").addEventListener("change", (e) => { setLevel("l1", e.target.value); refresh(); });
    $("#p-l2").addEventListener("change", (e) => { setLevel("l2", e.target.value); refresh(); });
    $("#p-cat").addEventListener("change", (e) => { F.cat = e.target.value; refresh(); });
    $("#p-brand").addEventListener("change", (e) => { F.brand = e.target.value; refresh(); });
    $("#p-promo").addEventListener("change", (e) => { F.promo = e.target.checked; refresh(); });
    $("#p-out").addEventListener("change", (e) => { F.out = e.target.checked; refresh(); });
    // 2 ô tìm SKU (trong bộ lọc và ở tab Danh sách SKU) dùng chung một giá trị.
    const setQ = (v) => { F.q = v.trim(); $("#p-q").value = v; $("#p-q-sku").value = v; refresh(); };
    $("#p-q").addEventListener("input", (e) => setQ(e.target.value));
    $("#p-q-sku").addEventListener("input", (e) => setQ(e.target.value));
    $("#p-cats").addEventListener("click", (e) => {
      const r = e.target.closest("[data-cat]"); if (!r) return;
      const k = r.dataset.lv || "cat";
      if (k === "cat") { F.cat = F.cat === r.dataset.cat ? "" : r.dataset.cat; $("#p-cat").value = F.cat; } else setLevel(k, r.dataset.cat);
      refresh();
    });
    $("#p-pager").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b && !b.disabled) { F.page += +b.dataset.p; renderSku(filtered()); } });
    $("#p-export").addEventListener("click", exportCsv);
    $("#p-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-ptab]"); if (b) setTab(b.dataset.ptab); });
    $("#p-insights").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { setTab(b.dataset.go); $("#p-tabs").scrollIntoView({ block: "start" }); } });
    $("#p-more-btn").addEventListener("click", () => { const m = $("#p-more"); m.hidden = !m.hidden; $("#p-more-btn").textContent = m.hidden ? "Thêm bộ lọc" : "Ẩn bớt bộ lọc"; });
    // Xoá lọc ngành, thương hiệu, tìm kiếm; giữ nguyên nơi đang xem (miền, vùng, tỉnh, khu vực).
    $("#p-reset").addEventListener("click", () => {
      Object.assign(F, { l1: "", l2: "", cat: "", brand: "", promo: false, out: false, q: "", page: 0 });
      $("#p-q").value = ""; $("#p-q-sku").value = ""; $("#p-promo").checked = false; $("#p-out").checked = false;
      fillSelects(); refresh();
    });
    let saved = "overview"; try { saved = localStorage.getItem("wmbhx_ptab") || saved; } catch (_) {}
    setTab(saved);
  }
  // Số tổng hợp cho bot, theo bộ lọc đang chọn. Cố ý không có tên SKU, mã SKU hay link; Apps Script cũng chỉ nhận đúng các nhóm này.
  function context() {
    if (!D || !C) return null;
    const r1 = (v) => (isFinite(v) ? Math.round(v * 10) / 10 : null), p1 = (v) => (isFinite(v) ? Math.round(v * 1000) / 10 : null);
    const rows = filtered(), offs = rows.filter((x) => x.off > 0).map((x) => x.off), n = rows.length;
    const line = (key, name) => (g) => ({ [name]: g.name, so_sku: g.n, ty_le_khuyen_mai: p1(g.rate), giam_trung_vi: p1(g.off), gia_trung_vi: isFinite(g.price) ? g.price : null });
    const out = {
      pham_vi: { doi_thu: CHAINS[C.chain] || C.chain, mien: F.mien || "Tất cả", vung: F.vung || "Tất cả", tinh: C.prov, khu_vuc: C.khu, ngay_gia: C.latest, nganh_lon: F.l1 || "Tất cả", nhom: F.l2 || "Tất cả", nganh: F.cat || "Tất cả", thuong_hieu: F.brand || "Tất cả", chi_sku_khuyen_mai: F.promo, tu_khoa_tim: F.q ? "có lọc theo từ khoá" : "không", so_cua_hang_moi_tinh: 1 },
      chi_so: { so_sku: n, ty_le_khuyen_mai: n ? p1(rows.filter((x) => x.promo).length / n) : null, giam_trung_vi: p1(median(offs)), so_sku_giam_tu_30: rows.filter((x) => x.off >= 0.3).length, so_sku_khong_mua_duoc: rows.filter((x) => !x.can).length },
      theo_nganh: group(rows, "cat").sort((a, b) => b.rate - a.rate).slice(0, 30).map(line("cat", "nganh")),
      theo_thuong_hieu: group(rows, "brand").filter((g) => g.promo).sort((a, b) => b.promo - a.promo).slice(0, 15).map(line("brand", "thuong_hieu")),
      muc_giam: [["duoi_10", 0, 0.1], ["10_19", 0.1, 0.2], ["20_29", 0.2, 0.3], ["30_49", 0.3, 0.5], ["tu_50", 0.5, 1]].map(([t, a, b]) => ({ muc: t, so_sku: offs.filter((v) => v >= a && v < b).length })),
    };
    const cmp = compareCalc();
    if (cmp.P.length >= 2 && cmp.common.length) {
      out.theo_tinh = { ghi_chu: "Chỉ số trên rổ SKU có giá ở mọi tỉnh; trung bình các tỉnh = 100", so_sku_ro_chung: cmp.common.length, tinh: cmp.P.map((p, k) => { const list = p.active.filter(cmp.ok); return { tinh: p.tinh, ngay_gia: p.latest, so_sku: list.length, ty_le_khuyen_mai: list.length ? p1(list.filter((x) => x.promo).length / list.length) : null, chi_so_gia_ban: r1(cmp.iF[k]), chi_so_gia_goc: r1(cmp.iB[k]) }; }) };
      out.tinh_x_nganh = [...new Set(cmp.common.map((m) => m.x.cat))].slice(0, 30).map((c) => { const v = cmp.indexOf(cmp.common.filter((m) => m.x.cat === c), "final"), o = { nganh: c }; cmp.P.forEach((p, k) => (o[p.tinh] = r1(v[k]))); return o; });
    }
    if (C.dates.length >= 2) {
      const t = trendCalc(rows);
      if (t.basket) out.xu_huong = { ghi_chu: "Rổ cố định của tỉnh đang xem; lần đầu = 100", so_sku_ro: t.basket, ngay: C.dates, chi_so_gia_ban: t.sum.map((s) => r1((s[0] / t.sum[0][0]) * 100)), chi_so_gia_goc: t.sum.map((s) => r1((s[1] / t.sum[0][1]) * 100)), ty_le_sku_giam_gia: t.rate.map(r1) };
      const moved = rows.map(changeOf).filter(Boolean);
      out.thay_doi = { so_voi_ngay: C.prev, tang_gia: moved.filter((c) => c.d > 0).length, giam_gia: moved.filter((c) => c.d < 0).length, sku_moi: rows.filter((x) => x.first_seen === C.latest).length, sku_khong_con: C.items.filter((x) => x.last_seen === C.prev && inCat(x) && (!F.brand || x.brand === F.brand)).length };
    }
    return out;
  }

  // ---------- Cập nhật giá (Admin bấm nút) ----------
  let running = false;
  const STATUS = { running: "Đang lấy giá", saving: "Đang ghi dữ liệu", done: "Đã cập nhật xong", paused: "Tạm dừng", confirm: "Cần xác nhận" };
  function showJob(j) {
    const unfinished = !!j && j.status !== "done";
    $("#p-cancel").hidden = !unfinished || running;
    $("#p-confirm").hidden = !j || j.status !== "confirm" || running;
    $("#p-refresh").disabled = running; $("#p-test").disabled = running;
    $("#p-refresh").textContent = running ? "Đang cập nhật…" : unfinished ? "Tiếp tục cập nhật" : "Cập nhật giá";
    if (!j) { $("#p-job").textContent = ""; return; }
    const part = j.total ? ` ${pct(j.done / j.total, 0)} · ${fmt(j.rows)} dòng` : "";
    const sum = j.status === "done" && j.summary ? ` ${j.summary.provinces.map((p) => `${p.tinh}: ${fmt(p.rows)} SKU, mới ${fmt(p.added)}, tăng ${fmt(p.up)}, giảm ${fmt(p.down)}`).join(". ")}.` : "";
    $("#p-job").textContent = `${STATUS[j.status] || j.status}${j.status === "running" && j.tinh ? ` ${j.tinh}` : ""}${j.status === "done" ? "." : ":"}${j.status === "done" ? sum : part}${j.msg ? " " + j.msg : ""}`;
  }
  const warnLeave = (e) => { e.preventDefault(); e.returnValue = ""; };
  async function runRefresh() {
    if (running) return;
    running = true; window.addEventListener("beforeunload", warnLeave); $("#p-admin").open = true;
    let job = null;
    try {
      showJob(null);
      job = await API.priceStart($("#p-scope").value); showJob(job);
      let fails = 0;
      while (job.status === "running" || job.status === "saving") {
        try { job = await API.priceStep(job.id); fails = 0; showJob(job); }
        catch (err) {
          if (err.code === "AUTH" || ++fails >= 3) throw err;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      if (job.status === "done") await reload();
    } catch (err) {
      $("#p-job").textContent = `Chưa cập nhật xong: ${err.message} Bấm lại để chạy tiếp.`;
    } finally {
      running = false; window.removeEventListener("beforeunload", warnLeave);
      if (job) showJob(job); else { $("#p-refresh").disabled = false; $("#p-test").disabled = false; $("#p-refresh").textContent = "Cập nhật giá"; }
    }
  }
  function cfgRow(p) {
    return `<tr><td><select data-k="chain">${["BHX", "LOTTE", "KFM"].map((c) => opt(c, p.chain || "BHX", CHAINS[c])).join("")}</select></td><td><input data-k="tinh" maxlength="60" value="${esc(p.tinh)}"></td><td><select data-k="khu">${[URBAN, RURAL].map((k) => opt(k, p.khu || URBAN)).join("")}</select></td>${["provinceId", "wardId", "storeId"].map((k) => `<td><input data-k="${k}" inputmode="numeric" maxlength="12" value="${esc(p[k])}"></td>`).join("")}<td><input data-k="addr" maxlength="200" class="p-addr" value="${esc(p.addr || "")}" title="${esc(p.addr || "")}"></td><td><button class="link" data-del="1">Xoá</button></td></tr>`;
  }
  function showConfig(c) {
    $("#t-p-cfg tbody").innerHTML = c.provinces.map(cfgRow).join("");
    $("#p-keys").textContent = c.missing.length === 7 ? "Không cần token: hệ thống lấy giá như khách chưa đăng nhập, không dùng tài khoản nào." : `Đang có ${7 - c.missing.length}/7 mục BHX_ trong Script Properties. Chỉ nhập ở Apps Script, không nhập vào trang này. Web không đọc được giá trị.`;
    if (c.provinces.some((p) => !p.provinceId || !p.wardId || !p.storeId)) $("#p-setup").open = true;
    showJob(c.job);
  }
  async function loadAdmin() {
    try { showConfig(await API.priceConfig()); }
    catch (err) { $("#p-job").textContent = `Chưa đọc được thiết lập: ${err.message}`; }
  }
  function wireAdmin() {
    $("#p-refresh").addEventListener("click", runRefresh);
    $("#p-test").addEventListener("click", async () => {
      const el = $("#p-job"), b = $("#p-test");
      b.disabled = true; el.textContent = "Đang thử kết nối…";
      try {
        const res = await API.priceTest();
        el.textContent = res.map((r) => (r.ok ? `${r.tinh}: được, ${fmt(r.sku)} SKU mẫu, ${fmt(r.withPrice)} có giá, ${fmt(r.withCat)} có tên ngành, ${fmt(r.withBrand)} có thương hiệu` : `${r.tinh}: chưa được. ${r.msg || "Không có SKU nào có giá."}`)).join(". ") + ". Chưa lưu gì.";
      } catch (err) { el.textContent = `Chưa thử được: ${err.message}`; }
      b.disabled = false;
    });
    $("#p-confirm").addEventListener("click", async () => {
      try { const j = await API.priceFinish(await jobId()); showJob(j); if (j.status === "done") await reload(); }
      catch (err) { $("#p-job").textContent = `Chưa lưu: ${err.message}`; }
    });
    $("#p-cancel").addEventListener("click", async () => {
      if (!window.confirm("Huỷ lần cập nhật này? Phần đã lấy sẽ bỏ, dữ liệu đã lưu trước đó vẫn giữ nguyên.")) return;
      try { showConfig(await API.priceCancel()); $("#p-job").textContent = "Đã huỷ."; }
      catch (err) { $("#p-job").textContent = `Chưa huỷ được: ${err.message}`; }
    });
    if (API.fbPrice) {
      $("#p-cfg-auto").hidden = false;
      $("#p-cfg-auto").addEventListener("click", async () => {
        const msg = $("#p-cfg-msg"); msg.textContent = "Đang lấy danh sách tỉnh…";
        try {
          // Giữ nguyên các dòng LOTTE, Kingfoodmart đang có; chỉ lập lại phần BHX.
          const others = [...document.querySelectorAll("#t-p-cfg tbody tr")].map((tr) => { const o = {}; tr.querySelectorAll("input,select").forEach((i) => (o[i.dataset.k] = i.value.trim())); return o; }).filter((r) => r.chain && r.chain !== "BHX");
          const list = (await API.priceAutoStores()).map((r) => ({ ...r, chain: "BHX" })).concat(others); $("#t-p-cfg tbody").innerHTML = list.map(cfgRow).join(""); const nt = list.filter((x) => x.khu === RURAL).length; msg.textContent = `Có ${new Set(list.map((x) => x.tinh)).size} tỉnh, ${list.length} cửa hàng (${list.length - nt} thành thị, ${nt} nông thôn). Xem lại địa chỉ rồi bấm Lưu thiết lập để dùng.`; }
        catch (err) { msg.textContent = err.message; }
      });
    }
    if (API.importGasPrices) {
      $("#p-import-box").hidden = false;
      $("#p-import").addEventListener("click", async () => {
        const b = $("#p-import"), msg = $("#p-import-msg");
        b.disabled = true; msg.textContent = "Đang đọc dữ liệu ở bản cũ và chép sang… có thể mất vài phút.";
        try {
          const r = await API.importGasPrices();
          msg.textContent = r.provinces.length ? `Đã chép xong: ${r.provinces.map((p) => `${p.tinh} thêm ${fmt(p.dates)} mốc`).join(", ")}.` : "Bản cũ không có dữ liệu giá để chép.";
          await reload();
        } catch (err) { msg.textContent = `Chưa chép được: ${err.message}`; }
        b.disabled = false;
      });
    }
    // Thêm LOTTE (mỗi tỉnh 1 siêu thị, gần cửa hàng BHX thành thị của tỉnh nhất) và Kingfoodmart (giá online, 1 nơi).
    $("#p-cfg-chains").addEventListener("click", () => {
      const msg = $("#p-cfg-msg"), rows = [...document.querySelectorAll("#t-p-cfg tbody tr")].map((tr) => { const o = {}; tr.querySelectorAll("input,select").forEach((i) => (o[i.dataset.k] = i.value.trim())); return o; });
      const have = new Set(rows.map((r) => (r.chain || "BHX") + "|" + r.tinh));
      const lotte = STORES.filter((s) => s.chain === "LOTTE" && /^[a-z]{2,6}$/.test(String(s.ma)));
      if (!lotte.length) { msg.textContent = "Chưa có danh sách siêu thị LOTTE. Mở tab bản đồ một lần để tải danh sách cửa hàng rồi bấm lại."; return; }
      const bhxAt = (tinh) => { const r = rows.find((x) => (x.chain || "BHX") === "BHX" && x.tinh === tinh && x.khu !== RURAL); const s = r && STORES.find((b) => b.chain === "BHX" && String(b.ma) === String(r.storeId)); return s || null; };
      const d2 = (a, b) => (a.lat - b.lat) ** 2 + ((a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180)) ** 2;
      const byT = new Map(); lotte.forEach((s) => { if (!byT.has(s.tinh)) byT.set(s.tinh, []); byT.get(s.tinh).push(s); });
      const add = [];
      byT.forEach((list, tinh) => {
        if (have.has("LOTTE|" + tinh)) return;
        // Không có cửa hàng BHX để so: ưu tiên siêu thị có địa chỉ ghi đúng tên tỉnh (trước sáp nhập), rồi theo mã.
        const named = (s) => (provKey(s.dia_chi || "").includes(provKey(tinh)) || plain(s.dia_chi || "").includes(plain(tinh)) ? 0 : 1);
        const ref = bhxAt(tinh), pick = ref ? list.reduce((m, s) => (d2(s, ref) < d2(m, ref) ? s : m)) : list.slice().sort((a, b) => named(a) - named(b) || String(a.ma).localeCompare(String(b.ma)))[0];
        add.push({ chain: "LOTTE", tinh, khu: URBAN, provinceId: "", wardId: "", storeId: String(pick.ma), addr: pick.dia_chi || "" });
      });
      if (!have.has("KFM|Hồ Chí Minh")) add.push({ chain: "KFM", tinh: "Hồ Chí Minh", khu: URBAN, provinceId: "", wardId: "", storeId: "online", addr: "Giá bán online của Kingfoodmart (cửa hàng mặc định của web)" });
      $("#t-p-cfg tbody").insertAdjacentHTML("beforeend", add.map(cfgRow).join(""));
      msg.textContent = add.length ? `Đã thêm ${add.filter((a) => a.chain === "LOTTE").length} siêu thị LOTTE và ${add.some((a) => a.chain === "KFM") ? 1 : 0} Kingfoodmart. Xem lại rồi bấm Lưu thiết lập.` : "LOTTE và Kingfoodmart đã có đủ trong thiết lập.";
    });
    $("#p-cfg-add").addEventListener("click", () => $("#t-p-cfg tbody").insertAdjacentHTML("beforeend", cfgRow({ tinh: "", provinceId: "", wardId: "", storeId: "" })));
    $("#t-p-cfg").addEventListener("click", (e) => { if (e.target.dataset.del) e.target.closest("tr").remove(); });
    $("#p-cfg-save").addEventListener("click", async () => {
      const list = [...document.querySelectorAll("#t-p-cfg tbody tr")].map((tr) => { const o = {}; tr.querySelectorAll("input,select").forEach((i) => (o[i.dataset.k] = i.value.trim())); return o; });
      try { showConfig(await API.savePriceConfig(list)); $("#p-cfg-msg").textContent = "Đã lưu."; }
      catch (err) { $("#p-cfg-msg").textContent = err.message; }
    });
  }
  async function jobId() { const c = await API.priceConfig(); return c.job && c.job.id; }

  // Dữ liệu giá khá lớn nên chỉ tải khi mở tab lần đầu. Mở tab không tự gọi BHX.
  let loaded = false, loading = Promise.resolve();
  function open(api, isAdmin) {
    API = api; ADMIN = !!isAdmin; wire();
    if (loaded) return;
    loaded = true;
    if (isAdmin) { wireAdmin(); loadAdmin(); }
    loading = reload().then(() => { if (!D && !$("#p-msg").textContent) render(); });
  }
  // Danh sách cửa hàng (BHX và chuỗi khác) từ tab bản đồ, dùng để chọn siêu thị LOTTE gần cửa hàng BHX.
  let STORES = [];
  const setStores = (list) => { STORES = (list || []).map((s) => ({ chain: s.chain, ma: s.ma, tinh: s.tinh, lat: +s.lat, lng: +s.lng, dia_chi: s.dia_chi })); };
  return { open, context, setRegions, setStores, ready: () => loading };
})();
