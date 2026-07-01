# 衣柜模型选择区 3D 缩略图 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pages/design/` 下方 picker-bar 里的 `.model-thumb` 不再是纯色块，而是每种柜型一张实时 3D 渲染的预览图，颜色跟随上方色卡。

**Architecture:** `three-renderer.js` 拆出 `initRoom` / `initPreview` / `renderSingle` 三个对外入口（同 class，共用 GLB 加载/材质/边线工具）。新增 `utils/thumb-generator.js` 调度器：用一块隐藏 webgl canvas 顺序渲染每种柜型 → `wx.canvasToTempFilePath` 截图 → 增量回传 url。设计页加隐藏 canvas + thumb 里 `<image>` + 占位回退。换色重渲时旧 thumb 留着不闪烁，新 thumb 渲完依次覆盖（key 不带颜色，新 url 直接覆盖旧 url）。

**Tech Stack:** threejs-miniprogram, WeChat mini-program WebGL canvas, `wx.canvasToTempFilePath`, `wx.createSelectorQuery`。

**项目无 git**——本计划不含 `git commit` 步骤；如后续接入 git，再补 commit 节奏。

**Spec 参考:** `docs/superpowers/specs/2026-06-24-cabinet-thumb-preview-design.md`

---

## 任务概览

| # | 任务 | 涉及文件 |
|---|------|----------|
| 1 | renderer 拆出 `initRoom` 入口（不动行为，重命名+保留旧入口） | `miniprogram/utils/three-renderer.js` |
| 2 | renderer 加 `initPreview` + `renderSingle`（新增 preview 模式） | `miniprogram/utils/three-renderer.js` |
| 3 | 新建 `thumb-generator.js` 骨架 + 纯逻辑单测（token / cache key / 队列） | `miniprogram/utils/thumb-generator.js`、`tests/run.js` |
| 4 | thumb-generator 接 renderer + `wx.canvasToTempFilePath` 出图 | `miniprogram/utils/thumb-generator.js` |
| 5 | design 页加隐藏 canvas + thumb 内 `<image>` + 占位 | `miniprogram/pages/design/index.wxml` |
| 6 | 隐藏 canvas + thumb image 样式 | `miniprogram/pages/design/index.wxss` |
| 7 | design 页 JS 接入 generator（onReady / onPickColor / onUnload） | `miniprogram/pages/design/index.js` |
| 8 | 真机/工具视觉验证 + 预览角度光照微调 | （只调参数，不改架构） |

---

## Task 1: renderer 拆出 `initRoom` 入口

**Files:**
- Modify: `miniprogram/utils/three-renderer.js`（重命名 `init` 为 `initRoom`，保留 `init` 作为兼容 alias）

**目的：** 为后续加 `initPreview` 做准备，且不破坏当前 design 页的调用。

- [ ] **Step 1.1: 把 `init` 重命名为 `initRoom`，再补一个 `init` 兼容方法**

打开 `miniprogram/utils/three-renderer.js`，找到 `init(canvas, sizeInfo, opts)` 方法（约第 37 行）。把方法名改为 `initRoom`，方法体不动。在 `initRoom` 之后立刻加一个兼容方法：

```js
  // 兼容旧调用：保留 init 作为 initRoom 的别名，待所有调用方迁移完毕后可移除
  init(canvas, sizeInfo, opts) {
    return this.initRoom(canvas, sizeInfo, opts);
  }
```

- [ ] **Step 1.2: 跑一次现有 Node 测试，确保 utils 类纯逻辑没受影响**

Run: `node tests/run.js`
Expected: 全部 `✓`，没有 `✗`（这一步只是回归确认，因为 three-renderer.js 不被 Node 测试加载，应该全过）

- [ ] **Step 1.3: 手动验证 design 页 3D 主画布仍正常**

打开微信开发者工具，编译 → 进入 design 页（先在 plan-list 新建一个方案 → 空间设置 → 设计）。
Expected：3D 房间和柜体正常渲染，无报错。Console 出现 `[3D] init done, wall ... × ...`。

---

## Task 2: renderer 加 `initPreview` + `renderSingle`

**Files:**
- Modify: `miniprogram/utils/three-renderer.js`（新增 `initPreview`、`renderSingle`、内部 `_buildPreviewLights`、`_clearPreviewCabinet`）

**目的：** 单柜预览模式：无房间、固定俯视角度、简化光照、可清掉旧柜加载新柜。

- [ ] **Step 2.1: 在 ThreeRenderer 类里加 `initPreview` 方法**

放在 `initRoom` 方法之后。逻辑参照 `initRoom` 但跳过 `_buildRoom`，灯光用简化版，背景透明：

```js
  // 预览画布：无房间、透明背景、固定俯视角度、简化光照
  // 用法：r.initPreview(canvas, { cssWidth, cssHeight, dpr }) 一次；之后 r.renderSingle(item, color) 多次
  initPreview(canvas, sizeInfo) {
    this.canvas = canvas;
    this._isPreview = true;

    const dpr = sizeInfo.dpr || 1;
    const w = Math.floor(sizeInfo.cssWidth * dpr);
    const h = Math.floor(sizeInfo.cssHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    console.log('[3D-preview] canvas buffer', w, 'x', h, 'css', sizeInfo.cssWidth, 'x', sizeInfo.cssHeight);

    const THREE = createScopedThreejs(canvas);
    this.THREE = THREE;
    attachGLTFLoader(THREE);
    this.gltfLoader = new THREE.GLTFLoader();

    const scene = new THREE.Scene();
    scene.background = null; // 透明，让 CSS 浅底色透出
    this.scene = scene;

    // 相机参数会在 renderSingle 时根据柜体尺寸刷新；这里先建一个占位
    const aspect = w / h || 1;
    this.camera = new THREE.PerspectiveCamera(35, aspect, 1, 2000);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0); // 完全透明
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;

    // preview 用一个独立 group 放当前柜体，便于 clear/replace
    const previewGroup = new THREE.Group();
    scene.add(previewGroup);
    this._previewGroup = previewGroup;

    this._buildPreviewLights();
  }
```

- [ ] **Step 2.2: 加 `_buildPreviewLights` 简化灯光（3 盏）**

放在 `_buildLights` 之后：

```js
  // preview 模式专用：3 盏简化灯，够照出柜体结构即可，不投阴影
  _buildPreviewLights() {
    const THREE = this.THREE;
    this.scene.add(new THREE.AmbientLight(0xfff1d6, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e0, 0.9);
    key.position.set(120, 220, 200);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xeef3ff, 0.35);
    fill.position.set(-150, 100, 150);
    this.scene.add(fill);
  }
```

- [ ] **Step 2.3: 加 `_clearPreviewCabinet` 清掉 group 里旧的柜体 mesh**

放在 `_buildPreviewLights` 之后：

```js
  _clearPreviewCabinet() {
    if (!this._previewGroup) return;
    const old = this._previewGroup.children.slice();
    old.forEach((child) => {
      this._previewGroup.remove(child);
      // 递归释放 GPU 资源
      child.traverse && child.traverse((n) => {
        if (n.geometry && n.geometry.dispose) n.geometry.dispose();
        if (n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach((m) => m && m.dispose && m.dispose());
        }
      });
    });
  }
```

- [ ] **Step 2.4: 加 `renderSingle` 加载并渲染单柜**

放在 `_clearPreviewCabinet` 之后：

```js
  // 加载单个柜型、按 color 着色、render 一帧；resolve 表示帧已渲染好可被截图
  // item 形如 { code, w, h, kind = 'standard' }
  async renderSingle(item, colorId) {
    if (!this._isPreview) throw new Error('renderSingle only available in preview mode');
    this._clearPreviewCabinet();

    const mesh = await this._loadItemMesh(item);
    if (!mesh) return;

    const THREE = this.THREE;
    const group = new THREE.Group();
    group.add(mesh);

    // 沿用 room 模式的等比缩放/居中逻辑
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const CABINET_DEPTH_CM = 60;
    const sx = size.x > 0.001 ? item.w / size.x : 1;
    const sy = size.y > 0.001 ? item.h / size.y : 1;
    const sz = size.z > 0.001 ? CABINET_DEPTH_CM / size.z : 1;
    mesh.scale.set(sx, sy, sz);
    const bbox2 = new THREE.Box3().setFromObject(mesh);
    mesh.position.y -= bbox2.min.y;
    mesh.position.x -= (bbox2.min.x + bbox2.max.x) / 2;
    mesh.position.z -= (bbox2.min.z + bbox2.max.z) / 2;

    this._stripNonGeometryNodes(group);
    this._normalizeMaterials(group);
    this._applyColor(group, COLOR_HEX[colorId] || COLOR_HEX.white);
    this._applyEdges(group);
    this._applyDoorVisibility(group);

    // 让柜体下底齐 y=0，并整体后挪一点点，让相机看着不顶到镜头
    group.position.set(0, 0, 0);
    // 固定一个略带俯视/侧视的角度
    group.rotation.set(-0.15, 0.35, 0);

    this._previewGroup.add(group);

    // 根据柜体尺寸刷新相机：focal 在柜体几何中心，距离正比于对角线
    const diag = Math.sqrt(item.w * item.w + item.h * item.h + CABINET_DEPTH_CM * CABINET_DEPTH_CM);
    const dist = diag * 1.6;
    this.camera.position.set(dist * 0.45, item.h * 0.55, dist * 0.85);
    this.camera.lookAt(0, item.h * 0.45, 0);
    this.camera.updateProjectionMatrix && this.camera.updateProjectionMatrix();

    // 渲一帧（同步），便于 wx.canvasToTempFilePath 立刻能取到画面
    this.renderer.render(this.scene, this.camera);
  }
```

> `COLOR_HEX` 复用模块顶部（约第 7 行）那个常量。

- [ ] **Step 2.5: 跑现有 Node 测试，确保未触发 require 解析错误**

Run: `node tests/run.js`
Expected: 全部 `✓`。

- [ ] **Step 2.6: 手动验证主画布仍正常（preview 代码已加但未启用）**

微信开发者工具编译 → design 页：3D 主画布与之前一致，console 无新 warn/error。

---

## Task 3: 新建 `thumb-generator.js` 骨架 + 纯逻辑单测

**Files:**
- Create: `miniprogram/utils/thumb-generator.js`
- Create: `tests/thumb-generator.test.js`（独立文件，避免动 `tests/run.js` 的 sync `process.exit` 结尾）

**目的：** 调度器：维护任务队列、token 比对取消并发、key 缓存。**不依赖 wx.\* 或 renderer**，先把纯逻辑写出来并测掉。

- [ ] **Step 3.1: 写 `thumb-generator.js` 骨架（无 wx.* 依赖）**

新建 `miniprogram/utils/thumb-generator.js`：

```js
// 衣柜模型缩略图生成器（调度器）
// 仅负责：任务队列、token 取消并发、增量回调。
// 实际的"渲染一帧 + 截图"由注入的 captureOne 函数完成（便于单测与平台适配）。

class ThumbGenerator {
  // opts:
  //   models: [{ code, w, h, kind }]
  //   captureOne: async (item, colorId) => tempFilePath
  //               注入函数；内部应调用 renderer.renderSingle + wx.canvasToTempFilePath
  //   onThumbReady: (key, tempFilePath) => void
  //   onError: (key, error) => void  可选
  constructor(opts) {
    this.models = opts.models || [];
    this.captureOne = opts.captureOne;
    this.onThumbReady = opts.onThumbReady || (() => {});
    this.onError = opts.onError || (() => {});
    this._cache = {};           // key -> tempFilePath
    this._currentToken = 0;     // 每次 start/regenerate 自增；旧任务过期忽略
    this._disposed = false;
  }

  static keyOf(item) {
    return `${item.code}_${item.w}`;
  }

  // 启动一次完整渲染：按 models 顺序逐个出图
  // 不清空 _cache：保证换色期间旧 url 仍然挂在 image 上不闪烁
  start(colorId) {
    if (this._disposed) return;
    const token = ++this._currentToken;
    this._runQueue(token, colorId);
  }

  // 色卡变化：开启新一轮渲染。旧任务通过 token 比对自动作废。
  regenerateForColor(colorId) {
    this.start(colorId);
  }

  async _runQueue(token, colorId) {
    for (const item of this.models) {
      if (this._disposed) return;
      if (token !== this._currentToken) return; // 被新一轮取消
      try {
        const tempPath = await this.captureOne(item, colorId);
        if (this._disposed) return;
        if (token !== this._currentToken) return;
        const key = ThumbGenerator.keyOf(item);
        this._cache[key] = tempPath;
        this.onThumbReady(key, tempPath);
      } catch (e) {
        this.onError(ThumbGenerator.keyOf(item), e);
        // 单个失败不阻塞后续
      }
    }
  }

  getCachedUrl(item) {
    return this._cache[ThumbGenerator.keyOf(item)];
  }

  dispose() {
    this._disposed = true;
    this._currentToken++; // 让所有 in-flight 任务作废
    this._cache = {};
  }
}

module.exports = ThumbGenerator;
```

- [ ] **Step 3.2: 创建独立测试文件 `tests/thumb-generator.test.js`**

```js
// Async-friendly assertion tests for ThumbGenerator. Run: `node tests/thumb-generator.test.js`

const path = require('path');
const ThumbGenerator = require(path.resolve(__dirname, '../miniprogram/utils/thumb-generator.js'));

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.log('  ✗ ' + msg);
    console.log('    expected: ' + JSON.stringify(expected));
    console.log('    actual:   ' + JSON.stringify(actual));
  }
}

function truthy(v, msg) {
  if (v) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  console.log('\nThumbGenerator');

  // keyOf 拼装
  eq(ThumbGenerator.keyOf({ code: 'a', w: 50 }), 'a_50', 'keyOf 拼装 code_w');

  // 顺序渲染：onThumbReady 按 models 顺序回调
  {
    const calls = [];
    const captures = [];
    const gen = new ThumbGenerator({
      models: [
        { code: 'a', w: 50 },
        { code: 'b', w: 50 },
        { code: 'c', w: 50 },
      ],
      captureOne: async (item, colorId) => {
        captures.push(`${item.code}-${colorId}`);
        return `/tmp/${item.code}_${item.w}_${colorId}.png`;
      },
      onThumbReady: (key, url) => calls.push(`${key}=${url}`),
    });
    gen.start('white');
    await wait(30);
    eq(captures, ['a-white', 'b-white', 'c-white'], '顺序调用 captureOne');
    eq(
      calls,
      ['a_50=/tmp/a_50_white.png', 'b_50=/tmp/b_50_white.png', 'c_50=/tmp/c_50_white.png'],
      'onThumbReady 按顺序回调，url 入参正确'
    );
    eq(gen.getCachedUrl({ code: 'b', w: 50 }), '/tmp/b_50_white.png', 'getCachedUrl 返回缓存');
  }

  // token 取消：连续 regenerate，旧任务作废，新任务才回调
  {
    const calls2 = [];
    let resolveSlow;
    const gen2 = new ThumbGenerator({
      models: [{ code: 'a', w: 50 }, { code: 'b', w: 50 }],
      captureOne: (item, colorId) => {
        if (colorId === 'old') {
          if (item.code === 'a') return Promise.resolve('/old/a.png');
          return new Promise((r) => { resolveSlow = () => r('/old/b.png'); });
        }
        return Promise.resolve(`/new/${item.code}.png`);
      },
      onThumbReady: (key, url) => calls2.push(`${key}=${url}`),
    });
    gen2.start('old');
    await wait(10);
    eq(calls2, ['a_50=/old/a.png'], '第一项已回调，第二项仍卡着');
    gen2.regenerateForColor('new');
    await wait(10);
    resolveSlow && resolveSlow();
    await wait(30);
    eq(
      calls2,
      ['a_50=/old/a.png', 'a_50=/new/a.png', 'b_50=/new/b.png'],
      '旧任务被取消，新任务正常回调'
    );
  }

  // dispose 后不再回调
  {
    const calls3 = [];
    const gen3 = new ThumbGenerator({
      models: [{ code: 'a', w: 50 }, { code: 'b', w: 50 }],
      captureOne: async (item) => {
        await wait(5);
        return `/x/${item.code}.png`;
      },
      onThumbReady: (key) => calls3.push(key),
    });
    gen3.start('white');
    await wait(8);
    gen3.dispose();
    await wait(30);
    truthy(calls3.length <= 1, 'dispose 后停止回调（至多收到当前正在跑的那 1 个）');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
```

- [ ] **Step 3.3: 运行测试，确认全部通过**

Run: `node tests/thumb-generator.test.js`
Expected: 5 条 ThumbGenerator 测试 `✓`，summary 行 `5 passed, 0 failed`。

并跑一次原有 `node tests/run.js` 确认未被波及：全过。

---

## Task 4: thumb-generator 接 renderer + `wx.canvasToTempFilePath` 出图

**Files:**
- Modify: `miniprogram/utils/thumb-generator.js`（加一个 helper：从 renderer + canvas + wx 构造 `captureOne`）

**目的：** 在 generator 层提供"用真实 renderer 出图"的封装，让设计页只管传入 renderer / canvas / wx 即可。

- [ ] **Step 4.1: 在 thumb-generator.js 加 `createCaptureOne` 工厂函数**

在 `module.exports = ThumbGenerator;` 之前加：

```js
// 工厂：用 (renderer, canvas) 造一个能直接传进 ThumbGenerator 的 captureOne。
// 调用方需保证 renderer 已经 initPreview(canvas, ...) 过。
// wxApi 默认从全局 wx 取，便于单测时注入 mock。
function createCaptureOne(renderer, canvas, wxApi) {
  const W = wxApi || (typeof wx !== 'undefined' ? wx : null);
  if (!W) throw new Error('wx API not available');
  return async function captureOne(item, colorId) {
    await renderer.renderSingle(item, colorId);
    return new Promise((resolve, reject) => {
      W.canvasToTempFilePath({
        canvas,
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => reject(err),
      });
    });
  };
}

ThumbGenerator.createCaptureOne = createCaptureOne;
```

- [ ] **Step 4.2: 在 `tests/thumb-generator.test.js` 的 dispose block 之后追加 `createCaptureOne` 单测**

在 `console.log(`\n${passed} passed, ${failed} failed`);` 这一行之前插入：

```js
  // createCaptureOne：依次调 renderSingle 再 canvasToTempFilePath
  {
    const callsRender = [];
    const fakeRenderer = {
      renderSingle: async (item, colorId) => {
        callsRender.push(`r:${item.code}-${colorId}`);
      },
    };
    const fakeCanvas = { __id: 'cv' };
    const fakeWx = {
      canvasToTempFilePath: ({ canvas, success }) => {
        callsRender.push(`c:${canvas.__id}`);
        success({ tempFilePath: '/wx/tmp.png' });
      },
    };
    const capture = ThumbGenerator.createCaptureOne(fakeRenderer, fakeCanvas, fakeWx);
    const tempPath = await capture({ code: 'a', w: 50 }, 'beige');
    eq(callsRender, ['r:a-beige', 'c:cv'], 'createCaptureOne 先渲染再截图');
    eq(tempPath, '/wx/tmp.png', 'createCaptureOne 返回 wx 给的 tempFilePath');
  }
```

- [ ] **Step 4.3: 运行测试，确认通过**

Run: `node tests/thumb-generator.test.js`
Expected: 新增 2 条 assertion 全 `✓`，summary `7 passed, 0 failed`。

---

## Task 5: design 页 WXML 加隐藏 canvas + thumb 内 `<image>`

**Files:**
- Modify: `miniprogram/pages/design/index.wxml`

**目的：** 让生成器有 canvas 节点可渲染；让 thumb 能显示 image 又能回退到占位色块。

- [ ] **Step 5.1: 替换 `.model-thumb` 的内部结构**

找到（约第 50 行）：

```html
        <view class="model-thumb" style="background:{{colorCss}}"></view>
```

替换为：

```html
        <view class="model-thumb">
          <image
            wx:if="{{thumbUrls[item.code + '_' + item.w]}}"
            class="model-thumb-img"
            src="{{thumbUrls[item.code + '_' + item.w]}}"
            mode="aspectFit"
          />
          <view
            wx:else
            class="model-thumb-placeholder"
            style="background:{{colorCss}}"
          ></view>
        </view>
```

- [ ] **Step 5.2: 在文件末尾、`</view>` 闭合前一行加隐藏 canvas**

找到文件最末的 `</view>`（页面根容器），在它前面加：

```html
  <canvas type="webgl" id="thumb-webgl" class="thumb-canvas-hidden"></canvas>
```

- [ ] **Step 5.3: 手动验证 WXML 编译无报错**

微信开发者工具编译 → design 页：页面布局与之前一致（thumb 还是占位色，因为 thumbUrls 是空对象）。Console 不应有 wxml/wxss 编译错误。

---

## Task 6: 隐藏 canvas + thumb image 样式

**Files:**
- Modify: `miniprogram/pages/design/index.wxss`

- [ ] **Step 6.1: 在文件末尾追加 3 条样式**

打开 `miniprogram/pages/design/index.wxss`，文件最末追加：

```css
.thumb-canvas-hidden {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 200px;
  height: 280px;
  pointer-events: none;
  opacity: 0;
}

.model-thumb-img {
  width: 100%;
  height: 100%;
  border-radius: 6rpx;
}

.model-thumb-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 6rpx;
}
```

> `opacity: 0` 是双保险：即使将来某机型把 `left: -9999px` 也渲染了，也看不见这块 canvas。

- [ ] **Step 6.2: 手动验证 design 页样式没破**

微信开发者工具编译 → design 页：上方画布、ctrl-bar、color-row、picker-bar、action-bar 布局全部正常；picker 里 thumb 仍是占位色块。

---

## Task 7: design 页 JS 接入 ThumbGenerator

**Files:**
- Modify: `miniprogram/pages/design/index.js`

**目的：** onReady 后初始化生成器；onPickColor 触发重渲；onUnload 释放。

- [ ] **Step 7.1: 顶部 require 加进来**

打开 `miniprogram/pages/design/index.js`，在第 4 行（`const cloud = ...`）之后加：

```js
const ThumbGenerator = require('../../utils/thumb-generator.js');
```

- [ ] **Step 7.2: data 里加 thumbUrls 初始值**

找到 `data: {`（约第 28 行），在 `toast: '',` 之前加一行：

```js
    thumbUrls: {},
```

- [ ] **Step 7.3: onReady 末尾追加初始化 thumb generator 的逻辑**

找到 `onReady` 方法里 `renderer.setItems(layoutEngine.renderRows(this._state));` 这一行（约第 119 行）。在它**之后**、`} catch` **之前**，把 try 块继续延展：

```js
          renderer.setItems(layoutEngine.renderRows(this._state));

          // 启动 thumb generator
          this._initThumbGenerator(ThreeRendererCls);
```

然后在 Page 对象的方法里新增 `_initThumbGenerator`（紧跟 `onReady` 之后）：

```js
  _initThumbGenerator(ThreeRendererCls) {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 1;
    wx.createSelectorQuery()
      .select('#thumb-webgl')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.warn('thumb-webgl canvas missing');
          return;
        }
        const canvas = res[0].node;
        const cssWidth = 200;
        const cssHeight = 280;
        const previewRenderer = new ThreeRendererCls();
        try {
          previewRenderer.initPreview(canvas, { cssWidth, cssHeight, dpr });
        } catch (e) {
          console.warn('thumb preview init failed', e);
          return;
        }
        this._thumbRenderer = previewRenderer;

        // 当前 picker 会出现的所有标准柜（s50 + s100），先一口气都渲了，切 tab 时无延迟。
        // 注：cabinet-model.localModels() 出的 item 没有 kind 字段，而 renderer 内部
        // _resolveModelPath 必须靠 kind === 'standard' 才能解出 GLB 路径，所以这里补上。
        const models = []
          .concat(this._grouped.s50 || [])
          .concat(this._grouped.s100 || [])
          .map((m) => Object.assign({}, m, { kind: 'standard' }));
        const captureOne = ThumbGenerator.createCaptureOne(previewRenderer, canvas);
        this._thumbGen = new ThumbGenerator({
          models,
          captureOne,
          onThumbReady: (key, url) => {
            this.setData({ [`thumbUrls.${key}`]: url });
          },
          onError: (key, err) => {
            console.warn('[thumb] gen failed for', key, err);
          },
        });
        this._thumbGen.start(this.data.color);
      });
  },
```

- [ ] **Step 7.4: onPickColor 调 generator 重渲**

找到 `onPickColor` 方法（约第 186 行），在 `this.recompute();` **之后**加一行：

```js
    if (this._thumbGen) this._thumbGen.regenerateForColor(this._state.meta.color);
```

- [ ] **Step 7.5: onUnload 释放 generator 与 preview renderer**

找到 `onUnload` 方法（约第 127 行），在 `this._renderer = null;` **之后**追加：

```js
    if (this._thumbGen) {
      this._thumbGen.dispose();
      this._thumbGen = null;
    }
    if (this._thumbRenderer) {
      this._thumbRenderer.dispose();
      this._thumbRenderer = null;
    }
```

- [ ] **Step 7.6: 跑现有 Node 测试，确认 utils 类未受影响**

Run: `node tests/run.js`
Expected: 全过。

- [ ] **Step 7.7: 手动验证：进入 design 页，picker 里 thumb 逐个变成 3D 渲染图**

微信开发者工具编译 → 进入 design 页：
- 进入 ~1s 内，picker 的 4 个（50cm tab）→ 然后 100cm tab 的 4 个 thumb 应该陆续被 3D 图替换
- Console 出现 `[3D-preview] canvas buffer ...`
- 不应有报错

预期表现：每个 thumb 显示一个略带俯视的小柜子，能看出 a/b/c/d 的内部结构差异。

---

## Task 8: 真机/工具视觉验证 + 预览角度光照微调

**Files:**
- 只在 `miniprogram/utils/three-renderer.js` 的 `renderSingle` 与 `_buildPreviewLights` 微调常量

**目的：** 让预览观感接近 spec 引用的 `utils/display.png`：单柜居中、能看到侧面与层板纵深、阴影柔和。

- [ ] **Step 8.1: 切色卡验证：旧 thumb 不闪烁，新 thumb 渲完依次覆盖**

微信开发者工具 → design 页 → 依次点击 米色 / 灰色 / 原木色：
- 期望：picker 里的 thumb **保持显示旧颜色**，等约 ~300–600ms 后逐个变成新颜色
- 不应有"突然全部变白/空白"的闪烁
- 连续快速点 3 个色卡：最后一次点的颜色应被显示，中间 2 次的截图不应残留

- [ ] **Step 8.2: 视觉调参（按需）**

如果观感不理想，按以下顺序微调（每改一处刷新看效果）：

1. **俯视角度**：`renderSingle` 中 `group.rotation.set(-0.15, 0.35, 0);` 的两个值
   - 第一个数（rotX）控制俯视幅度：-0.2 更俯，0 平视
   - 第二个数（rotY）控制侧转幅度：0.5 更斜，0.1 更正
2. **相机距离**：`renderSingle` 中 `const dist = diag * 1.6;` 的乘数
   - 1.4 更近（柜体充满 thumb），1.8 更远（边缘留白多）
3. **灯光**：`_buildPreviewLights` 中 ambient/key/fill 的强度，按"够看清结构、不过曝"为准

- [ ] **Step 8.3: 安卓中低端机回归（如有条件）**

真机预览到一台安卓机：
- 主画布 + 隐藏 canvas 共 2 个 WebGL 上下文，不应触发"too many contexts"
- 进入页面到所有 thumb 出图的总时长不超 2s（4 个 s50 + 4 个 s100 = 8 个）
- 主画布旋转/缩放/换色/换模型行为不受影响

- [ ] **Step 8.4: 反复进出 design 页验证无内存泄漏**

在开发者工具里反复 `navigateBack` + `navigateTo` 进出 design 页 5 次：
- 每次都能正常出图
- 无 "WebGL: CONTEXT_LOST" 警告
- Console 无累积报错

---

## 收尾

完成 Task 1–8 后：
- 主画布与 thumb 共用同一套 ThreeRenderer 与 GLB 缓存
- 切色卡时 thumb 不闪烁
- 单柜预览的纯逻辑（队列 / token 取消 / 缓存）有 Node 单测兜底
- 后续如果加柜门切换 / 旋转手势 / 持久化缓存，generator 接口稳定，扩展不影响主画布
