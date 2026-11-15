// Cây ngành hàng BHX 3 cấp: Ngành lớn › Nhóm › Ngành (tên ngành BHX trả về, 153 ngành đang lấy giá).
// Lập theo tên ngành lấy từ BHX ngày 11/11/2026. Ngành mới chưa có trong cây thì vào "Khác".
window.CatTree = (function () {
  const TREE = {
    "Thịt, cá, trứng, rau củ": {
      "Thịt": ["Thịt heo", "Thịt bò", "Thịt gà, vịt"],
      "Cá, hải sản, trứng": ["Cá, hải sản", "Trứng gà, vịt, cút"],
      "Rau, củ, trái cây": ["Rau lá", "Củ, quả", "Trái cây", "Nấm các loại"],
    },
    "Hàng đông, hàng mát": {
      "Hàng đông": ["Thủy hải sản, thịt đông", "Hàng đông chế biến", "Viên đông, viên mát", "Chả giò", "Kem"],
      "Hàng mát": ["Hàng mát chế biến", "Xúc xích, lạp xưởng, giò chả", "Sữa chua", "Bánh tươi, Sandwich"],
    },
    "Sữa các loại": {
      "Sữa nước": ["Sữa tươi", "Sữa hạt, sữa đậu", "Sữa trái cây", "Sữa chua uống liền"],
      "Sữa bột, sữa đặc, ngũ cốc": ["Sữa bột, pha sẵn", "Sữa đặc", "Ngũ cốc, yến mạch"],
    },
    "Đồ uống": {
      "Nước giải khát": ["Nước ngọt", "Nước suối", "Nước trà", "Nước tăng lực, bù khoáng", "Nước ép trái cây", "Nước yến", "Trái cây hộp, si rô"],
      "Cà phê, trà": ["Cà phê hoà tan", "Cà phê pha phin", "Cà phê lon", "Trà khô, túi lọc"],
      "Bia, rượu": ["Bia, nước có cồn", "Rượu"],
    },
    "Mì, gạo, đồ khô": {
      "Mì, phở, cháo ăn liền": ["Mì ăn liền", "Phở, bún ăn liền", "Cháo gói, cháo tươi", "Hủ tiếu, miến"],
      "Gạo, bún, mì khô, bột": ["Gạo, nếp", "Mì Ý, mì trứng", "Nui các loại", "Miến, hủ tiếu, phở khô", "Bún các loại", "Bánh tráng", "Bánh phồng, bánh đa", "Bánh gạo Hàn Quốc", "Bột các loại"],
      "Đồ hộp, đồ khô": ["Cá hộp", "Heo, bò, pate hộp", "Xúc xích", "Đậu, nấm, đồ khô", "Rong biển", "Khô chế biến sẵn", "Cơm cháy, bánh tráng", "Nước cốt dừa lon"],
    },
    "Gia vị, dầu ăn": {
      "Dầu ăn, bơ, giấm": ["Dầu ăn", "Dầu hào, giấm, bơ"],
      "Nước chấm, tương": ["Nước mắm", "Nước tương", "Nước chấm, mắm", "Tương ớt, tương đen, mayonnaise", "Chao"],
      "Gia vị": ["Muối", "Đường", "Hạt nêm, bột ngọt, bột canh", "Tiêu, sa tế, ớt bột", "Gia vị nêm sẵn", "Bột nghệ, tỏi, hồi, quế,..."],
    },
    "Bánh kẹo, ăn vặt": {
      "Bánh": ["Bánh quy", "Bánh bông lan", "Bánh quế", "Bánh xốp", "Bánh gạo", "Bánh que", "Bánh Chocopie"],
      "Kẹo, socola": ["Kẹo cứng", "Kẹo Singum", "Kẹo dẻo, kẹo marshmallow", "Socola"],
      "Ăn vặt": ["Bánh snack", "Trái cây sấy", "Hạt khô", "Rau câu, thạch dừa"],
    },
    "Chăm sóc cá nhân": {
      "Tắm gội, tóc": ["Sữa tắm", "Dầu gội", "Dầu xả, kem ủ", "Xà bông cục", "Nước rửa tay", "Keo vuốt tóc", "Thuốc nhuộm tóc", "Khăn tắm, bông tắm"],
      "Răng miệng": ["Kem đánh răng", "Bàn chải, tăm chỉ nha khoa", "Nước súc miệng"],
      "Chăm sóc da, mỹ phẩm": ["Sữa rửa mặt", "Sữa dưỡng thể", "Kem dưỡng, serum", "Mặt nạ", "Kem chống nắng", "Tẩy trang", "Lăn xịt khử mùi", "Nước hoa", "Dao cạo, bọt cạo râu", "Tăm bông"],
      "Vệ sinh phụ nữ, sức khoẻ": ["Băng vệ sinh", "Dung dịch vệ sinh", "Bao cao su"],
      "Giấy, khăn giấy": ["Khăn giấy", "Khăn ướt", "Giấy vệ sinh"],
    },
    "Mẹ và bé": {
      "Đồ dùng cho bé": ["Giặt xả cho bé", "Bàn chải cho bé", "Kem đánh răng bé", "Phấn thơm, dưỡng ẩm", "Tắm gội cho bé"],
    },
    "Giặt giũ, vệ sinh nhà": {
      "Giặt xả": ["Bột giặt", "Nước giặt", "Nước xả", "Nước tẩy"],
      "Vệ sinh nhà cửa": ["Nước rửa chén", "Nước lau sàn", "Tẩy rửa nhà tắm", "Lau kính, lau bếp", "Bình xịt côn trùng", "Xịt phòng, sáp thơm", "Miếng rửa chén", "Bàn chải", "Túi đựng rác"],
    },
    "Đồ dùng gia đình": {
      "Nhà bếp": ["Chảo", "Dao, kéo", "Hộp đựng thực phẩm", "Màng bọc thực phẩm", "Đồ dùng một lần", "Khăn lau bếp", "Bật lửa, kẹp gắp"],
      "Đồ dùng khác": ["Pin tiểu", "Băng keo, bao thư", "Đồ thờ cúng"],
    },
  };
  const OTHER = "Khác";
  const norm = (s) => String(s || "").normalize("NFC").trim().toLowerCase();
  const map = new Map();
  Object.entries(TREE).forEach(([l1, groups]) => Object.entries(groups).forEach(([l2, cats]) => cats.forEach((c) => map.set(norm(c), [l1, l2]))));
  const order = Object.keys(TREE).concat(OTHER);
  // Chuỗi khác: ngành lớn của chuỗi (LOTTE cấp 3, Kingfoodmart và Co.op cấp 1, Emart cấp 2) xếp vào 11 ngành lớn chung. Nhóm giữ tên ngành của chuỗi.
  const L = { TT: "Thịt, cá, trứng, rau củ", DM: "Hàng đông, hàng mát", SUA: "Sữa các loại", DU: "Đồ uống", KHO: "Mì, gạo, đồ khô", GV: "Gia vị, dầu ăn", BK: "Bánh kẹo, ăn vặt", CS: "Chăm sóc cá nhân", MB: "Mẹ và bé", GG: "Giặt giũ, vệ sinh nhà", GD: "Đồ dùng gia đình" };
  const GROUPS = {
    LOTTE: { "rau củ": L.TT, "thịt": L.TT, "thủy sản": L.TT, "trứng": L.TT, "trái cây": L.TT, "thực phẩm đông lạnh": L.DM, "thực phẩm sơ chế": L.DM, "món ăn nhanh": L.DM, "bánh tươi": L.DM,
      "dầu ăn, gia vị": L.GV, "gạo, mì, bún, đậu": L.KHO, "thực phẩm khô": L.KHO, "chế phẩm từ sữa": L.SUA, "bánh kẹo": L.BK, "trà, cà phê": L.DU, "đồ uống": L.DU, "thực phẩm bổ sung": L.DU,
      "sức khỏe, làm đẹp": L.CS, "chăm sóc cá nhân": L.CS, "mẹ và bé": L.MB, "hóa phẩm, vệ sinh": L.GG, "nhà cửa đời sống": L.GD },
    KFM: { "thế giới trái cây": L.TT, "rau củ quả": L.TT, "thịt, cá, trứng, thủy, hải sản": L.TT, "kem, sữa chua": L.DM, "thực phẩm đông mát": L.DM, "sữa, bơ, phô mai": L.SUA,
      "mì gói, xúc xích, đồ hộp": L.KHO, "gạo, đậu, bột, đồ khô": L.KHO, "bánh kẹo, ăn vặt": L.BK, "bánh tươi, ngũ cốc, ăn sáng": L.BK, "dầu ăn, nước chấm, gia vị": L.GV,
      "bia, rượu, đồ uống có cồn": L.DU, "trà, cà phê, nước giải khát": L.DU, "đồ dùng gia đình": L.GD, "chăm sóc cá nhân": L.CS },
    COOP: { "rau củ, trái cây": L.TT, "thịt, trứng, hải sản": L.TT, "thức ăn chế biến, bún tươi": L.DM, "thực phẩm đông, mát": L.DM, "sữa, sản phẩm từ sữa": L.SUA,
      "thức uống": L.DU, "bánh, kẹo, snack": L.BK, "gia vị, gạo, thực phẩm khô": L.KHO, "sản phẩm cho bé": L.MB, "chăm sóc cá nhân": L.CS, "nhà cửa và đời sống": L.GD },
    // Cập nhật 13/11/2026: Emart tách ngành nhỏ hơn (trước gộp chung "trứng, thịt, hải sản") — tên khớp thẳng BHX ở mức ngành nhỏ nhất có thể.
    EMART: { "bánh mặn, bánh ngọt": L.DM, "món ăn chế biến sẵn hàn quốc": L.DM, "món ăn chế biến sẵn việt nam": L.DM, "món ăn chế biến sẵn khác": L.DM, "đồ uống (chế biến sẵn)": L.DU,
      "rau lá": L.TT, "củ, quả": L.TT, "rau gia vị": L.TT, "nấm": L.TT, "đậu hũ": L.TT, "rau củ gap": L.TT, "rau củ hữu cơ": L.TT, "rau củ cắt sẵn": L.TT,
      "trái cây nhập khẩu": L.TT, "trái cây nội địa": L.TT,
      "trứng": L.TT, "thịt bò": L.TT, "thịt heo": L.TT, "thịt gia cầm": L.TT, "thủy hải sản": L.TT, "trứng, thịt khác": L.TT,
      "gạo": L.KHO,
      "bánh kẹo, trái cây sấy (khô)": L.BK, "hạt, trà (khô)": L.DU, "thịt, thủy hải sản khô": L.KHO,
      "thực phẩm ăn liền": L.KHO, "thực phẩm đóng hộp": L.KHO,
      "sữa nước": L.SUA, "sữa đặc, sữa bột": L.SUA,
      "sản phẩm từ sữa (mát)": L.SUA, "sản phẩm từ thịt (mát)": L.DM, "thực phẩm mát khác": L.DM,
      "thực phẩm chế biến sẵn (đông lạnh)": L.DM, "thịt, thủy hải sản (đông lạnh)": L.DM, "đông lạnh khác": L.DM,
      "bánh": L.BK, "kẹo, mứt": L.BK, "sản phẩm sấy khô": L.BK,
      "trà, cà phê": L.DU, "nước giải khát": L.DU, "nước suối": L.DU, "đồ uống có cồn": L.DU,
      "dầu ăn, bơ thực vật": L.GV, "nước chấm": L.GV, "gia vị, nước sốt": L.GV, "bột, hạt, nấm khô": L.KHO, "thực phẩm dinh dưỡng": L.SUA, "đồ chay": L.KHO,
      "chăm sóc răng miệng": L.CS, "chăm sóc da mặt": L.CS, "chăm sóc tóc": L.CS, "chăm sóc cơ thể": L.CS, "chăm sóc cá nhân khác": L.CS, "mẹ và bé": L.MB,
      "giấy": L.CS, "giặt giũ": L.GG, "tẩy rửa": L.GG, "khử mùi, diệt côn trùng": L.GG, "dụng cụ vệ sinh": L.GG, "đồ gia dụng": L.GD,
      "dụng cụ nhà bếp": L.GD, "dụng cụ ăn uống": L.GD, "phòng tắm": L.GD, "nhà cửa khác": L.GD,
      "no brand: ăn liền, gia vị": L.KHO, "no brand: bánh kẹo": L.BK, "no brand: đồ uống": L.DU, "no brand: đông lạnh": L.DM, "no brand: chăm sóc cá nhân": L.CS, "no brand: nhà cửa": L.GG,
      "hàng hàn: gia vị, xốt": L.GV, "hàng hàn: ăn liền": L.KHO, "hàng hàn: bánh kẹo": L.BK, "hàng hàn: sữa, dinh dưỡng": L.SUA, "hàng hàn: đồ uống": L.DU,
      "hàng hàn: mát, đông lạnh": L.DM, "hàng hàn: rong biển, kim chi": L.KHO, "hàng hàn: chăm sóc cá nhân": L.CS, "hàng hàn: nhà cửa": L.GG },
    // GO!/Big C/Tops Market: tên ngành lớn trên web đã khớp thẳng tên BHX (không cần map vòng qua tên riêng của chuỗi).
    GO: { "thịt heo": L.TT, "thịt gia cầm": L.TT, "thủy hải sản": L.TT, "trứng": L.TT, "thịt bò": L.TT, "rau, củ, nấm": L.TT, "trái cây": L.TT,
      "sữa các loại": L.SUA, "bánh mì, bánh ngọt": L.DM, "nguyên liệu - gia vị": L.GV, "gạo, mì, bún": L.KHO, "món ăn nhanh": L.DM, "thực phẩm đông mát": L.DM,
      "xúc xích & đồ hộp": L.KHO, "bánh kẹo các loại": L.BK, "đồ uống các loại": L.DU, "chăm sóc nhà cửa": L.GG, "chăm sóc cá nhân": L.CS, "chăm sóc cho bé": L.MB,
      "khăn, giấy vệ sinh": L.CS, "đồ dùng gia đình": L.GD, "đồ dùng nhà bếp": L.GD, "đồ điện gia dụng": L.GD },
  };
  // Bảng ánh xạ ngành NHỎ chính thức (không phải so khớp chữ may rủi) — lập 15/11/2026 bằng dữ liệu thật gọi trực tiếp
  // từ API/trang mỗi chuỗi (xem ghi chú trong lịch sử trò chuyện/HANDOFF). Hiện chỉ làm xong nhóm "Thịt, cá, trứng, rau củ"
  // (9 ngành nhỏ) — nhóm khác chưa có thì renderChainCompare tự rơi về so khớp chữ như trước (không vỡ, không sai, chỉ kém chi tiết hơn).
  // Nhiều tên của 1 chuỗi có thể cùng quy về 1 ngành nhỏ BHX (ví dụ Co.op "Cá" + "Hải sản" đều → "Cá, hải sản").
  const LEAF_MAP = {
    LOTTE: { "thịt heo": "Thịt heo", "thịt bò": "Thịt bò", "thịt gà": "Thịt gà, vịt", "thịt gà khác": "Thịt gà, vịt",
      "thủy sản tươi sống": "Cá, hải sản", "trứng gà": "Trứng gà, vịt, cút", "trứng vịt": "Trứng gà, vịt, cút",
      "rau lá": "Rau lá", "rau củ": "Củ, quả", "nấm": "Nấm các loại",
      "trái cây": "Trái cây", "táo, lê": "Trái cây", "dưa hấu, dưa lưới": "Trái cây", "cam, bưởi, quýt": "Trái cây",
      "chuối": "Trái cây", "xoài": "Trái cây", "nho, cherry, dâu, kiwi": "Trái cây", "trái cây khác": "Trái cây" },
    KFM: { "thịt heo": "Thịt heo", "thịt bò": "Thịt bò", "thịt gia cầm": "Thịt gà, vịt",
      "cá, thủy, hải sản tươi": "Cá, hải sản", "trứng gia cầm": "Trứng gà, vịt, cút" },
    COOP: { "thịt heo": "Thịt heo", "thịt bò": "Thịt bò", "gà, vịt": "Thịt gà, vịt", "cá": "Cá, hải sản", "hải sản": "Cá, hải sản",
      "trứng gà": "Trứng gà, vịt, cút", "trứng vịt": "Trứng gà, vịt, cút" },
    EMART: { "thịt heo": "Thịt heo", "thịt bò": "Thịt bò", "thịt gia cầm": "Thịt gà, vịt", "thủy hải sản": "Cá, hải sản", "trứng": "Trứng gà, vịt, cút",
      "rau lá": "Rau lá", "củ, quả": "Củ, quả", "nấm": "Nấm các loại", "trái cây nhập khẩu": "Trái cây", "trái cây nội địa": "Trái cây" },
    GO: { "thịt heo": "Thịt heo", "thịt bò": "Thịt bò", "thịt gia cầm": "Thịt gà, vịt", "thủy hải sản": "Cá, hải sản", "trứng": "Trứng gà, vịt, cút", "trái cây": "Trái cây" },
  };
  const LEAVES = new Set();
  Object.values(TREE).forEach((groups) => Object.values(groups).forEach((cats) => cats.forEach((c) => LEAVES.add(norm(c)))));
  return {
    // [ngành lớn, nhóm] của ngành thuộc chuỗi khác BHX: nhóm = ngành lớn của chuỗi đó
    ofGroup: (chain, grp) => [(GROUPS[chain] || {})[norm(grp)] || OTHER, grp || OTHER],
    // [ngành lớn, nhóm] của một ngành BHX
    of: (cat) => map.get(norm(cat)) || [OTHER, OTHER],
    // Tên ngành NHỎ chuẩn (theo đúng tên BHX) của 1 ngành thuộc chuỗi bất kỳ — null nếu chưa lập được (nhóm khác chưa làm).
    // BHX: trả lại chính tên đó nếu đúng là 1 trong 153 ngành nhỏ đã biết.
    leafOf: (chain, cat) => { const n = norm(cat); return chain === "BHX" ? (LEAVES.has(n) ? cat : null) : ((LEAF_MAP[chain] || {})[n] || null); },
    // thứ tự ngành lớn và nhóm như trong cây, "Khác" cuối cùng
    rank: (l1, l2) => { const a = order.indexOf(l1), g = TREE[l1] ? Object.keys(TREE[l1]).indexOf(l2) : -1; return (a < 0 ? 99 : a) * 100 + (l2 === undefined ? 0 : g < 0 ? 99 : g); },
  };
})();
