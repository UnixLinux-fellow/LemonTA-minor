// 五金/尺寸参考 PDF 导出：4-N 页固定图片资源，与方案无关。
// 与 utils/pdf-exporter.js 平级，共用 canvas + jsPDF 模式但保持独立。
const jspdfModule = require('../vendor/jspdf.min.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const SCALE = 2;
const CANVAS_W = Math.round(A4_W_PT * SCALE);
const CANVAS_H = Math.round(A4_H_PT * SCALE);
const MARGIN = 40 * SCALE;
const MAX_SPEC_PAGES = 5; // 五金规范最多扫多少页

const HARDWARE_DIR = 'cabinet/utils/cabinet-hardware/';

module.exports = { exportHardware };

async function exportHardware({ canvas, fileName }) {
  if (!canvas) throw new Error('canvas is required');

  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const sources = await _buildSources(canvas);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let isFirst = true;

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    await _renderImagePage(canvas, ctx, s.path, s.fallback);
    await _addCanvasPage(doc, canvas, isFirst);
    isFirst = false;
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

function _resetCanvas(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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

function _drawPlaceholder(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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

function _drawImageContain(canvas, ctx, src, dx, dy, dw, dh, fallback) {
  return new Promise((resolve) => {
    if (!src) {
      _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
      resolve(false);
      return;
    }
    const img = canvas.createImage();
    img.onload = () => {
      const ratio = Math.min(dw / img.width, dh / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      try {
        ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
        resolve(true);
      } catch (e) {
        _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
        resolve(false);
      }
    };
    img.onerror = () => {
      _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
      resolve(false);
    };
    img.src = src;
  });
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

// 返回 Promise<boolean>：图片能否加载成功。用于探测代码包内资源是否存在。
function _probeImage(canvas, src) {
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

// 返回五金规范图片路径数组（按 -1, -2 顺序或单页 fallback）。
// 若都不存在，返回 [null]（占位符会由渲染阶段处理）。
async function _resolveSpecPages(canvas) {
  // 优先扫 -1 -> -N 多页
  const multi = [];
  for (let i = 1; i <= MAX_SPEC_PAGES; i++) {
    const path = HARDWARE_DIR + '五金规范-' + i + '.jpg';
    const ok = await _probeImage(canvas, path);
    if (!ok) break;
    multi.push(path);
  }
  if (multi.length > 0) return multi;

  // 回退到无后缀单页
  const single = HARDWARE_DIR + '五金规范.jpg';
  const ok = await _probeImage(canvas, single);
  if (ok) return [single];

  // 都没有，返回单个 null 占位
  return [null];
}

// 构造按顺序的图片资源列表：
// 尺寸 → 五金规范（1-N 页）→ 国产 → 进口
async function _buildSources(canvas) {
  const specPages = await _resolveSpecPages(canvas);
  const sources = [];
  sources.push({
    path: HARDWARE_DIR + '衣柜尺寸.png',
    fallback: '衣柜尺寸图片缺失',
  });
  specPages.forEach((path) => {
    sources.push({
      path,
      fallback: '五金规范图片缺失，请将 五金规范.docx 另存为图片（.jpg）放入 cabinet-hardware/ 目录',
    });
  });
  sources.push({
    path: HARDWARE_DIR + '国产五金参数.jpg',
    fallback: '国产五金参数图片缺失',
  });
  sources.push({
    path: HARDWARE_DIR + '进口五金参数.jpg',
    fallback: '进口五金参数图片缺失',
  });
  return sources;
}

// 渲染一页：白底 + 图片 contain 铺满整页（含 MARGIN）。
async function _renderImagePage(canvas, ctx, src, fallbackText) {
  _resetCanvas(ctx);
  const x = MARGIN;
  const y = MARGIN;
  const w = CANVAS_W - MARGIN * 2;
  const h = CANVAS_H - MARGIN * 2;
  await _drawImageContain(canvas, ctx, src, x, y, w, h, fallbackText);
}
