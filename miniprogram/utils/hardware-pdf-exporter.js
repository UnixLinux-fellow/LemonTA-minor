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
  throw new Error('not implemented');
}
