# GLB 模型上传与元数据入库 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设计页添加"上传新模型"入口,让用户上传 GLB → 前端 GLTFLoader 解析元数据 → 上传到 COS `cabinet-model-standard/{50cm,100cm,zj}/` + 写入云数据库 `model_panel_hardware`。

**Architecture:** 单页面按钮 + 弹窗组件 + 独立的 GLB 元数据解析工具。文件校验/命名归类/解析全部在小程序端;GLB 解析复用现有 `three-renderer` 的 `THREE` + `gltfLoader` 实例;数据库前端直接 add。

**Tech Stack:** 微信小程序原生框架、`threejs-miniprogram`、GLTFLoader vendor、`wx.cloud.uploadFile`、`wx.cloud.database().collection()`

**Spec:** [2026-07-13-glb-upload-metadata-design.md](../specs/2026-07-13-glb-upload-metadata-design.md)

---

## 文件结构

**新增:**
- `miniprogram/utils/glb-metadata.js` — GLB → explain_example 元数据结构提取器 (纯逻辑,依赖注入 THREE)
- `miniprogram/components/upload-model-modal/index.{wxml,wxss,js,json}` — 上传弹窗组件
- `tests/glb-metadata.test.js` — Node 端单测

**修改:**
- `miniprogram/cabinet/pages/design/index.wxml` — info-bar 加按钮 + 挂载 modal
- `miniprogram/cabinet/pages/design/index.wxss` — 按钮样式 + info-bar 布局
- `miniprogram/cabinet/pages/design/index.js` — 上传编排 (打开 modal / 确认上传)
- `miniprogram/cabinet/pages/design/index.json` — 引入组件

---

## Task 1: `glb-metadata.js` mesh 分类与尺寸计算 (纯函数,可测)

**Files:**
- Create: `miniprogram/utils/glb-metadata.js`
- Test: `tests/glb-metadata.test.js`

**背景:** 元数据里 `board_list` / `hanging_rail_list` / `total_door_area` 由 mesh.name 关键字决定归属;每个 mesh 的 length/width/thickness/area 由 Box3 尺寸算出。这一步把纯逻辑先写出来,不涉及 GLTFLoader / wx / 文件 IO。

- [ ] **Step 1: 写失败测试 `tests/glb-metadata.test.js`**

```javascript
// GLB 元数据抽取纯逻辑测试。
// 注:parse() 端到端因涉及 GLTFLoader + wx.getFileSystemManager,需要真机验证;
// 这里只覆盖分类/尺寸/面积/命名归类 4 个纯函数。
const test = require('node:test');
const assert = require('node:assert/strict');
const glb = require('../miniprogram/utils/glb-metadata.js');

test('_classifyMesh: door', () => {
  assert.equal(glb._classifyMesh('door_panel_01'), 'door');
  assert.equal(glb._classifyMesh('Door01'), 'door');
});

test('_classifyMesh: rail', () => {
  assert.equal(glb._classifyMesh('hanging_rail_01'), 'rail');
  assert.equal(glb._classifyMesh('rail_top'), 'rail');
});

test('_classifyMesh: board', () => {
  assert.equal(glb._classifyMesh('left_vertical_board'), 'board');
  assert.equal(glb._classifyMesh('middle_shelf_02'), 'board');
  assert.equal(glb._classifyMesh('top_board'), 'board');
  assert.equal(glb._classifyMesh('drawer_side_left'), 'board');
  assert.equal(glb._classifyMesh('drawer_back_board'), 'board');
});

test('_classifyMesh: other', () => {
  assert.equal(glb._classifyMesh('camera'), 'other');
  assert.equal(glb._classifyMesh('lamp_light'), 'other');
});

test('_meshDimsFromSize: length/width/thickness 排序', () => {
  // size {x:230, y:60, z:1.8} 且 unitToCm=1 → length=230, width=60, thickness=1.8
  const r = glb._meshDimsFromSize({ x: 230, y: 60, z: 1.8 }, 1);
  assert.equal(r.length, 230);
  assert.equal(r.width, 60);
  assert.equal(r.thickness, 1.8);

  // 换任意顺序,应仍按 max/mid/min 归类
  const r2 = glb._meshDimsFromSize({ x: 1.8, y: 230, z: 60 }, 1);
  assert.equal(r2.length, 230);
  assert.equal(r2.width, 60);
  assert.equal(r2.thickness, 1.8);
});

test('_meshDimsFromSize: unitToCm 换算', () => {
  // GLB 原始单位为米时 size = {x:2.3, y:0.6, z:0.018},unitToCm = 100
  const r = glb._meshDimsFromSize({ x: 2.3, y: 0.6, z: 0.018 }, 100);
  assert.equal(r.length, 230);
  assert.equal(r.width, 60);
  assert.equal(r.thickness, 1.8);
});

test('_computeArea: (length * width) / 10000 保留 4 位', () => {
  assert.equal(glb._computeArea(230, 60), 1.38);
  assert.equal(glb._computeArea(46.4, 15), 0.0696);
});

test('parseSubdir: 50cm', () => {
  assert.equal(glb.parseSubdir('50A.glb'), '50cm');
  assert.equal(glb.parseSubdir('50L.glb'), '50cm');
});

test('parseSubdir: 100cm', () => {
  assert.equal(glb.parseSubdir('100A.glb'), '100cm');
  assert.equal(glb.parseSubdir('100C.glb'), '100cm');
});

test('parseSubdir: zj', () => {
  assert.equal(glb.parseSubdir('Y110.glb'), 'zj');
  assert.equal(glb.parseSubdir('Z.glb'), 'zj');
  assert.equal(glb.parseSubdir('YG120.glb'), 'zj');
  assert.equal(glb.parseSubdir('ZG-110-230.glb'), 'zj');
});

test('parseSubdir: 命名不合法返回 null', () => {
  assert.equal(glb.parseSubdir('random.glb'), null);
  assert.equal(glb.parseSubdir('abc.glb'), null);
  assert.equal(glb.parseSubdir('200A.glb'), null);
});

test('expectedWidthCm: 从文件名反推目标宽度', () => {
  assert.equal(glb.expectedWidthCm('50A.glb'), 50);
  assert.equal(glb.expectedWidthCm('100C.glb'), 100);
  assert.equal(glb.expectedWidthCm('Y110.glb'), 110);
  assert.equal(glb.expectedWidthCm('YG120.glb'), 110); // 转角柜宽度固定 110
  assert.equal(glb.expectedWidthCm('random.glb'), null);
});
```

- [ ] **Step 2: 跑一遍看它失败**

Run: `node --test tests/glb-metadata.test.js`
Expected: 全 FAIL,报 `Cannot find module '../miniprogram/utils/glb-metadata.js'`

- [ ] **Step 3: 写 `miniprogram/utils/glb-metadata.js` 最小实现**

```javascript
// GLB 元数据抽取:遍历 mesh 抽 board/rail/door,拼成 explain_example.json 结构。
// 依赖注入:parse(filePath, opts, deps)  deps = { THREE, gltfLoader, fs }
// 让此模块可以脱离 wx / three-renderer 单测(纯函数部分)。

// 硬件默认清单,拷贝自 docs/explain_example.json。
// 本期 hardware_list 不做识别,统一写默认值让下游 cost/materials 页有数可算。
const DEFAULT_HARDWARE_LIST = {
  hinge: 8,
  slide: 2,
  hanging_rail: 1,
  minifix: 36,
  countersunk_screw: 86,
  wood_dowel: 42,
  push_latch: 2,
  self_tapping_screw_16: 30,
  self_tapping_screw_30: 30,
  support_arm: 2,
  plinth: 4,
  nylon_pre_inserted_nut: 50,
  dust_strip: 8,
  liquid_nails: 1,
  access_panel_handle: 1,
  cable_channel: 1,
  led_light_strip: 2.2,
  led_light_power: 1,
  led_light_switch: 1,
};

// mesh.name 关键字 → 归类:'door' | 'rail' | 'board' | 'other'
function _classifyMesh(name) {
  const n = String(name || '').toLowerCase();
  if (n.indexOf('door') >= 0) return 'door';
  if (n.indexOf('rail') >= 0 || n.indexOf('hanging') >= 0) return 'rail';
  const boardKws = ['board', 'shelf', 'vertical', 'top', 'bottom', 'side', 'front', 'back'];
  for (let i = 0; i < boardKws.length; i++) {
    if (n.indexOf(boardKws[i]) >= 0) return 'board';
  }
  return 'other';
}

// 三元 size × unitToCm → { length, width, thickness } cm
// length=max, width=mid, thickness=min
function _meshDimsFromSize(size, unitToCm) {
  const arr = [size.x, size.y, size.z].map((v) => v * unitToCm);
  arr.sort((a, b) => b - a);
  return {
    length: Math.round(arr[0] * 10) / 10,
    width: Math.round(arr[1] * 10) / 10,
    thickness: Math.round(arr[2] * 100) / 100,
  };
}

function _computeArea(length, width) {
  return Math.round((length * width) / 10000 * 10000) / 10000;
}

// 文件名 → 子目录归类
function parseSubdir(fileName) {
  const base = String(fileName || '').replace(/\.glb$/i, '');
  if (/^50[A-Za-z]+$/.test(base)) return '50cm';
  if (/^100[A-Za-z]+$/.test(base)) return '100cm';
  if (/^(Y|Z|YG|ZG)([-_A-Za-z0-9]*)$/i.test(base)) return 'zj';
  return null;
}

// 文件名 → 期望宽度(用来反推 unitToCm)
function expectedWidthCm(fileName) {
  const base = String(fileName || '').replace(/\.glb$/i, '');
  if (/^50[A-Za-z]+$/.test(base)) return 50;
  if (/^100[A-Za-z]+$/.test(base)) return 100;
  if (/^(Y|Z|YG|ZG)([-_A-Za-z0-9]*)$/i.test(base)) return 110;
  return null;
}

module.exports = {
  DEFAULT_HARDWARE_LIST,
  _classifyMesh,
  _meshDimsFromSize,
  _computeArea,
  parseSubdir,
  expectedWidthCm,
};
```

- [ ] **Step 4: 再跑测试确认全绿**

Run: `node --test tests/glb-metadata.test.js`
Expected: 全部 pass。

- [ ] **Step 5: 提交**

```bash
git add tests/glb-metadata.test.js miniprogram/utils/glb-metadata.js
git commit -m "feat(glb-metadata): mesh 分类/尺寸/命名归类纯函数

- _classifyMesh: 按 mesh.name 关键字归 door/rail/board/other
- _meshDimsFromSize: max/mid/min → length/width/thickness cm
- _computeArea: 面积 m²,保留 4 位
- parseSubdir + expectedWidthCm: 文件名归类与宽度反推
- DEFAULT_HARDWARE_LIST: 默认五金清单常量

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `glb-metadata.js` parse() 主流程 (依赖注入 THREE / gltfLoader / fs)

**Files:**
- Modify: `miniprogram/utils/glb-metadata.js` (追加 `parse` + 内部辅助)
- Test: `tests/glb-metadata.test.js` (追加 parse 集成测试,mock deps)

**背景:** 有了纯函数,现在把 `parse(filePath, opts, deps)` 串起来:读文件 → GLTFLoader.parse → 遍历 scene → 拼元数据。deps 允许测试注入 mock。

- [ ] **Step 1: 追加失败测试**

在 `tests/glb-metadata.test.js` 末尾追加:

```javascript
// parse 集成测试:mock 出 GLTFLoader / fs / THREE.Box3,断言输出结构对齐 explain_example
test('parse: 端到端拼装 (mock deps)', async () => {
  // 手工构造一棵 scene:2 板件 + 1 衣通 + 1 门板
  const meshLeft = { name: 'left_vertical_board', isMesh: true };
  const meshShelf = { name: 'middle_shelf_01', isMesh: true };
  const meshRail = { name: 'hanging_rail_01', isMesh: true };
  const meshDoor = { name: 'door_panel', isMesh: true };
  const fakeRoot = {
    traverse(cb) { [meshLeft, meshShelf, meshRail, meshDoor].forEach(cb); },
  };

  // 假 Box3:根据 mesh.name 返回不同尺寸(cm 单位,unitToCm=1)。
  // root 本身 = 50cm 宽,230cm 高,60cm 深。
  const sizesByMesh = new Map([
    [null,       { x: 50, y: 230, z: 60 }],   // root
    [meshLeft,   { x: 1.8, y: 230, z: 60 }],
    [meshShelf,  { x: 50, y: 60, z: 1.8 }],
    [meshRail,   { x: 50, y: 1, z: 1 }],
    [meshDoor,   { x: 50, y: 230, z: 1.8 }],
  ]);
  function makeBox3() {
    let obj = null;
    return {
      setFromObject(o) { obj = o; return this; },
      getSize(v) {
        const s = sizesByMesh.get(obj) || sizesByMesh.get(null);
        v.x = s.x; v.y = s.y; v.z = s.z;
        return v;
      },
    };
  }
  const FakeVec3 = function () { this.x = 0; this.y = 0; this.z = 0; };
  const deps = {
    THREE: { Box3: function () { return makeBox3(); }, Vector3: FakeVec3 },
    gltfLoader: {
      parse(buf, base, onOk) { onOk({ scene: fakeRoot }); },
    },
    fs: {
      readFile({ filePath, success }) {
        success({ data: new ArrayBuffer(8) });
      },
    },
  };
  const opts = {
    filePath: '/tmp/50A.glb',
    fileName: '50A.glb',
    modelCategory: 'wardrobe',
    fileSize: 128000,
    uploadOpenid: 'oXX',
    sourceType: 'normal_user',
  };
  const meta = await glb.parse(opts, deps);
  assert.equal(meta.glb_file_name, '50A.glb');
  assert.equal(meta.model_category, 'wardrobe');
  assert.equal(meta.platform, 'wechat');
  assert.equal(meta.file_size, 128000);
  assert.equal(meta.upload_openid, 'oXX');
  assert.equal(meta.source_type, 'normal_user');
  assert.equal(meta.is_online, true);
  assert.equal(meta.remark, '');
  assert.equal(meta.overall_size.total_width, 50);
  assert.equal(meta.overall_size.total_height, 230);
  assert.equal(meta.overall_size.total_depth, 60);
  assert.equal(meta.board_list.length, 2);
  assert.equal(meta.board_list[0].node_name, 'left_vertical_board');
  assert.equal(meta.hanging_rail_list.length, 1);
  assert.equal(meta.hanging_rail_list[0].node_name, 'hanging_rail_01');
  assert.equal(meta.hanging_rail_list[0].length, 50);
  // total_door_area 应等于门板面积
  assert.equal(meta.total_door_area, glb._computeArea(230, 50));
  // total_body_area 应等于两板件面积之和
  const expBody = glb._computeArea(230, 60) + glb._computeArea(50, 60);
  assert.equal(meta.total_body_area, Math.round(expBody * 10000) / 10000);
  // hardware_list 用默认值
  assert.equal(meta.hardware_list.hinge, 8);
  assert.equal(meta.hardware_list.slide, 2);
  // 时间戳
  assert.ok(meta.create_time);
  assert.equal(meta.create_time, meta.update_time);
});
```

- [ ] **Step 2: 跑一遍看新测试失败**

Run: `node --test tests/glb-metadata.test.js`
Expected: `glb.parse is not a function` FAIL,其他 pass。

- [ ] **Step 3: 追加 `parse` 到 `miniprogram/utils/glb-metadata.js`**

在 `module.exports` 上方追加(module.exports 也要加上 parse):

```javascript
// 读取文件 → ArrayBuffer,依赖注入 fs (支持 wx.getFileSystemManager 与测试 mock)
function _readGlbBuffer(filePath, fs) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: (err) => reject(err),
    });
  });
}

// gltfLoader.parse 回调化 → Promise<root>
function _parseGltf(buffer, gltfLoader) {
  return new Promise((resolve, reject) => {
    try {
      gltfLoader.parse(
        buffer,
        '',
        (gltf) => {
          const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!root) return reject(new Error('no_scene'));
          resolve(root);
        },
        (err) => reject(err || new Error('gltf_parse_fail'))
      );
    } catch (e) {
      reject(e);
    }
  });
}

function _rootSize(root, THREE) {
  const bbox = new THREE.Box3().setFromObject(root);
  const v = new THREE.Vector3();
  bbox.getSize(v);
  return { x: v.x, y: v.y, z: v.z };
}

function _meshSize(mesh, THREE) {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const v = new THREE.Vector3();
  bbox.getSize(v);
  return { x: v.x, y: v.y, z: v.z };
}

// 主入口。opts: { filePath, fileName, modelCategory, fileSize, uploadOpenid, sourceType }
// deps: { THREE, gltfLoader, fs }  fs 需实现 readFile({ filePath, success, fail })
async function parse(opts, deps) {
  const { THREE, gltfLoader, fs } = deps;
  const { filePath, fileName, modelCategory, fileSize, uploadOpenid, sourceType } = opts;

  const buffer = await _readGlbBuffer(filePath, fs);
  const root = await _parseGltf(buffer, gltfLoader);

  const expectedW = expectedWidthCm(fileName);
  const rootSize = _rootSize(root, THREE);
  // GLB 原始坐标不是可靠的 cm/mm,用文件名反推的目标宽度反算 unitToCm。
  // rootSize.x 为 0 时兜底 1(承认 GLB 已按 cm 建模)。
  const unitToCm =
    rootSize.x > 0.0001 && expectedW ? expectedW / rootSize.x : 1;

  const overall_size = {
    total_width: Math.round(rootSize.x * unitToCm),
    total_height: Math.round(rootSize.y * unitToCm),
    total_depth: Math.round(rootSize.z * unitToCm),
  };

  const board_list = [];
  const hanging_rail_list = [];
  let total_door_area = 0;

  root.traverse((node) => {
    if (!node || !node.isMesh) return;
    const kind = _classifyMesh(node.name);
    if (kind === 'other') return;
    const size = _meshSize(node, THREE);
    const dims = _meshDimsFromSize(size, unitToCm);
    if (kind === 'board') {
      board_list.push({
        node_name: node.name,
        length: dims.length,
        width: dims.width,
        thickness: dims.thickness,
        area: _computeArea(dims.length, dims.width),
      });
    } else if (kind === 'rail') {
      hanging_rail_list.push({
        node_name: node.name,
        length: dims.length,
      });
    } else if (kind === 'door') {
      total_door_area += _computeArea(dims.length, dims.width);
    }
  });

  const total_body_area = Math.round(
    board_list.reduce((s, b) => s + b.area, 0) * 10000
  ) / 10000;
  total_door_area = Math.round(total_door_area * 10000) / 10000;
  const total_raw_board_area = Math.round(
    (total_body_area + total_door_area) * 10000
  ) / 10000;

  const now = new Date().toISOString();

  return {
    glb_file_name: fileName,
    model_category: modelCategory,
    platform: 'wechat',
    // cos_path 由调用方在上传成功后回填
    file_size: fileSize,
    source_type: sourceType,
    upload_openid: uploadOpenid,
    is_online: true,
    remark: '',
    overall_size,
    board_list,
    total_body_area,
    total_door_area,
    total_raw_board_area,
    hanging_rail_list,
    hardware_list: Object.assign({}, DEFAULT_HARDWARE_LIST),
    create_time: now,
    update_time: now,
  };
}
```

同时把 `parse` 加到 `module.exports`:

```javascript
module.exports = {
  DEFAULT_HARDWARE_LIST,
  _classifyMesh,
  _meshDimsFromSize,
  _computeArea,
  parseSubdir,
  expectedWidthCm,
  parse,
};
```

- [ ] **Step 4: 再跑测试**

Run: `node --test tests/glb-metadata.test.js`
Expected: 全部 pass (含新加的 parse 端到端测试)。

- [ ] **Step 5: 提交**

```bash
git add tests/glb-metadata.test.js miniprogram/utils/glb-metadata.js
git commit -m "feat(glb-metadata): parse() 主流程,依赖注入 THREE/gltfLoader/fs

- _readGlbBuffer + _parseGltf 回调化 → Promise
- unitToCm 由文件名反推目标宽度反算
- 遍历 mesh 拼 board_list/hanging_rail_list/total_door_area
- 输出结构完全对齐 explain_example.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `upload-model-modal` 组件骨架

**Files:**
- Create: `miniprogram/components/upload-model-modal/index.json`
- Create: `miniprogram/components/upload-model-modal/index.wxml`
- Create: `miniprogram/components/upload-model-modal/index.wxss`
- Create: `miniprogram/components/upload-model-modal/index.js`

**背景:** 弹窗组件负责 UI:文件选择 / 下拉 category / 取消上传。上传编排逻辑不在这里,交给页面。

- [ ] **Step 1: `index.json`**

```json
{ "component": true, "usingComponents": {} }
```

- [ ] **Step 2: `index.wxml`**

```xml
<view class="umm" wx:if="{{visible}}">
  <view class="umm-mask" bindtap="onCancel"></view>
  <view class="umm-card">
    <view class="umm-title">上传新模型</view>

    <view class="umm-file" bindtap="onChooseFile">
      <block wx:if="{{file}}">
        <view class="umm-file-name">{{file.name}}</view>
        <view class="umm-file-meta">{{fileSizeText}}</view>
      </block>
      <block wx:else>
        <view class="umm-file-placeholder">+ 选择 GLB 文件</view>
      </block>
    </view>

    <view class="umm-row">
      <view class="umm-row-label">模型类型</view>
      <picker mode="selector" range="{{categoryLabels}}" value="{{categoryIdx}}" bindchange="onPickCategory">
        <view class="umm-row-value">{{categoryLabels[categoryIdx]}} ▼</view>
      </picker>
    </view>

    <view class="umm-actions">
      <view class="umm-btn" bindtap="onCancel">取消</view>
      <view class="umm-btn primary {{file ? '' : 'disabled'}}" bindtap="onConfirm">上传</view>
    </view>
  </view>
</view>
```

- [ ] **Step 3: `index.wxss`** (参照 filename-input-modal)

```css
.umm { position: fixed; inset: 0; z-index: 210; }
.umm-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
.umm-card {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 600rpx; background: #fff; border-radius: 24rpx; padding: 48rpx 40rpx 32rpx;
}
.umm-title { font-size: 34rpx; font-weight: 500; margin-bottom: 24rpx; text-align: center; }
.umm-file {
  border: 2rpx dashed #d1d5db; border-radius: 14rpx; padding: 32rpx 24rpx;
  min-height: 80rpx; text-align: center; margin-bottom: 24rpx;
}
.umm-file-placeholder { color: #9ca3af; font-size: 28rpx; }
.umm-file-name { font-size: 30rpx; color: #1f2937; }
.umm-file-meta { font-size: 24rpx; color: #9ca3af; margin-top: 8rpx; }
.umm-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16rpx 0; margin-bottom: 24rpx;
}
.umm-row-label { font-size: 28rpx; color: #4b5563; }
.umm-row-value { font-size: 28rpx; color: #1f2937; }
.umm-actions { display: flex; gap: 24rpx; }
.umm-btn { flex: 1; padding: 22rpx 0; border-radius: 999rpx; background: #f3f4f6; color: #4b5563; font-size: 30rpx; text-align: center; }
.umm-btn.primary { background: #1f2937; color: #fff7c2; }
.umm-btn.disabled { opacity: 0.45; }
```

- [ ] **Step 4: `index.js`**

```javascript
const CATEGORIES = [
  { id: 'wardrobe',     label: 'wardrobe (衣柜)' },
  { id: 'shoe cabinet', label: 'shoe cabinet (鞋柜)' },
];

Component({
  properties: {
    visible: { type: Boolean, value: false },
  },
  data: {
    file: null,           // { name, size, path }
    fileSizeText: '',
    categoryIdx: 0,
    categoryLabels: CATEGORIES.map((c) => c.label),
  },
  observers: {
    // 关闭时重置状态,避免下次打开还留着上次的选择
    'visible': function (visible) {
      if (!visible) {
        this.setData({ file: null, fileSizeText: '', categoryIdx: 0 });
      }
    },
  },
  methods: {
    onChooseFile() {
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['glb'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          if (!f) return;
          if (!/\.glb$/i.test(f.name)) {
            wx.showToast({ title: '仅支持 GLB 格式', icon: 'none' });
            return;
          }
          this.setData({
            file: { name: f.name, size: f.size, path: f.path },
            fileSizeText: _formatSize(f.size),
          });
        },
        fail: () => { /* 用户取消,忽略 */ },
      });
    },
    onPickCategory(e) {
      this.setData({ categoryIdx: Number(e.detail.value) });
    },
    onCancel() {
      this.triggerEvent('uploadcancel');
    },
    onConfirm() {
      if (!this.data.file) {
        wx.showToast({ title: '请先选择 GLB 文件', icon: 'none' });
        return;
      }
      const category = CATEGORIES[this.data.categoryIdx].id;
      this.triggerEvent('uploadconfirm', {
        file: this.data.file,
        category,
      });
    },
  },
});

function _formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
```

- [ ] **Step 5: 提交**

```bash
git add miniprogram/components/upload-model-modal/
git commit -m "feat(upload-model-modal): 弹窗组件骨架

- 文件选择区(wx.chooseMessageFile, ext=glb)
- model_category 下拉(wardrobe/shoe cabinet)
- 取消/上传按钮
- visible 关闭时自动重置内部状态

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 设计页 info-bar 加按钮 + 挂载 modal (UI)

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.json`
- Modify: `miniprogram/cabinet/pages/design/index.wxml`
- Modify: `miniprogram/cabinet/pages/design/index.wxss`
- Modify: `miniprogram/cabinet/pages/design/index.js` (仅加 data + 打开/关闭空方法,不含上传逻辑)

**背景:** 先把 UI 挂上去,能开能关,不接上传逻辑。下一 Task 再接。

- [ ] **Step 1: `design/index.json`** 引组件

```json
{
  "navigationBarTitleText": "设计衣柜",
  "usingComponents": {
    "cabinet-toast": "/components/cabinet-toast/index",
    "upload-model-modal": "/components/upload-model-modal/index"
  },
  "navigationStyle": "default"
}
```

- [ ] **Step 2: `design/index.wxml`** info-bar 右侧加按钮 + modal

替换 `<view class="info-bar">` 那一块 (第 2-5 行):

```xml
  <view class="info-bar">
    <view class="info-main">
      <view class="info-name">{{plan.name}}</view>
      <view class="info-meta">{{plan.wall.w}}×{{plan.wall.h}}cm · {{cornerLabel}}{{plan.hasRaise ? ' · 加高' : ''}}</view>
    </view>
    <view class="info-upload" bindtap="onOpenUploadModal">上传新模型</view>
  </view>
```

并在 `<cabinet-toast>` 前追加 modal:

```xml
  <upload-model-modal
    visible="{{uploadModalVisible}}"
    binduploadcancel="onCancelUploadModal"
    binduploadconfirm="onConfirmUploadModal" />
```

- [ ] **Step 3: `design/index.wxss`** 调整 info-bar 布局 + 按钮样式

修改现有 `.info-bar` 规则,并新增两条:

```css
.info-bar {
  background: #fef9c3;
  padding: 20rpx 28rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  justify-content: space-between;
}

.info-main {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 16rpx;
  flex: 1;
  min-width: 0;
}

.info-upload {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: #14532d;
  border: 2rpx solid #14532d;
  border-radius: 999rpx;
  padding: 8rpx 20rpx;
  line-height: 1;
}
```

原有 `.info-name` / `.info-meta` 规则保留不动。

- [ ] **Step 4: `design/index.js`** data + 空方法

在 `data: { ... }` 中追加一行:

```javascript
    uploadModalVisible: false,
```

在 `Page({ ... })` 内(可紧跟 `showToast` 方法后面)加两个方法:

```javascript
  onOpenUploadModal() {
    this.setData({ uploadModalVisible: true });
  },

  onCancelUploadModal() {
    this.setData({ uploadModalVisible: false });
  },
```

- [ ] **Step 5: 手工验证 (开发者工具)**

打开微信开发者工具编译预览,进入设计页:
- info-bar 右上角显示"上传新模型"胶囊按钮
- 点击 → 弹出 modal
- 点 mask / 取消 → modal 关闭
- 布局不破:方案名称+尺寸文字仍在左侧,右上角按钮不换行、不遮挡 canvas

- [ ] **Step 6: 提交**

```bash
git add miniprogram/cabinet/pages/design/index.json miniprogram/cabinet/pages/design/index.wxml miniprogram/cabinet/pages/design/index.wxss miniprogram/cabinet/pages/design/index.js
git commit -m "feat(design): info-bar 右侧加\"上传新模型\"按钮 + modal 挂载

- 按钮为绿色胶囊,点击打开 upload-model-modal
- info-bar 改成 space-between 布局,方案名/尺寸左对齐
- 目前只挂 UI,onConfirmUploadModal 尚未实现,下一 Task 接上

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 上传编排 `onConfirmUploadModal`

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js`

**背景:** 用户在 modal 点"上传"后,页面负责:命名校验 → uploadFile → 调 glb-metadata.parse → 数据库 add → 反馈。GLB 解析要复用现有 renderer 的 THREE + gltfLoader 实例(见架构说明)。

- [ ] **Step 1: 顶部常量 + require**

在 `design/index.js` 顶部现有 require 后追加:

```javascript
const glbMetadata = require('../../../utils/glb-metadata.js');

// 管理员 openid 白名单。命中则 source_type = 'official_standard',
// 否则 'normal_user'。目前空,后续由运营手动填并发版。
const ADMIN_OPENIDS = [];

const MODEL_PANEL_HARDWARE = 'model_panel_hardware';
const UPLOAD_ROOT = 'cabinet-model-standard';
```

- [ ] **Step 2: 补 openid 读取**

在同一顶部区域追加辅助函数(module 顶级,不进 Page):

```javascript
// 从 app.globalData.openid 拿 openid;没有则通过 cloud.callFunction('login') 兜底。
// 现有登录/注册流程在 app.js onLaunch 时已缓存到 globalData.openid;这里仅做兜底。
async function _getOpenid() {
  const app = getApp();
  if (app && app.globalData && app.globalData.openid) return app.globalData.openid;
  try {
    const r = await wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: { type: 'getOpenId' },
    });
    const openid = r && r.result && r.result.openid;
    if (openid && app && app.globalData) app.globalData.openid = openid;
    return openid || '';
  } catch (e) {
    return '';
  }
}
```

- [ ] **Step 3: 在 Page 里加 `onConfirmUploadModal`**

替换 Task 4 中加的 `onCancelUploadModal` 那一段,把 `onConfirmUploadModal` 加在旁边:

```javascript
  onCancelUploadModal() {
    this.setData({ uploadModalVisible: false });
  },

  async onConfirmUploadModal(e) {
    const { file, category } = e.detail || {};
    if (!file || !file.name || !file.path) {
      wx.showToast({ title: '未选择文件', icon: 'none' });
      return;
    }
    // 1) 命名校验 → 子目录归类
    const subdir = glbMetadata.parseSubdir(file.name);
    if (!subdir) {
      wx.showModal({
        title: '文件名格式无效',
        content: '请使用形如 50A.glb / 100C.glb / Y110.glb / YG120.glb 的命名',
        showCancel: false,
      });
      return;
    }

    // 2) 3D 渲染器必须已初始化,才能拿到 scoped THREE + gltfLoader
    const renderer = this._renderer;
    if (!renderer || !renderer.THREE || !renderer.gltfLoader) {
      wx.showModal({
        title: '3D 渲染尚未就绪',
        content: '请等待模型加载完成后再试',
        showCancel: false,
      });
      return;
    }

    wx.showLoading({ title: '上传中...', mask: true });
    try {
      // 3) 上传到 cabinet-model-standard/{subdir}/{name}
      const cloudPath = `${UPLOAD_ROOT}/${subdir}/${file.name}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const fileID = up && up.fileID;
      if (!fileID) throw new Error('upload_no_fileID');

      // 4) 解析 GLB → 元数据
      const openid = await _getOpenid();
      const sourceType = ADMIN_OPENIDS.indexOf(openid) >= 0
        ? 'official_standard'
        : 'normal_user';
      const meta = await glbMetadata.parse(
        {
          filePath: file.path,
          fileName: file.name,
          modelCategory: category,
          fileSize: file.size,
          uploadOpenid: openid,
          sourceType,
        },
        {
          THREE: renderer.THREE,
          gltfLoader: renderer.gltfLoader,
          fs: wx.getFileSystemManager(),
        }
      );
      meta.cos_path = fileID;

      // 5) 写库(集合首次调用时会自动被创建;若权限限制则需要控制台创建)
      const db = wx.cloud.database();
      await db.collection(MODEL_PANEL_HARDWARE).add({ data: meta });

      wx.hideLoading();
      this.setData({ uploadModalVisible: false });
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('[design] upload model failed', err);
      wx.showModal({
        title: '上传失败',
        content: (err && (err.errMsg || err.message)) || '未知错误',
        showCancel: false,
      });
    }
  },
```

- [ ] **Step 4: 手工验证**

在开发者工具:
- 选一个合法命名的 GLB(如 tests/100Z.glb 若存在)→ 上传 → 云开发控制台看 `cabinet-model-standard/zj/100Z.glb` 是否出现 + `model_panel_hardware` 集合是否有对应文档
- 选一个乱名 GLB → 弹 modal 提示命名格式无效
- 选择非 glb 文件 → chooseMessageFile 会由 extension 过滤,若绕过则组件里 `/\.glb$/i` 兜底 toast

- [ ] **Step 5: 提交**

```bash
git add miniprogram/cabinet/pages/design/index.js
git commit -m "feat(design): 接上 onConfirmUploadModal 上传编排

- 命名校验 → uploadFile → glbMetadata.parse → db add
- 复用 this._renderer.THREE + gltfLoader
- source_type 走 ADMIN_OPENIDS 白名单判断(目前空)
- 失败弹 wx.showModal,成功 toast 并关 modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 收尾 — README + 手工验证 checklist

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-glb-upload-metadata.md` (勾选完成项)

**背景:** 全部步骤走完后,把 checklist 打上勾并跑一遍完整验证。

- [ ] **Step 1: 完整手工验证**

在真机 or 开发者工具走一遍:

| 场景 | 预期 |
|------|------|
| 点"上传新模型"按钮 | modal 弹出 |
| 只点上传不选文件 | toast "请先选择 GLB 文件" |
| 选合法 50A.glb + wardrobe → 上传 | 云 COS 出现 `cabinet-model-standard/50cm/50A.glb`,数据库出现文档,cos_path 为 fileID,overall_size 与真实模型接近 |
| 选合法 Y110.glb + shoe cabinet → 上传 | 云 COS 出现 `cabinet-model-standard/zj/Y110.glb`,数据库文档 model_category = 'shoe cabinet' |
| 选 abc.glb (乱名) → 上传 | wx.showModal 提示命名格式 |
| Modal 打开时点 mask 关闭 → 重开 | 内部状态清空 (无残留文件) |
| 上传中弹 loading → 期间点 mask | 期间 mask=true 拦截,不会重复关 modal |

- [ ] **Step 2: 补一行 README 提示**

在 `README.md` 底部追加:

```markdown
## 模型上传

设计页右上角"上传新模型"按钮支持将 GLB 上传到 `cabinet-model-standard/{50cm,100cm,zj}/`,并将元数据写入 `model_panel_hardware` 集合。命名必须匹配 `50X.glb` / `100X.glb` / `Y*.glb` / `Z*.glb` / `YG*.glb` / `ZG*.glb`(不区分大小写),不匹配将被拒绝上传。
```

- [ ] **Step 3: 提交**

```bash
git add README.md docs/superpowers/plans/2026-07-13-glb-upload-metadata.md
git commit -m "docs: GLB 模型上传功能收尾 + README 说明

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
