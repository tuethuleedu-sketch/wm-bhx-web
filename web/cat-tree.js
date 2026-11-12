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
    EMART: { "bánh mì, bánh ngọt": L.DM, "món ăn chế biến sẵn": L.DM, "rau củ": L.TT, "trái cây": L.TT, "trứng, thịt, hải sản": L.TT, "gạo": L.KHO, "đồ khô": L.KHO,
      "thực phẩm ăn liền": L.KHO, "sữa": L.SUA, "thực phẩm mát": L.DM, "thực phẩm đông lạnh": L.DM, "bánh kẹo, snack": L.BK, "đồ uống": L.DU,
      "dầu ăn, bơ thực vật": L.GV, "nước chấm": L.GV, "gia vị, nước sốt": L.GV, "bột, hạt, nấm khô": L.KHO, "thực phẩm dinh dưỡng": L.SUA, "đồ chay": L.KHO,
      "chăm sóc răng miệng": L.CS, "chăm sóc da mặt": L.CS, "chăm sóc tóc": L.CS, "chăm sóc cơ thể": L.CS, "chăm sóc cá nhân khác": L.CS, "mẹ và bé": L.MB,
      "vệ sinh nhà cửa": L.GG, "đồ dùng nhà bếp": L.GD, "đồ dùng phòng tắm": L.GD, "đồ dùng gia đình khác": L.GD,
      "no brand: ăn liền, gia vị": L.KHO, "no brand: bánh kẹo": L.BK, "no brand: đồ uống": L.DU, "no brand: đông lạnh": L.DM, "no brand: chăm sóc cá nhân": L.CS, "no brand: nhà cửa": L.GG,
      "hàng hàn: thực phẩm": L.KHO, "hàng hàn: chăm sóc cá nhân": L.CS, "hàng hàn: nhà cửa": L.GG },
  };
  return {
    // [ngành lớn, nhóm] của ngành thuộc chuỗi khác BHX: nhóm = ngành lớn của chuỗi đó
    ofGroup: (chain, grp) => [(GROUPS[chain] || {})[norm(grp)] || OTHER, grp || OTHER],
    // [ngành lớn, nhóm] của một ngành BHX
    of: (cat) => map.get(norm(cat)) || [OTHER, OTHER],
    // thứ tự ngành lớn và nhóm như trong cây, "Khác" cuối cùng
    rank: (l1, l2) => { const a = order.indexOf(l1), g = TREE[l1] ? Object.keys(TREE[l1]).indexOf(l2) : -1; return (a < 0 ? 99 : a) * 100 + (l2 === undefined ? 0 : g < 0 ? 99 : g); },
  };
})();
