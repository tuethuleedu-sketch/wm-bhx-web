// Tìm nhanh: ô lọc dạng danh sách gõ chữ để tìm, và ô tìm trong bảng.
// Không đổi cách các trang khác đọc giá trị: <select> gốc vẫn giữ giá trị và vẫn phát sự kiện "change".
window.QuickFind = (function () {
  const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let open = null;
  const close = () => { if (open) { open.box.hidden = true; open.input.value = open.label(); open = null; } };
  document.addEventListener("mousedown", (e) => { if (open && !open.wrap.contains(e.target)) close(); });

  // Ô danh sách → ô gõ để tìm. Gõ một phần tên (không cần dấu) là lọc ngay; Enter chọn dòng đầu, Esc đóng.
  function select(sel) {
    if (!sel || sel.dataset.qf) return;
    sel.dataset.qf = "1";
    const wrap = document.createElement("span"), input = document.createElement("input"), box = document.createElement("div");
    wrap.className = "qf"; input.className = "qf-input"; input.autocomplete = "off"; input.spellcheck = false; box.className = "qf-box"; box.hidden = true;
    input.setAttribute("role", "combobox"); input.setAttribute("aria-label", sel.closest("label") ? sel.closest("label").firstChild.textContent.trim() : "Chọn");
    sel.parentNode.insertBefore(wrap, sel); wrap.append(input, box, sel); sel.classList.add("qf-native"); sel.tabIndex = -1;
    const label = () => (sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "");
    const me = { wrap, input, box, label };
    let hit = [], at = 0;
    function draw() {
      const q = plain(input.value === label() ? "" : input.value);
      hit = [...sel.options].filter((o) => !q || plain(o.textContent).includes(q));
      at = Math.min(at, Math.max(0, hit.length - 1));
      box.innerHTML = hit.slice(0, 200).map((o, i) => `<div class="qf-opt${i === at ? " on" : ""}${o.value === sel.value ? " cur" : ""}" data-i="${i}">${esc(o.textContent)}</div>`).join("") || `<div class="qf-none">Không có kết quả</div>`;
    }
    function pick(o) {   // đóng trước rồi mới báo đổi giá trị, để trang vẽ lại không làm danh sách mở lại
      box.hidden = true; if (open === me) open = null; input.blur();
      if (o && sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      input.value = label();
    }
    function show() { if (open && open !== me) close(); document.querySelectorAll(".qf-box").forEach((b) => { if (b !== box) b.hidden = true; }); open = me; at = 0; input.select(); box.hidden = false; draw(); }
    input.addEventListener("focus", show);
    input.addEventListener("input", () => { at = 0; box.hidden = false; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (box.hidden) show(); at = Math.max(0, Math.min(hit.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))); draw(); box.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); pick(hit[at]); }
      else if (e.key === "Escape") { close(); input.blur(); }
    });
    box.addEventListener("mousedown", (e) => { const d = e.target.closest("[data-i]"); if (d) { e.preventDefault(); pick(hit[+d.dataset.i]); } });
    // Danh sách do trang khác điền lại hoặc đổi giá trị: cập nhật chữ hiện trên ô.
    const sync = () => { if (open !== me) input.value = label(); input.disabled = sel.disabled; };
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true });
    sel.addEventListener("change", sync);
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(sel, "value", { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); }, configurable: true });
    sync();
  }

  // Ô tìm trong bảng: lọc các dòng đang hiện theo chữ gõ (không cần dấu). Bảng vẽ lại thì tự lọc lại.
  function table(tbl, placeholder) {
    if (!tbl || tbl.dataset.qf) return;
    tbl.dataset.qf = "1";
    const at = tbl.closest(".table-wrap") || tbl, input = document.createElement("input");
    input.type = "search"; input.className = "qf-table"; input.placeholder = placeholder || "Tìm trong bảng…";
    at.parentNode.insertBefore(input, at);
    const body = tbl.tBodies[0];
    const apply = () => {
      const q = plain(input.value.trim());
      [...body.rows].forEach((r) => { r.hidden = !!q && !plain(r.textContent).includes(q); });
    };
    input.addEventListener("input", apply);
    new MutationObserver(apply).observe(body, { childList: true });
  }

  function init() {
    document.querySelectorAll("#view-price .p-filter select, #view-changes .controls select").forEach(select);
    [["#t-p-cat", "Tìm ngành…"], ["#t-p-brand", "Tìm thương hiệu…"], ["#t-p-prov", "Tìm tỉnh, vùng…"], ["#t-p-area", "Tìm tỉnh…"], ["#t-p-matrix", "Tìm ngành…"], ["#t-p-gap", "Tìm SKU…"],
      ["#t-p-change", "Tìm SKU…"], ["#t-p-runs", "Tìm ngày, nơi lấy giá…"], ["#t-changes", "Tìm mã, địa chỉ, tỉnh…"], ["#t-users", "Tìm email…"]]
      .forEach(([s, ph]) => table(document.querySelector(s), ph));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { select, table, init };
})();
