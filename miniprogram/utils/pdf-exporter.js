// PDF 导出（canvas 渲染版）：用 2d canvas 把每一页画成 JPEG，再用 jsPDF.addImage 拼成 PDF。
// 这样中文走系统字体，不用打包字体文件，主包体积不爆。
const jspdfModule = require('../vendor/jspdf.min.js');
const costEngine = require('./cost-engine.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const SCALE = 2;                                  // canvas 像素 / pt，画清楚一点
const CANVAS_W = Math.round(A4_W_PT * SCALE);     // 1191
const CANVAS_H = Math.round(A4_H_PT * SCALE);     // 1684
const MARGIN = 40 * SCALE;

function _resetCanvas(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}

function _drawPlaceholder(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 自动换行：按字符宽度切片，留 40pt × SCALE 左右内边距
  const maxW = w - 40 * SCALE;
  const lines = _wrapText(ctx, text, maxW);
  const lineH = 22 * SCALE;
  const totalH = lines.length * lineH;
  const startY = y + h / 2 - totalH / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x + w / 2, startY + i * lineH);
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}

function _wrapText(ctx, text, maxWidth) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function _formatCurrency(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '¥' + parts.join('.');
}

function _computeCostFor(plan) {
  if (!plan || !plan.materials) return null;
  try {
    return costEngine.calc({
      cabinets: plan.cabinets || [],
      materials: plan.materials,
      wall: plan.wall,
    });
  } catch (e) {
    return null;
  }
}

function _drawImageContain(canvas, ctx, src, dx, dy, dw, dh, fallback) {
  return new Promise((resolve) => {
    if (!src) { _drawPlaceholder(ctx, dx, dy, dw, dh, fallback); resolve(); return; }
    const img = canvas.createImage();
    img.onload = () => {
      const ratio = Math.min(dw / img.width, dh / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      try {
        ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
      } catch (e) {
        _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
      }
      resolve();
    };
    img.onerror = () => { _drawPlaceholder(ctx, dx, dy, dw, dh, fallback); resolve(); };
    img.src = src;
  });
}

async function _renderOverview(canvas, ctx, plan) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
  ctx.fillText(plan.name || '', MARGIN, MARGIN);

  ctx.fillStyle = '#6b7280';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  const wall = plan.wall || {};
  const cornerLabel = plan.cornerLabel || '';
  const sub = `${wall.w || '?'} × ${wall.h || '?'} cm · ${cornerLabel}` + (plan.hasRaise ? ' · 加高' : '');
  ctx.fillText(sub, MARGIN, MARGIN + 46 * SCALE);

  const photoY = MARGIN + 100 * SCALE;
  const photoW = (CANVAS_W - MARGIN * 2) * 0.45;
  const photoH = 240 * SCALE;
  await _drawImageContain(canvas, ctx, plan.photoPath, MARGIN, photoY, photoW, photoH, '无照片');

  ctx.fillStyle = '#1f2937';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  const infoX = MARGIN + photoW + 20 * SCALE;
  let infoY = photoY + 10 * SCALE;
  ctx.fillText(`墙体尺寸: 宽度${wall.w || '?'}x高度${wall.h || '?'}cm`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`转角类型: ${cornerLabel || '无转角'}`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`是否加高: ${plan.hasRaise ? '加高' : '无'}`, infoX, infoY); infoY += 30 * SCALE;

  // 板材五金（与上方空间信息文字续列对齐）
  infoY += 16 * SCALE; // 段间间距
  const m = plan.materials || {};
  const matRows = [
    ['板材', m.panel],
    ['柜门面板', m.doorPanel],
    ['柜门工艺', m.doorCraft],
    ['五金', m.hardware],
    ['灯带', m.lighting],
  ];
  matRows.forEach(([k, v]) => {
    ctx.fillText(`${k}: ${v || ''}`, infoX, infoY);
    infoY += 30 * SCALE;
  });

  const previewY = photoY + photoH + 40 * SCALE;
  const previewW = CANVAS_W - MARGIN * 2;
  const previewH = CANVAS_H - previewY - MARGIN;
  await _drawImageContain(canvas, ctx, plan.previewImage, MARGIN, previewY, previewW, previewH, '无预览');
}

async function _renderLayout(canvas, ctx, plan, options) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  ctx.fillText('布局线框图', MARGIN, MARGIN);

  const cost = options && options.cost;
  const cabinets = Array.isArray(plan.cabinets) ? plan.cabinets : [];
  const rows = _buildCabinetRows(plan, cabinets, cost);
  const wfY = MARGIN + 50 * SCALE;
  const wfW = CANVAS_W - MARGIN * 2;
  const totalContentH = CANVAS_H - wfY - MARGIN;

  const hint = '未计算成本，无线框图。请到"我的方案"选择该方案，选板材五金后点"计算成本"，在成本透视页即可看到线框图。';
  const src = (plan.wireframeImage && plan.wireframeHasLabels) ? plan.wireframeImage : null;

  if (!rows.length) {
    await _drawImageContain(canvas, ctx, src, MARGIN, wfY, wfW, totalContentH, hint);
    return;
  }

  // 让表格优先塞下所有柜子；行高在 14~28 之间动态收缩，线框图占用剩余空间，最少保留 30%
  // 有成本列时末尾多一行"总计"
  const gap = 30 * SCALE;
  const headerH = 30 * SCALE;
  const idealRowH = 28 * SCALE;
  const minRowH = 14 * SCALE;
  const wfFloor = Math.floor(totalContentH * 0.30);
  const tableMaxH = totalContentH - gap - wfFloor;
  const showCost = !!cost;
  const totalRowsForLayout = rows.length + (showCost ? 1 : 0);
  let rowH = Math.floor((tableMaxH - headerH) / totalRowsForLayout);
  if (rowH > idealRowH) rowH = idealRowH;
  if (rowH < minRowH) rowH = minRowH;
  const tableH = headerH + totalRowsForLayout * rowH;
  const wfH = Math.max(wfFloor, totalContentH - gap - tableH);

  await _drawImageContain(canvas, ctx, src, MARGIN, wfY, wfW, wfH, hint);
  _renderCabinetTable(ctx, rows, MARGIN, wfY + wfH + gap, wfW, headerH, rowH, cost);
}

function _buildCabinetRows(plan, cabinets, cost) {
  const modules = (cost && Array.isArray(cost.modules)) ? cost.modules : null;
  const rows = cabinets.map((cab, idx) => {
    const code = (cab.code || '').toLowerCase();
    const isCorner = cab.kind === 'corner' || code === 'y' || code === 'z' || code === 'yg' || code === 'zg';
    const depth = isCorner ? 110 : 60;
    return {
      name: cab.label || '',
      size: `宽${cab.w}cmx高${cab.h}cmx深${depth}cm`,
      cornerText: isCorner ? '是' : '否',
      cost: modules && modules[idx] && typeof modules[idx].total === 'number' ? modules[idx].total : null,
    };
  });
  const wall = plan.wall || {};
  if (wall.w && wall.h) {
    const skDepth = 6;
    // 收口条：整体价 cost.sk.total 记在最后一条（上收口）行；左右收口显示 —
    const skTotal = cost && cost.sk && typeof cost.sk.total === 'number' ? cost.sk.total : null;
    rows.push({ name: '左收口', size: `宽2cmx高${wall.h}cmx深${skDepth}cm`, cornerText: '否', cost: null });
    rows.push({ name: '右收口', size: `宽2cmx高${wall.h}cmx深${skDepth}cm`, cornerText: '否', cost: null });
    rows.push({ name: '上收口', size: `宽${wall.w - 4}cmx高2cmx深${skDepth}cm`, cornerText: '否', cost: skTotal });
  }
  return rows;
}

function _renderCabinetTable(ctx, rows, x, y, w, headerH, rowH, cost) {
  const headerPadX = 12 * SCALE;
  const showCost = !!cost;
  const colRatios = showCost
    ? [0.24, 0.36, 0.16, 0.24]
    : [0.28, 0.46, 0.26];
  const colX = [];
  let cx = x;
  for (let i = 0; i < colRatios.length; i++) {
    colX.push(cx);
    cx += w * colRatios[i];
  }

  // 表头背景
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x, y, w, headerH);

  // 表头文字
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (13 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headerCenterY = y + headerH / 2;
  const headers = showCost
    ? ['名称', '尺寸', '是否是转角柜', '成本']
    : ['名称', '尺寸', '是否是转角柜'];
  headers.forEach((label, i) => {
    ctx.fillText(label, colX[i] + headerPadX, headerCenterY);
  });

  const startY = y + headerH;
  const bodyFontPx = Math.max(10 * SCALE, Math.min(12 * SCALE, rowH - 6 * SCALE));

  rows.forEach((row, i) => {
    const ry = startY + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(x, ry, w, rowH);
    }
    ctx.fillStyle = '#1f2937';
    ctx.font = bodyFontPx + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const cellY = ry + rowH / 2;
    ctx.fillText(row.name, colX[0] + headerPadX, cellY);
    ctx.fillText(row.size, colX[1] + headerPadX, cellY);
    ctx.fillText(row.cornerText, colX[2] + headerPadX, cellY);
    if (showCost) {
      const costText = typeof row.cost === 'number' ? _formatCurrency(row.cost) : '—';
      ctx.fillText(costText, colX[3] + headerPadX, cellY);
    }
  });

  // 总计行（仅 showCost）
  if (showCost) {
    const totalRowY = startY + rows.length * rowH;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x, totalRowY, w, rowH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + bodyFontPx + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const totalCenterY = totalRowY + rowH / 2;
    ctx.fillText('总计', colX[0] + headerPadX, totalCenterY);
    const grandTotal = typeof cost.grandTotal === 'number' ? cost.grandTotal : null;
    const grandText = grandTotal != null ? _formatCurrency(grandTotal) : '—';
    ctx.fillText(grandText, colX[3] + headerPadX, totalCenterY);
  }

  ctx.textBaseline = 'top';
}

const KIND_FILL = {
  standard: '#fef3c7',
  corner: '#fde68a',
  nonstandard: '#fed7aa',
  sk: '#e5e7eb',
  raise: '#dbeafe',
};
const KIND_STROKE = '#475569';

function _countCabinets(plan) {
  if (!plan || !plan.layout) return 0;
  const items = Array.isArray(plan.layout.items) ? plan.layout.items : [];
  const wall = plan.wall || {};
  const wallH = wall.h || 0;
  let bottom = 0;
  items.forEach((it) => {
    if (it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard') {
      bottom += 1;
    }
  });
  const hasRaise = plan.hasRaise && wallH > 250;
  return hasRaise ? bottom * 2 : bottom;
}

function _countCabinetsSplit(plan) {
  if (!plan || !plan.layout) return { regular: 0, raise: 0 };
  const items = Array.isArray(plan.layout.items) ? plan.layout.items : [];
  const wall = plan.wall || {};
  const wallH = wall.h || 0;
  let regular = 0;
  items.forEach((it) => {
    if (it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard') {
      regular += 1;
    }
  });
  const hasRaise = plan.hasRaise && wallH > 250;
  return { regular, raise: hasRaise ? regular : 0 };
}

function _drawWireframeDiagram(ctx, plan, x, y, w, h) {
  const wall = plan.wall || {};
  const layout = plan.layout || {};
  const items = Array.isArray(layout.items) ? layout.items : [];
  const wallW = wall.w || 0;
  const wallH = wall.h || 0;

  if (!items.length || !wallW || !wallH) {
    _drawPlaceholder(ctx, x, y, w, h, '无线框图');
    return;
  }

  const padInside = 20 * SCALE;
  const availW = w - padInside * 2;
  const availH = h - padInside * 2;
  const scaleByW = availW / wallW;
  const scaleByH = availH / wallH;
  const s = Math.min(scaleByW, scaleByH);
  const drawW = wallW * s;
  const drawH = wallH * s;
  const ox = x + (w - drawW) / 2;
  const oy = y + (h - drawH) / 2;

  // 墙体外框
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = Math.max(1, 1 * SCALE);
  ctx.strokeRect(ox, oy, drawW, drawH);

  // 计算每个 item 的横向位置（cm），从左到右累加 w
  const placed = [];
  let cursor = 0;
  items.forEach((it) => {
    placed.push({ it, x: cursor, w: it.w });
    cursor += it.w;
  });

  // 加高排：与底排同顺序，y 高度从 230cm 起
  const hasRaise = plan.hasRaise && wallH > 250;
  const raiseH = hasRaise ? Math.max(0, wallH - 230 - 2) : 0;

  // 底排标准/转角/非标记编号，与 cost-engine modules 索引一致
  let numIdx = 0;
  placed.forEach((p) => {
    const it = p.it;
    const isCabinet = it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard';
    const itemH = isCabinet ? 230 : (it.h || wallH);
    const rx = ox + p.x * s;
    const ry = oy + drawH - itemH * s;
    const rw = p.w * s;
    const rh = itemH * s;
    ctx.fillStyle = KIND_FILL[it.kind] || '#f1f5f9';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = KIND_STROKE;
    ctx.lineWidth = Math.max(1, 1.2 * SCALE);
    ctx.strokeRect(rx, ry, rw, rh);

    if (isCabinet) {
      numIdx += 1;
      _drawBadge(ctx, rx + rw / 2, ry + rh / 2, numIdx);
      // 尺寸标注
      ctx.fillStyle = '#475569';
      ctx.font = (10 * SCALE) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${it.w}×${it.h}`, rx + rw / 2, ry + rh + 4 * SCALE);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  });

  // 加高排（如有）
  if (hasRaise && raiseH > 0) {
    let raiseIdx = numIdx;
    placed.forEach((p) => {
      const it = p.it;
      const isCabinet = it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard';
      if (!isCabinet) return;
      raiseIdx += 1;
      const rx = ox + p.x * s;
      const rh = raiseH * s;
      const rw = p.w * s;
      const ry = oy + drawH - (230 + raiseH) * s;
      ctx.fillStyle = KIND_FILL.raise;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = KIND_STROKE;
      ctx.lineWidth = Math.max(1, 1.2 * SCALE);
      ctx.strokeRect(rx, ry, rw, rh);
      _drawBadge(ctx, rx + rw / 2, ry + rh / 2, raiseIdx);
    });
  }
}

function _drawBadge(ctx, cx, cy, num) {
  const r = 14 * SCALE;
  ctx.beginPath();
  ctx.fillStyle = '#1f2937';
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), cx, cy);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}

function _renderSeparator(ctx, plan, idx, total) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + (48 * SCALE) + 'px sans-serif';
  ctx.fillText(plan.name || '', CANVAS_W / 2, CANVAS_H / 2 - 30 * SCALE);
  ctx.font = (16 * SCALE) + 'px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(`方案 ${idx} / ${total}`, CANVAS_W / 2, CANVAS_H / 2 + 30 * SCALE);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

// 方案总览表格页：4 列表格（方案名称 | 空间尺寸 | 普通衣柜个数 | 加高衣柜个数），
// 整行可点击跳转。返回每行在 PDF 坐标系中的位置（pt），供调用方加内链。
function _renderOverviewTable(ctx, plans, options) {
  const showCost = !!(options && options.showCostColumn);
  const costMap = (options && options.costMap) || new Map();
  _resetCanvas(ctx);

  // 标题
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
  ctx.fillText('方案总览', MARGIN, MARGIN);

  ctx.fillStyle = '#6b7280';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.fillText('点击方案名跳转到对应方案页', MARGIN, MARGIN + 40 * SCALE);

  // 表格区域
  const tableX = MARGIN;
  const tableY = MARGIN + 100 * SCALE;
  const tableW = CANVAS_W - MARGIN * 2;
  const headerH = 30 * SCALE;
  const rowH = 36 * SCALE;

  // 列宽度
  const colRatios = showCost
    ? [0.26, 0.20, 0.18, 0.18, 0.18]
    : [0.32, 0.24, 0.22, 0.22];
  const colX = [];
  let cx = tableX;
  for (let i = 0; i < colRatios.length; i++) {
    colX.push(cx);
    cx += tableW * colRatios[i];
  }

  // 表头背景
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(tableX, tableY, tableW, headerH);

  // 表头文字
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headerCenterY = tableY + headerH / 2;
  const headerPadX = 12 * SCALE;
  const headers = showCost
    ? ['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数', '方案成本']
    : ['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数'];
  headers.forEach((label, i) => {
    ctx.fillText(label, colX[i] + headerPadX, headerCenterY);
  });

  // 数据行
  const startY = tableY + headerH;
  const reservedRows = showCost ? 1 : 0; // 为总计行预留 1 行
  const maxRows = Math.floor((CANVAS_H - startY - MARGIN) / rowH) - reservedRows;
  const visible = plans.slice(0, Math.max(0, maxRows));
  const entries = [];

  visible.forEach((plan, i) => {
    const ry = startY + i * rowH;
    // zebra
    if (i % 2 === 1) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(tableX, ry, tableW, rowH);
    }

    const cellCenterY = ry + rowH / 2;
    ctx.textBaseline = 'middle';
    ctx.font = (14 * SCALE) + 'px sans-serif';

    // 列 1：方案名（蓝色 + 下划线）
    const name = plan.name || '(未命名)';
    ctx.fillStyle = '#2563eb';
    const nameX = colX[0] + headerPadX;
    ctx.fillText(name, nameX, cellCenterY);
    const nameWidth = ctx.measureText(name).width;
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = Math.max(1, 1 * SCALE);
    ctx.beginPath();
    ctx.moveTo(nameX, cellCenterY + 10 * SCALE);
    ctx.lineTo(nameX + nameWidth, cellCenterY + 10 * SCALE);
    ctx.stroke();

    // 列 2：空间尺寸
    const wall = plan.wall || {};
    const sizeText = `${wall.w || '?'}×${wall.h || '?'}cm`;
    ctx.fillStyle = '#1f2937';
    ctx.fillText(sizeText, colX[1] + headerPadX, cellCenterY);

    // 列 3 / 4：普通衣柜个数 / 加高衣柜个数
    const counts = _countCabinetsSplit(plan);
    ctx.fillText(String(counts.regular), colX[2] + headerPadX, cellCenterY);
    ctx.fillText(String(counts.raise), colX[3] + headerPadX, cellCenterY);

    if (showCost) {
      const cost = costMap.get(plan.id);
      if (cost && typeof cost.grandTotal === 'number') {
        ctx.fillStyle = '#1f2937';
        ctx.fillText(_formatCurrency(cost.grandTotal), colX[4] + headerPadX, cellCenterY);
      } else {
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('未算成本', colX[4] + headerPadX, cellCenterY);
      }
    }

    // 内链 hit-box（整行）—— 转 PDF 坐标 (pt) = canvas 坐标 / SCALE
    // pageNumber 由调用方在真正渲染每个方案时填入（避免预估页数错位）。
    entries.push({
      planId: plan.id,
      pageNumber: 0,
      x: tableX / SCALE,
      y: ry / SCALE,
      w: tableW / SCALE,
      h: rowH / SCALE,
    });
  });

  // 还原 baseline
  ctx.textBaseline = 'top';

  if (showCost) {
    const totalRowY = startY + visible.length * rowH;
    // 总计行深底 + 白字
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(tableX, totalRowY, tableW, rowH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const totalCenterY = totalRowY + rowH / 2;
    const totalLabel = `总计（共 ${visible.length} 个方案）`;
    ctx.fillText(totalLabel, colX[0] + headerPadX, totalCenterY);

    let sum = 0;
    let counted = 0;
    let missing = 0;
    visible.forEach((p) => {
      const c = costMap.get(p.id);
      if (c && typeof c.grandTotal === 'number') {
        sum += c.grandTotal;
        counted += 1;
      } else {
        missing += 1;
      }
    });
    let totalCellText;
    if (counted === 0) {
      totalCellText = '—';
    } else if (missing > 0) {
      totalCellText = _formatCurrency(sum) + ' (不含未算 ' + missing + ' 个)';
    } else {
      totalCellText = _formatCurrency(sum);
    }
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.fillText(totalCellText, colX[4] + headerPadX, totalCenterY);
    ctx.fillStyle = '#1f2937';
  }

  // 截断提示
  if (plans.length > visible.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = (12 * SCALE) + 'px sans-serif';
    const noticeBaseRows = visible.length + (showCost ? 1 : 0);
    ctx.fillText(
      `… 还有 ${plans.length - visible.length} 个方案未在表格中列出`,
      MARGIN,
      startY + noticeBaseRows * rowH + 10 * SCALE
    );
  }

  return entries;
}

// 渲染方案的"成本透视"部分：
// - 未算成本：1 页占位提示
// - 已算成本：从上向下堆叠卡片，页满则新开一页
// 返回渲染的 canvas 数组（每张对应 PDF 里的一页 JPEG）。
// 调用方负责用 _addCanvasPage 把每张塞进 doc。
async function _renderCostBreakdown(canvas, ctx, plan, cost) {
  const pages = []; // 每项：一个已在 canvas 上画完的快照，用于随后 _captureJpeg
  // 骨架：先只实现未算分支。已算分支由 Task 4-6 补齐。
  if (!cost) {
    _renderCostPlaceholderPage(ctx, plan);
    pages.push('rendered');
    return pages;
  }
  const mgr = _createCostPageManager(canvas, ctx, plan);
  const contentX = MARGIN;
  const contentW = CANVAS_W - MARGIN * 2;
  const cardGap = 20 * SCALE;

  const panelCols = [
    { title: '名称', ratio: 0.24 },
    { title: '尺寸', ratio: 0.24 },
    { title: '面积', ratio: 0.20 },
    { title: '单价', ratio: 0.16 },
    { title: '小计', ratio: 0.16 },
  ];
  const hardwareCols = [
    { title: '部件', ratio: 0.28 },
    { title: '规格', ratio: 0.16 },
    { title: '数量', ratio: 0.16 },
    { title: '单价', ratio: 0.20 },
    { title: '小计', ratio: 0.20 },
  ];

  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const gap = 8 * SCALE;
    const cardBlockH = _cabinetCardTotalHeight(m) + cardGap;
    mgr.addBlock(cardBlockH, (y) => {
      let cy = y;
      const cardH = _drawCabinetCard(ctx, m, contentX, cy, contentW);
      cy += cardH + gap;
      const panelH = _drawDetailTable(ctx, panelCols, _panelDetailRows(m), contentX, cy, contentW);
      cy += panelH + gap;
      _drawDetailTable(ctx, hardwareCols, _hardwareDetailRows(m), contentX, cy, contentW);
    });
  }

  if (cost.sk) {
    const skH = 36 * SCALE + 30 * SCALE + cardGap;
    mgr.addBlock(skH, (y) => {
      _drawSkCard(ctx, cost.sk, contentX, y, contentW);
    });
  }
  const grandH = 60 * SCALE + cardGap;
  mgr.addBlock(grandH, (y) => {
    _drawGrandTotalCard(ctx, cost.grandTotal, contentX, y, contentW);
  });

  return mgr.finalize();
}

// 每完成一页就 flush（画完的 canvas 快照塞入 PDF），然后清空 canvas 继续画下一页。
// 与 _renderCostBreakdown 不同：这版直接接管 canvas 逐页输出，不再收集 pages 数组。
async function _renderAndFlushCostBreakdown(canvas, ctx, plan, cost, flushPage) {
  if (!cost) {
    _renderCostPlaceholderPage(ctx, plan);
    await flushPage();
    return;
  }

  const pageTopContent = MARGIN + 100 * SCALE;
  const pageBottom = CANVAS_H - MARGIN;
  const contentX = MARGIN;
  const contentW = CANVAS_W - MARGIN * 2;
  const cardGap = 20 * SCALE;
  let y = 0;
  let pageStarted = false;

  function beginPage() {
    _resetCanvas(ctx);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
    ctx.fillText(plan.name || '', MARGIN, MARGIN);
    ctx.fillStyle = '#6b7280';
    ctx.font = (14 * SCALE) + 'px sans-serif';
    ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);
    y = pageTopContent;
    pageStarted = true;
  }

  async function endPage() {
    if (pageStarted) {
      await flushPage();
      pageStarted = false;
    }
  }

  async function addBlock(height, drawFn) {
    if (!pageStarted) beginPage();
    if (y + height > pageBottom && y > pageTopContent) {
      await endPage();
      beginPage();
    }
    drawFn(y);
    y += height;
  }

  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const headH = 36 * SCALE;
    const gridH = 60 * SCALE;
    const blockH = headH + gridH + cardGap;
    await addBlock(blockH, (yy) => {
      _drawCabinetCard(ctx, m, contentX, yy, contentW);
    });
  }

  if (cost.sk) {
    const skH = 36 * SCALE + 30 * SCALE + cardGap;
    await addBlock(skH, (yy) => {
      _drawSkCard(ctx, cost.sk, contentX, yy, contentW);
    });
  }
  const grandH = 60 * SCALE + cardGap;
  await addBlock(grandH, (yy) => {
    _drawGrandTotalCard(ctx, cost.grandTotal, contentX, yy, contentW);
  });

  await endPage();
}

// 未算成本占位页：方案名 + 副标题 + 居中提示
function _renderCostPlaceholderPage(ctx, plan, overrideText) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
  ctx.fillText(plan.name || '', MARGIN, MARGIN);

  ctx.fillStyle = '#6b7280';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);

  const msg = overrideText || '未算成本，请到成本页选择板材/五金后再导出';
  ctx.fillStyle = '#9ca3af';
  ctx.font = (16 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, CANVAS_W / 2, CANVAS_H / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

// 分页布局器：维护当前 canvas 的 y 光标；调用 addBlock(height, drawFn) 时
// 若剩余高度不够则先 finalize 当前页（推入 pages），再复位光标并画。
function _createCostPageManager(canvas, ctx, plan) {
  const pageTopContent = MARGIN + 100 * SCALE; // 页眉占 100pt*SCALE 左右
  const pageBottom = CANVAS_H - MARGIN;
  const state = { y: 0, pages: [], canvas, ctx, plan };

  function _drawHeader() {
    _resetCanvas(ctx);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
    ctx.fillText(plan.name || '', MARGIN, MARGIN);

    ctx.fillStyle = '#6b7280';
    ctx.font = (14 * SCALE) + 'px sans-serif';
    ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);
  }

  function beginPage() {
    _drawHeader();
    state.y = pageTopContent;
  }

  function commitPage() {
    state.pages.push('rendered');
  }

  function remaining() {
    return pageBottom - state.y;
  }

  function addBlock(height, drawFn) {
    if (state.y + height > pageBottom && state.y > pageTopContent) {
      commitPage();
      beginPage();
    }
    drawFn(state.y);
    state.y += height;
  }

  function finalize() {
    if (state.y > pageTopContent) commitPage();
    return state.pages;
  }

  beginPage();
  return { addBlock, remaining, finalize };
}

function _drawCabinetCard(ctx, module_, x, y, w) {
  const headH = 36 * SCALE;
  const gridH = 60 * SCALE;
  const totalH = headH + gridH;

  // 卡头背景
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y, w, headH);

  // 卡头文字（左：名称，右：¥total）
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headCenterY = y + headH / 2;
  const title = module_.label + ' ' + (module_.code || '') + '-' + module_.w + '-' + module_.h;
  ctx.fillText(title, x + 12 * SCALE, headCenterY);
  const priceText = _formatCurrency(module_.total || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 12 * SCALE, headCenterY);

  // 4 格网格：标签 + 价格 同一行
  const gridY = y + headH;
  const cellW = w / 2;
  const cellH = gridH / 2;
  const cells = [
    ['板材合计', module_.panelCost],
    ['运输费用', module_.transport],
    ['五金配件', module_.hardwareCost],
    ['安装费用', module_.install],
  ];
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = Math.max(1, 1 * SCALE);
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const cx = x + (i % 2) * cellW;
    const cy = gridY + Math.floor(i / 2) * cellH;
    ctx.strokeRect(cx, cy, cellW, cellH);
    const midY = cy + cellH / 2;
    ctx.fillStyle = '#6b7280';
    ctx.font = (12 * SCALE) + 'px sans-serif';
    const label = cells[i][0] + ': ';
    ctx.fillText(label, cx + 12 * SCALE, midY);
    const labelW = ctx.measureText(label).width;
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.fillText(_formatCurrency(cells[i][1] || 0), cx + 12 * SCALE + labelW, midY);
  }

  ctx.textBaseline = 'top';
  return totalH;
}

// 通用 5 列表格绘制：
//   columns: [{ title, ratio }] 5 项
//   rows: [[cellText, ...5]]
//   起始 y，返回渲染高度。
function _drawDetailTable(ctx, columns, rows, x, y, w) {
  const headerH = 26 * SCALE;
  const rowH = 22 * SCALE;
  const padX = 8 * SCALE;

  // 计算列 x
  const colX = [];
  let cx = x;
  for (let i = 0; i < columns.length; i++) {
    colX.push(cx);
    cx += w * columns[i].ratio;
  }

  // 表头
  ctx.fillStyle = '#374151';
  ctx.fillRect(x, y, w, headerH);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (11 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headerCenterY = y + headerH / 2;
  columns.forEach((col, i) => {
    ctx.fillText(col.title, colX[i] + padX, headerCenterY);
  });

  // 空行占位
  const useRows = (Array.isArray(rows) && rows.length) ? rows : [['无数据', '', '', '', '']];

  // 行
  const startY = y + headerH;
  useRows.forEach((row, i) => {
    const ry = startY + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(x, ry, w, rowH);
    }
    ctx.fillStyle = '#1f2937';
    ctx.font = (11 * SCALE) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const cellY = ry + rowH / 2;
    for (let c = 0; c < columns.length; c++) {
      const text = row[c] == null ? '' : String(row[c]);
      ctx.fillText(text, colX[c] + padX, cellY);
    }
  });

  ctx.textBaseline = 'top';
  return headerH + useRows.length * rowH;
}

function _panelDetailRows(module_) {
  const panels = (module_.detail && module_.detail.panels) || [];
  return panels.map((p) => [
    p.name || '',
    p.size || '',
    (p.area != null ? p.area + '㎡' : '') + (p.qty != null ? '×' + p.qty : ''),
    p.unit != null ? _formatCurrency(p.unit) : '',
    p.total != null ? _formatCurrency(p.total) : '',
  ]);
}

function _hardwareDetailRows(module_) {
  const hardware = (module_.detail && module_.detail.hardware) || [];
  return hardware.map((h) => [
    h.name || '',
    h.qty != null ? String(h.qty) : '',
    h.unit != null ? _formatCurrency(h.unit) : '',
    h.total != null ? _formatCurrency(h.total) : '',
  ]);
}

// 跨页表格：把 rows 按当前剩余空间切片，每页写一遍表头。
// 依赖 addBlock/endPage/beginPage/getY/getBottom 由 _renderAndFlushCostBreakdown 提供。
async function _drawPagedDetailTable(ctx, columns, rows, x, w, addBlock, endPage, beginPage, getY, getBottom) {
  const headerH = 26 * SCALE;
  const rowH = 22 * SCALE;
  const useRows = (Array.isArray(rows) && rows.length) ? rows : [Array(columns.length).fill('').map((_, i) => i === 0 ? '无数据' : '')];

  let idx = 0;
  while (idx < useRows.length) {
    const remaining = getBottom() - getY();
    // 若剩余高度连表头 + 1 行都放不下，翻页
    if (remaining < headerH + rowH) {
      await endPage();
      beginPage();
      continue;
    }
    const maxRowsThisPage = Math.floor((getBottom() - getY() - headerH) / rowH);
    const slice = useRows.slice(idx, idx + maxRowsThisPage);
    const chunkH = headerH + slice.length * rowH;
    await addBlock(chunkH, (yy) => {
      _drawDetailTable(ctx, columns, slice, x, yy, w);
    });
    idx += slice.length;
  }
}

function _drawSkCard(ctx, sk, x, y, w) {
  const headH = 36 * SCALE;
  const bodyH = 30 * SCALE;
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(x, y, w, headH);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(sk.label || '收口条', x + 12 * SCALE, y + headH / 2);
  const priceText = _formatCurrency(sk.total || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 12 * SCALE, y + headH / 2);

  ctx.fillStyle = '#6b7280';
  ctx.font = (12 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('面积 ' + sk.area + '㎡ × 单价 ' + _formatCurrency(sk.unit || 0),
    x + 12 * SCALE, y + headH + 8 * SCALE);
  return headH + bodyH;
}

function _drawGrandTotalCard(ctx, grandTotal, x, y, w) {
  const h = 60 * SCALE;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff7c2';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('总成本预估', x + 20 * SCALE, y + h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  const priceText = _formatCurrency(grandTotal || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 20 * SCALE, y + h / 2);
  ctx.textBaseline = 'top';
  return h;
}

function _cabinetCardTotalHeight(module_) {
  const headH = 36 * SCALE;
  const gridH = 60 * SCALE;
  const gap = 8 * SCALE;
  const panelHeaderH = 26 * SCALE;
  const panelRowH = 22 * SCALE;
  const panelRows = ((module_.detail && module_.detail.panels) || []).length || 1;
  const hardwareRows = ((module_.detail && module_.detail.hardware) || []).length || 1;
  const panelTableH = panelHeaderH + panelRows * panelRowH;
  const hardwareTableH = panelHeaderH + hardwareRows * panelRowH;
  return headH + gridH + gap + panelTableH + gap + hardwareTableH;
}

function _captureJpeg(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.85,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    });
  });
}

function _readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve('data:image/jpeg;base64,' + r.data),
      fail: reject,
    });
  });
}

async function _addCanvasPage(doc, canvas, isFirstPage) {
  if (!isFirstPage) doc.addPage();
  const tmp = await _captureJpeg(canvas);
  const dataUrl = await _readBase64(tmp);
  doc.addImage(dataUrl, 'JPEG', 0, 0, A4_W_PT, A4_H_PT);
}

function _writeToTempFile(arrayBuffer, fileName) {
  return new Promise((resolve, reject) => {
    const filePath = `${wx.env.USER_DATA_PATH}/${Date.now()}-${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: arrayBuffer,
      success: () => resolve(filePath),
      fail: (err) => reject(new Error('writeFile failed: ' + (err && err.errMsg))),
    });
  });
}

async function exportPlans({ canvas, plans, fileName }) {
  if (!canvas) throw new Error('canvas is required');
  if (!Array.isArray(plans) || plans.length === 0) throw new Error('plans is empty');

  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let isFirst = true;

  // 先渲染总览表格页（占第 1 页）
  const tocEntries = _renderOverviewTable(ctx, plans);
  await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

  // 记录每个 plan 的真实入口页号（渲染时填入）
  // 记录每个 plan 的真实入口页号和跳转 y 偏移
  //  - 首方案入口页是 overview（方案名在 PDF 坐标约 40pt），top 用 20pt
  //  - 后续方案入口页是 separator（方案名居中偏上，PDF 坐标约 391pt），top 用 370pt
  const planEntryPage = new Map();
  const planEntryTop = new Map();

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (i > 0) {
      _renderSeparator(ctx, plan, i + 1, plans.length);
      await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
      planEntryPage.set(plan.id, doc.internal.getNumberOfPages());
      planEntryTop.set(plan.id, 370);
    }
    await _renderOverview(canvas, ctx, plan);
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
    if (i === 0) {
      planEntryPage.set(plan.id, doc.internal.getNumberOfPages());
      planEntryTop.set(plan.id, 20);
    }

    await _renderLayout(canvas, ctx, plan);
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
  }

  // 用真实页号回填 tocEntries.pageNumber
  tocEntries.forEach((e) => {
    if (e.planId != null && planEntryPage.has(e.planId)) {
      e.pageNumber = planEntryPage.get(e.planId);
      e.top = planEntryTop.get(e.planId);
    }
  });

  // 回到目录页加内链——跳转到方案名位置
  if (doc.setPage && tocEntries.length) {
    try {
      doc.setPage(1);
      tocEntries.forEach((e) => {
        doc.link(e.x, e.y, e.w, e.h, { pageNumber: e.pageNumber, top: e.top != null ? e.top : 20 });
      });
    } catch (err) {
      console.warn('[pdf] add toc links failed', err && err.message);
    }
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

async function exportPlansWithCost({ canvas, plans, fileName }) {
  if (!canvas) throw new Error('canvas is required');
  if (!Array.isArray(plans) || plans.length === 0) throw new Error('plans is empty');

  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let isFirst = true;

  // 1) 预计算每方案成本
  const costMap = new Map();
  plans.forEach((p) => {
    costMap.set(p.id, _computeCostFor(p));
  });

  // 2) 渲染总表
  const tocEntries = _renderOverviewTable(ctx, plans, {
    showCostColumn: true,
    costMap,
  });
  await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

  // 3) 记录每个 plan 的真实入口页号和跳转 y 偏移（渲染时填入）
  //    - 首方案入口页是 overview（方案名在 PDF 坐标约 40pt），top 用 20pt
  //    - 后续方案入口页是 separator（方案名居中偏上，PDF 坐标约 391pt），top 用 370pt
  const planEntryPage = new Map();
  const planEntryTop = new Map();

  // 4) 逐方案渲染
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const cost = costMap.get(plan.id);

    if (i > 0) {
      _renderSeparator(ctx, plan, i + 1, plans.length);
      await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
      planEntryPage.set(plan.id, doc.internal.getNumberOfPages());
      planEntryTop.set(plan.id, 370);
    }
    await _renderOverview(canvas, ctx, plan);
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
    if (i === 0) {
      planEntryPage.set(plan.id, doc.internal.getNumberOfPages());
      planEntryTop.set(plan.id, 20);
    }

    await _renderLayout(canvas, ctx, plan, { cost });
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

    // 成本透视：可能 1..N 页
    await _renderAndFlushCostBreakdown(canvas, ctx, plan, cost, async () => {
      await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
    });
  }

  // 5) 用真实页号回填 tocEntries.pageNumber
  tocEntries.forEach((e) => {
    if (e.planId != null && planEntryPage.has(e.planId)) {
      e.pageNumber = planEntryPage.get(e.planId);
      e.top = planEntryTop.get(e.planId);
    }
  });

  // 6) 目录页内链——跳转到方案名位置
  if (doc.setPage && tocEntries.length) {
    try {
      doc.setPage(1);
      tocEntries.forEach((e) => {
        doc.link(e.x, e.y, e.w, e.h, { pageNumber: e.pageNumber, top: e.top != null ? e.top : 20 });
      });
    } catch (err) {
      console.warn('[pdf] add toc links failed', err && err.message);
    }
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

module.exports = { exportPlans, exportPlansWithCost, _countCabinets };
