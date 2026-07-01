# 主包减肥：拆分 cabinet 分包设计

日期：2026-06-28
影响文件：
- `miniprogram/app.json`
- `miniprogram/project.config.json`
- 全部 `miniprogram/pages/{design,materials,cost}/` 文件移到 `miniprogram/cabinet/pages/<page>/`
- 全部 `miniprogram/utils/{three-renderer,layout-engine,cabinet-model,cabinet-rules,wireframe-labels}.js` 移到 `miniprogram/cabinet/utils/`
- 全部 7 个 three.js 贴图资源（wall.png 等）从 `miniprogram/utils/` 移到 `miniprogram/cabinet/utils/`
- `miniprogram/vendor/GLTFLoader.js` 移到 `miniprogram/cabinet/vendor/GLTFLoader.js`
- `miniprogram/miniprogram_npm/threejs-miniprogram/` 移到 `miniprogram/cabinet/miniprogram_npm/threejs-miniprogram/`
- 删除 `miniprogram/vendor/GLTFLoader.raw.js`
- 移除 `miniprogram/utils/calculate.xlsx`、`miniprogram/utils/jietu.png`（搬到项目根 `docs/`）
- `tests/run.js`：同步 require 路径
- 所有 require 跨文件夹路径：逐文件更新

## 1. 背景与目标

小程序真机上传报错 80051：主包体积超过 2MB 上限。当前主包实测约 3.18MB。本次改造把"衣柜设计 / 选材 / 算价"三页拆到分包 `cabinet/` 内，同时把仅这三页用到的重资源（贴图、threejs-miniprogram、GLTFLoader）一并跟过去；主包仅留 `plan-list`（首页）和 `space-setup`（新建方案空间设置）。

目标：主包压到 1.7MB 以下，安全过 2MB 门槛；用户从 plan-list 进入方案时通过 `preloadRule` 静默预下载 cabinet 分包，UX 无可感知延迟。

## 2. 大小预算

| 项 | 原主包 | 优化后主包 | 改去哪 |
|---|---|---|---|
| utils/ 三类资源（wall/wood_NormalMap/display/floor/wood/cream-coloured/white1000） | ~520KB | 0 | cabinet/utils/ |
| vendor/GLTFLoader.js + GLTFLoader.raw.js | 163KB | 0 | js 进 cabinet/vendor/、raw.js 删 |
| vendor/jspdf.min.js | 367KB | 367KB | 留主包 |
| miniprogram_npm/threejs-miniprogram | 597KB | 0 | cabinet/miniprogram_npm/ |
| pages/design + materials + cost | ~50KB | 0 | cabinet/pages/ |
| utils/three-renderer + layout-engine + cabinet-model + cabinet-rules + wireframe-labels | ~95KB | 0 | cabinet/utils/ |
| utils/cost-engine.js | 15.7KB | 15.7KB | 留主包（plan-list 导出 PDF 时要算总价） |
| utils/calculate.xlsx + jietu.png | 92KB | 0 | 移到 docs/ |
| 其他主包资源（plan-store / pdf-exporter / cloud / filename-cleaner / components / app / pages/plan-list / pages/space-setup / images） | ~330KB | ~330KB | 不动 |
| **主包总计** | **3.18MB** | **~1.66MB** | |
| cabinet 分包大小 | — | ~1.4MB | 单分包上限 8MB，远低于 |

## 3. 分包目录结构

```
miniprogram/
├── app.json                              # 加入 subPackages、preloadRule
├── app.js / app.wxss / sitemap.json / envList.js / package.json   # 不动
├── pages/                                # 主包仅留两个页面
│   ├── plan-list/
│   └── space-setup/
├── utils/                                # 主包工具
│   ├── plan-store.js
│   ├── pdf-exporter.js
│   ├── filename-cleaner.js
│   ├── cloud.js
│   └── cost-engine.js                    # 主包保留（plan-list 用）
├── vendor/
│   └── jspdf.min.js                      # 主包保留
├── components/                            # 主包共用
│   └── cabinet-toast/
├── images/                                # 主包共用
└── cabinet/                              # 分包根
    ├── pages/
    │   ├── design/
    │   ├── materials/
    │   └── cost/
    ├── utils/
    │   ├── three-renderer.js
    │   ├── layout-engine.js
    │   ├── cabinet-model.js
    │   ├── cabinet-rules.js
    │   ├── wireframe-labels.js
    │   ├── wall.png
    │   ├── wood_NormalMap.jpg
    │   ├── display.png
    │   ├── floor.jpg
    │   ├── wood.jpg
    │   ├── cream-coloured.png
    │   └── white1000.png
    ├── vendor/
    │   └── GLTFLoader.js
    └── miniprogram_npm/
        └── threejs-miniprogram/
```

## 4. app.json 改动

```json
{
  "pages": [
    "pages/plan-list/index",
    "pages/space-setup/index"
  ],
  "subPackages": [
    {
      "root": "cabinet/",
      "pages": [
        "pages/design/index",
        "pages/materials/index",
        "pages/cost/index"
      ]
    }
  ],
  "preloadRule": {
    "pages/plan-list/index": {
      "network": "all",
      "packages": ["cabinet"]
    }
  }
}
```

其余字段（window、tabBar 等）保持不动。

## 5. project.config.json 改动

```json
{
  "setting": {
    ...
    "packNpmManually": true,
    "packNpmRelationList": [
      {
        "packageJsonPath": "./miniprogram/package.json",
        "miniprogramNpmDistDir": "./miniprogram/cabinet/"
      }
    ]
  },
  "packOptions": {
    "ignore": [
      { "type": "folder", "value": "node_modules" }
    ]
  }
}
```

改动两处：
- `miniprogramNpmDistDir` 从 `./miniprogram/` 改为 `./miniprogram/cabinet/`，让 npm 构建产物落到分包内
- 新增 `packOptions.ignore` 显式排除 `node_modules`（IDE 默认就会排，加上更稳）

## 6. 跨包引用与路径调整

### 6.1 主包代码不变的部分

- `pages/plan-list/index.js`：require 路径不变（仍 require `../../utils/cost-engine.js`、`../../utils/pdf-exporter.js`、`../../utils/plan-store.js`、`../../utils/filename-cleaner.js`、`../../utils/cloud.js`）
- `pages/space-setup/index.js`：require 不变

### 6.2 分包代码必须改的 require

| 文件 | 原 require 路径 | 新 require 路径 |
|---|---|---|
| `cabinet/pages/design/index.js` | `../../utils/three-renderer.js` | `../../utils/three-renderer.js`（同包，无需改） |
| `cabinet/pages/design/index.js` | `../../utils/layout-engine.js` | `../../utils/layout-engine.js` |
| `cabinet/pages/design/index.js` | `../../utils/cabinet-model.js` | `../../utils/cabinet-model.js` |
| `cabinet/pages/design/index.js` | `../../utils/cabinet-rules.js` | `../../utils/cabinet-rules.js` |
| `cabinet/pages/design/index.js` | `../../utils/plan-store.js` | `../../../utils/plan-store.js`（跨包到主包） |
| `cabinet/pages/design/index.js` | `../../utils/cloud.js` | `../../../utils/cloud.js` |
| `cabinet/pages/materials/index.js` | `../../utils/plan-store.js` | `../../../utils/plan-store.js` |
| `cabinet/pages/materials/index.js` | `../../utils/cloud.js`（若有） | `../../../utils/cloud.js`（若有） |
| `cabinet/pages/cost/index.js` | `../../utils/cost-engine.js` | `../../../utils/cost-engine.js`（跨包） |
| `cabinet/pages/cost/index.js` | `../../utils/cloud.js` | `../../../utils/cloud.js` |
| `cabinet/pages/cost/index.js` | `../../utils/plan-store.js` | `../../../utils/plan-store.js` |
| `cabinet/pages/cost/index.js` | `../../utils/wireframe-labels.js` | `../../utils/wireframe-labels.js`（同包，无需改） |
| `cabinet/utils/three-renderer.js` | `../vendor/GLTFLoader.js` | `../vendor/GLTFLoader.js`（同包，无需改） |
| `cabinet/utils/three-renderer.js` | 贴图文件路径（如 `'./wall.png'`） | `'./wall.png'`（同 utils 目录，无需改） |
| `cabinet/utils/three-renderer.js` | `require('threejs-miniprogram')` | 不变（npm 构建产物落 cabinet/miniprogram_npm/） |

实施前需逐文件 grep 实际 require 行；上表是基于现有 grep 结果给出的预估，实施时以实际文件为准。

### 6.3 wxml/wxss 资源引用

`cabinet/pages/<page>/index.wxml` 和 `index.wxss` 中如果引用了图片资源（`<image src="...">` 或 `background: url(...)`），需更新路径。当前预估 cost、materials、design 三页都不直接引用 utils 下的 three 贴图（那些只在 three-renderer 内通过 require 加载）；实施时 grep 一遍确认。

### 6.4 components 是否需挪？

`components/cabinet-toast` 被多个页面用，包括主包的 plan-list 也可能用、分包的 design 也用。需 grep 确认；如果只是分包用，可挪到 cabinet 下；如主包也用，保留在主包，分包跨包 require 即可（小程序支持自定义组件跨包引用）。**默认保留在主包**，实施阶段如发现仅分包使用再考虑挪。

### 6.5 tests/run.js

测试中 require 路径要同步改：

```javascript
// 旧
const rules = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-rules.js'));
const layout = require(path.resolve(__dirname, '../miniprogram/utils/layout-engine.js'));
const cost = require(path.resolve(__dirname, '../miniprogram/utils/cost-engine.js'));    // 这条不变，cost-engine 留主包
const model = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-model.js'));
const planStore = require(...);                                                            // 不变
const pdfExporter = require(...);                                                          // 不变
const wireframeLabels = require(...);                                                      // 改路径

// 新
const rules = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/cabinet-rules.js'));
const layout = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/layout-engine.js'));
const cost = require(...);                                                                 // 不变
const model = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/cabinet-model.js'));
const planStore = ...;                                                                     // 不变
const pdfExporter = ...;                                                                   // 不变
const wireframeLabels = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/wireframe-labels.js'));
```

## 7. 删除清单

- `miniprogram/vendor/GLTFLoader.raw.js`（确认未被引用）
- `miniprogram/utils/calculate.xlsx`（开发参考表，搬 `docs/calculate.xlsx` 保存）
- `miniprogram/utils/jietu.png`（截图临时文件，搬 `docs/jietu.png` 或直接删；实施时确认非项目正常资源）
- `miniprogram/node_modules/`（含 threejs-miniprogram 源；通过 packOptions.ignore 排除，文件本身保留以便 IDE 重新构建 npm 时使用）
- `miniprogram/miniprogram_npm/`（旧 npm 构建产物；切换 `miniprogramNpmDistDir` 后这里就不再使用，目录整个删除，新的产物会落到 `miniprogram/cabinet/miniprogram_npm/`）

## 8. 错误处理

- **构建 npm 失败**：执行 `miniprogramNpmDistDir` 切换后，IDE 需重新执行「工具 → 构建 npm」。若失败，恢复原配置或手动复制 `node_modules/threejs-miniprogram` 到 `cabinet/miniprogram_npm/`
- **跨包 require 写错**：分包代码可 require 主包代码（向上路径），主包代码不可 require 分包代码（小程序限制）。pdf-exporter 留主包，因此主包 → 分包的反向 require 已不需要。实施时如果发现某段主包代码 require 了分包文件，得改设计
- **资源路径写错**：开发者工具加载时会报「资源未找到」，跑一遍冒烟即知
- **plan-list 预下载失败**：preloadRule 失败时进入 cabinet 页面会按需下载，不影响功能，仅首次进入有短暂等待

## 9. 测试策略

### 9.1 Node 单测

`node tests/run.js` 同步更新路径后必须仍 128 passed / 1 pre-existing failed。

### 9.2 主包大小验证

开发者工具 → 详情 → 本地代码 → 查看主包大小，目标 ≤ 1.7MB。

### 9.3 冒烟场景（按用户路径）

1. **打开小程序 → plan-list**：列表正常加载；后台静默触发 cabinet 分包预下载
2. **新建方案 → space-setup → 输入墙体尺寸 → 下一步进入 design**：进入分包时如果未预下载完则等待几百毫秒；3D 场景正常加载（说明 threejs-miniprogram、GLTFLoader、贴图资源都在分包正常工作）
3. **design → 拖布局 → 确认布局 → materials → 选板材**：路径正确
4. **materials → 计算成本 → cost**：成本表显示；线框图合成（带橙色编号 1、2、3…）；plan 持久化
5. **从 cost 返回 plan-list → 导出方案 PDF**：jsPDF 在主包加载、生成 PDF 中线框图为合成图
6. **真机上传**：确认主包大小、80051 错误消失

## 10. 不在范围内

- 不改业务逻辑、数据结构、UI
- jsPDF 不上云、不拆分包
- three.js 贴图资源不上云
- pdf-exporter.js 内 `_drawWireframeDiagram`（已成死代码）不删（避免节外生枝）
- 不改 cloudfunctions/
- 不引入新的库或工具链
