# Cabinet 分包拆分 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把衣柜设计 / 选材 / 算价三页和它们的重资源拆到分包 `miniprogram/cabinet/`，让主包 ≤ 1.7MB，解决 80051 上传错误。

**Architecture:** 文件物理迁移 + require 路径修正 + app.json 加 subPackages/preloadRule + project.config.json 切换 npm 构建产物目录。主包保留 plan-list、space-setup、plan-store、cost-engine、pdf-exporter、jspdf、cabinet-toast。分包持有 design/materials/cost 三页、three-renderer、layout-engine、cabinet-model、cabinet-rules、wireframe-labels、20 个 GLB、5 张 three.js 贴图、GLTFLoader、threejs-miniprogram。

**Tech Stack:** 微信小程序分包、wx subPackages/preloadRule、Node（用于 `node tests/run.js`）

参考 spec：`docs/superpowers/specs/2026-06-28-cabinet-subpackage-design.md`

**重要前置事实**（来自代码 grep，spec 未明列）：
- `miniprogram/utils/cabinet-model/` 是含 20 个 GLB 文件的子目录，必须整体迁移
- `miniprogram/utils/three-renderer.js` 使用**绝对路径** `/utils/<file>` 引用资源（非相对路径），迁移后改为 `/cabinet/utils/<file>`
- `components/cabinet-toast/` 同时被 plan-list（主包）与 design（分包）使用 → 留主包，分包通过 `/components/...` 绝对路径跨包引用（小程序原生支持）
- `display.png` 与 `cream-coloured.png` 未在 three-renderer.js 中被引用（grep 结果），需在迁移前确认是否被 wxml/wxss 引用

---

## Task 1: 准备目录 + 删除冗余文件

**Files:**
- Create dir: `miniprogram/cabinet/`、`miniprogram/cabinet/pages/`、`miniprogram/cabinet/utils/`、`miniprogram/cabinet/vendor/`、`miniprogram/cabinet/miniprogram_npm/`
- Delete: `miniprogram/vendor/GLTFLoader.raw.js`
- Move: `miniprogram/utils/calculate.xlsx` → `docs/calculate.xlsx`
- Move: `miniprogram/utils/jietu.png` → `docs/jietu.png`

- [ ] **Step 1.1: 验证 display.png 与 cream-coloured.png 是否被引用**

```
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "display\.png\|cream-coloured\.png" miniprogram/ --include="*.wxml" --include="*.wxss" --include="*.js" --include="*.json"
```

预期：grep 应有结果时记下其引用位置，**该文件随迁移**；grep 结果为空（除了文件本身）时，**不迁移、保留在原地不打入分包，但物理保留**——稳妥起见也搬到 docs/ 保存。具体决策：grep 输出全部贴出来，按以下决策表处理：

| grep 结果 | display.png 处置 | cream-coloured.png 处置 |
|---|---|---|
| 在 wxml/wxss/js 有引用 | 跟引用方所在包走 | 同上 |
| 完全未引用 | 移到 `docs/` 不放分包 | 同上 |

下文 Task 2 默认它们与 wall.png 等其他贴图一同进 cabinet/utils/；若 Step 1.1 显示它们未引用，请在 Task 2 跳过它们的迁移，改为搬到 docs/。

- [ ] **Step 1.2: 创建目录**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mkdir -p miniprogram/cabinet/pages miniprogram/cabinet/utils/cabinet-model miniprogram/cabinet/vendor miniprogram/cabinet/miniprogram_npm docs
```

Expected：4 个 cabinet 子目录与 docs/ 全部创建。

- [ ] **Step 1.3: 移动 calculate.xlsx 和 jietu.png 到 docs/**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/calculate.xlsx docs/ && mv miniprogram/utils/jietu.png docs/
```

Expected：两个文件不在 `miniprogram/utils/` 而在 `docs/`。

- [ ] **Step 1.4: 删除 vendor/GLTFLoader.raw.js**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && rm miniprogram/vendor/GLTFLoader.raw.js
```

Expected：文件不存在；后续 `ls miniprogram/vendor/` 仅剩 jspdf.min.js。

- [ ] **Step 1.5: 验证**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && ls miniprogram/cabinet/ miniprogram/utils/ miniprogram/vendor/ docs/
```

Expected：
- `miniprogram/cabinet/` 含 pages/、utils/（含 cabinet-model/）、vendor/、miniprogram_npm/
- `miniprogram/utils/` 不再有 calculate.xlsx 和 jietu.png
- `miniprogram/vendor/` 仅剩 jspdf.min.js
- `docs/` 含 calculate.xlsx、jietu.png（以及之前已有的 superpowers/ 子目录）

---

## Task 2: 物理迁移文件到 cabinet/

**Files moved（按一次性 mv 完成）：**
- `miniprogram/pages/design/` → `miniprogram/cabinet/pages/design/`
- `miniprogram/pages/materials/` → `miniprogram/cabinet/pages/materials/`
- `miniprogram/pages/cost/` → `miniprogram/cabinet/pages/cost/`
- `miniprogram/utils/three-renderer.js` → `miniprogram/cabinet/utils/three-renderer.js`
- `miniprogram/utils/layout-engine.js` → `miniprogram/cabinet/utils/layout-engine.js`
- `miniprogram/utils/cabinet-model.js` → `miniprogram/cabinet/utils/cabinet-model.js`
- `miniprogram/utils/cabinet-rules.js` → `miniprogram/cabinet/utils/cabinet-rules.js`
- `miniprogram/utils/wireframe-labels.js` → `miniprogram/cabinet/utils/wireframe-labels.js`
- `miniprogram/utils/cabinet-model/` 整个目录 → `miniprogram/cabinet/utils/cabinet-model/`（含 50A/B/C/D/G1/G2、100A/B/C/D/G1/G2/H/L、Y-110-230、YG-110-230G1/G2、Z-110-230、ZG-110-230G1/G2 共 20 个 GLB）
- `miniprogram/utils/wall.png`、`wood_NormalMap.jpg`、`wood.jpg`、`floor.jpg`、`white1000.png` → `miniprogram/cabinet/utils/`
- `miniprogram/utils/display.png`、`cream-coloured.png` → 视 Step 1.1 grep 结果定（默认搬 cabinet/utils/）
- `miniprogram/vendor/GLTFLoader.js` → `miniprogram/cabinet/vendor/GLTFLoader.js`
- `miniprogram/miniprogram_npm/threejs-miniprogram/` → `miniprogram/cabinet/miniprogram_npm/threejs-miniprogram/`

- [ ] **Step 2.1: 移动三个页面**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/pages/design miniprogram/cabinet/pages/ && mv miniprogram/pages/materials miniprogram/cabinet/pages/ && mv miniprogram/pages/cost miniprogram/cabinet/pages/
```

Expected：`miniprogram/pages/` 仅剩 plan-list/ 和 space-setup/。

- [ ] **Step 2.2: 移动 utils 中的 JS 模块**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/three-renderer.js miniprogram/utils/layout-engine.js miniprogram/utils/cabinet-model.js miniprogram/utils/cabinet-rules.js miniprogram/utils/wireframe-labels.js miniprogram/cabinet/utils/
```

Expected：`miniprogram/utils/` 仅剩 plan-store.js、pdf-exporter.js、filename-cleaner.js、cloud.js、cost-engine.js。

- [ ] **Step 2.3: 移动 utils 中的贴图**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/wall.png miniprogram/utils/wood_NormalMap.jpg miniprogram/utils/wood.jpg miniprogram/utils/floor.jpg miniprogram/utils/white1000.png miniprogram/cabinet/utils/
```

Expected：5 个贴图全部进 cabinet/utils/。

- [ ] **Step 2.4: 处理 display.png 与 cream-coloured.png（依据 Step 1.1 结论）**

如果 Step 1.1 表明这两个文件**有引用**：
```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/display.png miniprogram/utils/cream-coloured.png miniprogram/cabinet/utils/
```

如果 Step 1.1 表明这两个文件**完全未被引用**：
```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/display.png miniprogram/utils/cream-coloured.png docs/
```

Expected：`miniprogram/utils/` 不再有这两个文件。

- [ ] **Step 2.5: 移动 cabinet-model/ 子目录**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/utils/cabinet-model miniprogram/cabinet/utils/
```

注意：Step 1.2 已经 `mkdir miniprogram/cabinet/utils/cabinet-model`，会导致这步 mv 失败（目标目录已存在）。先删空目录再 mv：

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && rmdir miniprogram/cabinet/utils/cabinet-model && mv miniprogram/utils/cabinet-model miniprogram/cabinet/utils/
```

Expected：`miniprogram/cabinet/utils/cabinet-model/` 含 20 个 GLB 文件；`miniprogram/utils/cabinet-model/` 不存在。

- [ ] **Step 2.6: 移动 GLTFLoader.js**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/vendor/GLTFLoader.js miniprogram/cabinet/vendor/
```

Expected：`miniprogram/vendor/` 仅剩 jspdf.min.js；`miniprogram/cabinet/vendor/GLTFLoader.js` 存在。

- [ ] **Step 2.7: 移动 threejs-miniprogram**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && mv miniprogram/miniprogram_npm/threejs-miniprogram miniprogram/cabinet/miniprogram_npm/ && rmdir miniprogram/miniprogram_npm
```

Expected：`miniprogram/miniprogram_npm/` 不存在；`miniprogram/cabinet/miniprogram_npm/threejs-miniprogram/index.js` 存在（约 597KB）。

- [ ] **Step 2.8: 全量验证**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && ls miniprogram/pages/ && echo '---' && ls miniprogram/utils/ && echo '---' && ls miniprogram/vendor/ && echo '---' && ls miniprogram/cabinet/pages/ && echo '---' && ls miniprogram/cabinet/utils/ && echo '---' && ls miniprogram/cabinet/utils/cabinet-model/ | wc -l && echo '---' && ls miniprogram/cabinet/vendor/ && echo '---' && ls miniprogram/cabinet/miniprogram_npm/
```

Expected：
- `pages/`: plan-list, space-setup（两项）
- `utils/`: cloud.js, cost-engine.js, filename-cleaner.js, pdf-exporter.js, plan-store.js（5 项）
- `vendor/`: jspdf.min.js（1 项）
- `cabinet/pages/`: cost, design, materials（3 项）
- `cabinet/utils/`: 5 个 .js + cabinet-model/ + 5~7 张贴图（看 Step 2.4 选择）
- `cabinet/utils/cabinet-model/` 行数：20
- `cabinet/vendor/`: GLTFLoader.js
- `cabinet/miniprogram_npm/`: threejs-miniprogram

---

## Task 3: 修改分包内 JS 文件的 require 路径

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js`
- Modify: `miniprogram/cabinet/pages/materials/index.js`
- Modify: `miniprogram/cabinet/pages/cost/index.js`
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

规则：
- 跨包到主包：原 `../../utils/X.js` → `../../../utils/X.js`（多向上跳一级到 cabinet/，再向上到 miniprogram/）
- 同包内：原相对路径（`../../utils/X.js` 当 X 在分包 utils/ 内）→ `../../utils/X.js` 不变（因为页面也跟着进了 cabinet/，相对关系一致）
- 资源绝对路径：`/utils/X` → `/cabinet/utils/X`

- [ ] **Step 3.1: cabinet/pages/design/index.js**

文件首部（行 1-5 + 行 94）替换 4 处。
- 行 1：`const cabinetModel = require('../../utils/cabinet-model.js');` —— **保持不变**（cabinet-model.js 同包，相对路径 `../../utils/` 仍指向 `cabinet/utils/`）
- 行 2：`const layoutEngine = require('../../utils/layout-engine.js');` —— **保持不变**
- 行 3：`const planStore = require('../../utils/plan-store.js');` —— **改为** `const planStore = require('../../../utils/plan-store.js');`
- 行 4：`const cloud = require('../../utils/cloud.js');` —— **改为** `const cloud = require('../../../utils/cloud.js');`
- 行 94：`ThreeRendererCls = require('../../utils/three-renderer.js');` —— **保持不变**

仅两处实际修改。Edit 用法：

```
Edit miniprogram/cabinet/pages/design/index.js
old_string: const planStore = require('../../utils/plan-store.js');
new_string: const planStore = require('../../../utils/plan-store.js');
```

```
Edit miniprogram/cabinet/pages/design/index.js
old_string: const cloud = require('../../utils/cloud.js');
new_string: const cloud = require('../../../utils/cloud.js');
```

- [ ] **Step 3.2: cabinet/pages/materials/index.js**

行 1-2 改 2 处：

```
Edit miniprogram/cabinet/pages/materials/index.js
old_string: const planStore = require('../../utils/plan-store.js');
new_string: const planStore = require('../../../utils/plan-store.js');
```

```
Edit miniprogram/cabinet/pages/materials/index.js
old_string: const cloud = require('../../utils/cloud.js');
new_string: const cloud = require('../../../utils/cloud.js');
```

- [ ] **Step 3.3: cabinet/pages/cost/index.js**

行 1-4 中 3 处改主包（cost-engine、cloud、plan-store），第 4 个（wireframe-labels）同包不动：

```
Edit miniprogram/cabinet/pages/cost/index.js
old_string: const costEngine = require('../../utils/cost-engine.js');
new_string: const costEngine = require('../../../utils/cost-engine.js');
```

```
Edit miniprogram/cabinet/pages/cost/index.js
old_string: const cloud = require('../../utils/cloud.js');
new_string: const cloud = require('../../../utils/cloud.js');
```

```
Edit miniprogram/cabinet/pages/cost/index.js
old_string: const planStore = require('../../utils/plan-store.js');
new_string: const planStore = require('../../../utils/plan-store.js');
```

`const wireframeLabels = require('../../utils/wireframe-labels.js');` 不动。

- [ ] **Step 3.4: cabinet/utils/three-renderer.js 资源绝对路径**

把 5 处资源引用从 `/utils/` 改为 `/cabinet/utils/`：

```
Edit miniprogram/cabinet/utils/three-renderer.js
old_string: /utils/white1000.png
new_string: /cabinet/utils/white1000.png
```

```
Edit miniprogram/cabinet/utils/three-renderer.js
old_string: /utils/wood.jpg
new_string: /cabinet/utils/wood.jpg
```

```
Edit miniprogram/cabinet/utils/three-renderer.js
old_string: /utils/wood_NormalMap.jpg
new_string: /cabinet/utils/wood_NormalMap.jpg
```

```
Edit miniprogram/cabinet/utils/three-renderer.js
old_string: /utils/wall.png
new_string: /cabinet/utils/wall.png
```

```
Edit miniprogram/cabinet/utils/three-renderer.js
old_string: /utils/floor.jpg
new_string: /cabinet/utils/floor.jpg
```

注意：每条 `old_string` 在文件中可能多次出现（拼接字符串）。若 Edit 报错 "old_string not unique"，提供更长的上下文（前后几个字符）来唯一定位。

另外 cabinet-model GLB 路径在行 1087 形如 `/utils/cabinet-model/${w}${letter}.glb`，以及行 1090-1094 的常量字符串（`/utils/cabinet-model/Y-110-230.glb` 等）。需要 grep 全文找出**所有** `/utils/` 出现位置并批量替换：

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -n "/utils/" miniprogram/cabinet/utils/three-renderer.js
```

对每个 grep 命中行，把 `/utils/` 改为 `/cabinet/utils/`。

- [ ] **Step 3.5: 最终 grep 验证**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "'/utils/\|\"/utils/" miniprogram/cabinet/
```

Expected：无输出（所有 `/utils/` 字面量都已变成 `/cabinet/utils/`）。

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "require('\.\./\.\./utils/\(plan-store\|cloud\|cost-engine\)" miniprogram/cabinet/
```

Expected：无输出（所有跨主包 require 已经是 `../../../utils/...` 形式）。

---

## Task 4: 修改 app.json 与 project.config.json

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `project.config.json`（位于项目根，非 miniprogram/）

- [ ] **Step 4.1: app.json 改 pages + 加 subPackages 和 preloadRule**

读 `miniprogram/app.json`，找到现有 `"pages"` 字段：

```json
{
  "pages": [
    "pages/plan-list/index",
    "pages/space-setup/index",
    "pages/design/index",
    "pages/materials/index",
    "pages/cost/index"
  ]
}
```

替换为（保留其它字段）：

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

注意：保留 `app.json` 中其余所有字段（window、tabBar、style 等）不变；仅替换 pages 数组并新增 subPackages、preloadRule 两个顶层键。

- [ ] **Step 4.2: project.config.json 改 npm 构建产物目录 + 加 packOptions.ignore**

读 `D:/工程/柠檬塔/程序/LemonTA-minor/project.config.json`，找到：

```json
"packNpmRelationList": [
  {
    "packageJsonPath": "./miniprogram/package.json",
    "miniprogramNpmDistDir": "./miniprogram/"
  }
],
```

把 `miniprogramNpmDistDir` 改为 `"./miniprogram/cabinet/"`：

```json
"packNpmRelationList": [
  {
    "packageJsonPath": "./miniprogram/package.json",
    "miniprogramNpmDistDir": "./miniprogram/cabinet/"
  }
],
```

然后在 `project.config.json` 顶层（`"setting"` 与 `"appid"` 等同级）添加 `"packOptions"`：

```json
"packOptions": {
  "ignore": [
    { "type": "folder", "value": "node_modules" }
  ]
}
```

具体插入位置：紧跟 `"setting": { ... }` 的结束 `}` 之后、`"appid"` 之前。Edit 步骤：

```
Edit project.config.json
old_string: "appid":
new_string: "packOptions": {
    "ignore": [
      { "type": "folder", "value": "node_modules" }
    ]
  },
  "appid":
```

注意 JSON 缩进保持与原文件一致。

---

## Task 5: 修改 tests/run.js require 路径

**Files:**
- Modify: `tests/run.js`

迁移之后的路径：
- cabinet-rules.js, layout-engine.js, cabinet-model.js, wireframe-labels.js 在 `miniprogram/cabinet/utils/` 下
- cost-engine.js, plan-store.js, pdf-exporter.js 仍在 `miniprogram/utils/`

- [ ] **Step 5.1: 改 4 处主包→分包路径**

```
Edit tests/run.js
old_string: const rules = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-rules.js'));
new_string: const rules = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/cabinet-rules.js'));
```

```
Edit tests/run.js
old_string: const layout = require(path.resolve(__dirname, '../miniprogram/utils/layout-engine.js'));
new_string: const layout = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/layout-engine.js'));
```

```
Edit tests/run.js
old_string: const model = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-model.js'));
new_string: const model = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/cabinet-model.js'));
```

```
Edit tests/run.js
old_string: const wireframeLabels = require(path.resolve(__dirname, '../miniprogram/utils/wireframe-labels.js'));
new_string: const wireframeLabels = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/wireframe-labels.js'));
```

cost-engine、plan-store、pdf-exporter 三处 require 路径**保持不变**（这些文件仍在主包 utils/）。

- [ ] **Step 5.2: 跑测试**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && node tests/run.js
```

Expected：**128 passed, 1 failed**（与之前一致；唯一失败为 pre-existing 的 `layout-engine.renderRows 加高分层` 顶层 kind=raise）。

若新失败：检查路径是否写错；检查 cabinet-model.js 中 Node 测试相关代码（行 83-84 require fs/path）是否仍能找到 cabinet-model 目录（cabinet-model.js 现在在 `miniprogram/cabinet/utils/`，glb 在 `miniprogram/cabinet/utils/cabinet-model/`，相对关系不变，Node 端 `nodePath.resolve(__dirname, 'cabinet-model')` 仍能找到）。

---

## Task 6: 全文 grep 兜底验证

**Files:** 无修改

- [ ] **Step 6.1: 检查主包代码中没有遗漏的 design/materials/cost 路径**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "pages/design\|pages/materials\|pages/cost" miniprogram/pages/ miniprogram/utils/ miniprogram/components/ miniprogram/app.json miniprogram/app.js
```

Expected：每条命中都应是 `navigateTo({ url: '/pages/...' })` 之类业务跳转。我们已经把这三页放到分包，**路径应改为带 `/cabinet/` 前缀**。

具体来说：业务跳转 `wx.navigateTo({ url: '/pages/design/index' })` 必须改为 `wx.navigateTo({ url: '/cabinet/pages/design/index' })`。grep 命中后逐处 Edit 修复。

参考目前已知跳转点（来自前面调研）：
- `pages/plan-list/index.js` 第 56-57 行可能 navigateTo materials
- `pages/space-setup/index.js` 跳转到 design
- `cabinet/pages/cost/index.js` redirectTo materials（同包跨页跳）

**对同包跨页跳转（分包内）**：`url: '/cabinet/pages/<name>/index'` 也用绝对路径，符合小程序规范。

逐个 grep 命中处理：

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "navigateTo\|redirectTo\|switchTab\|reLaunch" miniprogram/ --include="*.js" | grep -E "/pages/(design|materials|cost)"
```

Expected：列出所有需要改成 `/cabinet/pages/...` 的跳转。对每条 Edit 替换路径。

- [ ] **Step 6.2: 检查 wxml 中 navigator 跳转**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && grep -rn "url=" miniprogram/ --include="*.wxml" | grep -E "/pages/(design|materials|cost)"
```

Expected：通常 wxml 不直接写跳转路径，命中为空。若有，同样改 `/cabinet/pages/...`。

- [ ] **Step 6.3: 二次跑测试 + 一致性检查**

```bash
cd D:/工程/柠檬塔/程序/LemonTA-minor && node tests/run.js
```

Expected：128 passed, 1 pre-existing failed。

---

## Task 7: 真机/开发者工具冒烟回归

**Files:** 无修改

- [ ] **Step 7.1: IDE 重启 + 重新构建 npm**

操作（用户手动）：
1. 关闭微信开发者工具 → 重开 → 打开项目（确保 IDE 加载新的 project.config.json）
2. 上方菜单 → 工具 → 构建 npm
3. 等待构建完成。预期：`miniprogram/cabinet/miniprogram_npm/threejs-miniprogram/index.js` 被 IDE 重新生成（与 Task 2.7 物理 mv 过去的内容一致）

预期：IDE 构建提示「构建成功」。

- [ ] **Step 7.2: 在开发者工具中预览主包大小**

操作：右上角"详情" → 本地代码 → 查看主包大小、cabinet 分包大小

预期：
- 主包 ≤ 1.7MB
- cabinet 分包 ≤ 1.5MB（含 threejs-miniprogram 597KB + GLB 20 个）
- 总和 ≤ 3.2MB

- [ ] **Step 7.3: 冒烟路径**

走一遍完整路径，每步观察是否报错：

1. 进入小程序 → plan-list 列表正常
2. 「新建方案」→ space-setup → 输入墙体尺寸/转角/加高 → 下一步
3. 进入 design（**分包加载点**）：观察 3D 场景渲染 OK、贴图 OK（如果 5 个贴图路径有错，会显示纯色或报错）
4. 选柜子布局 → 确认布局 → materials
5. materials 选板材五金 → 计算成本 → cost
6. cost 页显示线框图 + 橙色编号 + 成本表
7. 返回 plan-list → 选方案 → 导出 PDF → 检查 PDF 中线框图为带编号成品图、成本表正常

任何一步报错（特别是「资源未找到」、「找不到模块」），按报错回查对应 require/路径。

- [ ] **Step 7.4: 真机上传**

操作：开发者工具 → 上传 → 选环境 → 上传

预期：**80051 错误消失**（主包未超 2MB）。上传过程显示主包/分包大小报告。

---

## 自审记录

**Spec 覆盖检查：**
- spec §3 目录结构 → Task 1.2 + Task 2 ✓
- spec §4 app.json → Task 4.1 ✓
- spec §5 project.config.json → Task 4.2 ✓
- spec §6.2 跨包 require 路径表 → Task 3 ✓
- spec §6.5 tests/run.js → Task 5 ✓
- spec §7 删除清单 → Task 1.3、1.4、2.7 ✓
- spec §8 错误处理 → Task 7.1 IDE 重新构建 npm 即解决
- spec §9 测试 → Task 5、7.3、7.4 ✓
- spec 漏列但实际必要：cabinet-model/ 子目录 → Task 2.5 ✓；three-renderer 绝对路径 → Task 3.4 + 3.5 ✓；业务跳转路径修改 → Task 6 ✓

**Placeholder 扫描：** 无 TBD/TODO。每个 Edit 步骤都给出了完整 old_string 与 new_string。Step 1.1 的两个图片处置依据 grep 结果决策表，不是占位符。

**Type 一致性：**
- 路径前缀 `/cabinet/` 在 spec §3 与 plan Task 3.4 一致
- 主包→分包跨包 require 用 `../../../utils/`，分包内同包用 `../../utils/`，统一规则贯穿 Task 3 全部子步
- preloadRule.packages 字段值 `"cabinet"` 与 subPackages.root `"cabinet/"` 对应关系符合小程序规范

**Plan 完整性：** 所有任务可以在不依赖 git、不需要中途确认的情况下顺序执行（Step 1.1 grep 结果决策可由执行者自决，列出两条分支）。
