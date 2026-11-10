// Bot Gemini: Admin hỏi, web gửi câu hỏi kèm SỐ TỔNG HỢP giá đối thủ qua Apps Script. API key nằm ở Script Properties, không tới trình duyệt.
// Không gửi tên SKU, không gửi dữ liệu WM, không tự gửi khi mở trang. Trả lời hiển thị dạng chữ thuần, không lưu lịch sử.
window.WMBot = (function () {
  const $ = (s) => document.querySelector(s);
  const QUICK = ["Tóm tắt 3–5 điểm đáng chú ý nhất", "So sánh giá và khuyến mãi giữa các tỉnh", "Ngành hàng nào nên xem trước, vì sao?"];
  let API = null, history = [], sending = false;

  function addTurn(role, text, cls = "") {
    const el = document.createElement("div");
    el.className = `bot-turn ${role} ${cls}`;
    el.textContent = text;
    $("#bot-log").appendChild(el);
    $("#bot-log").scrollTop = $("#bot-log").scrollHeight;
    return el;
  }
  async function refreshStatus() {
    try {
      const s = await API.botStatus();
      $("#bot-status").textContent = s.hasKey ? `Hôm nay đã hỏi ${s.used}/${s.limit} lần.` : "Chưa có GEMINI_API_KEY trong Script Properties của Apps Script nên bot chưa trả lời được.";
    } catch (err) { $("#bot-status").textContent = err.message; }
  }
  async function refreshData() {
    WMPrice.open(API, true);
    await WMPrice.ready();
    const c = WMPrice.context();
    $("#bot-data").textContent = c ? JSON.stringify(c, null, 2) : "Chưa có dữ liệu giá. Hãy cập nhật giá trước.";
    return c;
  }
  async function send(text) {
    const q = text.trim();
    if (!q || sending) return;
    if (!$("#bot-agree").checked) { $("#bot-msg").textContent = "Hãy tích ô đồng ý gửi số liệu trước."; return; }
    sending = true; $("#bot-send").disabled = true; $("#bot-msg").textContent = "";
    addTurn("me", q);
    const wait = addTurn("ai", "Gemini đang trả lời…", "wait");
    try {
      const context = await refreshData();
      if (!context) throw new Error("Chưa có dữ liệu giá để phân tích.");
      const r = await API.askBot(q, context, history);
      wait.classList.remove("wait"); wait.textContent = r.text;
      history = history.concat([{ q, a: r.text }]).slice(-3);
      $("#bot-q").value = "";
      $("#bot-status").textContent = `Hôm nay đã hỏi ${r.used}/${r.limit} lần.`;
    } catch (err) { wait.classList.remove("wait"); wait.classList.add("bad"); wait.textContent = err.message; }
    sending = false; $("#bot-send").disabled = false;
  }
  function init(api) {
    API = api;
    $("#bot-quick").innerHTML = QUICK.map((q, k) => `<button class="ghost" data-k="${k}">${q}</button>`).join("");
    $("#bot-open").addEventListener("click", async () => {
      const p = $("#bot-panel"); p.hidden = !p.hidden;
      $("#bot-open").hidden = !p.hidden;
      if (!p.hidden) { refreshStatus(); refreshData().catch((err) => ($("#bot-data").textContent = err.message)); }
    });
    $("#bot-close").addEventListener("click", () => { $("#bot-panel").hidden = true; $("#bot-open").hidden = false; });
    $("#bot-quick").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) send(QUICK[+b.dataset.k]); });
    $("#bot-send").addEventListener("click", () => send($("#bot-q").value));
    $("#bot-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#bot-q").value); } });
    $("#bot-preview").addEventListener("toggle", (e) => { if (e.target.open) refreshData().catch(() => {}); });
  }
  return { init };
})();
