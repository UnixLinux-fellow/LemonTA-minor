// 成本计算 — 复刻 utils/calculate.xlsx 的公式逻辑。
// 输入：每个柜子 { code(a/b/c/d/g), w(cm), h(cm) } + 配置（板材/门板材质/门板工艺/五金/照明）
// 输出：每个柜子的板件清单 + 五金清单 + 小计 + 合计

// ---- 数据库表（来自 sheet2 数据库） ----
// 板材单价 元/m²
const PANEL_PRICE = {
  'E2国产板': 80,
  '兔宝宝': 120,
  '克诺斯帮': 115,
  // 键名与 materials/index.js 的 PANEL_OPTIONS id 严格保持一致（用户 UI 显示的是"帮"），
  // 之前写成"邦"导致选了这一项时查表 miss，所有板件都用 E2 的 80 元/㎡，
  // 用户感受到"无论选哪种板，成本都不变"
  '德国克诺斯帮': 155,
  '爱格': 195,
};

// 门板材质单价加价 元/m²
const DOOR_PANEL_DELTA = {
  '柜体相同': 0,
  '钢琴烤漆': 200,
  '肤感烤漆': 250,
  '铝框AG玻璃': 270,
  '实木贴皮': 300,
  '橡胶实木': 480,
  '白蜡实木': 830,
};

// 门板工艺加价 元/m²
const DOOR_CRAFT_DELTA = {
  '无': 0,
  '骨骼线': 75,
  '骨格线': 75,
  '欧式': 148,
  '格栅门': 300,
};

// 层板数量（按 type，对应 xlsx 数据库!A21:B25）
const SHELF_COUNT = { a: 2, b: 2, c: 2, d: 3, g: 0 };

// A 抽屉数量（对应 xlsx 数据库!A28:B32）
const A_DRAWER = { a: 0, b: 0, c: 2, d: 2, g: 0 };
// B 抽屉数量（对应 xlsx 数据库!A35:B39）
const B_DRAWER = { a: 0, b: 0, c: 0, d: 1, g: 0 };

// 五金 — 铰链组（D29..D32 各装饰盖+底座+铰链等）
// E2:G9 表，按 ROW 偏移 0..3 取 4 行（铰链/一字底座/装饰盖A/装饰盖B 等）
const HINGE_TABLE = {
  '中国品牌': [
    { name: 'DTC东泰 C81全盖铰链', unit: 4 },
    { name: 'DTC东泰 C81一字底座', unit: 1.2 },
    { name: 'DTC东泰 铰链装饰盖', unit: 0.5 },
    { name: 'DTC东泰 铰杯装饰盖', unit: 0.5 },
  ],
  '海外品牌': [
    { name: 'Blum百隆 175H3100 MB快装集成阻尼 110°全盖', unit: 20 },
    { name: 'Blum百隆 175H3100 快装铰链一字底座 偏心螺丝', unit: 5 },
    { name: 'Blum百隆 70.1503 铰链装饰盖全盖镀镍', unit: 1 },
    { name: 'Blum百隆 TO-AB 铰杯装饰盖', unit: 1 },
  ],
};

// 挂衣杆组（F12..G15 表，按 ROW 偏移 0..3 取 4 行）
const ROD_TABLE = {
  '中国品牌': [
    { name: '加厚铝合金静音条挂衣杆 /cm', unit: 0.35 },
    { name: '挂衣杆双侧法兰 /对', unit: 5 },
    { name: 'Ø5mm×12mm 尼龙螺丝预埋颗粒', unit: 0.141 },
    { name: 'M4×16 深螺纹镀镍螺丝', unit: 9.6 / 300 },
  ],
  '海外品牌': [
    { name: 'Häfele海福乐 衣杆带顶部静音条 高级灰 /cm', unit: 216 / 3 / 100 },
    { name: 'Häfele海福乐 衣杆托 侧装/顶装 高级灰 /对', unit: 50 },
    { name: 'Ø5mm×12mm 尼龙螺丝预埋颗粒', unit: 0.141 },
    { name: 'M4×16 深螺纹镀镍螺丝', unit: 9.6 / 300 },
  ],
};

// 反弹器（对应 xlsx 数据库!F18:G19）
const PUSH_TABLE = {
  '中国品牌': { name: '悍高 重型反弹器 L=70mm', unit: 2.2 },
  '海外品牌': { name: 'Häfele 反弹器带橡胶缓冲器 M-PUSH L=80mm', unit: 22 },
};

// 上翻门支臂（F22..G23）
const FLAP_TABLE = {
  '中国品牌': { name: 'H-03A任意停支撑杆', unit: 14.5 },
  '海外品牌': { name: 'Häfele海福乐 重载型任意停上翻铰链', unit: 97 },
};

// 灯带组（对应 xlsx 数据库!F26:G33）
const LED_TABLE = {
  '中国品牌': [
    { name: 'Led 超薄1010带边灯槽 /米', unit: 4.4 },
    { name: '12V 4000K LED灯带 60珠 8mm /米', unit: 15 },
    { name: '12V 36瓦变压器', unit: 85 },
    { name: '12V 双头门碰感应器', unit: 47 },
  ],
  '海外品牌': [
    { name: 'Häfele Loox5 内嵌式型材1101 /米', unit: 41.58 / 3 },
    { name: 'Häfele Loox LED 2042 24V灯带 4000K /米', unit: 200 / 5 },
    { name: 'Häfele Loox5 24V 恒压电源+多开关分控盒V2', unit: 120 + 80 },
    { name: 'Loox5模块化门感应模块+导线', unit: 33.27 + 16.12 },
  ],
};

// 三合一（F36..G37）
const TRIO = {
  '中国品牌': { name: '常规三合一', unit: 0.2 },
  '海外品牌': { name: 'Häfele 抽屉三合一连接件', unit: 0.8 },
};

// === 公式实现 ===
function calc({ cabinets, materials, wall }) {
  const cfg = {
    panel: materials.panel || 'E2国产板',
    doorPanel: materials.doorPanel || '柜体相同',
    doorCraft: materials.doorCraft || '无',
    hardware: materials.hardware || '中国品牌',
    lighting: materials.lighting || '无',
  };
  const modules = (cabinets || []).map((c) => calcOne(c, cfg));
  // 总成本 = SUM(板材) + SUM(五金) + 运费 + 安装费
  const sumPanel = modules.reduce((s, m) => s + m.panelCost, 0);
  const sumHw = modules.reduce((s, m) => s + m.hardwareCost, 0);
  const sumArea = modules.reduce((s, m) => s + m.totalArea, 0);
  const transport = round2(sumArea * 15);
  const install = round2(sumArea * 20);

  // 收口条合并：左/右(2cm × H) + 上(W-4 × 2cm)，单价为门板单价
  let sk = null;
  if (wall && wall.w && wall.h) {
    const panelUnit = PANEL_PRICE[cfg.panel] || PANEL_PRICE['E2国产板'];
    const doorUnit = panelUnit
      + (DOOR_PANEL_DELTA[cfg.doorPanel] || 0)
      + (DOOR_CRAFT_DELTA[cfg.doorCraft] || 0);
    const area = round4(
      (2 * wall.h) / 10000 +
      (2 * wall.h) / 10000 +
      ((wall.w - 4) * 2) / 10000
    );
    const total = round2(doorUnit * area);
    sk = { label: '收口条', area, unit: doorUnit, total };
  }

  const grandTotal = round2(
    sumPanel + sumHw + transport + install + (sk ? sk.total : 0)
  );
  return {
    modules: modules.map((m) =>
      Object.assign({}, m, {
        transport: round2(m.totalArea * 15),
        install: round2(m.totalArea * 20),
        total: round2(m.panelCost + m.hardwareCost + m.totalArea * 35),
      })
    ),
    sk,
    transport,
    install,
    panelTotal: round2(sumPanel),
    hardwareTotal: round2(sumHw),
    grandTotal,
  };
}

// 单个柜子（参考 sheet1 的 R6..R58）
function calcOne(c, cfg) {
  const W = c.w; // 宽度 cm
  const H = c.h; // 高度 cm
  const TYPE = (c.code || 'a').toLowerCase().charAt(0); // a/b/c/d/g
  const isG = TYPE === 'g';
  const lightType = cfg.lighting; // 无/国产/进口

  const panelUnit = PANEL_PRICE[cfg.panel] || PANEL_PRICE['E2国产板'];
  const doorUnit = panelUnit
    + (DOOR_PANEL_DELTA[cfg.doorPanel] || 0)
    + (DOOR_CRAFT_DELTA[cfg.doorCraft] || 0);

  // ---- 板件清单 (R6..R24) ----
  const panels = [];
  const pushPanel = (name, l, w, t, qty, unit) => {
    const area = (l * w) / 10000;
    const total = qty * area * unit;
    panels.push({
      name,
      size: `${num(l)}×${num(w)}×${num(t)}`,
      qty,
      area: round4(area),
      unit,
      total: round2(total),
    });
  };

  // R6 左侧板：长 = H-6, 宽 = 60-2 = 58, 厚 1.8, 数量 1
  pushPanel('左侧板', H - 6, 58, 1.8, 1, panelUnit);
  // R7 右侧板：同上
  pushPanel('右侧板', H - 6, 58, 1.8, 1, panelUnit);
  // R8 顶板：长 = W - 3.6, 宽 58
  pushPanel('顶板', W - 3.6, 58, 1.8, 1, panelUnit);
  // R9 底板：长 96.4 (写死值；按 W=100 时 W-3.6=96.4，原表用了常数；这里改用 W-3.6 保持一致)
  pushPanel('底板', W - 3.6, 58, 1.8, 1, panelUnit);
  // R10 厚背板：长 = H - 1.8 - 1.8 - 6 = H-9.6, 宽 = W-3.6
  pushPanel('厚背板', H - 9.6, W - 3.6, 1.8, 1, panelUnit);
  // R11 层板：长 = W-3.6, 宽 = 56.2, 数量 = SHELF_COUNT[type] + (type='g' && H>=51 ? 1 : 0)
  // —— 特殊：xlsx 这一行的 G 列 = C*D/10000*F（把数量乘进了"面积"里），
  //     I 列又用 F*G*H 再乘一次 F，等价于 F²*单片面积*单价。
  //     运费/安装费里的 SUMPRODUCT(F,G) 同样以 F²*单片面积 计 R11。
  //     其它结构板 R6–R10 数量都是 1，没影响；R12+ 的 G 没含 F，是标准 qty 计法。
  //     这里完全照 xlsx 字面写出（用户明确"都照 xlsx 改"）。
  const shelfQty = (SHELF_COUNT[TYPE] || 0) + (TYPE === 'g' && H >= 51 ? 1 : 0);
  {
    const l = W - 3.6;
    const ww = 56.2;
    const singleArea = (l * ww) / 10000;
    const xlsxArea = singleArea * shelfQty;
    const total = shelfQty * xlsxArea * panelUnit;
    panels.push({
      name: '层板',
      size: `${num(l)}×${num(ww)}×1.8`,
      qty: shelfQty,
      area: round4(xlsxArea),
      unit: panelUnit,
      total: round2(total),
    });
  }
  // R12 门板：长 = H - 6 - 0.44, 宽 = W - 0.6, 单价 = panelUnit + 门板材质 + 门板工艺
  pushPanel('门板', H - 6.44, W - 0.6, 1.8, 1, doorUnit);
  // R13 检修口：长 19.8, 宽 = W - 4, 数量 = (type='g' || light='无') ? 0 : 1
  {
    const qty = (isG || lightType === '无') ? 0 : 1;
    pushPanel('检修口', 19.8, W - 4, 1.8, qty, panelUnit);
  }
  // R14..R18 A 抽（A抽面/A左抽帮/A右抽帮/A后抽堵/A抽底）数量 = A_DRAWER[type]
  {
    const qty = A_DRAWER[TYPE] || 0;
    pushPanel('A抽面', W - 4, 16, 1.8, qty, panelUnit);
    pushPanel('A左抽帮', 49, 12, 1.8, qty, panelUnit);
    pushPanel('A右抽帮', 49, 12, 1.8, qty, panelUnit);
    pushPanel('A后抽堵', W - 8.5, 10.7, 1.8, qty, panelUnit);
    pushPanel('A抽底', W - 8.5, 47.2, 1.8, qty, panelUnit);
  }
  // R19..R23 B 抽 同结构，数量 = B_DRAWER[type]
  {
    const qty = B_DRAWER[TYPE] || 0;
    pushPanel('B抽面', W - 4, 5, 1.8, qty, panelUnit);
    pushPanel('B左抽帮', 49, 5, 1.8, qty, panelUnit);
    pushPanel('B右抽帮', 49, 5, 1.8, qty, panelUnit);
    pushPanel('B后抽堵', W - 8.5, 4.2, 1.8, qty, panelUnit);
    pushPanel('B抽底', W - 8.5, 47.2, 1.8, qty, panelUnit);
  }
  // R24 踢脚线：长 W+45, 宽 5.5, 数量 = type=='g' ? 0 : 1
  pushPanel('踢脚线', W + 45, 5.5, 1.8, isG ? 0 : 1, panelUnit);

  // ---- 五金清单 (R25..R58) ----
  const hardware = [];
  const pushHw = (name, qty, unit) => {
    if (qty <= 0) return;
    hardware.push({
      name,
      qty: round2(qty),
      unit: round4(unit),
      total: round2(qty * unit),
    });
  };

  // R25 SW4 沉头螺丝：数量 = H*W/320
  pushHw('SW4 6.3×50mm 白锌合金 沉头螺丝', (H * W) / 320, 0.1);
  // R26 8×40mm 定位木销：同 R25 数量
  pushHw('8×40mm 定位木销', (H * W) / 320, 0.1);
  // R27 Häfele AXILO 基座系统：数量 type='g' ? 0 : 4
  pushHw('Häfele AXILO® 基座系统 53–70 mm', isG ? 0 : 4, 4.27);
  // R28 Häfele AXILO 压入式底座：同上
  pushHw('Häfele AXILO® 压入式底座', isG ? 0 : 4, 5.68);
  // R29..R32 铰链组（4 行），数量 = 8 / 8 / 8 / 8 (R29=8 R30=R29 R31=R29 R32=R29)
  {
    const tbl = HINGE_TABLE[cfg.hardware] || HINGE_TABLE['中国品牌'];
    pushHw(tbl[0].name, 8, tbl[0].unit);
    pushHw(tbl[1].name, 8, tbl[1].unit);
    pushHw(tbl[2].name, 8, tbl[2].unit);
    pushHw(tbl[3].name, 8, tbl[3].unit);
  }
  // R33 Ø5mm×12mm 尼龙螺丝预埋颗粒：数量 = 8*2 = 16
  pushHw('Ø5mm×12mm 尼龙螺丝预埋颗粒(铰链)', 16, 0.141);
  // R34 M4×16 深螺纹镀镍螺丝：数量 = 8*2 = 16
  pushHw('M4×16 深螺纹镀镍螺丝(铰链)', 16, 9.6 / 300);
  // R35 Ø37mm×12.8mm 防潮盖：数量 = 8
  pushHw('Ø37mm×12.8mm深 37孔无介防潮盖', 8, 0.128);
  // R36..R39 灯带组件（4 行）—— xlsx：R36/R37 同 qty（2.2 or 0），R38/R39 同 qty（1 or 0）
  {
    const tbl = (cfg.lighting === '国产' || cfg.lighting === '进口')
      ? (cfg.lighting === '国产' ? LED_TABLE['中国品牌'] : LED_TABLE['海外品牌'])
      : null;
    if (tbl) {
      const noLight = (lightType === '无' || isG);
      pushHw(tbl[0].name, noLight ? 0 : 2.2, tbl[0].unit);
      pushHw(tbl[1].name, noLight ? 0 : 2.2, tbl[1].unit);
      pushHw(tbl[2].name, noLight ? 0 : 1, tbl[2].unit);
      pushHw(tbl[3].name, noLight ? 0 : 1, tbl[3].unit);
    }
  }
  // R40 12mm×7mm 数据线槽：(light='无' || type='g') ? 0 : (W<=60 ? 1.1 : 1.65), unit=14/5
  // R41 9mm 散热双面胶：qty 同 R40，unit=7.92/10
  {
    const noLight = (lightType === '无' || isG);
    const dataQty = noLight ? 0 : (W <= 60 ? 1.1 : 1.65);
    pushHw('12mm×7mm 数据线/光纤PVC方形线槽', dataQty, 14 / 5);
    pushHw('9mm宽×0.3mm厚 导热散热双面胶', dataQty, 7.92 / 10);
  }
  // R42 6mm 折叠拉手：(type='g' || light='无') ? 0 : 1
  {
    const noLight = (lightType === '无' || isG);
    pushHw('6mm穿透折叠拉手（检修口用）', noLight ? 0 : 1, 7.67);
  }
  // R43..R46 挂衣杆组（4 行）
  // R43 数量 = type='a' ? (W-4.9)*2 : type∈{b,c,d} ? W-4.9 : 0 (g=0)
  // R44 数量 = type='a' ? 2 : type∈{b,c,d} ? 1 : 0
  // R45 数量 = R44 * 4
  // R46 数量 = R45
  {
    const tbl = ROD_TABLE[cfg.hardware] || ROD_TABLE['中国品牌'];
    let rod1 = 0, rod2 = 0;
    if (TYPE === 'a') { rod1 = (W - 4.9) * 2; rod2 = 2; }
    else if (TYPE === 'b' || TYPE === 'c' || TYPE === 'd') { rod1 = W - 4.9; rod2 = 1; }
    pushHw(tbl[0].name, rod1, tbl[0].unit);
    pushHw(tbl[1].name, rod2, tbl[1].unit);
    pushHw('Ø5mm×12mm 尼龙螺丝预埋颗粒(挂衣杆)', rod2 * 4, tbl[2].unit);
    pushHw('M4×16 深螺纹镀镍螺丝(挂衣杆)', rod2 * 4, tbl[3].unit);
  }
  // R47 海蒂诗 抽屉滑轨：数量 = type='c' ? 2 : type='d' ? 3 : 0
  const slideQty = TYPE === 'c' ? 2 : TYPE === 'd' ? 3 : 0;
  pushHw('海蒂诗 Quadro S 全拉出阻尼滑轨 30KG 500mm /对', slideQty, 60);
  // R48 数量 = R47 * 8 (尼龙螺丝)
  pushHw('Ø5mm×12mm 尼龙螺丝预埋颗粒(滑轨)', slideQty * 8, 0.141);
  // R49 数量 = R48
  pushHw('M4×16 深螺纹镀镍螺丝(滑轨)', slideQty * 8, 9.6 / 300);
  // R50 三合一连接件：数量 = R47 * 15
  {
    const trio = TRIO[cfg.hardware] || TRIO['中国品牌'];
    pushHw(trio.name, slideQty * 15, trio.unit);
  }
  // R51 按 xlsx 字面：name/unit 取 FLAP_TABLE（上翻门支臂），
  // qty 用反弹器条件（type='g' && H<=50 时，W<=60 ? 1 : 2 ; 否则 0）
  const r51Qty = (TYPE === 'g' && H <= 50) ? (W <= 60 ? 1 : 2) : 0;
  {
    const tbl = FLAP_TABLE[cfg.hardware] || FLAP_TABLE['中国品牌'];
    pushHw(tbl.name, r51Qty, tbl.unit);
  }
  // R52 按 xlsx 字面：name/unit 取 PUSH_TABLE（反弹器），qty = W<=60 ? 1 : 2（不分类型）
  {
    const tbl = PUSH_TABLE[cfg.hardware] || PUSH_TABLE['中国品牌'];
    const qty = W <= 60 ? 1 : 2;
    pushHw(tbl.name, qty, tbl.unit);
  }
  // R53/R54 螺丝（上翻）：xlsx 用 G51*4（即 R51 qty * 4，对非 g 型为 0）
  pushHw('Ø5mm×12mm 尼龙螺丝预埋颗粒(上翻)', r51Qty * 4, 0.141);
  pushHw('M4×16 深螺纹镀镍螺丝(上翻)', r51Qty * 4, 9.6 / 300);
  // R55 静音胶粒：W<=60 ? 2 : 4
  pushHw('Ø5mm×6mm深 静音胶粒', W <= 60 ? 2 : 4, 5.5 / 100);
  // R56 立邦MS免钉胶 50g：数量 = R55 * 0.05
  pushHw('立邦MS免钉胶 50g', (W <= 60 ? 2 : 4) * 0.05, 15.9);
  // R57 隐形二合一：type='g' ? 0 : 2
  pushHw('隐形二合一连接件（34mm自攻款）', isG ? 0 : 2, 8.8 / 50);
  // R58 T型地面防尘胶条：type='g' ? 0 : W/100
  pushHw('T型-151 地面防尘胶条', isG ? 0 : W / 100, 2);

  // ---- 汇总 ----
  const totalArea = panels.reduce((s, p) => s + p.qty * p.area, 0);
  const panelCost = panels.reduce((s, p) => s + p.total, 0);
  const hardwareCost = hardware.reduce((s, h) => s + h.total, 0);

  return {
    label: c.label,
    code: c.code,
    w: W,
    h: H,
    totalArea: round4(totalArea),
    panelCost: round2(panelCost),
    hardwareCost: round2(hardwareCost),
    detail: { panels, hardware },
  };
}

function num(n) { return Math.round(n * 100) / 100; }
function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

module.exports = {
  PANEL_PRICE,
  DOOR_PANEL_DELTA,
  DOOR_CRAFT_DELTA,
  calc,
};
