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

  let API = null, D = null, C = null, pending = null, wired = false, F = { tinh: "", cat: "", brand: "", promo: false, q: "", page: 0 };

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
    const items = raw.items.map((x) => { const s = sku.get(x.id) || {}; return { ...x, code: s.code || "", name: s.name || x.id, unit: s.unit || "", url: s.url || "", cat: s.cat || UNKNOWN, brand: s.brand || UNKNOWN }; });
    [...new Set(raw.runs.map((r) => r.tinh))].sort((a, b) => a.localeCompare(b, "vi")).forEach((tinh) => {
      const runs = raw.runs.filter((r) => r.tinh === tinh), dates = [...new Set(runs.map((r) => r.date))].sort().slice(-MAX_POINTS), latest = dates[dates.length - 1], mine = items.filter((x) => x.tinh === tinh);
      byT.set(tinh, { tinh, items: mine, active: mine.filter((x) => x.last_seen === latest), dates, latest, prev: dates[dates.length - 2] || "", run: runs.filter((r) => r.date === latest).pop(), stores: new Set(runs.map((r) => r.store).filter(Boolean)) });
    });
    return { byT, series, runs: raw.runs };
  }
  // Giá của SKU tại một ngày ở tỉnh đang xem: dòng lịch sử gần nhất không muộn hơn ngày đó.
  function priceAt(id, date) {
    const s = D.series.get(C.tinh + "|" + id); let hit = null;
    if (s) for (const row of s) { if (row[0] > date) break; hit = row; }
    return hit;
  }
  function pickProvince() {
    if (!D) { C = null; return; }
    if (!D.byT.has(F.tinh)) F.tinh = [...D.byT.keys()][0];
    C = D.byT.get(F.tinh);
    $("#p-tinh").innerHTML = [...D.byT.keys()].map((t) => `<option${t === F.tinh ? " selected" : ""}>${esc(t)}</option>`).join("");
  }
  async function reload() {
    const msg = $("#p-msg");
    try { D = prepare(await API.getPrices()); }
    catch (err) { msg.textContent = `Chưa tải được dữ liệu giá: ${err.message}`; return; }
    pickProvince(); fillSelects(); render();
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
      F = { tinh: F.tinh, cat: "", brand: "", promo: false, q: "", page: 0 };
      $("#p-q").value = ""; $("#p-promo").checked = false;
      await reload();
    } catch (err) {
      if (err.code === "PRICE_SHRINK" && !force && window.confirm(`${err.message} File có thể bị thiếu do lấy giá lỗi giữa chừng. Vẫn lưu?`)) { save.disabled = false; return savePending(true); }
      msg.textContent = `Chưa lưu: ${err.message}`;
    }
    save.disabled = false;
  }

  const filtered = () => {
    const q = plain(F.q);
    return C.active.filter((x) => (!F.cat || x.cat === F.cat) && (!F.brand || x.brand === F.brand) && (!F.promo || x.promo) && (!q || plain(x.name).includes(q) || plain(x.code).includes(q)));
  };
  function fillSelects() {
    const opts = (key) => (C ? [...new Set(C.active.map((x) => x[key]))] : []).sort((a, b) => a.localeCompare(b, "vi")).map((v) => `<option>${esc(v)}</option>`).join("");
    const fill = (el, key) => { el.innerHTML = `<option value="">Tất cả</option>` + opts(key); if ([...el.options].some((o) => o.value === F[key])) el.value = F[key]; else { F[key] = ""; el.value = ""; } };
    fill($("#p-cat"), "cat"); fill($("#p-brand"), "brand");
  }
  function group(rows, key) {
    const m = new Map();
    rows.forEach((x) => { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); });
    return [...m].map(([name, list]) => {
      const promo = list.filter((x) => x.promo).length, offs = list.filter((x) => x.off > 0).map((x) => x.off);
      return { name, n: list.length, promo, rate: promo / list.length, off: median(offs), price: median(list.filter((x) => x.final).map((x) => x.final)) };
    });
  }
  const bar = (label, value, text, title, attr = "") => `<div class="bar-row p-bar" ${attr} title="${esc(title)}"><span class="bar-name">${esc(label)}</span>`
    + `<div class="pbar-track"><div class="pbar-fill p-fill" style="width:${Math.min(100, value * 100)}%"></div></div><span class="p-val">${text}</span></div>`;

  function render() {
    const has = !!D;
    $("#p-empty").hidden = has; $("#p-report").hidden = !has;
    if (!has) return;
    const rows = filtered(), promo = rows.filter((x) => x.promo), offs = rows.filter((x) => x.off > 0).map((x) => x.off), deep = rows.filter((x) => x.off >= 0.3).length, out = rows.filter((x) => !x.can).length;
    const n = rows.length, share = (k) => (n ? k / n : 0), run = C.run;
    $("#p-source").innerHTML = `<b>${esc(C.tinh)}</b> · giá ngày <b>${dayVN(C.latest)}</b>${run.at ? ` (cập nhật lúc ${esc(new Date(run.at).toLocaleString("vi-VN"))})` : ""}${run.store ? ` · cửa hàng ${esc(run.store)}` : ""}${run.file ? ` · ${esc(run.file)}` : ""} · đã lưu ${fmt(C.dates.length)} mốc thời gian. `
      + `Mỗi tỉnh lấy giá từ <b>một cửa hàng</b>, chưa đại diện cho mọi cửa hàng trong tỉnh. Giá website có thể khác giá tại quầy.`
      + (C.stores.size > 1 ? ` <b>Tỉnh này đã dùng ${fmt(C.stores.size)} cửa hàng khác nhau nên xu hướng có thể không so sánh được.</b>` : "");
    const noPrice = C.active.filter((x) => !x.final).length, noCat = C.active.filter((x) => x.cat === UNKNOWN).length, noBrand = C.active.filter((x) => x.brand === UNKNOWN).length;
    const warn = [noPrice && `${fmt(noPrice)} SKU không có giá`, noCat && `${fmt(noCat)} SKU không có tên ngành`, noBrand && `${fmt(noBrand)} SKU không có thương hiệu`].filter(Boolean);
    $("#p-quality").hidden = !warn.length;
    $("#p-quality").textContent = warn.length ? `Cần kiểm tra file: ${warn.join(", ")}.` : "";
    $("#p-kpis").innerHTML = [
      ["SKU trong bộ lọc", fmt(n), `trên tổng ${fmt(C.active.length)} SKU của tỉnh, lần mới nhất`],
      ["% SKU có khuyến mãi", pct(share(promo.length)), `${fmt(promo.length)} ÷ ${fmt(n)} SKU; có giảm giá hoặc có nhãn khuyến mãi`],
      ["Mức giảm trung vị", offs.length ? pct(median(offs)) : "–", `tính trên ${fmt(offs.length)} SKU có giảm giá`],
      ["SKU giảm từ 30%", fmt(deep), `${pct(share(deep))} số SKU trong bộ lọc`],
      ["SKU không mua được", fmt(out), `${pct(share(out))}; theo cửa hàng đã lấy giá`],
    ].map(([a, b, c]) => `<div class="card kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("");
    const cats = group(rows, "cat").sort((a, b) => b.rate - a.rate);
    $("#p-cats").innerHTML = cats.slice(0, 15).map((g) => bar(g.name, g.rate, pct(g.rate, 0), `${g.name}: ${fmt(g.promo)}/${fmt(g.n)} SKU có khuyến mãi. Bấm để lọc.`, `data-cat="${esc(g.name)}"`)).join("") || `<p class="muted small">Không có SKU nào.</p>`;
    const BUCKET = [["Dưới 10%", 0, 0.1], ["10–19%", 0.1, 0.2], ["20–29%", 0.2, 0.3], ["30–49%", 0.3, 0.5], ["Từ 50%", 0.5, 1]];
    const counts = BUCKET.map(([, a, b]) => offs.filter((v) => v >= a && v < b).length), top = Math.max(1, ...counts);
    $("#p-dist").innerHTML = BUCKET.map(([t], k) => bar(t, counts[k] / top, fmt(counts[k]), `${t}: ${fmt(counts[k])} SKU`)).join("");
    $("#t-p-cat tbody").innerHTML = cats.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(g.n)}</td><td class="num">${pct(g.rate)}</td><td class="num">${isNaN(g.off) ? "–" : pct(g.off)}</td><td class="num">${isNaN(g.price) ? "–" : fmt(g.price)}</td></tr>`).join("");
    const brands = group(rows, "brand").filter((g) => g.promo).sort((a, b) => b.promo - a.promo || b.rate - a.rate).slice(0, 10);
    $("#t-p-brand tbody").innerHTML = brands.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(g.promo)}</td><td class="num">${fmt(g.n)}</td><td class="num">${pct(g.rate)}</td><td class="num">${isNaN(g.off) ? "–" : pct(g.off)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Không có thương hiệu nào đang khuyến mãi.</td></tr>`;
    renderCompare();
    renderTrend(rows);
    renderChanges(rows);
    renderSku(rows);
    $("#t-p-runs tbody").innerHTML = [...D.runs].reverse().slice(0, 60).map((r) => `<tr><td>${dayVN(r.date)}</td><td>${esc(r.tinh)}</td><td>${esc(r.file)}</td><td>${esc(r.store)}</td><td>${esc(r.by)}</td><td class="num">${fmt(r.n)}</td><td class="num">${fmt(r.added)}</td><td class="num">${fmt(r.up)}</td><td class="num">${fmt(r.down)}</td><td class="num">${fmt(r.gone)}</td></tr>`).join("");
  }
  // So sánh dùng rổ chung: chỉ SKU có giá ở mọi tỉnh, để chỉ số không lệch vì mỗi tỉnh bán danh mục khác nhau. Trung bình các tỉnh = 100.
  function compareCalc() {
    const P = [...D.byT.values()];
    const ok = (x) => (!F.cat || x.cat === F.cat) && (!F.brand || x.brand === F.brand);
    const map = new Map();
    P.forEach((p, k) => p.active.forEach((x) => { if (!x.final || !x.base || !ok(x)) return; if (!map.has(x.id)) map.set(x.id, { x, at: new Array(P.length).fill(null) }); map.get(x.id).at[k] = x; }));
    const common = [...map.values()].filter((m) => m.at.every(Boolean));
    const indexOf = (list, key) => {
      const sum = P.map((_, k) => list.reduce((a, m) => a + m.at[k][key], 0)), avg = sum.reduce((a, b) => a + b, 0) / P.length;
      return sum.map((v) => (avg ? (v / avg) * 100 : NaN));
    };
    return { P, ok, common, indexOf, iF: indexOf(common, "final"), iB: indexOf(common, "base") };
  }
  function renderCompare() {
    const { P, ok, common, indexOf, iF, iB } = compareCalc(), many = P.length >= 2;
    $("#p-compare-need").hidden = many; $("#p-compare-body").hidden = !many;
    if (!many) return;
    const dates = new Set(P.map((p) => p.latest));
    $("#p-compare-note").innerHTML = `Rổ chung ${fmt(common.length)} SKU có giá ở cả ${fmt(P.length)} tỉnh; trung bình các tỉnh = 100. Trên 100 là đắt hơn trung bình. Giá gốc cho thấy mặt bằng giá; giá bán đã gồm khuyến mãi.`
      + (dates.size > 1 ? ` <b>Các tỉnh có ngày lấy giá khác nhau nên so sánh chỉ mang tính tham khảo.</b>` : "");
    const mark = (v) => (isNaN(v) ? "–" : v >= 102 ? `<span class="p-hi">▲ ${fmt(v, 1)}</span>` : v <= 98 ? `<span class="p-lo">▼ ${fmt(v, 1)}</span>` : fmt(v, 1));
    $("#t-p-prov tbody").innerHTML = P.map((p, k) => {
      const list = p.active.filter(ok), on = list.filter((x) => x.promo).length;
      return `<tr><td>${esc(p.tinh)}</td><td>${esc(p.run.store)}</td><td>${dayVN(p.latest)}</td><td class="num">${fmt(list.length)}</td><td class="num">${list.length ? pct(on / list.length) : "–"}</td><td class="num">${common.length ? mark(iF[k]) : "–"}</td><td class="num">${common.length ? mark(iB[k]) : "–"}</td></tr>`;
    }).join("");
    const cats = [...new Set(common.map((m) => m.x.cat))].sort((a, b) => a.localeCompare(b, "vi"));
    $("#t-p-matrix thead").innerHTML = `<tr><th>Chỉ số giá bán theo ngành</th>${P.map((p) => `<th class="num">${esc(p.tinh)}</th>`).join("")}</tr>`;
    $("#t-p-matrix tbody").innerHTML = cats.map((c) => { const v = indexOf(common.filter((m) => m.x.cat === c), "final"); return `<tr><td>${esc(c)}</td>${v.map((a) => `<td class="num">${mark(a)}</td>`).join("")}</tr>`; }).join("") || `<tr><td class="muted">Không có SKU chung.</td></tr>`;
    const gaps = common.map((m) => { const f = m.at.map((x) => x.final), lo = Math.min(...f), hi = Math.max(...f); return { m, gap: hi / lo - 1, lo, hi }; }).filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 15);
    $("#t-p-gap thead").innerHTML = `<tr><th>SKU</th><th>Ngành</th>${P.map((p) => `<th class="num">${esc(p.tinh)} (đ)</th>`).join("")}<th class="num">Chênh cao/thấp</th></tr>`;
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
    const scope = C.items.filter((x) => (!F.cat || x.cat === F.cat) && (!F.brand || x.brand === F.brand));
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
    const gone = C.items.filter((x) => x.last_seen === C.prev && (!F.cat || x.cat === F.cat) && (!F.brand || x.brand === F.brand)).length;
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
    $("#p-tinh").addEventListener("change", (e) => { F.tinh = e.target.value; F.page = 0; pickProvince(); fillSelects(); render(); });
    $("#p-cat").addEventListener("change", (e) => { F.cat = e.target.value; refresh(); });
    $("#p-brand").addEventListener("change", (e) => { F.brand = e.target.value; refresh(); });
    $("#p-promo").addEventListener("change", (e) => { F.promo = e.target.checked; refresh(); });
    $("#p-q").addEventListener("input", (e) => { F.q = e.target.value.trim(); refresh(); });
    $("#p-cats").addEventListener("click", (e) => { const r = e.target.closest("[data-cat]"); if (!r) return; F.cat = F.cat === r.dataset.cat ? "" : r.dataset.cat; $("#p-cat").value = F.cat; refresh(); });
    $("#p-pager").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b && !b.disabled) { F.page += +b.dataset.p; renderSku(filtered()); } });
    $("#p-export").addEventListener("click", exportCsv);
  }
  // Số tổng hợp cho bot, theo bộ lọc đang chọn. Cố ý không có tên SKU, mã SKU hay link; Apps Script cũng chỉ nhận đúng các nhóm này.
  function context() {
    if (!D || !C) return null;
    const r1 = (v) => (isFinite(v) ? Math.round(v * 10) / 10 : null), p1 = (v) => (isFinite(v) ? Math.round(v * 1000) / 10 : null);
    const rows = filtered(), offs = rows.filter((x) => x.off > 0).map((x) => x.off), n = rows.length;
    const line = (key, name) => (g) => ({ [name]: g.name, so_sku: g.n, ty_le_khuyen_mai: p1(g.rate), giam_trung_vi: p1(g.off), gia_trung_vi: isFinite(g.price) ? g.price : null });
    const out = {
      pham_vi: { tinh: C.tinh, ngay_gia: C.latest, nganh: F.cat || "Tất cả", thuong_hieu: F.brand || "Tất cả", chi_sku_khuyen_mai: F.promo, tu_khoa_tim: F.q ? "có lọc theo từ khoá" : "không", so_cua_hang_moi_tinh: 1 },
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
      out.thay_doi = { so_voi_ngay: C.prev, tang_gia: moved.filter((c) => c.d > 0).length, giam_gia: moved.filter((c) => c.d < 0).length, sku_moi: rows.filter((x) => x.first_seen === C.latest).length, sku_khong_con: C.items.filter((x) => x.last_seen === C.prev && (!F.cat || x.cat === F.cat) && (!F.brand || x.brand === F.brand)).length };
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
    running = true; window.addEventListener("beforeunload", warnLeave);
    let job = null;
    try {
      showJob(null);
      job = await API.priceStart(); showJob(job);
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
    return `<tr><td><input data-k="tinh" maxlength="60" value="${esc(p.tinh)}"></td>${["provinceId", "wardId", "storeId"].map((k) => `<td><input data-k="${k}" inputmode="numeric" maxlength="12" value="${esc(p[k])}"></td>`).join("")}<td><button class="link" data-del="1">Xoá</button></td></tr>`;
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
    $("#p-cfg-add").addEventListener("click", () => $("#t-p-cfg tbody").insertAdjacentHTML("beforeend", cfgRow({ tinh: "", provinceId: "", wardId: "", storeId: "" })));
    $("#t-p-cfg").addEventListener("click", (e) => { if (e.target.dataset.del) e.target.closest("tr").remove(); });
    $("#p-cfg-save").addEventListener("click", async () => {
      const list = [...document.querySelectorAll("#t-p-cfg tbody tr")].map((tr) => { const o = {}; tr.querySelectorAll("input").forEach((i) => (o[i.dataset.k] = i.value.trim())); return o; });
      try { showConfig(await API.savePriceConfig(list)); $("#p-cfg-msg").textContent = "Đã lưu."; }
      catch (err) { $("#p-cfg-msg").textContent = err.message; }
    });
  }
  async function jobId() { const c = await API.priceConfig(); return c.job && c.job.id; }

  // Dữ liệu giá khá lớn nên chỉ tải khi mở tab lần đầu. Mở tab không tự gọi BHX.
  let loaded = false, loading = Promise.resolve();
  function open(api, isAdmin) {
    API = api; wire();
    if (loaded) return;
    loaded = true;
    if (isAdmin) { wireAdmin(); loadAdmin(); }
    loading = reload().then(() => { if (!D && !$("#p-msg").textContent) render(); });
  }
  return { open, context, ready: () => loading };
})();
