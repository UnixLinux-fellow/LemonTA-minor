# PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "导出方案信息" button to the plan-list page that lets users select saved plans and export them as a single PDF (default filename "我的衣柜方案.pdf"), with each plan containing space photo, wall dimensions, corner/raise info, 3D preview screenshot, wireframe, materials/hardware selection, and full cost breakdown.

**Architecture:** All PDF generation happens in the WeChat miniprogram frontend using jsPDF (UMD build) bundled into `miniprogram/vendor/`. A new utility `utils/pdf-exporter.js` exposes `exportPlans(plans, fileName) → Promise<filePath>`. Two new components (`plan-select-modal`, `filename-input-modal`) drive the selection and naming flow. The generated PDF is written to `wx.env.USER_DATA_PATH` and handed to the user via `wx.openDocument`.

**Tech Stack:** WeChat miniprogram (JS), jsPDF 2.x UMD build, embedded Chinese font (Noto Sans SC subset) as base64, Node + Jest for unit tests.

---

## Spec Reference

`docs/superpowers/specs/2026-06-27-pdf-export-design.md`

Read it before starting — it defines layouts, edge cases, and error policies. The plan below realizes it task-by-task.

---

## File Structure

**Create:**
- `miniprogram/vendor/jspdf.min.js` — jsPDF library, wrapped for miniprogram (Task 1).
- `miniprogram/vendor/NotoSansSC-normal.js` — base64 Chinese font (Task 2).
- `miniprogram/utils/pdf-exporter.js` — orchestrator + draw functions (Tasks 3–8).
- `miniprogram/utils/filename-cleaner.js` — pure filename sanitization util (Task 3).
- `miniprogram/components/plan-select-modal/index.{js,wxml,wxss,json}` (Task 9).
- `miniprogram/components/filename-input-modal/index.{js,wxml,wxss,json}` (Task 10).
- `tests/filename-cleaner.test.js` — unit tests (Task 3).
- `tests/pdf-exporter.test.js` — unit tests using mocked jsPDF (Tasks 4–8).

**Modify:**
- `miniprogram/pages/plan-list/index.json` — register the two new components (Task 11).
- `miniprogram/pages/plan-list/index.wxml` — add button + modal references (Task 11).
- `miniprogram/pages/plan-list/index.wxss` — button styles (Task 11).
- `miniprogram/pages/plan-list/index.js` — handlers, modal state, exporter call (Task 11).

---

## Task 1: Bring in jsPDF library with miniprogram shim

**Files:**
- Create: `miniprogram/vendor/jspdf.min.js`

**Background:** jsPDF's UMD build references `window`/`self`/`globalThis`. Miniprogram has none of these by name, so we prepend a shim that provides them. We use jsPDF v2.5.1 (latest 2.x as of Jan 2026; stable miniprogram-compatible release).

- [ ] **Step 1: Download jsPDF UMD into vendor**

Run from `D:/工程/柠檬塔/程序/LemonTA-minor`:
```bash
curl -L -o miniprogram/vendor/jspdf.raw.js https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
```

Expected: a `jspdf.raw.js` of roughly 350 KB.

- [ ] **Step 2: Wrap with miniprogram globalThis shim**

Create `miniprogram/vendor/jspdf.min.js` with content:

```javascript
// jsPDF 2.5.1 wrapped for WeChat miniprogram.
// The UMD build references window / self / globalThis. Miniprogram has none of
// those exact names, so we synthesize a fake `globalThis` object that the UMD
// pattern walks before falling back to `module.exports`.
const fakeGlobal = {};
(function () {
  const window = fakeGlobal;
  const self = fakeGlobal;
  const globalThis = fakeGlobal;
  // BEGIN_JSPDF_UMD
  // (paste jspdf.raw.js contents here, then DELETE jspdf.raw.js)
  // END_JSPDF_UMD
}).call(fakeGlobal);
module.exports = fakeGlobal.jspdf || fakeGlobal;
```

Then literally paste the contents of `jspdf.raw.js` between the BEGIN/END comments and delete `jspdf.raw.js`.

- [ ] **Step 3: Smoke-test the import in Node**

Add a temp file `tests/_smoke-jspdf.js`:

```javascript
const jsPDF = require('../miniprogram/vendor/jspdf.min.js').jsPDF || require('../miniprogram/vendor/jspdf.min.js');
const doc = new jsPDF({ unit: 'pt', format: 'a4' });
doc.text('hello', 40, 40);
const out = doc.output('arraybuffer');
console.log('jsPDF output bytes:', out.byteLength);
```

Run: `node tests/_smoke-jspdf.js`
Expected: prints "jsPDF output bytes: 1000+" with no errors.

If the require returns `undefined`, the shim wrap is wrong — the module.exports line at the bottom must match the global jsPDF exposes. Re-inspect: in jspdf 2.5.1 the UMD attaches `jspdf` (lowercase) to globalThis with `{ jsPDF: ... }`. Adjust the last line to `module.exports = fakeGlobal.jspdf;`.

- [ ] **Step 4: Delete smoke file**

```bash
rm tests/_smoke-jspdf.js
```

- [ ] **Step 5: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git init  # if not already a repo (project root reported `Is a git repository: false`)
git add miniprogram/vendor/jspdf.min.js
git commit -m "feat(vendor): add jsPDF 2.5.1 for miniprogram"
```

If `git init` was needed and there are existing files, also `git add -A` for a baseline commit first — but ask the user before doing a baseline commit; just adding `jspdf.min.js` is safer.

---

## Task 2: Embed Chinese font for jsPDF

**Files:**
- Create: `miniprogram/vendor/NotoSansSC-normal.js`

**Background:** jsPDF's built-in fonts (Helvetica etc.) don't support Chinese. We embed a subsetted Noto Sans SC and register it with jsPDF via `addFileToVFS` + `addFont`.

- [ ] **Step 1: Download Noto Sans SC TTF**

```bash
curl -L -o /tmp/NotoSansSC-Regular.ttf https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
```

We use the SubsetOTF version (~3MB) over the full TTF (~10MB) to save miniprogram bundle size.

- [ ] **Step 2: Convert TTF to base64 JS module**

Create `scripts/font-to-js.js`:

```javascript
const fs = require('fs');
const buf = fs.readFileSync('/tmp/NotoSansSC-Regular.ttf');
const b64 = buf.toString('base64');
const out = `// Auto-generated. Noto Sans SC Regular as base64 for jsPDF.
module.exports = ${JSON.stringify(b64)};
`;
fs.writeFileSync('miniprogram/vendor/NotoSansSC-normal.js', out);
console.log('Wrote', out.length, 'bytes');
```

Run: `node scripts/font-to-js.js`
Expected: prints byte count around 4-5 MB.

- [ ] **Step 3: Delete the script**

```bash
rm scripts/font-to-js.js
rmdir scripts 2>/dev/null
```

- [ ] **Step 4: Verify the module loads in Node**

```bash
node -e "console.log(require('./miniprogram/vendor/NotoSansSC-normal.js').length)"
```

Expected: prints a number around 4_000_000.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/vendor/NotoSansSC-normal.js
git commit -m "feat(vendor): embed Noto Sans SC for PDF Chinese rendering"
```

---

## Task 3: Filename cleaner utility + tests

**Files:**
- Create: `miniprogram/utils/filename-cleaner.js`
- Create: `tests/filename-cleaner.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/filename-cleaner.test.js`:

```javascript
const { cleanFileName } = require('../miniprogram/utils/filename-cleaner.js');

describe('cleanFileName', () => {
  test('empty input falls back to default', () => {
    expect(cleanFileName('')).toBe('我的衣柜方案.pdf');
    expect(cleanFileName(null)).toBe('我的衣柜方案.pdf');
    expect(cleanFileName(undefined)).toBe('我的衣柜方案.pdf');
    expect(cleanFileName('   ')).toBe('我的衣柜方案.pdf');
  });

  test('appends .pdf if missing', () => {
    expect(cleanFileName('老李的衣柜')).toBe('老李的衣柜.pdf');
    expect(cleanFileName('plan')).toBe('plan.pdf');
  });

  test('keeps .pdf if present', () => {
    expect(cleanFileName('a.pdf')).toBe('a.pdf');
    expect(cleanFileName('a.PDF')).toBe('a.PDF');
  });

  test('replaces illegal characters with _', () => {
    expect(cleanFileName('a/b\\c:d*e?f"g<h>i|j.pdf'))
      .toBe('a_b_c_d_e_f_g_h_i_j.pdf');
  });

  test('trims surrounding whitespace', () => {
    expect(cleanFileName('  abc.pdf  ')).toBe('abc.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Set up Jest first if missing. Check `D:/工程/柠檬塔/程序/LemonTA-minor/package.json`:

```bash
cat package.json 2>/dev/null || echo "no root package.json"
```

If no root `package.json`, create one:

```json
{
  "name": "lemonta-minor",
  "version": "1.0.0",
  "scripts": { "test": "jest" },
  "devDependencies": { "jest": "^29.7.0" }
}
```

Then:
```bash
npm install
```

Run: `npx jest tests/filename-cleaner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement filename-cleaner**

Create `miniprogram/utils/filename-cleaner.js`:

```javascript
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
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/filename-cleaner.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/filename-cleaner.js tests/filename-cleaner.test.js package.json package-lock.json
git commit -m "feat(utils): add filename-cleaner with tests"
```

---

## Task 4: pdf-exporter — skeleton + font injection

**Files:**
- Create: `miniprogram/utils/pdf-exporter.js`
- Create: `tests/pdf-exporter.test.js`

**Background:** We start with the public surface (`exportPlans`) and font-loading mechanism. Other draw functions are stubs at first. Subsequent tasks fill them in. Each task adds tests.

- [ ] **Step 1: Write failing test for exportPlans surface**

Create `tests/pdf-exporter.test.js`:

```javascript
// Mock the vendor modules before requiring pdf-exporter.
jest.mock('../miniprogram/vendor/NotoSansSC-normal.js', () => 'FAKE_FONT_B64', { virtual: true });
jest.mock('../miniprogram/vendor/jspdf.min.js', () => {
  return {
    jsPDF: class {
      constructor() {
        this.calls = [];
        this.pageNumber = 1;
      }
      addFileToVFS(name, b64) { this.calls.push(['addFileToVFS', name, b64]); }
      addFont(file, family, style) { this.calls.push(['addFont', file, family, style]); }
      setFont(family) { this.calls.push(['setFont', family]); }
      setFontSize(n) { this.calls.push(['setFontSize', n]); }
      text(t, x, y) { this.calls.push(['text', t, x, y]); }
      addPage() { this.calls.push(['addPage']); this.pageNumber++; }
      setFillColor() {}
      rect() {}
      setTextColor() {}
      addImage() { this.calls.push(['addImage']); }
      output(_) { return new ArrayBuffer(8); }
      internal = {
        pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 },
      };
    },
  };
}, { virtual: true });

// Mock wx environment
global.wx = {
  env: { USER_DATA_PATH: '/tmp/userdata' },
  getFileSystemManager: () => ({
    writeFile: ({ filePath, success, fail }) => { setImmediate(() => success && success({ filePath })); },
  }),
};

const { exportPlans } = require('../miniprogram/utils/pdf-exporter.js');

describe('exportPlans surface', () => {
  test('resolves with a string filePath', async () => {
    const plans = [{ id: 'p1', name: 'plan-one', wall: { w: 200, h: 250 }, cornerLabel: '无转角', materials: {}, cabinets: [], previewImage: '', wireframeImage: '', photoPath: '' }];
    const filePath = await exportPlans(plans, 'test.pdf');
    expect(typeof filePath).toBe('string');
    expect(filePath).toMatch(/test\.pdf$/);
  });

  test('throws TypeError when plans not array', async () => {
    await expect(exportPlans(null, 'x.pdf')).rejects.toBeInstanceOf(TypeError);
  });

  test('throws Error when plans is empty', async () => {
    await expect(exportPlans([], 'x.pdf')).rejects.toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pdf-exporter skeleton**

Create `miniprogram/utils/pdf-exporter.js`:

```javascript
// PDF 导出：把若干方案绘制到 jsPDF 文档，写入 USER_DATA_PATH 供 wx.openDocument 预览。
const jspdfModule = require('../vendor/jspdf.min.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;
const fontB64 = require('../vendor/NotoSansSC-normal.js');

const FONT_FAMILY = 'NotoSansSC';
const FONT_FILE = 'NotoSansSC-Regular.ttf';
let _fontLoaded = false;

function _ensureFont(doc) {
  if (!_fontLoaded) {
    doc.addFileToVFS(FONT_FILE, fontB64);
    doc.addFont(FONT_FILE, FONT_FAMILY, 'normal');
    _fontLoaded = true;
  }
  doc.setFont(FONT_FAMILY);
}

// 三页骨架——具体实现见后续 Task
function _drawOverviewPage(doc, plan) {
  doc.setFontSize(24);
  doc.text(String(plan.name || ''), 40, 60);
}
function _drawLayoutPage(doc, plan) { /* Task 6 */ }
function _drawCostPages(doc, plan) { /* Task 7 */ }
function _drawSeparatorPage(doc, plan, idx, total) { /* Task 8 */ }

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

async function exportPlans(plans, fileName) {
  if (!Array.isArray(plans)) throw new TypeError('plans must be an array');
  if (plans.length === 0) throw new Error('plans is empty');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  _ensureFont(doc);

  for (let i = 0; i < plans.length; i++) {
    if (i > 0) {
      doc.addPage();
      _drawSeparatorPage(doc, plans[i], i + 1, plans.length);
      doc.addPage();
    }
    _drawOverviewPage(doc, plans[i]);
    doc.addPage();
    _drawLayoutPage(doc, plans[i]);
    doc.addPage();
    _drawCostPages(doc, plans[i]);
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

module.exports = { exportPlans, _ensureFont, _drawOverviewPage, _drawLayoutPage, _drawCostPages, _drawSeparatorPage };
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js tests/pdf-exporter.test.js
git commit -m "feat(utils): pdf-exporter skeleton with font injection"
```

---

## Task 5: pdf-exporter — image placeholder helper + overview page

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`
- Modify: `tests/pdf-exporter.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/pdf-exporter.test.js`:

```javascript
describe('_drawImageOrPlaceholder', () => {
  const { _drawImageOrPlaceholder } = require('../miniprogram/utils/pdf-exporter.js');
  function makeDoc() {
    const calls = [];
    return {
      calls,
      setFillColor: (...a) => calls.push(['setFillColor', ...a]),
      rect: (...a) => calls.push(['rect', ...a]),
      setTextColor: (...a) => calls.push(['setTextColor', ...a]),
      setFontSize: (...a) => calls.push(['setFontSize', ...a]),
      text: (...a) => calls.push(['text', ...a]),
      addImage: (...a) => calls.push(['addImage', ...a]),
    };
  }
  test('draws gray placeholder when imgSrc empty', () => {
    const d = makeDoc();
    _drawImageOrPlaceholder(d, '', 10, 20, 100, 50, '无照片');
    const types = d.calls.map((c) => c[0]);
    expect(types).toContain('rect');
    expect(types).toContain('text');
    expect(types).not.toContain('addImage');
  });
  test('draws gray placeholder when imgSrc null/undefined', () => {
    const d = makeDoc();
    _drawImageOrPlaceholder(d, null, 0, 0, 10, 10, 'X');
    expect(d.calls.map((c) => c[0])).toContain('rect');
  });
  test('calls addImage when imgSrc looks valid', () => {
    const d = makeDoc();
    _drawImageOrPlaceholder(d, 'data:image/jpeg;base64,AAA', 0, 0, 10, 10, 'X');
    expect(d.calls.map((c) => c[0])).toContain('addImage');
  });
});

describe('_drawOverviewPage', () => {
  const { _drawOverviewPage } = require('../miniprogram/utils/pdf-exporter.js');
  function makeDoc() {
    const calls = [];
    const d = {
      calls,
      setFontSize: (...a) => calls.push(['setFontSize', ...a]),
      setFont: (...a) => calls.push(['setFont', ...a]),
      text: (...a) => calls.push(['text', ...a]),
      setFillColor: () => {}, rect: () => {}, setTextColor: () => {}, addImage: (...a) => calls.push(['addImage', ...a]),
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    };
    return d;
  }
  test('writes plan name and subtitle', () => {
    const d = makeDoc();
    const plan = { name: '主卧衣柜', wall: { w: 280, h: 250 }, cornerLabel: '左转角', hasRaise: true, previewImage: '', photoPath: '' };
    _drawOverviewPage(d, plan);
    const textArgs = d.calls.filter((c) => c[0] === 'text').map((c) => c[1]);
    expect(textArgs.some((t) => String(t).includes('主卧衣柜'))).toBe(true);
    expect(textArgs.some((t) => String(t).includes('280') && String(t).includes('250'))).toBe(true);
    expect(textArgs.some((t) => String(t).includes('左转角'))).toBe(true);
    expect(textArgs.some((t) => String(t).includes('加高'))).toBe(true);
  });
  test('handles missing wall gracefully', () => {
    const d = makeDoc();
    expect(() => _drawOverviewPage(d, { name: 'x', materials: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: tests for `_drawImageOrPlaceholder` and the new `_drawOverviewPage` cases FAIL.

- [ ] **Step 3: Implement placeholder helper and overview page**

In `miniprogram/utils/pdf-exporter.js`, **replace** the stub `_drawOverviewPage` and add `_drawImageOrPlaceholder`. The full updated file should now read:

```javascript
const jspdfModule = require('../vendor/jspdf.min.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;
const fontB64 = require('../vendor/NotoSansSC-normal.js');

const FONT_FAMILY = 'NotoSansSC';
const FONT_FILE = 'NotoSansSC-Regular.ttf';
let _fontLoaded = false;

const PAGE_MARGIN = 40;

function _ensureFont(doc) {
  if (!_fontLoaded) {
    doc.addFileToVFS(FONT_FILE, fontB64);
    doc.addFont(FONT_FILE, FONT_FAMILY, 'normal');
    _fontLoaded = true;
  }
  doc.setFont(FONT_FAMILY);
}

function _drawImageOrPlaceholder(doc, imgSrc, x, y, w, h, fallbackText) {
  if (!imgSrc) {
    doc.setFillColor(230, 230, 230);
    doc.rect(x, y, w, h, 'F');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(12);
    doc.text(fallbackText, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
    doc.setTextColor(0, 0, 0);
    return;
  }
  try {
    const fmt = /\.png|^data:image\/png/i.test(imgSrc) ? 'PNG' : 'JPEG';
    doc.addImage(imgSrc, fmt, x, y, w, h);
  } catch (e) {
    doc.setFillColor(230, 230, 230);
    doc.rect(x, y, w, h, 'F');
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(12);
    doc.text(fallbackText, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
    doc.setTextColor(0, 0, 0);
  }
}

function _drawOverviewPage(doc, plan) {
  const W = doc.internal.pageSize.getWidth();
  const wall = plan.wall || { w: '?', h: '?' };

  doc.setFontSize(24);
  doc.text(String(plan.name || ''), PAGE_MARGIN, 70);

  doc.setFontSize(12);
  const subtitle = `${wall.w} × ${wall.h} cm · ${plan.cornerLabel || ''}` + (plan.hasRaise ? ' · 加高' : '');
  doc.text(subtitle, PAGE_MARGIN, 95);

  const photoX = PAGE_MARGIN;
  const photoY = 120;
  const photoW = (W - PAGE_MARGIN * 2) * 0.45;
  const photoH = 180;
  _drawImageOrPlaceholder(doc, plan.photoPath, photoX, photoY, photoW, photoH, '无照片');

  const infoX = photoX + photoW + 20;
  let infoY = photoY + 14;
  doc.setFontSize(12);
  doc.text(`墙体尺寸: ${wall.w} × ${wall.h} cm`, infoX, infoY); infoY += 22;
  doc.text(`转角类型: ${plan.cornerLabel || '无转角'}`, infoX, infoY); infoY += 22;
  doc.text(`是否加高: ${plan.hasRaise ? '加高' : '无'}`, infoX, infoY);

  const previewX = PAGE_MARGIN;
  const previewY = photoY + photoH + 40;
  const previewW = W - PAGE_MARGIN * 2;
  const previewH = 320;
  _drawImageOrPlaceholder(doc, plan.previewImage, previewX, previewY, previewW, previewH, '无预览');
}

function _drawLayoutPage(doc, plan) { /* Task 6 */ }
function _drawCostPages(doc, plan) { /* Task 7 */ }
function _drawSeparatorPage(doc, plan, idx, total) { /* Task 8 */ }

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

async function exportPlans(plans, fileName) {
  if (!Array.isArray(plans)) throw new TypeError('plans must be an array');
  if (plans.length === 0) throw new Error('plans is empty');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  _ensureFont(doc);

  for (let i = 0; i < plans.length; i++) {
    if (i > 0) {
      doc.addPage();
      _drawSeparatorPage(doc, plans[i], i + 1, plans.length);
      doc.addPage();
    }
    _drawOverviewPage(doc, plans[i]);
    doc.addPage();
    _drawLayoutPage(doc, plans[i]);
    doc.addPage();
    _drawCostPages(doc, plans[i]);
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}

module.exports = {
  exportPlans,
  _ensureFont,
  _drawImageOrPlaceholder,
  _drawOverviewPage,
  _drawLayoutPage,
  _drawCostPages,
  _drawSeparatorPage,
};
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: all PASS (initial 3 + 3 placeholder + 2 overview = 8 total).

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js tests/pdf-exporter.test.js
git commit -m "feat(pdf-exporter): image placeholder helper and overview page"
```

---

## Task 6: pdf-exporter — layout + materials page

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`
- Modify: `tests/pdf-exporter.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/pdf-exporter.test.js`:

```javascript
describe('_drawLayoutPage', () => {
  const { _drawLayoutPage } = require('../miniprogram/utils/pdf-exporter.js');
  function makeDoc() {
    const calls = [];
    return {
      calls,
      setFontSize: (...a) => calls.push(['setFontSize', ...a]),
      setFont: (...a) => calls.push(['setFont', ...a]),
      text: (...a) => calls.push(['text', ...a]),
      setFillColor: () => {}, rect: () => {}, setTextColor: () => {},
      addImage: (...a) => calls.push(['addImage', ...a]),
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    };
  }
  test('renders 5 material rows with their values', () => {
    const d = makeDoc();
    const plan = {
      name: 'X', wireframeImage: '',
      materials: {
        panel: '爱格', doorPanel: '钢琴烤漆', doorCraft: '欧式',
        hardware: '海外品牌', lighting: '进口',
      },
    };
    _drawLayoutPage(d, plan);
    const lines = d.calls.filter((c) => c[0] === 'text').map((c) => String(c[1]));
    expect(lines.some((l) => l.includes('板材') && l.includes('爱格'))).toBe(true);
    expect(lines.some((l) => l.includes('柜门面板') && l.includes('钢琴烤漆'))).toBe(true);
    expect(lines.some((l) => l.includes('柜门工艺') && l.includes('欧式'))).toBe(true);
    expect(lines.some((l) => l.includes('五金') && l.includes('海外品牌'))).toBe(true);
    expect(lines.some((l) => l.includes('灯带') && l.includes('进口'))).toBe(true);
  });
  test('falls back to empty strings when materials missing', () => {
    const d = makeDoc();
    expect(() => _drawLayoutPage(d, { name: 'X' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: 2 new failures.

- [ ] **Step 3: Implement _drawLayoutPage**

In `miniprogram/utils/pdf-exporter.js`, **replace** `function _drawLayoutPage(doc, plan) { /* Task 6 */ }` with:

```javascript
function _drawLayoutPage(doc, plan) {
  const W = doc.internal.pageSize.getWidth();
  const m = plan.materials || {};

  doc.setFontSize(18);
  doc.text('布局线框图与板材五金', PAGE_MARGIN, 60);

  const wfX = PAGE_MARGIN;
  const wfY = 80;
  const wfW = W - PAGE_MARGIN * 2;
  const wfH = 360;
  _drawImageOrPlaceholder(doc, plan.wireframeImage, wfX, wfY, wfW, wfH, '无线框图');

  let y = wfY + wfH + 40;
  doc.setFontSize(14);
  doc.text('板材五金', PAGE_MARGIN, y);
  y += 24;
  doc.setFontSize(12);

  const rows = [
    ['板材', m.panel || ''],
    ['柜门面板', m.doorPanel || ''],
    ['柜门工艺', m.doorCraft || ''],
    ['五金', m.hardware || ''],
    ['灯带', m.lighting || ''],
  ];
  rows.forEach((r) => {
    doc.text(`${r[0]}: ${r[1]}`, PAGE_MARGIN, y);
    y += 20;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: all PASS (8 + 2 = 10 total).

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js tests/pdf-exporter.test.js
git commit -m "feat(pdf-exporter): layout & materials page"
```

---

## Task 7: pdf-exporter — cost pages

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`
- Modify: `tests/pdf-exporter.test.js`

**Background:** Cost pages can overflow. We track a `y` cursor; before drawing each cabinet section, we check if its estimated height fits, otherwise `addPage` and reset `y`. The cost data structure (from `utils/cost-engine.js calc`):

```
{
  modules: [
    { label, code, w, h, total, panelCost, hardwareCost,
      detail: { panels: [{name,size,qty,unit,total}], hardware: [{name,qty,unit,total}] } },
    ...
  ],
  grandTotal,
}
```

Filter rows with `qty <= 0` or `total <= 0` (mirrors cost page's `openDetail`).

- [ ] **Step 1: Add failing tests**

Append to `tests/pdf-exporter.test.js`:

```javascript
describe('_drawCostPages', () => {
  const costEngine = require('../miniprogram/utils/cost-engine.js');
  const { _drawCostPages } = require('../miniprogram/utils/pdf-exporter.js');
  function makeDoc() {
    const calls = [];
    return {
      calls,
      pageNumber: 1,
      setFontSize: (...a) => calls.push(['setFontSize', ...a]),
      setFont: (...a) => calls.push(['setFont', ...a]),
      text: (...a) => calls.push(['text', ...a]),
      setFillColor: () => {}, rect: () => {}, setTextColor: () => {},
      addPage: () => { calls.push(['addPage']); },
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    };
  }
  test('renders grand total and at least one module section', () => {
    const cost = costEngine.calc({
      cabinets: [{ label: 'a1', code: 'a01', w: 50, h: 230, kind: 'standard' }],
      materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' },
      wall: { w: 200, h: 250 },
    });
    const plan = { cost, cabinets: [{ label: 'a1', code: 'a01', w: 50, h: 230 }] };
    const d = makeDoc();
    _drawCostPages(d, plan);
    const lines = d.calls.filter((c) => c[0] === 'text').map((c) => String(c[1]));
    expect(lines.some((l) => l.includes('总价'))).toBe(true);
    expect(lines.some((l) => l.includes('a01') || l.includes('a1'))).toBe(true);
  });
  test('does not throw on missing cost', () => {
    const d = makeDoc();
    expect(() => _drawCostPages(d, { cost: null, cabinets: [] })).not.toThrow();
    const lines = d.calls.filter((c) => c[0] === 'text').map((c) => String(c[1]));
    expect(lines.some((l) => l.includes('数据缺失'))).toBe(true);
  });
  test('adds page when content overflows', () => {
    const cost = {
      grandTotal: 99999,
      modules: Array.from({ length: 30 }, (_, i) => ({
        label: 'c' + i, code: 'a01', w: 50, h: 230, total: 1000,
        detail: { panels: [{ name: 'p', size: '1x1', qty: 1, unit: 80, total: 80 }], hardware: [] },
      })),
    };
    const d = makeDoc();
    _drawCostPages(d, { cost, cabinets: [] });
    expect(d.calls.some((c) => c[0] === 'addPage')).toBe(true);
  });
});
```

Note: the test uses real `cost-engine.calc` to validate compatibility with its output shape.

- [ ] **Step 2: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: 3 new failures.

- [ ] **Step 3: Implement _drawCostPages**

In `miniprogram/utils/pdf-exporter.js`, **replace** `function _drawCostPages(doc, plan) { /* Task 7 */ }` with:

```javascript
function _drawCostPages(doc, plan) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const BOTTOM = H - PAGE_MARGIN;
  let y = PAGE_MARGIN + 30;

  const cost = plan.cost;
  if (!cost || !cost.modules || cost.modules.length === 0) {
    doc.setFontSize(14);
    doc.text('成本明细', PAGE_MARGIN, y); y += 24;
    doc.setFontSize(12);
    doc.text('数据缺失', PAGE_MARGIN, y);
    return;
  }

  doc.setFontSize(18);
  doc.text('成本明细', PAGE_MARGIN, y); y += 24;
  doc.setFontSize(14);
  doc.text(`总价: ¥${cost.grandTotal}`, PAGE_MARGIN, y); y += 28;

  const checkPageBreak = (needed) => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = PAGE_MARGIN + 30;
    }
  };

  cost.modules.forEach((m, idx) => {
    checkPageBreak(60);
    doc.setFontSize(13);
    const head = `${idx + 1}. ${m.label || ''} ${m.code || ''}  ${m.w}×${m.h}  小计 ¥${m.total}`;
    doc.text(head, PAGE_MARGIN, y); y += 18;

    const panels = ((m.detail && m.detail.panels) || []).filter((p) => p.qty > 0 && p.total > 0);
    const hardware = ((m.detail && m.detail.hardware) || []).filter((h) => h.qty > 0 && h.total > 0);

    doc.setFontSize(11);
    if (panels.length > 0) {
      checkPageBreak(20);
      doc.text('板材:', PAGE_MARGIN + 10, y); y += 14;
      panels.forEach((p) => {
        checkPageBreak(14);
        doc.text(`  ${p.name}  ${p.size}  x${p.qty}  单价 ${p.unit}  小计 ${p.total}`, PAGE_MARGIN + 20, y);
        y += 14;
      });
    }
    if (hardware.length > 0) {
      checkPageBreak(20);
      doc.text('五金:', PAGE_MARGIN + 10, y); y += 14;
      hardware.forEach((h) => {
        checkPageBreak(14);
        doc.text(`  ${h.name}  x${h.qty}  单价 ${h.unit}  小计 ${h.total}`, PAGE_MARGIN + 20, y);
        y += 14;
      });
    }
    y += 10;
  });
}
```

Also: the cost data is **computed at call site**, not stored on the plan. Tests pass `plan.cost` directly. The page-list integration in Task 11 will call `costEngine.calc(...)` and merge `cost` onto each plan before passing to `exportPlans`.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: all PASS (10 + 3 = 13 total).

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js tests/pdf-exporter.test.js
git commit -m "feat(pdf-exporter): cost pages with overflow handling"
```

---

## Task 8: pdf-exporter — separator page + integration test

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`
- Modify: `tests/pdf-exporter.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/pdf-exporter.test.js`:

```javascript
describe('_drawSeparatorPage', () => {
  const { _drawSeparatorPage } = require('../miniprogram/utils/pdf-exporter.js');
  function makeDoc() {
    const calls = [];
    return {
      calls,
      setFontSize: (...a) => calls.push(['setFontSize', ...a]),
      setFont: () => {},
      text: (...a) => calls.push(['text', ...a]),
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    };
  }
  test('renders plan name and N / total', () => {
    const d = makeDoc();
    _drawSeparatorPage(d, { name: '次卧衣柜' }, 2, 3);
    const lines = d.calls.filter((c) => c[0] === 'text').map((c) => String(c[1]));
    expect(lines.some((l) => l.includes('次卧衣柜'))).toBe(true);
    expect(lines.some((l) => l.includes('2') && l.includes('3'))).toBe(true);
  });
});

describe('exportPlans integration', () => {
  const { exportPlans } = require('../miniprogram/utils/pdf-exporter.js');
  test('multi-plan run produces a filePath without throwing', async () => {
    const plans = [
      { id: 'p1', name: 'A', wall: { w: 200, h: 250 }, cornerLabel: '无转角', materials: {}, cabinets: [], previewImage: '', wireframeImage: '', photoPath: '', cost: { modules: [], grandTotal: 0 } },
      { id: 'p2', name: 'B', wall: { w: 300, h: 270 }, cornerLabel: '左转角', materials: {}, cabinets: [], previewImage: '', wireframeImage: '', photoPath: '', cost: { modules: [], grandTotal: 0 } },
    ];
    const filePath = await exportPlans(plans, 'multi.pdf');
    expect(filePath).toMatch(/multi\.pdf$/);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: 2 new failures (separator page test fails; integration test runs but separator-related calls missing).

- [ ] **Step 3: Implement _drawSeparatorPage**

In `miniprogram/utils/pdf-exporter.js`, **replace** `function _drawSeparatorPage(doc, plan, idx, total) { /* Task 8 */ }` with:

```javascript
function _drawSeparatorPage(doc, plan, idx, total) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFontSize(48);
  doc.text(String(plan.name || ''), W / 2, H / 2, { align: 'center' });
  doc.setFontSize(14);
  doc.text(`方案 ${idx} / ${total}`, W / 2, H / 2 + 40, { align: 'center' });
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/pdf-exporter.test.js`
Expected: all PASS (13 + 2 = 15 total).

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js tests/pdf-exporter.test.js
git commit -m "feat(pdf-exporter): separator page and multi-plan integration"
```

---

## Task 9: plan-select-modal component

**Files:**
- Create: `miniprogram/components/plan-select-modal/index.js`
- Create: `miniprogram/components/plan-select-modal/index.wxml`
- Create: `miniprogram/components/plan-select-modal/index.wxss`
- Create: `miniprogram/components/plan-select-modal/index.json`

- [ ] **Step 1: Create index.json**

```json
{ "component": true, "usingComponents": {} }
```

- [ ] **Step 2: Create index.js**

```javascript
Component({
  properties: {
    visible: { type: Boolean, value: false },
    plans: { type: Array, value: [] },
  },
  data: { selectedIds: [] },
  observers: {
    'visible, plans': function (visible) {
      if (visible) this.setData({ selectedIds: [] });
    },
  },
  computed: {},
  methods: {
    onToggle(e) {
      const id = e.currentTarget.dataset.id;
      const selectedIds = this.data.selectedIds.slice();
      const idx = selectedIds.indexOf(id);
      if (idx >= 0) selectedIds.splice(idx, 1); else selectedIds.push(id);
      this.setData({ selectedIds });
    },
    onToggleAll() {
      const all = this.data.plans.map((p) => p.id);
      const isAll = this.data.selectedIds.length === all.length;
      this.setData({ selectedIds: isAll ? [] : all });
    },
    onCancel() { this.triggerEvent('cancel'); },
    onConfirm() {
      if (this.data.selectedIds.length === 0) return;
      this.triggerEvent('confirm', { ids: this.data.selectedIds.slice() });
    },
    _checked(id) { return this.data.selectedIds.indexOf(id) >= 0; },
  },
});
```

- [ ] **Step 3: Create index.wxml**

```xml
<view class="psm" wx:if="{{visible}}">
  <view class="psm-mask" bindtap="onCancel"></view>
  <view class="psm-card">
    <view class="psm-title">选择要导出的方案</view>
    <view class="psm-all" bindtap="onToggleAll">
      <view class="psm-checkbox {{selectedIds.length === plans.length && plans.length ? 'on' : ''}}"></view>
      <text>全选 ({{selectedIds.length}}/{{plans.length}})</text>
    </view>
    <scroll-view class="psm-list" scroll-y="{{true}}">
      <view class="psm-row" wx:for="{{plans}}" wx:key="id" data-id="{{item.id}}" bindtap="onToggle">
        <view class="psm-checkbox {{selectedIds.indexOf(item.id) >= 0 ? 'on' : ''}}"></view>
        <view class="psm-row-main">
          <view class="psm-row-name">{{item.name}}</view>
          <view class="psm-row-meta">{{item.wall.w}}×{{item.wall.h}}cm · {{item.cornerLabel}} · {{item.cabinetCount}} 个柜子</view>
        </view>
      </view>
    </scroll-view>
    <view class="psm-actions">
      <view class="psm-btn" bindtap="onCancel">取消</view>
      <view class="psm-btn primary {{selectedIds.length === 0 ? 'disabled' : ''}}" bindtap="onConfirm">下一步</view>
    </view>
  </view>
</view>
```

- [ ] **Step 4: Create index.wxss**

```css
.psm { position: fixed; inset: 0; z-index: 200; }
.psm-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
.psm-card {
  position: absolute; left: 50%; bottom: 0;
  transform: translateX(-50%);
  width: 100%; max-height: 75vh;
  background: #fff; border-radius: 24rpx 24rpx 0 0;
  padding: 40rpx 40rpx 32rpx; display: flex; flex-direction: column;
}
.psm-title { font-size: 34rpx; font-weight: 500; margin-bottom: 24rpx; }
.psm-all { display: flex; align-items: center; gap: 20rpx; margin-bottom: 16rpx; font-size: 28rpx; color: #4b5563; }
.psm-list { flex: 1; }
.psm-row { display: flex; align-items: center; gap: 20rpx; padding: 24rpx 0; border-bottom: 1rpx solid #f3f4f6; }
.psm-row-main { flex: 1; }
.psm-row-name { font-size: 30rpx; color: #1f2937; }
.psm-row-meta { font-size: 24rpx; color: #9ca3af; margin-top: 8rpx; }
.psm-checkbox { width: 36rpx; height: 36rpx; border: 2rpx solid #d1d5db; border-radius: 8rpx; flex-shrink: 0; }
.psm-checkbox.on { background: #1f2937; border-color: #1f2937; position: relative; }
.psm-checkbox.on::after {
  content: ''; position: absolute; left: 8rpx; top: 2rpx;
  width: 10rpx; height: 18rpx; border: solid #fff7c2; border-width: 0 4rpx 4rpx 0; transform: rotate(45deg);
}
.psm-actions { display: flex; gap: 24rpx; margin-top: 24rpx; }
.psm-btn { flex: 1; padding: 22rpx 0; border-radius: 999rpx; background: #f3f4f6; color: #4b5563; font-size: 30rpx; text-align: center; }
.psm-btn.primary { background: #1f2937; color: #fff7c2; }
.psm-btn.disabled { opacity: 0.45; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/components/plan-select-modal/
git commit -m "feat(component): plan-select-modal"
```

---

## Task 10: filename-input-modal component

**Files:**
- Create: `miniprogram/components/filename-input-modal/index.js`
- Create: `miniprogram/components/filename-input-modal/index.wxml`
- Create: `miniprogram/components/filename-input-modal/index.wxss`
- Create: `miniprogram/components/filename-input-modal/index.json`

- [ ] **Step 1: Create index.json**

```json
{ "component": true, "usingComponents": {} }
```

- [ ] **Step 2: Create index.js**

```javascript
Component({
  properties: {
    visible: { type: Boolean, value: false },
    defaultValue: { type: String, value: '我的衣柜方案.pdf' },
  },
  data: { value: '' },
  observers: {
    'visible, defaultValue': function (visible, def) {
      if (visible) this.setData({ value: def });
    },
  },
  methods: {
    onInput(e) { this.setData({ value: e.detail.value }); },
    onCancel() { this.triggerEvent('cancel'); },
    onConfirm() { this.triggerEvent('confirm', { value: this.data.value }); },
  },
});
```

- [ ] **Step 3: Create index.wxml**

```xml
<view class="fim" wx:if="{{visible}}">
  <view class="fim-mask" bindtap="onCancel"></view>
  <view class="fim-card">
    <view class="fim-title">PDF 文件名</view>
    <input class="fim-input" value="{{value}}" placeholder="我的衣柜方案.pdf" bindinput="onInput" />
    <view class="fim-actions">
      <view class="fim-btn" bindtap="onCancel">取消</view>
      <view class="fim-btn primary" bindtap="onConfirm">确认导出</view>
    </view>
  </view>
</view>
```

- [ ] **Step 4: Create index.wxss**

```css
.fim { position: fixed; inset: 0; z-index: 210; }
.fim-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
.fim-card {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 560rpx; background: #fff; border-radius: 24rpx; padding: 48rpx 40rpx 32rpx;
}
.fim-title { font-size: 34rpx; font-weight: 500; margin-bottom: 24rpx; text-align: center; }
.fim-input { border: 2rpx solid #e5e7eb; border-radius: 14rpx; padding: 20rpx 24rpx; font-size: 28rpx; margin-bottom: 32rpx; }
.fim-actions { display: flex; gap: 24rpx; }
.fim-btn { flex: 1; padding: 22rpx 0; border-radius: 999rpx; background: #f3f4f6; color: #4b5563; font-size: 30rpx; text-align: center; }
.fim-btn.primary { background: #1f2937; color: #fff7c2; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/components/filename-input-modal/
git commit -m "feat(component): filename-input-modal"
```

---

## Task 11: Wire plan-list page to the export flow

**Files:**
- Modify: `miniprogram/pages/plan-list/index.json`
- Modify: `miniprogram/pages/plan-list/index.wxml`
- Modify: `miniprogram/pages/plan-list/index.wxss`
- Modify: `miniprogram/pages/plan-list/index.js`

- [ ] **Step 1: Register components in index.json**

Replace `miniprogram/pages/plan-list/index.json` with:

```json
{
  "navigationBarTitleText": "我的设计方案",
  "usingComponents": {
    "cabinet-toast": "/components/cabinet-toast/index",
    "plan-select-modal": "/components/plan-select-modal/index",
    "filename-input-modal": "/components/filename-input-modal/index"
  }
}
```

- [ ] **Step 2: Add export button + modals to index.wxml**

In `miniprogram/pages/plan-list/index.wxml`, find the `<cabinet-toast text="{{toast}}"></cabinet-toast>` line. Before it, after the `</view>` that closes `confirmDelete` modal, insert:

```xml
  <view class="export-btn-wrap" wx:if="{{plans.length}}">
    <view class="export-btn" bindtap="onTapExport">导出方案信息</view>
  </view>

  <plan-select-modal
    visible="{{exportSelectOpen}}"
    plans="{{plans}}"
    bind:cancel="onExportSelectCancel"
    bind:confirm="onExportSelectConfirm">
  </plan-select-modal>

  <filename-input-modal
    visible="{{exportNameOpen}}"
    bind:cancel="onExportNameCancel"
    bind:confirm="onExportNameConfirm">
  </filename-input-modal>
```

- [ ] **Step 3: Add button styles to index.wxss**

Append to `miniprogram/pages/plan-list/index.wxss`:

```css
.export-btn-wrap { padding: 16rpx 32rpx 40rpx; }
.export-btn {
  background: #fff;
  border: 2rpx solid #1f2937;
  color: #1f2937;
  font-size: 30rpx;
  border-radius: 999rpx;
  padding: 22rpx 0;
  text-align: center;
}
.export-btn:active { background: #f3f4f6; }
```

- [ ] **Step 4: Add export handlers to index.js**

Replace `miniprogram/pages/plan-list/index.js` with:

```javascript
const planStore = require('../../utils/plan-store.js');
const cloud = require('../../utils/cloud.js');
const pdfExporter = require('../../utils/pdf-exporter.js');
const filenameCleaner = require('../../utils/filename-cleaner.js');
const costEngine = require('../../utils/cost-engine.js');

Page({
  data: {
    plans: [],
    confirmDelete: null,
    toast: '',
    exportSelectOpen: false,
    exportNameOpen: false,
    _selectedExportIds: [],
  },

  onShow() {
    const plans = planStore.list();
    this.setData({ plans });
    cloud.listPlans().then((res) => {
      if (res.ok && res.data && res.data.success) {
        // 简单合并：以本地为主
      }
    });
  },

  onTapStart() {
    if (planStore.isFull()) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    getApp().globalData.draftPlan = null;
    wx.navigateTo({ url: '/pages/space-setup/index' });
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const plan = planStore.get(id);
    if (!plan) return;
    getApp().globalData.currentPlan = plan;
    wx.navigateTo({
      url: '/pages/materials/index?from=list&id=' + id,
    });
  },

  onAskDelete(e) {
    const id = e.currentTarget.dataset.id;
    const plan = planStore.get(id);
    if (!plan) return;
    this.setData({ confirmDelete: { id, name: plan.name } });
  },

  onConfirmDeleteCancel() {
    this.setData({ confirmDelete: null });
  },

  onConfirmDeleteOk() {
    const id = this.data.confirmDelete && this.data.confirmDelete.id;
    if (id) {
      planStore.remove(id);
      this.setData({
        plans: planStore.list(),
        confirmDelete: null,
      });
    }
  },

  onTapExport() {
    if (!this.data.plans.length) return;
    this.setData({ exportSelectOpen: true });
  },

  onExportSelectCancel() {
    this.setData({ exportSelectOpen: false });
  },

  onExportSelectConfirm(e) {
    this.setData({
      exportSelectOpen: false,
      exportNameOpen: true,
      _selectedExportIds: e.detail.ids || [],
    });
  },

  onExportNameCancel() {
    this.setData({ exportNameOpen: false, _selectedExportIds: [] });
  },

  onExportNameConfirm(e) {
    const fileName = filenameCleaner.cleanFileName(e.detail.value);
    const ids = this.data._selectedExportIds || [];
    this.setData({ exportNameOpen: false, _selectedExportIds: [] });
    if (!ids.length) return;

    const plans = ids
      .map((id) => planStore.get(id))
      .filter(Boolean)
      .map((p) => Object.assign({}, p, {
        cost: costEngine.calc({
          cabinets: p.cabinets || [],
          materials: p.materials || {},
          wall: p.wall || {},
        }),
      }));

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    pdfExporter.exportPlans(plans, fileName).then((filePath) => {
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (err) => {
          wx.showModal({
            title: '预览失败',
            content: 'PDF 已生成在 ' + filePath + '\n错误: ' + (err && err.errMsg),
            showCancel: false,
          });
        },
      });
    }).catch((err) => {
      wx.hideLoading();
      console.error('exportPlans failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    });
  },

  showToast(msg) {
    this.setData({ toast: msg });
    setTimeout(() => this.setData({ toast: '' }), 2000);
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/plan-list/index.json miniprogram/pages/plan-list/index.wxml miniprogram/pages/plan-list/index.wxss miniprogram/pages/plan-list/index.js
git commit -m "feat(plan-list): wire PDF export button + modals + handler"
```

---

## Task 12: Manual smoke test in the WeChat DevTools

**Files:** none modified.

- [ ] **Step 1: Open project in WeChat DevTools**

Open `D:/工程/柠檬塔/程序/LemonTA-minor` in the WeChat developer tool, click "工具 → 构建 npm" (the project uses npm), then re-compile.

- [ ] **Step 2: Confirm the "导出方案信息" button shows**

Navigate to the "我的设计" page. With at least one saved plan, the button should appear below the list. With none, the empty state should still render.

- [ ] **Step 3: Single-plan export**

Tap the button → modal opens → select one plan → 下一步 → keep default filename → 确认导出. Verify:
- Loading toast shows.
- After a few seconds the WeChat document preview opens.
- The PDF title page shows the plan name.
- Subsequent pages show photo (or placeholder), wireframe (or placeholder), materials, cost.
- Chinese text renders correctly (no boxes/garbled chars).

- [ ] **Step 4: Multi-plan export**

Save at least 3 plans (or simulate via existing). Tap export → 全选 → 下一步 → change filename to "测试导出.pdf" → 确认导出. Verify:
- PDF has separator page between plans showing "方案 N / 总数".
- Filename in preview header reads `测试导出.pdf`.

- [ ] **Step 5: Real device test**

Open via "预览" → scan QR code → run the same flow on at least one iOS and (if available) one Android device. Note any rendering differences.

- [ ] **Step 6: Document outcome**

Add brief findings to `docs/superpowers/specs/2026-06-27-pdf-export-design.md` under a new "Test results" section if any deviations from the spec emerge.

No commit unless docs were modified.

---

## Self-Review Notes

The plan was reviewed against the spec:

- **空间照片**: covered by `_drawOverviewPage` Step 5 in Task 5.
- **墙体尺寸**: covered (subtitle line + info block in Task 5).
- **转角加高标志**: covered (subtitle suffix and info row in Task 5).
- **衣柜布局预览截图**: covered (overview page bottom in Task 5).
- **衣柜布局线框图**: covered in Task 6.
- **选择的板材五金信息**: covered in Task 6 (5 rows).
- **成本报表（全部明细）**: covered in Task 7 with grand total + per-cabinet panels & hardware filtered tables.
- **导出按钮**: Task 11.
- **PDF 命名**: Task 3 (cleaner) + Task 11 (wiring).
- **错误处理**: image fallback in Task 5; missing cost handled in Task 7; export failure caught in Task 11.
- **wx.openDocument 失败**: Task 11 fail callback.
- **测试**: Tasks 3–8 have unit tests; Task 12 has manual smoke tests.

Type consistency check: `exportPlans` signature `(plans, fileName) → Promise<filePath>` is used identically in Tasks 4, 8, 11. Component event names `cancel` / `confirm` consistent in Tasks 9–11. Method names on doc (addImage, rect, text) match jsPDF API.

No placeholders, no "similar to Task N", no missing code.
