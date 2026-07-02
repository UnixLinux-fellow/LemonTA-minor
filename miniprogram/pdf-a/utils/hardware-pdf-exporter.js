// 五金/尺寸参考 PDF 导出：4-N 页固定图片资源，与方案无关。
//
// 关键设计：每一页 PDF 的高度按源图长宽比动态计算（页宽固定 = A4 宽），
// canvas 尺寸 = 源图像素（capped at MAX_CANVAS_EDGE），源图 edge-to-edge 铺满
// canvas，jsPDF addImage 填满整个自定义尺寸页。这样：
//   - 不再有 _drawImageContain 的 aspect-fit 无效缩放（原本 829×4713 的
//     五金规范会被塞进 A4，实际内容只占 25% 宽度，其余 75% canvas 都是白边）；
//   - canvas 分辨率 ≈ 源图分辨率，不做 upscale 也不做过度 downscale，
//     PDF viewer 放大时能吃到源图细节。
const jspdfModule = require('../vendor/jspdf.min.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;

// 单张 canvas 像素上限（部分安卓 Skia canvas 最大边约 4096；再高易崩）。
const MAX_CANVAS_EDGE = 4096;

const JPEG_QUALITY = 0.92;
const MAX_SPEC_PAGES = 5; // 五金规范最多扫多少页

// 五金参考图按大小拆入两个分包，避免单包超 2 MB 上限：
//   pdf-a/hardware/  五金规范.png + 国产五金参数.jpg
//   pdf-b/hardware/  衣柜尺寸.png + 进口五金参数.jpg
// 加载走 img.src URL 解析路径，跨分包读取不受 fs.readFile 分包边界限制。
const PATH_衣柜尺寸       = '/pdf-b/hardware/衣柜尺寸.png';
const PATH_国产五金参数   = '/pdf-a/hardware/国产五金参数.jpg';
const PATH_进口五金参数   = '/pdf-b/hardware/进口五金参数.jpg';
const SPEC_DIR = '/pdf-a/hardware/';
const SPEC_EXTS = ['.png', '.jpg'];

// 占位符渲染时用的 A4 canvas 分辨率倍率
const PLACEHOLDER_SCALE = 2;

module.exports = { exportHardware };

async function exportHardware({ canvas, fileName }) {
  if (!canvas) throw new Error('canvas is required');
  const ctx = canvas.getContext('2d');

  const sources = await _buildSources(canvas);

  let doc = null;
  for (const s of sources) {
    const dims = s.path ? await _measureImage(canvas, s.path) : null;
    const pageW = A4_W_PT;
    const pageH = dims ? (A4_W_PT * dims.height / dims.width) : A4_H_PT;

    if (!doc) doc = new jsPDF({ unit: 'pt', format: [pageW, pageH] });
    else doc.addPage([pageW, pageH]);

    if (dims) {
      await _renderImageFullBleed(canvas, ctx, s.path, dims);
    } else {
      _renderPlaceholderA4(canvas, ctx, s.fallback);
    }
    const tmp = await _captureJpeg(canvas);
    const dataUrl = await _readBase64(tmp);
    doc.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH);
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

// 加载图并返回自然像素尺寸；失败返回 null（走占位符分支）。
function _measureImage(canvas, src) {
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function _renderImageFullBleed(canvas, ctx, src, dims) {
  const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(dims.width, dims.height));
  canvas.width = Math.max(1, Math.round(dims.width * scale));
  canvas.height = Math.max(1, Math.round(dims.height * scale));

  // 重置 canvas（改 width/height 会清空 context，但 fillStyle 等状态保留在 ctx 上）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => {
      try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (_) {}
      resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

function _renderPlaceholderA4(canvas, ctx, text) {
  canvas.width = Math.round(A4_W_PT * PLACEHOLDER_SCALE);
  canvas.height = Math.round(A4_H_PT * PLACEHOLDER_SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 40 * PLACEHOLDER_SCALE;
  const x = margin;
  const y = margin;
  const w = canvas.width - margin * 2;
  const h = canvas.height - margin * 2;

  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * PLACEHOLDER_SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = _wrapText(ctx, text, w - 40 * PLACEHOLDER_SCALE);
  const lineH = 22 * PLACEHOLDER_SCALE;
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

function _captureJpeg(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: JPEG_QUALITY,
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

function _probeImage(canvas, src) {
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function _resolveSpecPages(canvas) {
  // 优先扫 -1 -> -N 多页（.png / .jpg 都试）
  const multi = [];
  for (let i = 1; i <= MAX_SPEC_PAGES; i++) {
    let found = null;
    for (const ext of SPEC_EXTS) {
      const path = SPEC_DIR + '五金规范-' + i + ext;
      if (await _probeImage(canvas, path)) { found = path; break; }
    }
    if (!found) break;
    multi.push(found);
  }
  if (multi.length > 0) return multi;

  // 回退到无后缀单页（.png / .jpg 都试）
  for (const ext of SPEC_EXTS) {
    const single = SPEC_DIR + '五金规范' + ext;
    if (await _probeImage(canvas, single)) return [single];
  }
  return [null];
}

async function _buildSources(canvas) {
  const specPages = await _resolveSpecPages(canvas);
  const sources = [];
  sources.push({
    path: PATH_衣柜尺寸,
    fallback: '衣柜尺寸图片缺失',
  });
  specPages.forEach((path) => {
    sources.push({
      path,
      fallback: '五金规范图片缺失，请将 五金规范.docx 另存为图片（.jpg）放入 pdf-a/hardware/ 目录',
    });
  });
  sources.push({
    path: PATH_国产五金参数,
    fallback: '国产五金参数图片缺失',
  });
  sources.push({
    path: PATH_进口五金参数,
    fallback: '进口五金参数图片缺失',
  });
  return sources;
}
