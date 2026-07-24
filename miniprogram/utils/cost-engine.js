// 成本引擎 v2 — 完全数据驱动。
// 依赖:
//   utils/price-dict.js         价格 code → {price, name, unit, brand_type, category}
//   utils/panel-dict.js         panel_code → {display_name, category}
//   utils/model-meta-cache.js   glb_file_name → 元数据文档 (peekMeta 同步读)
//   utils/panel-formulas.js     非标/加高的严格板件公式
//
// 前置: 调用前需保证 bootstrap.ensureCostDataReady 至少跑过一次 (app.onLaunch 里编排)。
// 字典 miss 只影响相关明细项;单价 miss → 该项按 0 + warn。
//
// 与旧版差异:
//   - 移除所有硬编码 PANEL_PRICE / DOOR_PANEL_DELTA / HINGE_TABLE / … 常量
//   - 标柜/转角直接读 glb 元数据的 board_list + hardware_list
//   - 非标(e1/e2)/加高(g/yg/zg) 用基础柜的 board_list 结构 + panel-formulas 重算尺寸
//   - 五金 code = `${key}_${brand_type}`; lighting=none 时 LED 三项 qty=0

const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMeta = require('./model-meta-cache.js');
const { PANEL_FORMULAS } = require('./panel-formulas.js');

const LED_KEYS = ['led_light_strip', 'led_light_power', 'led_light_switch'];

// 台面 code 前缀 (150A/D 的 countertop, 150B/C 的 countertop_L). 走独立计价路径:
// entry.length (cm) → 米 × countertop_marble_50mm 单价 (元/米), 不进 body/door_area.
const COUNTERTOP_PRICE_CODE = 'countertop_marble_50';
function _isCountertop(code) {
  return typeof code === 'string' && code.indexOf('countertop') === 0;
}

// 书柜中段玻璃门: entry.material === 'glass'. 走 glass_door 单价 (元/㎡),
// 不叠加 panel/doorMat/doorCraft; 从 door_area 里扣除避免重复计费.
const GLASS_DOOR_PRICE_CODE = 'glass_door';
function _isGlassDoor(entry) {
  return !!(entry && entry.material === 'glass');
}

// —— 单柜 → glb_file_name 分派 —— //
function resolveGlbFile(cabinet) {
  if (!cabinet) return null;
  switch (cabinet.kind) {
    case 'standard':
      return `${cabinet.w}${(cabinet.code || '').toUpperCase()}.glb`;
    case 'corner':
      return `${(cabinet.code || '').toUpperCase()}-110-230.glb`;
    case 'nonstandard':
      return cabinet.w <= 60 ? '50A.glb' : '100A.glb';
    case 'raise':
      if (cabinet.code === 'yg') return 'YG-110-230G1.glb';
      if (cabinet.code === 'zg') return 'ZG-110-230G1.glb';
      return '100G1.glb';
    case 'shoe':
      return `150${(cabinet.code || 'A').toUpperCase()}.glb`;
    case 'bookshelf':
      return `120${(cabinet.code || 'A').toUpperCase()}.glb`;
    case 'sk':
    case 'spacer':
    default:
      return null;
  }
}

// 合并运行时提取的动态板件与五金到 meta:
//   静态 (meta.board_list / door_list / hardware_list): shell 板件 + shell 五金
//   动态 (cabinet.dynamicBoardList / dynamicDoorList / dynamicHardware): 门/层/隔/抽 + 铰链/托底轨
// 合并策略:
//   板件/门板: 同 node_name 时优先动态 (真实运行时尺寸)
//   五金: 累加 (静态 shell 五金 + 动态门铰 / 抽屉滑轨)
function mergeDynamicIntoMeta(meta, cabinet) {
  const dynBoards = cabinet.dynamicBoardList || [];
  const dynDoors = cabinet.dynamicDoorList || [];
  const dynHardware = cabinet.dynamicHardware || {};
  const hasDyn = dynBoards.length || dynDoors.length || Object.keys(dynHardware).length;
  if (!hasDyn) return meta;

  const staticBoards = (meta && meta.board_list) || [];
  const staticDoors = (meta && meta.door_list) || [];
  const dynBoardCodes = new Set(dynBoards.map((b) => b.node_name));
  const dynDoorCodes = new Set(dynDoors.map((b) => b.node_name));
  const filteredStaticBoards = staticBoards.filter((b) => !dynBoardCodes.has(b.node_name));
  const filteredStaticDoors = staticDoors.filter((b) => !dynDoorCodes.has(b.node_name));
  const mergedBoards = filteredStaticBoards.concat(dynBoards);
  const mergedDoors = filteredStaticDoors.concat(dynDoors);

  // 五金: 累加 (dyn 覆盖不合适, 因为静态 shell 五金 与 dyn 门铰/滑轨 属于不同物理位置)
  const mergedHardware = { ...((meta && meta.hardware_list) || {}) };
  Object.entries(dynHardware).forEach(([k, v]) => {
    if (typeof v !== 'number' || !v) return;
    mergedHardware[k] = (mergedHardware[k] || 0) + v;
  });

  const bodyArea = round4(mergedBoards.reduce((s, b) => s + (b.area || 0), 0));
  const doorArea = round4(mergedDoors.reduce((s, b) => s + (b.area || 0), 0));

  return {
    ...(meta || {}),
    board_list: mergedBoards,
    door_list: mergedDoors,
    hardware_list: mergedHardware,
    total_body_area: bodyArea,
    total_door_area: doorArea,
    total_raw_board_area: round4(bodyArea + doorArea),
    overall_size: (meta && meta.overall_size) || {
      total_width: cabinet.w,
      total_height: cabinet.h,
      total_depth: 42,
    },
  };
}

// —— 非标/加高: 按公式重算 board_list & door_list 尺寸, 五金 hardware_list 保留 —— //
function rescaleMetadata(baseMeta, W, H) {
  const rescaleList = (list) => (list || []).map((b) => {
    const f = PANEL_FORMULAS[b.node_name];
    if (!f) {
      console.warn('[cost-engine] panel-formula miss', b.node_name);
      return b;
    }
    const dims = f(W, H);
    return {
      node_name: b.node_name,
      length: dims.length,
      width: dims.width,
      thickness: dims.thickness,
      area: round4(dims.length * dims.width / 10000),
    };
  });
  const rescaledBoards = rescaleList(baseMeta.board_list);
  const rescaledDoors = rescaleList(baseMeta.door_list);

  // 迁移期兼容: 旧云数据 board_list 里可能混入 door_panel 分类的老门板行,
  // 分拣出去合并进 door_list, 保证只走一条门板路径。
  const newBoards = [];
  const strayDoors = [];
  rescaledBoards.forEach((b) => {
    const dictEntry = panelDict.get(b.node_name);
    const cat = dictEntry ? dictEntry.category : 'cabinet_frame';
    if (cat === 'hanging_component') return;
    if (cat === 'door_panel') { strayDoors.push(b); return; }
    newBoards.push(b);
  });
  const newDoors = rescaledDoors.concat(strayDoors);
  const bodyArea = round4(newBoards.reduce((s, b) => s + b.area, 0));
  const doorArea = round4(newDoors.reduce((s, d) => s + d.area, 0));
  return {
    ...baseMeta,
    overall_size: {
      total_width: W,
      total_height: H,
      total_depth: (baseMeta.overall_size && baseMeta.overall_size.total_depth) || 60,
    },
    board_list: newBoards,
    door_list: newDoors,
    total_body_area: bodyArea,
    total_door_area: doorArea,
    total_raw_board_area: round4(bodyArea + doorArea),
  };
}

// —— 板材明细: 每块板一条 (只取柜身板, 门板由 buildDoorDetail 负责, 台面由 buildCounterDetail 负责) —— //
function buildPanelDetail(boardList, panelUnit) {
  const out = [];
  (boardList || []).forEach((b) => {
    if (_isCountertop(b.node_name)) return;
    const dictEntry = panelDict.get(b.node_name);
    const cat = dictEntry ? dictEntry.category : 'cabinet_frame';
    if (cat === 'hanging_component') return;
    if (cat === 'door_panel') return;
    const name = dictEntry ? dictEntry.display_name : b.node_name;
    out.push({
      name,
      code: b.node_name,
      size: `${b.length}×${b.width}×${b.thickness}`,
      qty: 1,
      area: round4(b.area),
      unit: panelUnit,
      total: round2(b.area * panelUnit),
    });
  });
  return out;
}

// —— 台面明细: 每块台面一条, 单价按 countertop_marble_50mm (元/米), 长度取长边 —— //
function buildCounterDetail(boardList, counterUnit) {
  const out = [];
  (boardList || []).forEach((b) => {
    if (!_isCountertop(b.node_name)) return;
    const dictEntry = panelDict.get(b.node_name);
    const name = dictEntry ? dictEntry.display_name : b.node_name;
    const lengthCm = Math.max(b.length || 0, b.width || 0);
    const lengthM = lengthCm / 100;
    out.push({
      name,
      code: b.node_name,
      size: `${b.length}×${b.width}×${b.thickness}`,
      qty: 1,
      length: round4(lengthM),
      unit: counterUnit,
      total: round2(lengthM * counterUnit),
    });
  });
  return out;
}

// —— 门板明细: 每块门板一条, 单价 = 基材 + 门材 + 门艺; 玻璃门单独出行走 glass_door —— //
function buildDoorDetail(doorList, panelUnit, doorMatUnit, doorCraftUnit) {
  const doorUnit = panelUnit + doorMatUnit + doorCraftUnit;
  const out = [];
  (doorList || []).forEach((d) => {
    if (_isGlassDoor(d)) return;
    const dictEntry = panelDict.get(d.node_name);
    const name = dictEntry ? dictEntry.display_name : d.node_name;
    out.push({
      name,
      code: d.node_name,
      size: `${d.length}×${d.width}×${d.thickness}`,
      qty: 1,
      area: round4(d.area),
      unit: doorUnit,
      total: round2(d.area * doorUnit),
    });
  });
  return out;
}

// —— 玻璃门明细: 单价 = glass_door 一项, 不叠加 panel/doorMat/doorCraft —— //
function buildGlassDoorDetail(doorList, glassUnit) {
  const out = [];
  (doorList || []).forEach((d) => {
    if (!_isGlassDoor(d)) return;
    const dictEntry = panelDict.get(d.node_name);
    const name = dictEntry ? dictEntry.display_name : d.node_name;
    out.push({
      name,
      code: d.node_name,
      size: `${d.length}×${d.width}×${d.thickness}`,
      qty: 1,
      area: round4(d.area),
      unit: glassUnit,
      total: round2(d.area * glassUnit),
    });
  });
  return out;
}

// —— 单柜成本 —— //
function calcModule(cabinet, cfg) {
  const glbFile = resolveGlbFile(cabinet);
  if (!glbFile) return null;

  const baseMeta = modelMeta.peekMeta(glbFile);
  const hasDynamic = !!(
    (cabinet.dynamicBoardList && cabinet.dynamicBoardList.length) ||
    (cabinet.dynamicDoorList && cabinet.dynamicDoorList.length) ||
    (cabinet.dynamicHardware && Object.keys(cabinet.dynamicHardware).length)
  );
  // 无 baseMeta 且无 dynamic → missing meta; 有 dynamic 时即使 meta 缺失也能算成本 (shoe/bookshelf 常态)
  if (!baseMeta && !hasDynamic) {
    return {
      missing: 'meta',
      label: cabinet.label || '',
      code: cabinet.code, w: cabinet.w, h: cabinet.h, glbFile,
      panelCost: 0, hardwareCost: 0,
      transport: 0, install: 0, total: 0,
      totalBodyArea: 0, totalDoorArea: 0, totalRawBoardArea: 0,
      detail: { panels: [], hardware: [] },
    };
  }

  const isFormulaPath = cabinet.kind === 'nonstandard' || cabinet.kind === 'raise';
  let meta = baseMeta ? (isFormulaPath ? rescaleMetadata(baseMeta, cabinet.w, cabinet.h) : baseMeta) : null;
  // 合并运行时动态板件 (shoe/bookshelf 主要靠这条路径)
  if (hasDynamic) meta = mergeDynamicIntoMeta(meta, cabinet);

  const panelPriceEntry = priceDict.get(cfg.panel);
  const doorMatEntry = priceDict.get(cfg.doorPanel);
  const doorCraftEntry = priceDict.get(cfg.doorCraft);
  const counterEntry = priceDict.get(COUNTERTOP_PRICE_CODE);
  const glassDoorEntry = priceDict.get(GLASS_DOOR_PRICE_CODE);
  const panelUnit = panelPriceEntry ? panelPriceEntry.price : 0;
  const doorMatUnit = doorMatEntry ? doorMatEntry.price : 0;
  const doorCraftUnit = doorCraftEntry ? doorCraftEntry.price : 0;
  const counterUnit = counterEntry ? counterEntry.price : 0;
  const glassDoorUnit = glassDoorEntry ? glassDoorEntry.price : 0;
  if (!panelPriceEntry) console.warn('[cost-engine] price miss', cfg.panel);
  if (!doorMatEntry) console.warn('[cost-engine] price miss', cfg.doorPanel);
  if (!doorCraftEntry) console.warn('[cost-engine] price miss', cfg.doorCraft);

  // 台面从 body 面积里拆出去 (不能既按 m² 又按米算): body 面积用不含台面的板件面积重算
  const boardListNoCounter = (meta.board_list || []).filter((b) => !_isCountertop(b.node_name));
  const bodyAreaNoCounter = boardListNoCounter.reduce((s, b) => s + (b.area || 0), 0);
  const bodyCost = bodyAreaNoCounter * panelUnit;

  // 玻璃门从 door 面积里拆出去: 常规门按 panel+doorMat+doorCraft, 玻璃门按 glass_door
  const glassDoorArea = (meta.door_list || [])
    .filter(_isGlassDoor)
    .reduce((s, d) => s + (d.area || 0), 0);
  const normalDoorArea = meta.total_door_area - glassDoorArea;
  const doorCost = normalDoorArea * (panelUnit + doorMatUnit + doorCraftUnit);
  const glassDoorCost = glassDoorArea * glassDoorUnit;
  if (glassDoorArea > 0 && !glassDoorEntry) console.warn('[cost-engine] price miss', GLASS_DOOR_PRICE_CODE);

  // 台面成本: Σ length(米) × counterUnit
  const counterDetail = buildCounterDetail(meta.board_list, counterUnit);
  const counterCost = counterDetail.reduce((s, r) => s + (r.total || 0), 0);
  if (counterDetail.length && !counterEntry) console.warn('[cost-engine] price miss', COUNTERTOP_PRICE_CODE);

  const brand = cfg.hardware;
  const lighting = cfg.lighting;
  const ledBrand = lighting === 'led_import' ? 'import' : 'domestic';
  const isRaise = cabinet.kind === 'raise';

  let hardwareCost = 0;
  const hardwareDetail = [];
  // v1 曾根据 lighting='无' 强制清零 access_panel_handle 与 cable_channel 数量;
  // v2 以 glb 元数据的数量为准 — 有无灯槽应在建模时决定, 通过 model_panel_hardware.hardware_list 表达。
  // 例外: 加高柜不落地, 不算调整脚(plinth); 与 LED 三项一样, 由业务规则强制清零, 不依赖每份 glb 元数据手工填 0。
  Object.entries(meta.hardware_list || {}).forEach(([key, qty]) => {
    let priceCode;
    let effectiveQty = qty;
    if (LED_KEYS.indexOf(key) >= 0) {
      if (lighting === 'none') effectiveQty = 0;
      priceCode = `${key}_${ledBrand}`;
    } else {
      if (key === 'plinth' && isRaise) effectiveQty = 0;
      priceCode = `${key}_${brand}`;
    }
    if (!effectiveQty) return; // 过滤 qty=0 行 (与旧版 pushHw 行为一致)
    const p = priceDict.get(priceCode);
    if (!p) {
      console.warn('[cost-engine] price miss', priceCode);
      return;
    }
    const total = effectiveQty * p.price;
    hardwareCost += total;
    hardwareDetail.push({
      code: priceCode, name: p.name || key, spec: p.unit || '',
      qty: effectiveQty, unit: p.price, total: round2(total),
    });
  });

  return {
    label: cabinet.label || '',
    code: cabinet.code, w: cabinet.w, h: cabinet.h, glbFile,
    // totalBodyArea 不含台面 (台面按米计价, 不能进按 m² 算的 panel 类目)
    totalBodyArea: round4(bodyAreaNoCounter),
    // totalDoorArea 不含玻璃门 (玻璃门走 glass_door 独立单价, 不参与 panel/doorMat/doorCraft 类目)
    totalDoorArea: round4(normalDoorArea),
    totalRawBoardArea: round4(meta.total_raw_board_area),
    // 命名兼容旧 UI: '板材合计' 含门板 + 玻璃门 + 台面 (三者各出独立明细行但汇总进 panelCost)
    panelCost: round2(bodyCost + doorCost + glassDoorCost + counterCost),
    counterCost: round2(counterCost),
    glassDoorCost: round2(glassDoorCost),
    hardwareCost: round2(hardwareCost),
    detail: {
      panels: buildPanelDetail(meta.board_list, panelUnit)
        .concat(buildDoorDetail(meta.door_list, panelUnit, doorMatUnit, doorCraftUnit))
        .concat(buildGlassDoorDetail(meta.door_list, glassDoorUnit))
        .concat(counterDetail),
      hardware: hardwareDetail,
    },
  };
}

// —— 方案汇总 —— //
function calc({ cabinets, materials, wall }) {
  const cfg = {
    panel: (materials && materials.panel) || 'panel_e2_domestic',
    doorPanel: (materials && materials.doorPanel) || 'door_material_same_as_cabinet',
    doorCraft: (materials && materials.doorCraft) || 'door_craft_none',
    hardware: (materials && materials.hardware) || 'domestic',
    lighting: (materials && materials.lighting) || 'none',
  };

  const modules = (cabinets || []).map((c) => calcModule(c, cfg)).filter(Boolean);

  const transportEntry = priceDict.get('transport_fee');
  const installEntry = priceDict.get('install_fee');
  const transportUnit = transportEntry ? transportEntry.price : 0;
  const installUnit = installEntry ? installEntry.price : 0;

  const sumPanel = modules.reduce((s, m) => s + (m.panelCost || 0), 0);
  const sumHw = modules.reduce((s, m) => s + (m.hardwareCost || 0), 0);
  const sumArea = modules.reduce((s, m) => s + (m.totalRawBoardArea || 0), 0);
  const transport = round2(sumArea * transportUnit);
  const install = round2(sumArea * installUnit);

  modules.forEach((m) => {
    if (m.missing) { m.transport = 0; m.install = 0; m.total = 0; return; }
    m.transport = round2(m.totalRawBoardArea * transportUnit);
    m.install = round2(m.totalRawBoardArea * installUnit);
    m.total = round2(m.panelCost + m.hardwareCost + m.transport + m.install);
  });

  let sk = null;
  if (wall && wall.w && wall.h) {
    const p = priceDict.get(cfg.panel);
    const dm = priceDict.get(cfg.doorPanel);
    const dc = priceDict.get(cfg.doorCraft);
    const skUnit = (p ? p.price : 0) + (dm ? dm.price : 0) + (dc ? dc.price : 0);
    const skArea = round4((2 * wall.h + 2 * wall.h + (wall.w - 4) * 2) / 10000);
    sk = { label: '收口条', area: skArea, unit: skUnit, total: round2(skUnit * skArea) };
  }

  const grandTotal = round2(sumPanel + sumHw + transport + install + (sk ? sk.total : 0));

  // —— categoryCost: 按 5 组材料选项归属 —— //
  // 定义见 docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §3.1
  //  panel     = Σ (bodyArea + doorArea) × panelUnit           (含柜身板 + 门板基材)
  //  doorPanel = Σ doorArea × doorMatUnit                      (门板材质加价)
  //  doorCraft = Σ doorArea × doorCraftUnit                    (门板工艺加价)
  //  hardware  = Σ 非 LED 五金 total                            (直接从 detail 求和)
  //  lighting  = Σ LED 三项 total                               (lighting=none → 0)
  // sk 不计入任一 category (口径见 spec §3.1)。
  const panelEntry = priceDict.get(cfg.panel);
  const doorMatEntry = priceDict.get(cfg.doorPanel);
  const doorCraftEntry = priceDict.get(cfg.doorCraft);
  const panelUnit = panelEntry ? panelEntry.price : 0;
  const doorMatUnit = doorMatEntry ? doorMatEntry.price : 0;
  const doorCraftUnit = doorCraftEntry ? doorCraftEntry.price : 0;

  const sumBodyArea = modules.reduce((s, m) => s + (m.totalBodyArea || 0), 0);
  const sumDoorArea = modules.reduce((s, m) => s + (m.totalDoorArea || 0), 0);
  let hwCatSum = 0;
  let ledCatSum = 0;
  modules.forEach((m) => {
    const hw = (m.detail && m.detail.hardware) || [];
    hw.forEach((row) => {
      // row.code 形如 `${key}_${brand_type}`; 取前缀判断是否 LED 三项
      const isLed = LED_KEYS.some((k) => row.code === `${k}_domestic` || row.code === `${k}_import`);
      if (isLed) ledCatSum += row.total || 0;
      else hwCatSum += row.total || 0;
    });
  });

  const categoryCost = {
    panel: round2((sumBodyArea + sumDoorArea) * panelUnit),
    doorPanel: round2(sumDoorArea * doorMatUnit),
    doorCraft: round2(sumDoorArea * doorCraftUnit),
    hardware: round2(hwCatSum),
    lighting: round2(ledCatSum),
  };

  return {
    modules,
    sk,
    transport, install,
    panelTotal: round2(sumPanel),
    hardwareTotal: round2(sumHw),
    grandTotal,
    categoryCost,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

module.exports = { calc, calcModule, resolveGlbFile, rescaleMetadata, mergeDynamicIntoMeta };
