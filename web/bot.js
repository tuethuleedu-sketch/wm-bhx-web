// Bot AI (Gemini hoặc Claude, theo key Admin đã dán): Admin hỏi, web gửi câu hỏi kèm SỐ TỔNG HỢP giá đối thủ qua Apps Script. API key nằm ở Script Properties, không tới trình duyệt.
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
  // Dán key hãng nào thì bot dùng hãng đó; tên và lời cảnh báo dữ liệu đổi theo.
  const WHO = { gemini: "Gemini (Google). Bản miễn phí có thể được Google dùng để cải thiện sản phẩm", claude: "Claude (Anthropic). Theo điều khoản API, Anthropic mặc định không dùng dữ liệu gửi qua API để huấn luyện model" };
  let NAME = "AI";
  function showStatus(s) {
    NAME = s.provider === "claude" ? "Claude" : s.provider === "gemini" ? "Gemini" : "AI";
    $("#bot-open").textContent = `Hỏi ${NAME}`; $("#bot-title").textContent = `Hỏi ${NAME} về giá đối thủ`;
    if (WHO[s.provider]) $("#bot-who").textContent = WHO[s.provider];
    $("#bot-status").textContent = s.hasKey ? `Đang dùng ${NAME}. Hôm nay đã hỏi ${s.used}/${s.limit} lần.` : "Chưa có key nên bot chưa trả lời được. Hãy dán key Gemini hoặc Claude ở ô bên dưới.";
    $("#bot-key-title").textContent = s.hasKey ? `Đã có key ${NAME}. Bấm để thay key khác` : "Dán key AI";
    $("#bot-key-box").open = !s.hasKey;
    // Ô chọn model: gợi ý theo hãng, gõ được tên khác (chép từ AI Studio / trang model của Anthropic).
    const box = $("#bot-model-box"), M = MODELS[s.provider];
    box.hidden = !s.hasKey || !M;
    if (!M) return;
    $("#bot-model-title").textContent = `Model đang dùng: ${s.model}`;
    $("#bot-model-note").textContent = M.note;
    $("#bot-models").innerHTML = M.list.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
    $("#bot-model").value = s.model;
  }
  const MODELS = {
    gemini: { note: "Xem model nào còn hạn mức miễn phí ở aistudio.google.com, mục hạn mức (Usage / Rate limit), rồi chọn hoặc gõ đúng tên model đó. Mỗi model có hạn mức miễn phí riêng.",
      list: [["gemini-3.5-flash-lite", "Nhanh, hạn mức miễn phí thường rộng nhất"], ["gemini-3.5-flash", "Trả lời kỹ hơn, hạn mức miễn phí ít hơn"]] },
    claude: { note: "Claude không có bản miễn phí, mỗi câu hỏi trừ vào tín dụng đã nạp. Haiku rẻ nhất, Opus trả lời kỹ nhất.",
      list: [["claude-haiku-5-5", "Haiku 5.5: rẻ nhất (khoảng 0,005 USD/câu)"], ["claude-sonnet-5-5", "Sonnet 5.5: cân bằng"], ["claude-opus-5-5", "Opus 5.5: kỹ nhất, đắt nhất"]] },
  };
  async function saveModel() {
    const btn = $("#bot-model-save"), msg = $("#bot-model-msg"), m = $("#bot-model").value.trim();
    if (!m) { msg.textContent = "Chưa chọn model."; return; }
    btn.disabled = true; msg.textContent = "Đang lưu…";
    try { const s = await API.saveBotModel(m); showStatus(s); msg.textContent = "Đã đổi model. Câu hỏi tiếp theo sẽ dùng model này."; }
    catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  }
  async function saveKey() {
    const input = $("#bot-key"), btn = $("#bot-key-save"), msg = $("#bot-key-msg"), key = input.value;
    if (!key.trim()) { msg.textContent = "Chưa dán key."; return; }
    btn.disabled = true; msg.textContent = "Đang lưu…";
    try { const s = await API.saveBotKey(key); input.value = ""; showStatus(s); msg.textContent = "Đã lưu key."; }
    catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  }
  async function refreshStatus() {
    try {
      const s = await API.botStatus();
      showStatus(s);
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
    const wait = addTurn("ai", `${NAME} đang trả lời…`, "wait");
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
    $("#bot-key-save").addEventListener("click", saveKey);
    $("#bot-model-save").addEventListener("click", saveModel);
    $("#bot-model").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveModel(); } });
    $("#bot-key").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveKey(); } });
    $("#bot-send").addEventListener("click", () => send($("#bot-q").value));
    $("#bot-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#bot-q").value); } });
    $("#bot-preview").addEventListener("toggle", (e) => { if (e.target.open) refreshData().catch(() => {}); });
  }
  return { init };
})();
