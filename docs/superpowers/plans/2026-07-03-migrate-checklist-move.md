# 移植知识库 checklist / move 页面 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把源项目 `pages/knowledge/checklist/` 与 `pages/knowledge/move/` 两个子页完整移植到当前项目 `miniprogram/pages/knowledge/` 下，并在知识库主页、app.json、share.js 完成入口注册与分享配置。

**Architecture:** 直接从源项目复制两个子页的四件套（js/json/wxml/wxss），wxml/wxss 根类由 `container` 改为 `page-container` 与当前项目已有子页（budget/needs/inspect）对齐；剩余改动集中在 `app.json / app.js / knowledge.js / knowledge.wxml / utils/share.js` 5 个已有文件的小追加。

**Tech Stack:** 微信小程序原生（js + wxml + wxss + json），本地状态 `wx.setStorageSync`，无云函数、无网络请求。

**参考路径**：
- 设计文档：`docs/superpowers/specs/2026-07-03-migrate-checklist-move-design.md`
- 源项目：`D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main`
- 目标项目：`D:/工程/柠檬塔/程序/LemonTA-minor`（本仓库）

**关键约定**：
- 当前项目子页 wxml 根 view 一律使用 `page-container` 类；源项目使用 `container`。移植时必须改。
- 当前项目 `utils/share.js` 使用 SHARE_CONFIG 映射；`onShare / onTimeline` 会根据 key 取配置。
- 项目 `tests/` 目录未包含单测框架 → 本计划以手动验证为主。

---

## Task 1: 复制 checklist 目录到当前项目

**Files:**
- Create: `miniprogram/pages/knowledge/checklist/checklist.js`
- Create: `miniprogram/pages/knowledge/checklist/checklist.json`
- Create: `miniprogram/pages/knowledge/checklist/checklist.wxml`
- Create: `miniprogram/pages/knowledge/checklist/checklist.wxss`

- [ ] **Step 1: 建目录并复制文件**

```bash
mkdir -p miniprogram/pages/knowledge/checklist
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/checklist/checklist.js"   "miniprogram/pages/knowledge/checklist/checklist.js"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/checklist/checklist.json" "miniprogram/pages/knowledge/checklist/checklist.json"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/checklist/checklist.wxml" "miniprogram/pages/knowledge/checklist/checklist.wxml"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/checklist/checklist.wxss" "miniprogram/pages/knowledge/checklist/checklist.wxss"
```

- [ ] **Step 2: 检查复制成功**

```bash
ls -la miniprogram/pages/knowledge/checklist/
```

Expected: 输出 4 个文件（checklist.js/json/wxml/wxss），字节数与源大致相同。

- [ ] **Step 3: 提交**

```bash
git add miniprogram/pages/knowledge/checklist/
git commit -m "feat(knowledge): 复制 checklist 子页四件套（未适配根类）"
```

---

## Task 2: 复制 move 目录到当前项目

**Files:**
- Create: `miniprogram/pages/knowledge/move/move.js`
- Create: `miniprogram/pages/knowledge/move/move.json`
- Create: `miniprogram/pages/knowledge/move/move.wxml`
- Create: `miniprogram/pages/knowledge/move/move.wxss`

- [ ] **Step 1: 建目录并复制文件**

```bash
mkdir -p miniprogram/pages/knowledge/move
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/move/move.js"   "miniprogram/pages/knowledge/move/move.js"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/move/move.json" "miniprogram/pages/knowledge/move/move.json"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/move/move.wxml" "miniprogram/pages/knowledge/move/move.wxml"
cp "D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/move/move.wxss" "miniprogram/pages/knowledge/move/move.wxss"
```

- [ ] **Step 2: 检查复制成功**

```bash
ls -la miniprogram/pages/knowledge/move/
```

Expected: 输出 4 个文件。

- [ ] **Step 3: 提交**

```bash
git add miniprogram/pages/knowledge/move/
git commit -m "feat(knowledge): 复制 move 子页四件套（未适配根类）"
```

---

## Task 3: 适配 checklist 根容器类

**Files:**
- Modify: `miniprogram/pages/knowledge/checklist/checklist.wxml:21`
- Modify: `miniprogram/pages/knowledge/checklist/checklist.wxss:3`

wxml 第 21 行是 `<view class="container">`，wxss 第 3 行是 `.container { ... }`。都要改成 `page-container`。

- [ ] **Step 1: 修改 checklist.wxml 根容器 class**

把 `<view class="container">` 改为 `<view class="page-container">`（wxml 里 `container` 只出现在根 view，不会与其它类冲突）。

- [ ] **Step 2: 修改 checklist.wxss 顶部选择器**

把

```css
.container {
  min-height: 100vh;
  position: relative;
}
```

改为

```css
.page-container {
  min-height: 100vh;
  position: relative;
}
```

- [ ] **Step 3: 校验修改**

```bash
grep -n "class=\"container\"\|class=\"page-container\"" miniprogram/pages/knowledge/checklist/checklist.wxml
grep -n "^\.container\|^\.page-container" miniprogram/pages/knowledge/checklist/checklist.wxss
```

Expected:
- wxml 只有一行输出且是 `class="page-container"`
- wxss 只有一行输出且是 `.page-container`

- [ ] **Step 4: 提交**

```bash
git add miniprogram/pages/knowledge/checklist/checklist.wxml miniprogram/pages/knowledge/checklist/checklist.wxss
git commit -m "style(checklist): 根容器 class 改为 page-container 与项目子页对齐"
```

---

## Task 4: 适配 move 根容器类

**Files:**
- Modify: `miniprogram/pages/knowledge/move/move.wxml:14`
- Modify: `miniprogram/pages/knowledge/move/move.wxss:3`

move.wxml 第 14 行是 `<view class="container">`，wxss 第 3 行是 `.container { ... }`。

- [ ] **Step 1: 修改 move.wxml 根容器 class**

把 `<view class="container">` 改为 `<view class="page-container">`。

- [ ] **Step 2: 修改 move.wxss 顶部选择器**

把

```css
.container {
  min-height: 100vh;
  position: relative;
}
```

改为

```css
.page-container {
  min-height: 100vh;
  position: relative;
}
```

- [ ] **Step 3: 校验修改**

```bash
grep -n "class=\"container\"\|class=\"page-container\"" miniprogram/pages/knowledge/move/move.wxml
grep -n "^\.container\|^\.page-container" miniprogram/pages/knowledge/move/move.wxss
```

Expected:
- wxml 只有一行输出且是 `class="page-container"`
- wxss 只有一行输出且是 `.page-container`

- [ ] **Step 4: 提交**

```bash
git add miniprogram/pages/knowledge/move/move.wxml miniprogram/pages/knowledge/move/move.wxss
git commit -m "style(move): 根容器 class 改为 page-container 与项目子页对齐"
```

---

## Task 5: 在 app.json 注册两个新页面

**Files:**
- Modify: `miniprogram/app.json`

在 `pages/knowledge/inspect/inspect` 那条之后追加两条。

- [ ] **Step 1: 找到当前 pages 数组内 inspect 行**

```bash
grep -n "pages/knowledge" miniprogram/app.json
```

Expected:
```
6:    "pages/knowledge/knowledge",
7:    "pages/knowledge/detail/detail",
8:    "pages/knowledge/budget/budget",
9:    "pages/knowledge/needs/needs",
10:    "pages/knowledge/inspect/inspect",
49:      { "pagePath": "pages/knowledge/knowledge","text": "知识库", ... },
```

- [ ] **Step 2: 在 inspect 行后追加两条**

把

```json
    "pages/knowledge/inspect/inspect",
```

改为

```json
    "pages/knowledge/inspect/inspect",
    "pages/knowledge/move/move",
    "pages/knowledge/checklist/checklist",
```

（保持缩进与逗号；注意不要漏最后一条也带逗号，因为下面还有别的页面。）

- [ ] **Step 3: 校验修改**

```bash
grep -n "pages/knowledge" miniprogram/app.json
```

Expected: 两条新页面出现在 inspect 之后、tabBar 之前。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/app.json
git commit -m "feat(app.json): 注册 knowledge/move 与 knowledge/checklist 两个页面"
```

---

## Task 6: 在 app.js 的 knowledgeList 追加两条入口

**Files:**
- Modify: `miniprogram/app.js`（knowledgeList 数组末尾）

在现有 `{ id: 13, ... type: 'image', imageUrl: '...' }` 之后追加两条。

- [ ] **Step 1: 定位 knowledgeList 末尾**

```bash
grep -n "knowledgeList\|id: 13" miniprogram/app.js
```

Expected: 能看到 knowledgeList 声明行与最后一条 id=13 的位置。

- [ ] **Step 2: 追加两条入口**

把

```javascript
      { id: 13, title: '全屋水路设备图', subtitle: '净水系统 · 走管参考图', type: 'image', imageUrl: 'cloud://cloud1-d6g1ct2i8712ebe2d.636c-cloud1-d6g1ct2i8712ebe2d-1436750926/全屋净水-水路设备图.png' }
    ]
```

改为

```javascript
      { id: 13, title: '全屋水路设备图', subtitle: '净水系统 · 走管参考图', type: 'image', imageUrl: 'cloud://cloud1-d6g1ct2i8712ebe2d.636c-cloud1-d6g1ct2i8712ebe2d-1436750926/全屋净水-水路设备图.png' },
      { id: 14, title: '搬家核对清单', subtitle: '从准备到入住 · 逐项核对零遗漏', type: 'move' },
      { id: 15, title: '新家物品清单', subtitle: '106项物品核对 · 采购与签收跟踪', type: 'checklist' }
    ]
```

注意：原本 id=13 那行末尾没有逗号，追加时要给它补上逗号。

- [ ] **Step 3: 校验修改**

```bash
grep -n "id: 14\|id: 15\|搬家核对\|新家物品" miniprogram/app.js
```

Expected: 两条新条目出现在文件中。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/app.js
git commit -m "feat(app.js): knowledgeList 追加 move 与 checklist 入口"
```

---

## Task 7: 在 knowledge.js 的 openArticle 追加两个跳转分支

**Files:**
- Modify: `miniprogram/pages/knowledge/knowledge.js`（openArticle 里 `type === 'inspect'` 分支之后）

- [ ] **Step 1: 定位 inspect 分支**

```bash
grep -n "type === 'inspect'" miniprogram/pages/knowledge/knowledge.js
```

Expected: 一行输出，指向 openArticle 里的 inspect 判断。

- [ ] **Step 2: 追加 move / checklist 分支**

把

```javascript
    // 快速验收跳转专用页面
    if (type === 'inspect') {
      wx.navigateTo({
        url: '/pages/knowledge/inspect/inspect'
      });
      return;
    }
```

改为

```javascript
    // 快速验收跳转专用页面
    if (type === 'inspect') {
      wx.navigateTo({
        url: '/pages/knowledge/inspect/inspect'
      });
      return;
    }

    // 搬家核对清单
    if (type === 'move') {
      wx.navigateTo({
        url: '/pages/knowledge/move/move'
      });
      return;
    }

    // 新家物品清单
    if (type === 'checklist') {
      wx.navigateTo({
        url: '/pages/knowledge/checklist/checklist'
      });
      return;
    }
```

- [ ] **Step 3: 校验修改**

```bash
grep -n "type === 'move'\|type === 'checklist'" miniprogram/pages/knowledge/knowledge.js
```

Expected: 两条输出，各一条。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/pages/knowledge/knowledge.js
git commit -m "feat(knowledge): openArticle 支持 move 与 checklist 类型跳转"
```

---

## Task 8: 在 knowledge.wxml 的 article-icon 追加两个图标 wx:if

**Files:**
- Modify: `miniprogram/pages/knowledge/knowledge.wxml`（article-icon view 内追加 2 条 wx:if）

- [ ] **Step 1: 定位 article-icon 块**

```bash
grep -n "article-icon\|item.type ===" miniprogram/pages/knowledge/knowledge.wxml
```

Expected: 能看到 article-icon 开始行 + 4 个既有 wx:if。

- [ ] **Step 2: 追加两个 wx:if**

把

```xml
        <view class="article-icon">
          <text wx:if="{{item.type === 'budget'}}">🍋</text>
          <text wx:if="{{item.type === 'needs'}}">📋</text>
          <text wx:if="{{item.type === 'inspect'}}">✅</text>
          <text wx:if="{{item.type === 'image'}}">🗺️</text>
        </view>
```

改为

```xml
        <view class="article-icon">
          <text wx:if="{{item.type === 'budget'}}">🍋</text>
          <text wx:if="{{item.type === 'needs'}}">📋</text>
          <text wx:if="{{item.type === 'inspect'}}">✅</text>
          <text wx:if="{{item.type === 'image'}}">🗺️</text>
          <text wx:if="{{item.type === 'move'}}">🚛</text>
          <text wx:if="{{item.type === 'checklist'}}">🏠</text>
        </view>
```

- [ ] **Step 3: 校验修改**

```bash
grep -n "item.type === 'move'\|item.type === 'checklist'" miniprogram/pages/knowledge/knowledge.wxml
```

Expected: 两条输出。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/pages/knowledge/knowledge.wxml
git commit -m "feat(knowledge): 主页 article-icon 追加 move / checklist 图标"
```

---

## Task 9: 在 utils/share.js 追加 checklist / move 分享配置

**Files:**
- Modify: `miniprogram/utils/share.js`（SHARE_CONFIG 里 inspect 之后）

- [ ] **Step 1: 定位 inspect 分享配置**

```bash
grep -n "inspect:\|SHARE_CONFIG" miniprogram/utils/share.js
```

Expected: 能看到 SHARE_CONFIG 定义和 inspect 那行。

- [ ] **Step 2: 读一下 inspect 那条的完整格式**

```bash
sed -n '105,120p' miniprogram/utils/share.js
```

Expected: 看到 inspect / feedback / contact / email / downloads 等条目的格式。

- [ ] **Step 3: 追加两条分享配置**

在 `inspect` 那条之后追加：

```javascript
  move:      { title: '搬家核对清单 · 从准备到入住', path: '/pages/knowledge/move/move' },
  checklist: { title: '新家物品清单 · 106项零遗漏', path: '/pages/knowledge/checklist/checklist' },
```

（缩进与前后 key 对齐；确保逗号完备。）

- [ ] **Step 4: 校验修改**

```bash
grep -n "move:\s*{\|checklist:\s*{" miniprogram/utils/share.js
```

Expected: 两条输出。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/share.js
git commit -m "feat(share): SHARE_CONFIG 追加 move 与 checklist 分享配置"
```

---

## Task 10: 手动验证（真机 / 开发者工具）

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 用微信开发者工具打开项目**

打开 `D:/工程/柠檬塔/程序/LemonTA-minor`，点击"编译"。

Expected: 编译日志无红色 error，也无 wxml 校验红字。

- [ ] **Step 2: 主页 → 知识库 tab → 看到两条新入口**

进入"知识库"tab，滚动列表。

Expected: 看到 "🚛 搬家核对清单 从准备到入住 · 逐项核对零遗漏" 和 "🏠 新家物品清单 106项物品核对 · 采购与签收跟踪" 两条卡片。

- [ ] **Step 3: 点入"新家物品清单"，验证总览态**

Expected:
- 顶部导航栏标题 "新家物品清单"
- 显示 "8大区域 · 106项物品 · 逐项核对零遗漏"
- 显示整体环形完成率（初次 0%）
- 8 张分类卡片渲染完整（玄关/客厅/厨房/卫生间/餐厅/阳台/通用/清洁用品）

- [ ] **Step 4: 点入"玄关"分类，验证详情态**

Expected:
- 顶部 "玄关清单"
- 详情统计条 4 项数字均为 0（首次进入）
- 物品列表 11 项渲染
- 短按物品可循环 unowned → purchased → received → owned 四态；卡片左边框颜色随状态变化
- 长按物品弹 ActionSheet，可直接选任一态
- "复制关键词"按钮点击有 toast "已复制选购关键词"

- [ ] **Step 5: 在详情态搜索"地垫"**

Expected: 物品列表只显示 "入户地垫" 一项。

- [ ] **Step 6: 返回总览态，在总览态搜索"洗"**

Expected: 显示跨分类搜索结果（含"洗衣机/洗衣液/洗手液/洗洁精/洗面奶/洗发露/沐浴露"等命中项），点击结果能跳到对应分类详情。

- [ ] **Step 7: 状态持久化验证**

关掉小程序，重新打开进入"新家物品清单" → "玄关"。

Expected: 之前切过态的物品状态仍然保留。

- [ ] **Step 8: 返回主页 → 点击"搬家核对清单"**

Expected:
- 顶部 "搬家核对清单"
- 显示 4 张阶段卡（📋 STEP1 搬家前准备 / 📦 STEP2 打包整理 / 🚛 STEP3 搬家当天 / 🏠 STEP4 新家入住）

- [ ] **Step 9: 点入 STEP1 详情**

Expected:
- 顶部显示 "📋 STEP1 搬家前准备 x/11"
- 11 条核对项渲染
- 点击复选框状态切换（勾选后卡片浅橙背景 + 文字删除线）
- 底部"备注"区显示 notes
- 显示 "注意：与搬家公司签订合同前..." 合同提示条
- 底部"重置本项"能弹 wx.showModal 确认清空当前阶段
- 底部"返回选择"回到 4 张卡片总览

- [ ] **Step 10: 状态持久化验证**

关掉小程序，重进 "搬家核对清单" → STEP1。

Expected: 之前勾选的项目仍然勾选。

- [ ] **Step 11: 分享菜单验证**

在 "新家物品清单" 页面点右上角 ... → 转发。

Expected: 分享卡片标题 "新家物品清单 · 106项零遗漏"，路径正确。

在 "搬家核对清单" 页面同样操作。

Expected: 分享卡片标题 "搬家核对清单 · 从准备到入住"，路径正确。

- [ ] **Step 12: 汇总验证**

如所有步骤均通过，本次移植完成。若有失败，回到对应 Task 排查。

---

## Self-review

- Spec coverage: 设计文档 5 大改动清单（app.js / app.json / knowledge.js / knowledge.wxml / share.js）分别对应 Task 6 / 5 / 7 / 8 / 9；两个子页目录复制与根类适配对应 Task 1-4；手动验证清单对应 Task 10。全部覆盖。
- Placeholder scan: 无 TBD/TODO。
- Type consistency: `page-container` 类在 Task 3-4 一致使用；`type === 'move'` / `type === 'checklist'` 在 Task 6-9 一致；`SHARE_CONFIG` 里 key 与 openArticle 分支 key 一致。
- 提交策略: 每 Task 一提交，共 9 次代码提交 + 1 次纯验证。
