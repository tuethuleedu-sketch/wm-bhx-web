// Giả lập các dịch vụ Google Apps Script tối thiểu mà gas/Code.gs dùng — CHỈ để test trên trình duyệt.
// Không mô phỏng giới hạn/quota/độ trễ thật của Google.
(function (G) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.data[this.r - 1 + i] || [];
        out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? "" : row[this.c - 1 + j])));
      }
      return out;
    }
    setValues(v) {
      if (v.length !== this.nr || v.some((r) => r.length !== this.nc)) throw new Error(`setValues: kích thước sai (${v.length}x${v[0] && v[0].length} vs ${this.nr}x${this.nc})`);
      v.forEach((row, i) => {
        const R = (this.sh.data[this.r - 1 + i] ||= []);
        row.forEach((x, j) => { R[this.c - 1 + j] = x; });
      });
      for (let i = 0; i < this.sh.data.length; i++) this.sh.data[i] ||= [];
      return this;
    }
    setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    getDataRange() {
      const nr = Math.max(this.getLastRow(), 1), nc = Math.max(1, ...this.data.map((r) => r.length));
      return new Range(this, 1, 1, nr, nc);
    }
    getRange(a, b, c, d) { return typeof a === "string" ? new Range(this, 1, 1, 0, 0) : new Range(this, a, b, c || 1, d || 1); }
    clearContents() { this.data = []; }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((x) => x !== "" && x !== undefined)) return i + 1;
      return 0;
    }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(id, name) { this.id = id; this.name = name; this.sheets = [new Sheet("Sheet1")]; }
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets; }
    getId() { return this.id; }
  }

  const M = (G.__gas = { files: {}, mails: [], removed: [], trashed: [], triggers: [], driveRemoveFails: false, cache: new Map(), props: new Map() });
  const active = new Spreadsheet("ACTIVE", "DB");
  let fileSeq = 0;

  G.SpreadsheetApp = {
    getActiveSpreadsheet: () => active,
    create: (name) => { const id = "F" + ++fileSeq; return (M.files[id] = new Spreadsheet(id, name)); },
    openById: (id) => { if (!M.files[id]) throw new Error("File không tồn tại: " + id); return M.files[id]; },
  };
  G.DriveApp = {
    getFileById: (id) => {
      if (!M.files[id]) throw new Error("File không tồn tại: " + id);
      return { moveTo() {}, setTrashed() { M.trashed.push(id); } };
    },
    getFoldersByName: () => ({ hasNext: () => !!M.folder, next: () => M.folder }),
    createFolder: (n) => (M.folder = { name: n }),
  };
  G.Drive = { Files: { remove: (id) => { if (M.driveRemoveFails) throw new Error("Drive API chưa bật"); delete M.files[id]; M.removed.push(id); } } };

  G.CacheService = {
    getScriptCache: () => ({
      get: (k) => { const e = M.cache.get(k); if (!e || e.exp < Date.now()) { M.cache.delete(k); return null; } return e.v; },
      put: (k, v, ttl) => M.cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }),
      remove: (k) => M.cache.delete(k),
    }),
  };
  G.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (M.props.has(k) ? M.props.get(k) : null), setProperty: (k, v) => M.props.set(k, String(v)) }) };

  // Băm giả (KHÔNG phải SHA-256 thật) — đủ để test logic so khớp; trả mảng 32 byte có dấu như Apps Script
  function fakeDigest(s) {
    const out = [];
    let h = 2166136261;
    for (let round = 0; round < 32; round++) {
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + round; h = Math.imul(h, 16777619); }
      out.push(((h >>> 0) & 255) - 128);
    }
    return out;
  }
  G.Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_alg, s) => fakeDigest(String(s)),
    formatDate: (d, _tz, f) => {                         // chỉ hỗ trợ múi giờ +07 và các mẫu Code.gs dùng
      const t = new Date(d.getTime() + 7 * 3600e3);
      const m = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()) };
      return f.replace(/yyyy|MM|dd|HH|mm/g, (k) => m[k]);
    },
  };
  G.MailApp = { sendEmail: (o) => M.mails.push(o) };
  G.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  G.Session = { getEffectiveUser: () => ({ getEmail: () => "Owner@Gmail.com" }) };
  G.Logger = { log: (...a) => (M.logs ||= []).push(a.join(" ")) };
  G.ContentService = {
    MimeType: { JSON: "JSON" },
    createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
  };
  G.ScriptApp = {
    getProjectTriggers: () => M.triggers.slice(),
    deleteTrigger: (t) => { M.triggers = M.triggers.filter((x) => x !== t); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyHours: (h) => ({ create: () => { const t = { getHandlerFunction: () => fn, h }; M.triggers.push(t); return t; } }) }) }),
  };

  // Gọi Web app như trình duyệt/GitHub Action gọi
  G.gasCall = (body) => JSON.parse(G.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).getContent());
  G.lastOtp = (email) => { const m = [...M.mails].reverse().find((x) => x.to === email); return m && m.subject.match(/(\d{6})$/)[1]; };
})(window);
