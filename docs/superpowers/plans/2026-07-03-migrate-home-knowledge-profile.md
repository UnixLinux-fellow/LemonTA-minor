# 首页/知识库/我的三栏移植 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把源项目 `D:/workspace/LemonTA-main/LemonTA-main` 的 首页/知识库/我的 三栏（含子页）移植到当前项目 `miniprogram/`，建立 4-tab 结构，让 `plan-list` 成为"设计"栏。

**Architecture:** 平铺移植 —— 保持源目录名 `pages/home`、`pages/knowledge`、`pages/profile`；共享静态资源与 utils；云开发依赖在 `app.js` 内 Mock 化（保留原方法签名与 Promise 类型）；全局样式追加到 `app.wxss`，源 `.container` 重命名为 `.page-container` 避免与现有 flex `.container` 冲突；`plan-list` 保留 JS 逻辑仅重写 wxml/wxss；`space-setup` 与 `cabinet/pages/*` 在自身 json 覆盖回 `navigationStyle: default`。

**Tech Stack:** 微信小程序（WeChat MiniProgram）、WXS、WXSS、Three.js（既有 cabinet 子包）、云开发（本次全部 Mock，不接入）

**Spec:** `docs/superpowers/specs/2026-07-03-migrate-home-knowledge-profile-design.md`

**Source Project Root:** `D:/workspace/LemonTA-main/LemonTA-main/`

**Target Project Root:** `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/`

---

## 文件结构总览

**新增目录：**
- `miniprogram/assets/icons/`（12 个 png）
- `miniprogram/assets/fonts/`（2 个 ttf）
- `miniprogram/assets/bg/`（空目录 + 占位文件）
- `miniprogram/pages/home/`
- `miniprogram/pages/knowledge/`（含 5 页：主页 + 4 子页）
- `miniprogram/pages/profile/`（含 5 页：主页 + 4 子页）

**新增文件：**
- `miniprogram/utils/assets.js`
- `miniprogram/utils/assets.wxs`
- `miniprogram/utils/share.js`

**修改文件：**
- `miniprogram/app.js`
- `miniprogram/app.json`
- `miniprogram/app.wxss`
- `miniprogram/pages/plan-list/index.wxml`
- `miniprogram/pages/plan-list/index.wxss`
- `miniprogram/pages/space-setup/index.json`
- `miniprogram/cabinet/pages/design/index.json`
- `miniprogram/cabinet/pages/materials/index.json`
- `miniprogram/cabinet/pages/cost/index.json`

**不改动：**
- `miniprogram/pages/plan-list/index.js`
- `miniprogram/pages/plan-list/index.json`
- `miniprogram/cabinet/**`（除 3 个 index.json）
- `miniprogram/components/**`
- `miniprogram/utils/*`（除新增的 3 个）
- `miniprogram/images/**`

---

## Task 1: 拷贝静态资源（图标、字体）

**Files:**
- Create: `miniprogram/assets/icons/*.png`（12 个文件）
- Create: `miniprogram/assets/fonts/*.ttf`（2 个文件）
- Create: `miniprogram/assets/bg/.gitkeep`（占位）

- [ ] **Step 1: 创建 assets 目录结构并拷贝图标与字体**

```bash
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/icons"
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/fonts"
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/bg"

cp "D:/workspace/LemonTA-main/LemonTA-main/assets/icons/"*.png \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/icons/"

cp "D:/workspace/LemonTA-main/LemonTA-main/assets/fonts/"*.ttf \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/fonts/"

touch "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/bg/.gitkeep"
```

- [ ] **Step 2: 验证文件数量**

```bash
ls "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/icons/" | wc -l
ls "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/assets/fonts/" | wc -l
```
Expected: icons 目录 12 个文件，fonts 目录 2 个文件。

- [ ] **Step 3: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/assets/
git commit -m "chore(assets): 添加 tabBar 图标、HarmonyOS 字体与背景图占位目录"
```

---

## Task 2: 添加 utils/assets.js、assets.wxs、share.js

**Files:**
- Create: `miniprogram/utils/assets.js`
- Create: `miniprogram/utils/assets.wxs`
- Create: `miniprogram/utils/share.js`

- [ ] **Step 1: 拷贝 utils 三个文件**

```bash
cp "D:/workspace/LemonTA-main/LemonTA-main/utils/assets.js" \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/assets.js"

cp "D:/workspace/LemonTA-main/LemonTA-main/utils/assets.wxs" \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/assets.wxs"

cp "D:/workspace/LemonTA-main/LemonTA-main/utils/share.js" \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/share.js"
```

- [ ] **Step 2: 修改 assets.js —— 将 USE_CDN 改为 false**

打开 `miniprogram/utils/assets.js`，把第 17 行：
```js
var USE_CDN = true;
```
改为：
```js
var USE_CDN = false;
```

- [ ] **Step 3: 修改 assets.wxs —— 将 USE_CDN 改为 false**

打开 `miniprogram/utils/assets.wxs`，把顶部：
```js
var USE_CDN = true;
```
改为：
```js
var USE_CDN = false;
```

- [ ] **Step 4: 修改 share.js —— 把 design.path 指向 plan-list**

打开 `miniprogram/utils/share.js`，找到 `design:` 对象：
```js
  design: {
    title: '我用「柠檬塔定制系统」做了一套陈列方案，快来看看',
    path: '/pages/design/design'
  },
```
改为：
```js
  design: {
    title: '我用「柠檬塔定制系统」做了一套陈列方案，快来看看',
    path: '/pages/plan-list/index'
  },
```

- [ ] **Step 5: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/utils/assets.js miniprogram/utils/assets.wxs miniprogram/utils/share.js
git commit -m "feat(utils): 添加 assets/share 工具，本地路径模式"
```

---

## Task 3: 修改 app.wxss —— 追加源全局样式，`.container` 改名 `.page-container`

**Files:**
- Modify: `miniprogram/app.wxss`

- [ ] **Step 1: 在 app.wxss 末尾追加源项目全局样式**

打开 `miniprogram/app.wxss`，在文件末尾（第 27 行 `}` 后）追加以下内容（来源：源 `app.wxss` 第 20-340 行，其中 `.container` 已改名为 `.page-container`）：

```css

/* ===============================================
   ↓↓↓ 以下为从源 LemonTA-main 项目移植的 iOS 风格全局样式 ↓↓↓
   =============================================== */

view, text, image, button, scroll-view, input {
  box-sizing: border-box;
}

/* input/textarea 干净化 */
input, textarea {
  background: transparent;
  background-color: transparent;
  border: none;
  outline: none;
  box-shadow: none;
  -webkit-appearance: none;
  appearance: none;
}

/* button 干净化 */
button {
  background: transparent;
  background-color: transparent;
  border: none;
  outline: none;
  padding: 0;
  margin: 0;
  line-height: inherit;
  -webkit-appearance: none;
  appearance: none;
}
button::after {
  border: none;
  border-radius: 0;
}

/* ===== 主题色 ===== */
.text-primary { color: #FC9700; }
.bg-primary { background-color: #FC9700; }

/* ===== iOS 文字色阶 ===== */
.text-label-primary   { color: #1d1d1f; }
.text-label-secondary { color: #6e6e73; }
.text-label-tertiary  { color: #86868b; }
.text-label-quaternary { color: #c7c7cc; }

/* ===== 章节小帽标 ===== */
.eyebrow {
  display: inline-block;
  font-size: 22rpx;
  font-weight: 700;
  color: #FC9700;
  letter-spacing: 4rpx;
  text-transform: uppercase;
  line-height: 1;
}

/* ===== 大标题 ===== */
.display-title {
  font-size: 88rpx;
  font-weight: 800;
  color: #1d1d1f;
  line-height: 1.05;
  letter-spacing: -2.4rpx;
}

/* ===== H1 页面主标题 ===== */
.h1-title {
  font-size: 64rpx;
  font-weight: 700;
  color: #1d1d1f;
  line-height: 1.1;
  letter-spacing: -1.6rpx;
}

/* ===== H2 区块标题 ===== */
.h2-title {
  font-size: 44rpx;
  font-weight: 700;
  color: #1d1d1f;
  line-height: 1.2;
  letter-spacing: -0.8rpx;
}

/* ===== 副标题 ===== */
.subtitle-lead {
  font-size: 30rpx;
  font-weight: 500;
  color: #6e6e73;
  line-height: 1.5;
  letter-spacing: -0.2rpx;
}

/* ===== 正文 ===== */
.body-text {
  font-size: 28rpx;
  font-weight: 400;
  color: #3a3a3c;
  line-height: 1.7;
}

/* ===== 注释 / caption ===== */
.caption-text {
  font-size: 24rpx;
  font-weight: 500;
  color: #86868b;
  line-height: 1.45;
  letter-spacing: 0.2rpx;
}

/* ===== 主按钮 ===== */
.btn-primary {
  background: linear-gradient(180deg, #FFB140 0%, #FC9700 100%);
  color: #ffffff;
  border: none;
  border-radius: 32rpx;
  padding: 28rpx 60rpx;
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 0.5rpx;
  box-shadow: 0 8rpx 24rpx rgba(252, 151, 0, 0.28);
  transition: all 0.2s ease;
}

.btn-primary:active {
  transform: scale(0.97);
  opacity: 0.9;
}

/* ===== 次级按钮 ===== */
.btn-outline {
  background-color: rgba(255, 255, 255, 0.72);
  color: #1d1d1f;
  border: 1rpx solid rgba(60, 60, 67, 0.18);
  border-radius: 32rpx;
  padding: 26rpx 60rpx;
  font-size: 32rpx;
  font-weight: 500;
}

/* ===== 通用页面容器（源 .container 重命名，避免与现有 flex .container 冲突） ===== */
.page-container {
  min-height: 100vh;
  position: relative;
  width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

/* ===== 毛玻璃卡片 ===== */
.section-card {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: saturate(180%) blur(30px);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  border-radius: 28rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.06),
              0 2rpx 8rpx rgba(0, 0, 0, 0.03);
}

/* ===== 分割线 ===== */
.hairline {
  height: 1rpx;
  background: rgba(60, 60, 67, 0.1);
  width: 100%;
}

/* ===== 安全区 ===== */
.nav-placeholder {
  height: calc(88rpx + env(safe-area-inset-top));
}

.bottom-safe-area {
  height: calc(100rpx + env(safe-area-inset-bottom));
}

/* ===== 弹窗（源 modal-mask/modal-content 全局类，与 plan-list 页面内的 .modal 局部类不冲突） ===== */
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content {
  background: rgba(250, 250, 252, 0.92);
  backdrop-filter: saturate(180%) blur(30px);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  border-radius: 28rpx;
  padding: 48rpx 40rpx 32rpx;
  width: 80%;
  max-width: 600rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.12);
}

.modal-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1d1d1f;
  text-align: center;
  margin-bottom: 12rpx;
  letter-spacing: -0.3rpx;
}

.modal-desc {
  font-size: 26rpx;
  color: #6e6e73;
  text-align: center;
  margin-bottom: 36rpx;
  line-height: 1.5;
}

.modal-btns {
  display: flex;
  justify-content: space-around;
  gap: 20rpx;
}

.modal-btn-cancel {
  flex: 1;
  text-align: center;
  padding: 24rpx;
  border-radius: 40rpx;
  border: 1rpx solid rgba(60, 60, 67, 0.18);
  font-size: 30rpx;
  font-weight: 500;
  color: #6e6e73;
  background: rgba(255, 255, 255, 0.6);
}

.modal-btn-confirm {
  flex: 1;
  text-align: center;
  padding: 24rpx;
  border-radius: 40rpx;
  font-size: 30rpx;
  color: #ffffff;
  font-weight: 600;
  background: linear-gradient(180deg, #FFB140 0%, #FC9700 100%);
  box-shadow: 0 4rpx 16rpx rgba(252, 151, 0, 0.3);
}

.modal-btn-confirm:active,
.modal-btn-cancel:active {
  transform: scale(0.97);
  opacity: 0.85;
}

/* ===== 背景图 opacity 档位 ===== */
.bg-image-dim    { opacity: 0.10; }
.bg-image-light  { opacity: 0.18; }
.bg-image-medium { opacity: 0.26; }

/* ===== 公共背景图基础样式 ===== */
.bg-image {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

/* ===== 公共自定义导航栏 ===== */
.custom-nav {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 100;
  background: rgba(245, 245, 247, 0.72);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.nav-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.3rpx;
}

.nav-back {
  position: absolute;
  left: 20rpx;
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-arrow,
.nav-back-icon {
  font-size: 48rpx;
  color: #FC9700;
  font-weight: 300;
}
```

**注意**：
- 原有 `.container` / `page` / `button` 规则不动
- 源 `.container` 已在此追加块内重命名为 `.page-container`
- 现有 `.container`（flex 布局）保持原语义
- 源版本里有一个重复的 `.nav-placeholder` 定义（宽 60rpx 用于导航右侧占位），与安全区版本重名冲突。已在追加块里删除 60rpx 版本，仅保留安全区版本。

- [ ] **Step 2: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/app.wxss
git commit -m "feat(app.wxss): 追加 iOS 风格全局样式（.page-container 等）"
```

---

## Task 4: 修改 app.js —— 追加 globalData 静态数据、Mock 云方法、字体加载

**Files:**
- Modify: `miniprogram/app.js`

- [ ] **Step 1: 完整重写 app.js**

将 `miniprogram/app.js` 内容完整替换为：

```js
// app.js
var assets = require('./utils/assets.js');

App({
  globalData: {
    env: '',
    userInfo: null,
    isLoggedIn: false,
    openid: '',
    phone: '',
    email: '',
    avatarFileID: '',
    nickName: '',
    designs: [],
    // 跨页传递草稿
    draftPlan: null,
    currentPlan: null,
    currentDesignPreview: '',

    // 全局可配置项（当前 Mock：不从云端拉，直接用默认值）
    appConfig: {
      downloadUrl: 'https://pan.baidu.com/s/14hTB_JKE53ABqnxqLSmKGQ?pwd=45q3'
    },

    tutorials: [
      {
        id: 1,
        title: '设计指南',
        bgImage: assets.bg('T1'),
        sections: [
          { title: '1  新建设计，输入墙面的 长度 / 高度\n输入是否有 左/右/双侧转角柜', content: '', gif: '' },
          { title: '2  点击 🍋 选择对应位置的 衣柜布局\n点击已放置柜子 可更换布局配置', content: '', gif: '' },
          { title: '3  全部摆放完毕后点击 确认布局\n点击 确认 以 保存设计', content: '', gif: '' },
          { title: '4  在已保存设计中更换配置/加工需求\n点击确认，可查看 成本透视表\n点击 一键下载，获得 全套图纸+配件表', content: '', gif: '' }
        ]
      },
      {
        id: 2,
        title: '知识库指南',
        bgImage: assets.bg('T2'),
        sections: [
          { title: '1  知识库以 标签 进行内容分类，\n选择对应标签，点击打开 对应内容', content: '', gif: '' },
          { title: '2  即可 在线查看\n后缀带有【下载】的条目，含可下载模\n型与成本、拆单文件或合同模板', content: '', gif: '' }
        ]
      }
    ],

    knowledgeList: [
      { id: 0, title: '柠檬塔快速预算', subtitle: '输入面积，一键测算全屋成本', type: 'budget' },
      { id: 10, title: '柠檬塔需求匹配表', subtitle: '场景化需求梳理 · 精准落地', type: 'needs' },
      { id: 12, title: '快速验收', subtitle: '清单式验收 · 零遗漏', type: 'inspect' },
      { id: 13, title: '全屋水路设备图', subtitle: '净水系统 · 走管参考图', type: 'image', imageUrl: 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/downloads/全屋净水-水路设备图.png' }
    ]
  },

  onLaunch: function () {
    // 初始化云开发（失败静默：本项目无 login 云函数，只是让 wx.cloud 有个 env）
    try {
      if (wx.cloud) {
        wx.cloud.init({
          env: 'cloud1-5gbuna7d27dafeba',
          traceUser: true
        });
      }
    } catch (e) {
      console.warn('[cloud] init failed:', e && e.errMsg);
    }

    // 读取本地缓存的用户信息（首次为空 —— profile 显示"未登录"外壳）
    var userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.isLoggedIn = !!userInfo.openid;
      this.globalData.openid = userInfo.openid || '';
      this.globalData.phone = userInfo.phone || '';
      this.globalData.email = userInfo.email || '';
      this.globalData.avatarFileID = userInfo.avatarFileID || '';
      this.globalData.nickName = userInfo.nickName || '';
    }

    this._loadHarmonyFonts();
  },

  // ===== Mock 云方法（保留原签名与 Promise 返回类型）=====

  ensureLogin: function () {
    // 无云函数 login，直接返回空 openid → profile 保持未登录外壳
    return Promise.resolve(this.globalData.openid || '');
  },

  loadUserProfile: function () {
    return Promise.resolve(null);
  },

  loadAppConfig: function () {
    return Promise.resolve(null);
  },

  saveUserProfile: function (patch) {
    // 只写本地：同步 globalData + storage
    var self = this;
    if (typeof patch.avatarFileID === 'string') {
      self.globalData.avatarFileID = patch.avatarFileID;
    }
    if (typeof patch.nickName === 'string') {
      self.globalData.nickName = patch.nickName;
    }
    var merged = Object.assign({}, self.globalData.userInfo || {}, {
      avatarFileID: self.globalData.avatarFileID,
      nickName: self.globalData.nickName
    });
    self.globalData.userInfo = merged;
    wx.setStorageSync('userInfo', merged);
    return Promise.resolve({ success: true });
  },

  saveUserInfo: function (info) {
    var merged = Object.assign({}, this.globalData.userInfo || {}, info || {});
    this.globalData.userInfo = merged;
    this.globalData.isLoggedIn = !!merged.openid;
    this.globalData.openid = merged.openid || this.globalData.openid || '';
    this.globalData.phone = merged.phone || '';
    this.globalData.email = merged.email || '';
    this.globalData.avatarFileID = merged.avatarFileID || this.globalData.avatarFileID || '';
    this.globalData.nickName = merged.nickName || this.globalData.nickName || '';
    wx.setStorageSync('userInfo', merged);
  },

  refreshDesigns: function () {
    this.globalData.designs = [];
    return Promise.resolve([]);
  },

  saveDesign: function (design) {
    return Promise.resolve({ success: false, msg: '离线版暂不支持云端保存' });
  },

  deleteDesignById: function (id) {
    return Promise.resolve({ success: false });
  },

  getDesignById: function (id) {
    var list = this.globalData.designs || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id) return list[i];
    }
    return null;
  },

  // ===== 字体加载（拷源实现）=====

  _loadHarmonyFonts: function () {
    if (!wx.loadFontFace) return;
    var fm = wx.getFileSystemManager();
    var USER = wx.env.USER_DATA_PATH;
    var tasks = [
      { weight: '100', pkgPath: '/assets/fonts/HarmonyOS_Sans_SC_Thin.ttf',  dst: USER + '/HarmonyOS_Sans_SC_Thin.ttf' },
      { weight: '900', pkgPath: '/assets/fonts/HarmonyOS_Sans_SC_Black.ttf', dst: USER + '/HarmonyOS_Sans_SC_Black.ttf' }
    ];
    tasks.forEach(function (t) {
      var registerFromWxfile = function () {
        wx.loadFontFace({
          global: true,
          scopes: ['webview', 'native'],
          family: 'HarmonyOS Sans SC',
          source: 'url("' + t.dst + '")',
          desc: { style: 'normal', weight: t.weight },
          success: function () { /* loaded */ },
          fail: function (err) {
            console.warn('[font] loadFontFace(' + t.weight + ') fail:', err && err.errMsg);
          }
        });
      };
      try {
        fm.accessSync(t.dst);
        registerFromWxfile();
      } catch (e) {
        fm.copyFile({
          srcPath: t.pkgPath,
          destPath: t.dst,
          success: registerFromWxfile,
          fail: function (err) {
            console.warn('[font] copyFile(' + t.weight + ') fail:', err && err.errMsg);
          }
        });
      }
    });
  }
});
```

- [ ] **Step 2: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/app.js
git commit -m "feat(app): 追加 tabBar 三栏所需的 globalData 与 Mock 云方法"
```

---

## Task 5: 修改 app.json —— 追加页面、tabBar、custom 导航

**Files:**
- Modify: `miniprogram/app.json`

- [ ] **Step 1: 完整替换 app.json**

将 `miniprogram/app.json` 内容替换为：

```json
{
  "pages": [
    "pages/plan-list/index",
    "pages/space-setup/index",
    "pages/home/home",
    "pages/knowledge/knowledge",
    "pages/knowledge/detail/detail",
    "pages/knowledge/budget/budget",
    "pages/knowledge/needs/needs",
    "pages/knowledge/inspect/inspect",
    "pages/profile/profile",
    "pages/profile/contact/contact",
    "pages/profile/feedback/feedback",
    "pages/profile/email/email",
    "pages/profile/downloads/downloads"
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
  },
  "window": {
    "backgroundColor": "#F6F6F6",
    "backgroundTextStyle": "light",
    "navigationBarBackgroundColor": "#FFFFFF",
    "navigationBarTitleText": "LEMONTA",
    "navigationBarTextStyle": "black",
    "navigationStyle": "custom"
  },
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#FC9700",
    "backgroundColor": "#ffffff",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/home/home",          "text": "首页",   "iconPath": "assets/icons/home.png",       "selectedIconPath": "assets/icons/home-active.png" },
      { "pagePath": "pages/plan-list/index",    "text": "设计",   "iconPath": "assets/icons/design.png",     "selectedIconPath": "assets/icons/design-active.png" },
      { "pagePath": "pages/knowledge/knowledge","text": "知识库", "iconPath": "assets/icons/knowledge.png",  "selectedIconPath": "assets/icons/knowledge-active.png" },
      { "pagePath": "pages/profile/profile",    "text": "我的",   "iconPath": "assets/icons/profile.png",    "selectedIconPath": "assets/icons/profile-active.png" }
    ]
  },
  "sitemapLocation": "sitemap.json",
  "style": "v2",
  "lazyCodeLoading": "requiredComponents"
}
```

- [ ] **Step 2: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/app.json
git commit -m "feat(app.json): 建立 4-tab 结构（首页/设计/知识库/我的）"
```

---

## Task 6: 让 space-setup 与 cabinet 三页保留系统导航栏

**Files:**
- Modify: `miniprogram/pages/space-setup/index.json`
- Modify: `miniprogram/cabinet/pages/design/index.json`
- Modify: `miniprogram/cabinet/pages/materials/index.json`
- Modify: `miniprogram/cabinet/pages/cost/index.json`

- [ ] **Step 1: 用 Read 工具读取 4 个 json 现有内容**

依次 Read：
- `miniprogram/pages/space-setup/index.json`
- `miniprogram/cabinet/pages/design/index.json`
- `miniprogram/cabinet/pages/materials/index.json`
- `miniprogram/cabinet/pages/cost/index.json`

- [ ] **Step 2: 用 Edit 在每个 json 的最外层追加 `"navigationStyle": "default"`**

以 `miniprogram/pages/space-setup/index.json` 为例：若原文是 `{ "usingComponents": {...} }`，则改为：
```json
{
  "usingComponents": {...},
  "navigationStyle": "default"
}
```
其中 `{...}` 保留原样。对另外 3 个 cabinet 页面 json 做同样操作。

- [ ] **Step 4: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/pages/space-setup/index.json miniprogram/cabinet/pages/*/index.json
git commit -m "chore(pages): space-setup 与 cabinet 3 页覆盖为 default 导航"
```

---

## Task 7: 拷贝 pages/home（含 wxml/wxss 内 `.container` 改名）

**Files:**
- Create: `miniprogram/pages/home/home.js`
- Create: `miniprogram/pages/home/home.json`
- Create: `miniprogram/pages/home/home.wxml`
- Create: `miniprogram/pages/home/home.wxss`

- [ ] **Step 1: 拷贝 home 四个文件**

```bash
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/home"
cp "D:/workspace/LemonTA-main/LemonTA-main/pages/home/"* \
   "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/home/"
```

- [ ] **Step 2: home.wxml 中 `class="container"` → `class="page-container"`**

打开 `miniprogram/pages/home/home.wxml`，把：
```xml
<view class="container" style="min-height:{{windowHeight}}px;">
```
改为：
```xml
<view class="page-container" style="min-height:{{windowHeight}}px;">
```

- [ ] **Step 3: home.wxss 中 `.container { ... }` 选择器改名**

打开 `miniprogram/pages/home/home.wxss`，把第 3-8 行：
```css
.container {
  width: 100%;
  background: #f5f3ef;
  overflow-x: hidden;
  box-sizing: border-box;
}
```
改为：
```css
.page-container {
  width: 100%;
  background: #f5f3ef;
  overflow-x: hidden;
  box-sizing: border-box;
}
```

- [ ] **Step 4: home.js 中把 goToDesign 目标改为 plan-list**

打开 `miniprogram/pages/home/home.js`，把：
```js
goToDesign: function() {
  wx.switchTab({
    url: '/pages/design/design'
  });
},
```
改为：
```js
goToDesign: function() {
  wx.switchTab({
    url: '/pages/plan-list/index'
  });
},
```

- [ ] **Step 5: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/pages/home
git commit -m "feat(home): 移植首页欢迎页与 CTA"
```

---

## Task 8: 拷贝 pages/knowledge（含主页 + 4 子页）与 `.container` 改名

**Files:**
- Create: `miniprogram/pages/knowledge/knowledge.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/knowledge/detail/detail.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/knowledge/budget/budget.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/knowledge/needs/needs.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/knowledge/inspect/inspect.{js,json,wxml,wxss}`

- [ ] **Step 1: 拷贝整棵 knowledge 目录**

```bash
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/knowledge"
cp -R "D:/workspace/LemonTA-main/LemonTA-main/pages/knowledge/"* \
      "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/knowledge/"
```

- [ ] **Step 2: 用 Grep 找出所有需改名的 wxml 与 wxss**

```
Grep pattern: "\.container|class=\"container\"" 
path: "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/knowledge"
```
预期命中：
- `knowledge.wxml`  (`class="container"`)
- `budget/budget.wxml` (`class="container"`)
- `needs/needs.wxml` (`class="container"`)
- `inspect/inspect.wxml` (`class="container"`)
- `detail/detail.wxml` (`class="container"`)
- `detail/detail.wxss` (`.container`)
- `needs/needs.wxss` (`.container`)
- `inspect/inspect.wxss` (`.container`)

- [ ] **Step 3: 逐文件把 `class="container"` 替换为 `class="page-container"`**

在 5 个 wxml 文件中执行替换。以 knowledge.wxml 为例：
```xml
<view class="container">
```
→
```xml
<view class="page-container">
```

对 budget.wxml、needs.wxml、inspect.wxml、detail.wxml 做相同替换。

- [ ] **Step 4: 在 wxss 里把 `.container { ... }` 选择器改名**

在 `detail.wxss`、`needs.wxss`、`inspect.wxss` 三个文件中，把 `.container { ... }` 的选择器 `.container` 改为 `.page-container`（只改选择器名，规则内容保留）。

- [ ] **Step 5: 验证 replace_all 后无残留**

```
Grep pattern: "class=\"container\"|^\.container" 
path: "miniprogram/pages/knowledge"
```
预期：无命中。

- [ ] **Step 6: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/pages/knowledge
git commit -m "feat(knowledge): 移植知识库主页与 detail/budget/needs/inspect 子页"
```

---

## Task 9: 拷贝 pages/profile（含主页 + 4 子页）与 `.container` 改名

**Files:**
- Create: `miniprogram/pages/profile/profile.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/profile/contact/contact.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/profile/feedback/feedback.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/profile/email/email.{js,json,wxml,wxss}`
- Create: `miniprogram/pages/profile/downloads/downloads.{js,json,wxml,wxss}`

- [ ] **Step 1: 拷贝整棵 profile 目录**

```bash
mkdir -p "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/profile"
cp -R "D:/workspace/LemonTA-main/LemonTA-main/pages/profile/"* \
      "D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/profile/"
```

- [ ] **Step 2: 用 Grep 找出所有需改名的 wxml/wxss**

预期命中：
- `profile.wxml` (`class="container"`)
- `profile.wxss` (`.container`)
- `contact/contact.wxml` + `contact/contact.wxss`
- `feedback/feedback.wxml` + `feedback/feedback.wxss`
- `email/email.wxml` + `email/email.wxss`
- `downloads/downloads.wxml` + `downloads/downloads.wxss`

- [ ] **Step 3: 逐文件替换 wxml 里的 `class="container"` → `class="page-container"`**

对 5 个 wxml 文件执行替换。

- [ ] **Step 4: 逐文件把 wxss 里 `.container { ... }` 选择器改名为 `.page-container`**

对 5 个 wxss 文件执行替换（只改选择器名）。

- [ ] **Step 5: 修改 profile.js —— onCardTap 改 Toast**

打开 `miniprogram/pages/profile/profile.js`，找到：
```js
onCardTap: function() {
  if (this.data.isLoggedIn) return;
  wx.navigateTo({ url: '/packageDesign/register/register' });
},
```
改为：
```js
onCardTap: function() {
  if (this.data.isLoggedIn) return;
  wx.showToast({ title: '登录功能开发中', icon: 'none' });
},
```

- [ ] **Step 6: 修改 profile.js —— saveProfile 跳过云上传**

打开 `miniprogram/pages/profile/profile.js`，找到 `saveProfile: function() { ... }`，把整个方法体替换为：

```js
saveProfile: function() {
  var self = this;
  if (self.data.saving) return;
  self.setData({ saving: true });

  var tempAvatar = self.data.editAvatarTemp;
  var nickName = (self.data.editNickName || '').trim();

  // 头像：若选了新头像用临时路径；否则沿用已有
  var avatarValue = tempAvatar || self.data.editAvatarUrl || '';

  app.saveUserProfile({
    avatarFileID: avatarValue,
    nickName: nickName
  }).then(function(res) {
    self.setData({ saving: false });
    if (res && res.success) {
      wx.showToast({ title: '已保存', icon: 'success' });
      self.setData({ editVisible: false, editAvatarTemp: '' });
      self._syncLoginState();
    } else {
      wx.showToast({ title: (res && res.msg) || '保存失败', icon: 'none' });
    }
  }).catch(function(err) {
    console.error('[profile] saveProfile 失败:', err);
    self.setData({ saving: false });
    wx.showToast({ title: (err && err.errMsg) || '保存失败', icon: 'none' });
  });
},
```

- [ ] **Step 7: 验证 replace_all 后无残留**

```
Grep pattern: "class=\"container\"|^\.container" 
path: "miniprogram/pages/profile"
```
预期：无命中。

- [ ] **Step 8: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/pages/profile
git commit -m "feat(profile): 移植我的页与 contact/feedback/email/downloads 子页"
```

---

## Task 10: 重写 plan-list（"设计" tab）套 iOS 外壳

**Files:**
- Modify: `miniprogram/pages/plan-list/index.wxml`
- Modify: `miniprogram/pages/plan-list/index.wxss`

- [ ] **Step 1: 完整替换 index.wxml**

将 `miniprogram/pages/plan-list/index.wxml` 内容替换为：

```xml
<wxs src="../../utils/assets.wxs" module="assets" />
<view class="page-container">

  <!-- 全屏背景图 -->
  <image class="bg-image bg-image-light" src="{{assets.bg('T3')}}" mode="aspectFill" lazy-load />

  <!-- 自定义导航栏 -->
  <view class="custom-nav" style="padding-top: {{statusBarHeight}}px;">
    <view class="nav-bar" style="height: {{navBarHeight}}px;">
      <text class="nav-title">设计</text>
    </view>
  </view>

  <view class="design-content" style="padding-top: {{statusBarHeight + navBarHeight + 40}}px;">

    <!-- 页面标题 -->
    <view class="design-header">
      <text class="eyebrow">MY DESIGNS</text>
      <text class="h1-title">我的设计</text>
      <text class="subtitle-lead">最多保存 30 个空间方案</text>
    </view>

    <!-- 新建 CTA -->
    <view class="cta-block">
      <button class="btn-primary" bindtap="onTapStart">
        <text>+ 开始新设计</text>
      </button>
    </view>

    <!-- 已保存方案列表 -->
    <view class="saved-section" wx:if="{{plans.length}}">
      <view class="saved-heading">已保存方案 ({{plans.length}}/30)</view>
      <view class="saved-list">
        <view class="plan-item section-card" wx:for="{{plans}}" wx:key="id">
          <view class="plan-main" data-id="{{item.id}}" bindtap="onTapItem">
            <text class="plan-name">{{item.name}}</text>
            <view class="plan-meta">
              <text>{{item.wall.w}}cm × {{item.wall.h}}cm</text>
              <text class="dot">·</text>
              <text>{{item.cornerLabel}}</text>
              <text class="dot">·</text>
              <text>{{item.cabinetCount}} 个柜子</text>
            </view>
          </view>
          <view class="del-btn" data-id="{{item.id}}" catchtap="onAskDelete">
            <text>✕</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 空态 -->
    <view class="empty section-card" wx:if="{{!plans.length}}">
      <text class="empty-text">还没有保存的设计</text>
      <text class="empty-tip">点击上方"开始新设计"开始第一个空间</text>
    </view>

    <!-- 导出按钮组 -->
    <view class="export-btn-wrap">
      <view class="export-btn btn-outline" bindtap="onTapExport">导出方案信息</view>
      <view class="export-btn btn-outline" bindtap="onTapExportHardware">导出拆单规范</view>
    </view>
    <view class="export-btn-wrap-cost">
      <view class="export-btn btn-outline" bindtap="onTapExportCost">导出方案成本</view>
    </view>
  </view>

  <!-- 删除确认弹窗（使用全局 modal 类） -->
  <view class="modal-mask" wx:if="{{confirmDelete}}">
    <view class="modal-content">
      <view class="modal-title">删除设计？</view>
      <view class="modal-desc">将删除"{{confirmDelete.name}}"，无法恢复。</view>
      <view class="modal-btns">
        <view class="modal-btn-cancel" bindtap="onConfirmDeleteCancel">否</view>
        <view class="modal-btn-confirm" bindtap="onConfirmDeleteOk">确认删除</view>
      </view>
    </view>
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

  <plan-select-modal
    visible="{{costExportSelectOpen}}"
    plans="{{plans}}"
    bind:cancel="onCostExportSelectCancel"
    bind:confirm="onCostExportSelectConfirm">
  </plan-select-modal>

  <filename-input-modal
    visible="{{costExportNameOpen}}"
    defaultValue="方案成本.pdf"
    bind:cancel="onCostExportNameCancel"
    bind:confirm="onCostExportNameConfirm">
  </filename-input-modal>

  <canvas type="2d" id="pdf-canvas" class="pdf-canvas"></canvas>

  <cabinet-toast text="{{toast}}"></cabinet-toast>
</view>
```

- [ ] **Step 2: 完整替换 index.wxss**

将 `miniprogram/pages/plan-list/index.wxss` 内容替换为：

```css
/* plan-list 页面样式 —— 与 home/knowledge/profile 一致的 iOS 外壳 */

.design-content {
  position: relative;
  z-index: 1;
  padding: 20rpx 32rpx 220rpx;
}

.design-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: 40rpx;
  padding: 0 8rpx;
}

.eyebrow {
  margin-bottom: 20rpx;
}

.h1-title {
  margin-bottom: 20rpx;
}

.subtitle-lead {
  margin-top: 4rpx;
}

/* 新建 CTA */
.cta-block {
  padding: 8rpx 8rpx 40rpx;
  display: flex;
  justify-content: center;
}

.cta-block .btn-primary {
  width: 100%;
  text-align: center;
}

/* 已保存方案区 */
.saved-section {
  margin-bottom: 32rpx;
}

.saved-heading {
  font-size: 26rpx;
  color: #6e6e73;
  font-weight: 700;
  letter-spacing: 0.4rpx;
  margin-bottom: 20rpx;
  padding: 0 8rpx;
}

.saved-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.plan-item {
  padding: 28rpx 28rpx;
  display: flex;
  align-items: center;
}

.plan-main {
  flex: 1;
  min-width: 0;
}

.plan-name {
  font-size: 32rpx;
  color: #1d1d1f;
  font-weight: 700;
  letter-spacing: -0.3rpx;
  margin-bottom: 8rpx;
  display: block;
}

.plan-meta {
  font-size: 24rpx;
  color: #86868b;
}

.plan-meta .dot {
  margin: 0 12rpx;
}

.del-btn {
  width: 60rpx;
  height: 60rpx;
  line-height: 60rpx;
  text-align: center;
  color: #c7c7cc;
  font-size: 32rpx;
  flex-shrink: 0;
}

/* 空态 */
.empty {
  padding: 80rpx 40rpx;
  text-align: center;
  margin-bottom: 32rpx;
}

.empty-text {
  display: block;
  font-size: 30rpx;
  color: #6e6e73;
  margin-bottom: 12rpx;
  font-weight: 600;
}

.empty-tip {
  display: block;
  font-size: 26rpx;
  color: #86868b;
}

/* 导出按钮 */
.export-btn-wrap {
  display: flex;
  gap: 20rpx;
  padding: 16rpx 0 20rpx;
}

.export-btn-wrap-cost {
  padding: 0 0 40rpx;
}

.export-btn {
  flex: 1;
  text-align: center;
  padding: 22rpx 0;
  font-size: 30rpx;
}

.export-btn-wrap-cost .export-btn {
  width: 100%;
}

/* 离屏 canvas —— PDF 导出必需 */
.pdf-canvas {
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 595px;
  height: 842px;
}
```

- [ ] **Step 3: 修改 index.js —— 追加导航栏尺寸的 data 与 onLoad 计算**

打开 `miniprogram/pages/plan-list/index.js`，在 `data:` 对象中追加：
```js
    statusBarHeight: 20,
    navBarHeight: 44,
```

然后在 Page 对象中新增（或在现有 onLoad 中追加）：
```js
  onLoad: function() {
    try {
      var sysInfo = wx.getWindowInfo();
      var menuBtn = wx.getMenuButtonBoundingClientRect();
      var statusBarHeight = sysInfo.statusBarHeight || 20;
      var navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height;
      this.setData({ statusBarHeight: statusBarHeight, navBarHeight: navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
  },
```

注意：现有 `Page({ data: {...}, onShow() { ... } })` 结构中没有 onLoad，需新增 onLoad 方法，与 onShow 平级。

- [ ] **Step 4: Commit**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git add miniprogram/pages/plan-list
git commit -m "feat(plan-list): 套 iOS 风格外壳适配设计 tab"
```

---

## Task 11: 手动验证 —— 编译运行小程序

**Files:** 无代码改动。

- [ ] **Step 1: 启动微信开发者工具**

打开微信开发者工具，导入或刷新项目 `D:/工程/柠檬塔/程序/LemonTA-minor`。

- [ ] **Step 2: 编译预览**

点击"编译"或按快捷键 Ctrl+B，观察 Console。

Expected: 编译成功，无红色 error。

- [ ] **Step 3: 首页 tab 验证**

模拟器进入首页 → 应显示 "Hi / 欢迎来到 / 柠檬塔定制系统" 标题、"0门槛\|快速规划…" 特性行、CTA 行。点击 CTA "点击 [icon] 开始设计" → 应切到"设计" tab（plan-list）。

- [ ] **Step 4: 设计 tab 验证**

进入"设计" tab → 显示 iOS 外壳（自定义导航栏"设计"标题、"MY DESIGNS" eyebrow、"我的设计" 大标题、"开始新设计" CTA、方案列表或空态、三个导出按钮）。

若已有本地方案：点击某方案 → 跳 `cabinet/pages/materials`；点删除 → 弹窗；确认删除生效。

若空：显示"还没有保存的设计"卡。

点击"开始新设计" → 跳 `space-setup`。space-setup 应有系统顶栏。

- [ ] **Step 5: 知识库 tab 验证**

进入"知识库" tab → 显示 4 项列表。逐项点击：
- 🍋 柠檬塔快速预算 → 进 budget 页
- 📋 柠檬塔需求匹配表 → 进 needs 页
- ✅ 快速验收 → 进 inspect 页
- 🗺️ 全屋水路设备图 → Toast "图片加载失败"（因云存储未接）

- [ ] **Step 6: 我的 tab 验证**

进入"我的" tab → 显示未登录卡 "点击登录，解锁全部功能"、"联系我们" 菜单。

点击账户卡 → Toast "登录功能开发中"。

点击"联系我们" → 进入 contact 子页；点击复制微信号/邮箱 → Toast 提示已复制。

- [ ] **Step 7: 登录态测试**

在开发者工具 Console 里执行：
```js
wx.setStorageSync('userInfo', {openid:'test123456', nickName:'测试用户'})
```
然后点重启小程序。进入"我的"：应显示 "测试用户" + "ID · 123456"。

点铅笔 → 弹窗 → 修改昵称为"新昵称" → 保存 → Toast "已保存" → 头像/昵称更新。

重启小程序再进"我的"：昵称仍是"新昵称"，说明本地持久化生效。

- [ ] **Step 8: cabinet 3D 页面回归**

从 plan-list 进入 space-setup → 输入尺寸下一步 → cabinet/design 页面。3D 场景可正常渲染，无报错。

- [ ] **Step 9: 若前 8 步全部通过，回到主计划继续**

若发现问题，回到出问题的 Task，读代码 → 定位 → 修复 → 提交。

- [ ] **Step 10: 打 tag 标记完成**

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
git tag -a "migrate-3-tabs-2026-07-03" -m "首页/知识库/我的三栏移植完成"
```

---

## 完整任务概览

| # | Task | 关键动作 |
|---|---|---|
| 1 | 拷贝静态资源 | 14 个文件（12 png + 2 ttf）+ bg 占位 |
| 2 | 新增 utils 三件套 | assets.js / assets.wxs / share.js（USE_CDN=false，design 路径改 plan-list） |
| 3 | app.wxss 追加全局样式 | 源 iOS 类，`.container` 已改名 `.page-container` |
| 4 | app.js Mock 云方法 | 完整重写，保留 Promise 类型 |
| 5 | app.json 建立 tabBar | 13 页面 + 4 tab + custom 导航 |
| 6 | space-setup/cabinet 覆盖回 default | 4 个 index.json |
| 7 | 拷贝 home | 4 文件 + container 改名 + CTA 目标改 |
| 8 | 拷贝 knowledge（5 页） | 20 文件 + container 改名 |
| 9 | 拷贝 profile（5 页） | 20 文件 + container 改名 + profile.js 两处降级 |
| 10 | 重写 plan-list | wxml/wxss + 追加 nav 尺寸计算 |
| 11 | 手动验证 | 编译 + 4 tab + 登录态 + cabinet 回归 |

**注意事项：**
- 每个 Task 完成后必 commit，一次 commit 只覆盖 Task 范围。
- 若某个 wxml/wxss 里已经存在 page-container / iOS 类的冲突（例如同名类不同定义），优先保留源代码语义，只改动本 spec 指定的项。
- 若在编译时发现 Console 报错，先仔细读报错行号定位 —— 不要提前跳过 Task 11 的验证步骤。
- **千万不要**去改 cabinet/utils、cabinet/vendor、components/ 里的任何文件。

