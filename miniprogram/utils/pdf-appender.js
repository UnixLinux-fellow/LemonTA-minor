// 用 pdf-lib 把一份"追加 PDF"合到"主 PDF (arraybuffer)"末尾，且让追加进来的
// 每一页排版与主 PDF 一致：都落在新建的 A4 纵向 (595.28 × 841.89pt) 页里，等比缩放
// 居中。宽高比不同的源页会形成上下 / 左右留白 (letterbox)，不裁切、不变形。
//
// 主 PDF 由 pdf-exporter.js 用 jsPDF 生成 (A4 纵向)，追加的拆单规范 PDF 由云端
// 存储 hardware-fittings/ 目录下的原始 PDF 直接下发；两者 A4 纸型对齐后合并成
// 一份新的 PDF，返回 ArrayBuffer 供上层写盘。

const { PDFDocument } = require('../vendor/pdf-lib.min.js');

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;

/**
 * 把 appendPdfPath 指向的 PDF 每一页追加到 mainAB 之后，页面统一 A4 纵向、等比居中。
 *
 * @param {ArrayBuffer} mainAB 主 PDF 字节 (来自 jsPDF doc.output('arraybuffer'))
 * @param {string} appendPdfPath 追加 PDF 的本地路径 (USER_DATA_PATH 下的文件)
 * @returns {Promise<ArrayBuffer>} 合并后 PDF 的 arraybuffer
 * @throws 读文件失败 / PDF 解析失败 时抛错，交给上层降级 (只导主 PDF + toast)
 */
async function appendPdfToArrayBuffer(mainAB, appendPdfPath) {
  const appendAB = await _readFileAsArrayBuffer(appendPdfPath);

  // 微信小程序里 wx.readFile 返回的 ArrayBuffer 和 jsPDF doc.output('arraybuffer')
  // 返回的 ArrayBuffer 有时不能通过 pdf-lib 的 `instanceof ArrayBuffer/Uint8Array`
  // (跨 realm / native binding buffer)，会抛 "must be of type ... but was NaN"。
  // 强制拷贝到当前 realm 的 Uint8Array 上再喂 pdf-lib，规避这个问题。
  const mainU8 = _toUint8Array(mainAB);
  const appendU8 = _toUint8Array(appendAB);

  const mainDoc = await PDFDocument.load(mainU8);
  const appendDoc = await PDFDocument.load(appendU8);

  // embedPages 返回的 embeddedPages 顺序与传入 pages 一致
  const embeddedPages = await mainDoc.embedPages(appendDoc.getPages());

  embeddedPages.forEach((embedded) => {
    const srcW = embedded.width;
    const srcH = embedded.height;
    const scale = Math.min(A4_W_PT / srcW, A4_H_PT / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const x = (A4_W_PT - drawW) / 2;
    const y = (A4_H_PT - drawH) / 2;
    const page = mainDoc.addPage([A4_W_PT, A4_H_PT]);
    page.drawPage(embedded, { x, y, width: drawW, height: drawH });
  });

  const merged = await mainDoc.save();
  // pdf-lib save() 返回 Uint8Array，转成 ArrayBuffer 交给 wx.writeFile
  return _uint8ToArrayBuffer(merged);
}

function _readFileAsArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (r) => resolve(r.data), // 已是 ArrayBuffer (未传 encoding)
      fail: (err) => reject(new Error('readFile failed: ' + (err && err.errMsg))),
    });
  });
}

function _uint8ToArrayBuffer(u8) {
  // pdf-lib 的 Uint8Array 可能是 subarray view; slice 出干净的 buffer 避免边界越出
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer;
  }
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// 兜底把任何"二进制载荷"转成 pdf-lib 认识的本 realm Uint8Array，
// 规避微信小程序里 wx.readFile 返回的 ArrayBuffer 或 jsPDF doc.output('arraybuffer')
// 的 ArrayBuffer 有时 instanceof 检查失败的问题 (跨 realm / native binding buffer)。
//
// 策略:
// 1) 真 Uint8Array → 复制到新的 Uint8Array (跨 realm 也吃);
// 2) 真 ArrayBuffer → new Uint8Array(ab.slice(0));
// 3) 上面 instanceof 都失败但看起来是 ArrayBuffer-like (有 byteLength、无 length):
//    先试 new Uint8Array(input) —— V8 只按 duck typing 走，跨 realm AB 也认;
// 4) 看起来是 TypedArray-like (有 byteLength、有 buffer): 从 buffer 走 slice 再包;
// 5) 最后按 length 逐字节复制,兼容 { 0: byte, length: n }。
function _toUint8Array(input) {
  if (input == null) throw new TypeError('pdf-appender: null binary input');
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));

  const hasByteLength = typeof input.byteLength === 'number';
  const hasLength = typeof input.length === 'number';

  if (hasByteLength && !hasLength) {
    // ArrayBuffer-like (跨 realm / native)
    try {
      const u8 = new Uint8Array(input);
      // 复制一份到本 realm 干净的新 Uint8Array
      return new Uint8Array(u8);
    } catch (e) { /* fall through */ }
  }
  if (hasByteLength && input.buffer) {
    try {
      const bufAB = input.buffer;
      const off = input.byteOffset || 0;
      const len = input.byteLength;
      // buffer 可能也不是本 realm 的 ArrayBuffer，先 new Uint8Array 兜一层再拷
      const view = new Uint8Array(bufAB, off, len);
      return new Uint8Array(view);
    } catch (e) { /* fall through */ }
  }
  if (hasLength) {
    const u8 = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) u8[i] = input[i] & 0xff;
    return u8;
  }
  throw new TypeError('pdf-appender: unsupported binary input');
}

module.exports = { appendPdfToArrayBuffer };
