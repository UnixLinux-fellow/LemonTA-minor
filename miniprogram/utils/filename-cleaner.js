// 文件名清洗：空 → 默认；缺 .pdf 后缀 → 补齐；非法字符 → 替换为 _
const DEFAULT_NAME = '我的衣柜方案.pdf';
const ILLEGAL_RE = /[\/\\:*?"<>|]/g;

function cleanFileName(raw) {
  if (raw == null) return DEFAULT_NAME;
  const trimmed = String(raw).trim();
  if (!trimmed) return DEFAULT_NAME;
  const safe = trimmed.replace(ILLEGAL_RE, '_');
  return /\.pdf$/i.test(safe) ? safe : safe + '.pdf';
}

module.exports = { cleanFileName, DEFAULT_NAME };
