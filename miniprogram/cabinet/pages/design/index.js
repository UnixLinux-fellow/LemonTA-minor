const cabinetModel = require('../../utils/cabinet-model.js');
const layoutEngine = require('../../utils/layout-engine.js');
const imgCache = require('../../../utils/img-cache.js');
const glbMetadata = require('../../../utils/glb-metadata.js');

// 管理员 openid 白名单。命中则 source_type = 'official_standard',
// 否则 'normal_user'。目前空,后续由运营手动填并发版。
const ADMIN_OPENIDS = [];

const MODEL_PANEL_HARDWARE = 'model_panel_hardware';
const UPLOAD_ROOT = 'cabinet-model-standard';

const COLORS = [
  { id: 'white', label: '白色', css: '#f0f0e7' },
  { id: 'beige', label: '米色', css: '#f1e4cb' },
  { id: 'gray', label: '灰色', css: '#9ca3af' },
  { id: 'wood', label: '原木色', css: '#c69661' },
];

const COLOR_CSS = {
  white: '#f0f0e7',
  beige: '#f1e4cb',
  gray: '#9ca3af',
  wood: '#c69661',
};

const CORNER_LABEL = {
  WZJ: '无转角',
  ZZJ: '左转角',
  YZJ: '右转角',
  ZYZJ: '双侧转角',
};

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

Page({
  data: {
    plan: null,
    items: [],
    meta: null,
    standardWidth: 0,
    standardUsed: 0,
    nonStandardWidth: 0,
    sizeTab: 50,
    selectedModelIdx: 0,
    modelList: [],
    colors: COLORS,
    color: 'white',
    colorCss: COLOR_CSS.white,
    showDoor: false,
    confirmReady: false,
    cornerLabel: '',
    nextBtnText: '下一模块',
    show50: true,
    show100: true,
    remainingStd: 0,
    rotation: { x: 0, y: 0 },
    zoom: 1,
    scrollNeeded: false,
    thumbWidthPct: 100,
    thumbLeftPct: 0,
    scrollViewLeft: 0,
    toast: '',
    uploadModalVisible: false,
  },

  onLoad() {
    const plan = getApp().globalData.draftPlan;
    if (!plan) {
      wx.navigateBack();
      return;
    }
    // 微信框架不会 await 异步 onLoad —— onReady 会紧接着触发。用一个 Promise 桥接：
    // onReady 里 await this._loadReady 才能保证 this._state / this.data.plan 已就位
    this._loadReady = (async () => {
      const modelSync = require('../../../utils/model-sync.js');
      try {
        await modelSync.onManifestReady();
      } catch (e) {
        console.warn('[design] manifest not ready', e);
        this.setData({ toast: '模型资源加载失败，请检查网络后重试' });
      }
      const allModels = cabinetModel.localModels();
      const grouped = cabinetModel.categorize(allModels);
      this._allModels = allModels;
      this._grouped = grouped;

      const state = layoutEngine.init({
        wall: plan.wall,
        cornerType: plan.cornerType,
        hasRaise: plan.hasRaise,
      });
      this._state = state;

      await new Promise((resolve) => {
        this.setData({
          plan,
          cornerLabel: CORNER_LABEL[plan.cornerType],
          modelList: grouped.s50,
          items: state.items,
          meta: state.meta,
          standardWidth: state.meta.standardWidth,
          standardUsed: state.meta.standardUsed,
          nonStandardWidth: state.meta.nonStandardWidth,
        }, () => {
          this._updateScrollIndicator();
          resolve();
        });
      });
    })().catch((err) => {
      console.error('[design] onLoad failed', err);
    });
  },

  async onReady() {
    if (this._loadReady) {
      try { await this._loadReady; } catch (e) { /* onLoad 已 warn */ }
    }
    const plan = this.data.plan;
    if (!plan) return;
    let ThreeRendererCls;
    try {
      ThreeRendererCls = require('../../utils/three-renderer.js');
    } catch (e) {
      console.error('three-renderer require failed', e);
      wx.showModal({
        title: '3D 渲染初始化失败',
        content: '请在微信开发者工具中点击"工具 → 构建 npm"后重新编译。\n错误: ' + (e && e.message),
        showCancel: false,
      });
      return;
    }
    const query = wx.createSelectorQuery();
    query.select('#webgl').fields({ node: true, size: true });
    // snap2d 是给 iOS 截图用的离屏 2d canvas，跟 webgl canvas 一并查出来
    query.select('#snap2d').fields({ node: true });
    query.exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.warn('webgl canvas node missing');
          return;
        }
        const canvas = res[0].node;
        const cssWidth = res[0].width || 320;
        const cssHeight = res[0].height || 220;
        const sysInfo = wx.getSystemInfoSync();
        const dpr = sysInfo.pixelRatio || 1;
        try {
          const renderer = new ThreeRendererCls();
          renderer.initRoom(canvas, { cssWidth, cssHeight, dpr }, {
            wall: plan.wall,
            hasRaise: plan.hasRaise,
          });
          this._renderer = renderer;
          // 把 2d 截图画布交给 renderer（iOS 真机 canvasToTempFilePath 不能直接吃 webgl canvas）
          if (res[1] && res[1].node && renderer.setSnapshotCanvas) {
            renderer.setSnapshotCanvas(res[1].node);
          } else {
            console.warn('snap2d canvas missing, iOS screenshot will fail');
          }
          renderer.setItems(layoutEngine.renderRows(this._state));

          // 给当前 picker 里每个 cell 各起一个 mini 3D 渲染
          this._ThreeRendererCls = ThreeRendererCls;
          this._thumbRenderers = [];
          this._refreshThumbCanvases();
        } catch (e) {
          console.error('three init failed', e);
          wx.showToast({ title: '3D 初始化失败:' + (e && e.message || ''), icon: 'none', duration: 4000 });
        }
      });
  },

  // 按当前 modelList 长度更新底部自定义滑动条的状态
  // 设计假设：picker-bar 内宽可见 3 个 cell（cell 220rpx + margin 14rpx，3*234=702rpx 正好）
  _updateScrollIndicator() {
    const total = (this.data.modelList || []).length;
    const visibleCells = 3;
    if (total <= visibleCells) {
      this.setData({ scrollNeeded: false, thumbLeftPct: 0, scrollViewLeft: 0 });
      return;
    }
    this.setData({
      scrollNeeded: true,
      thumbWidthPct: (visibleCells / total) * 100,
      thumbLeftPct: 0,
      scrollViewLeft: 0,
    }, () => {
      this._measureScrollGeometry();
    });
  },

  // 量 indicator track 的实际像素宽 + 由 cell 几何算出 scroll-view 内容/可见宽，
  // 用于把 indicator 上的 touch.x 反算成 scroll-view 的 scrollLeft（首次拖动前的兜底，
  // 之后 onPickerScroll 会以真实 scrollWidth 覆盖更准的值）
  _measureScrollGeometry() {
    wx.createSelectorQuery().in(this)
      .select('.scroll-indicator').boundingClientRect()
      .exec((res) => {
        this._indicatorTrackPx = (res && res[0]) ? res[0].width : 0;
      });
    const sys = wx.getSystemInfoSync();
    const rpxToPx = sys.windowWidth / 750;
    const N = (this.data.modelList || []).length;
    const cellPx = 220 * rpxToPx;
    const marginPx = 14 * rpxToPx;
    const contentPx = N * cellPx + Math.max(0, N - 1) * marginPx;
    // picker-bar 左右各 24rpx padding，scroll-view 可见宽 = window - 48rpx
    const visiblePx = sys.windowWidth - 48 * rpxToPx;
    this._scrollMaxLeftPx = Math.max(0, contentPx - visiblePx);
  },

  // scroll-view 滑动回调：把 scrollLeft 转成 thumb 的 left 百分比
  onPickerScroll(e) {
    if (!this.data.scrollNeeded) return;
    // 拖 thumb 期间由 indicator 自己驱动 scrollViewLeft，此时若用 scroll-view 的回包反算 thumb
    // 会形成 thumb 与手指相互拉扯的抖动，直接跳过
    if (this._draggingIndicator) return;
    const { scrollLeft, scrollWidth } = e.detail;
    const visibleRatio = this.data.thumbWidthPct / 100;
    const visibleWidth = scrollWidth * visibleRatio;
    const maxScroll = Math.max(scrollWidth - visibleWidth, 1);
    const progress = Math.min(1, Math.max(0, scrollLeft / maxScroll));
    const range = 100 - this.data.thumbWidthPct;
    // 拿真实 maxScroll 校准首次估算值
    this._scrollMaxLeftPx = maxScroll;
    // 同步保存当前 scrollLeft 到 data，避免下一次设 scroll-left 时跟实际位置差太多导致跳变
    this.setData({ thumbLeftPct: progress * range, scrollViewLeft: scrollLeft });
  },

  onIndicatorTouchStart(e) {
    if (!this.data.scrollNeeded) return;
    if (!this._indicatorTrackPx) this._measureScrollGeometry();
    this._draggingIndicator = true;
    this._dragStart = {
      touchX: e.touches[0].clientX,
      thumbLeftPct: this.data.thumbLeftPct,
    };
  },

  onIndicatorTouchMove(e) {
    if (!this._draggingIndicator || !this._dragStart) return;
    const trackPx = this._indicatorTrackPx;
    if (!trackPx) return;
    const range = 100 - this.data.thumbWidthPct;
    if (range <= 0) return;
    const dx = e.touches[0].clientX - this._dragStart.touchX;
    const dxPct = (dx / trackPx) * 100;
    let newThumbPct = this._dragStart.thumbLeftPct + dxPct;
    newThumbPct = Math.max(0, Math.min(range, newThumbPct));
    const progress = newThumbPct / range;
    const newScrollLeft = Math.round(progress * (this._scrollMaxLeftPx || 0));
    this.setData({
      thumbLeftPct: newThumbPct,
      scrollViewLeft: newScrollLeft,
    });
  },

  onIndicatorTouchEnd() {
    this._draggingIndicator = false;
    this._dragStart = null;
  },

  // 销毁现有 thumb 上的所有 mini renderer，并清空数组
  _disposeThumbCanvases() {
    if (!this._thumbRenderers) return;
    this._thumbRenderers.forEach((r) => {
      try { r && r.dispose && r.dispose(); } catch (e) { /* ignore */ }
    });
    this._thumbRenderers = [];
  },

  // 给当前 modelList 里每个 cell 起一个独立 mini 3D 渲染
  // 调用前提：setData(modelList) 之后等到 WXML 完成渲染（用 setData 的 callback 触发）
  _refreshThumbCanvases() {
    if (!this._ThreeRendererCls) return;
    this._disposeThumbCanvases();
    const ThreeRendererCls = this._ThreeRendererCls;
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 1;
    const modelList = (this.data.modelList || []).map((m) =>
      Object.assign({}, m, { kind: 'standard' })
    );
    const colorId = this._state ? this._state.meta.color : this.data.color;

    modelList.forEach((item, idx) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#thumb-canvas-' + idx)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            console.warn('[thumb] canvas missing idx=' + idx);
            return;
          }
          const canvas = res[0].node;
          const cssWidth = res[0].width || 70;
          const cssHeight = res[0].height || 100;
          const r = new ThreeRendererCls();
          try {
            r.initPreview(canvas, { cssWidth, cssHeight, dpr });
            r.renderSingle(item, colorId);
          } catch (e) {
            console.warn('[thumb] init/render failed idx=' + idx, e);
            return;
          }
          this._thumbRenderers[idx] = r;
        });
    });
  },

  // 已有 renderer，仅刷新颜色（切色卡时调用）
  _recolorThumbCanvases(colorId) {
    if (!this._thumbRenderers || !this.data.modelList) return;
    this.data.modelList.forEach((m, idx) => {
      const r = this._thumbRenderers[idx];
      if (!r) return;
      const item = Object.assign({}, m, { kind: 'standard' });
      try { r.renderSingle(item, colorId); } catch (e) { /* ignore */ }
    });
  },

  onUnload() {
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = null;
    }
    this._disposeThumbCanvases();
  },

  recompute() {
    const state = this._state;
    const remaining = layoutEngine.standardRemaining(state);
    // 末块查找：sizeTab 决策与 B-On 高亮共用
    const stds = state.items.filter((it) => it.kind === 'standard');
    const last = stds[stds.length - 1];
    let show50 = true;
    let show100 = true;
    let sizeTab = this.data.sizeTab;
    if (state.meta.isFull) {
      show50 = false;
      show100 = false;
    } else if (remaining < 100) {
      // 末块若是 50 且换 100 后仍能装下，则允许 100cm tab
      const replaceTo100Ok = last && (state.meta.standardUsed - last.w + 100) <= state.meta.standardWidth;
      if (!replaceTo100Ok) {
        show100 = false;
        sizeTab = 50;
      }
    }
    const list = sizeTab === 50 ? this._grouped.s50 : this._grouped.s100;
    const prevModelKey = (this.data.modelList || []).map((m) => m.name).join('|');
    const nextModelKey = list.map((m) => m.name).join('|');
    const modelListChanged = prevModelKey !== nextModelKey;
    // B-On：picker 高亮跟随末块
    let selIdx = -1;
    if (last && last.w === sizeTab) {
      selIdx = list.findIndex((m) => m.code === last.code);
    }
    this.setData({
      items: state.items,
      meta: state.meta,
      standardWidth: state.meta.standardWidth,
      standardUsed: state.meta.standardUsed,
      nonStandardWidth: state.meta.nonStandardWidth,
      color: state.meta.color,
      colorCss: COLOR_CSS[state.meta.color] || COLOR_CSS.white,
      showDoor: state.meta.showDoor,
      confirmReady: state.meta.isFull,
      nextBtnText: state.meta.isFull ? '确认布局' : '下一模块',
      sizeTab,
      modelList: list,
      show50,
      show100,
      remainingStd: remaining,
      selectedModelIdx: selIdx,
    }, () => {
      // modelList 变了（剩余宽度触发 50/100 切换）才重建 thumb canvas，避免空动作
      if (modelListChanged) {
        this._refreshThumbCanvases();
        this._updateScrollIndicator();
      }
    });
    if (this._renderer) {
      this._renderer.setColor(state.meta.color);
      this._renderer.setShowDoor(state.meta.showDoor);
      this._renderer.setItems(layoutEngine.renderRows(state));
    }
  },

  onSwitchSize(e) {
    const v = parseInt(e.currentTarget.dataset.v, 10);
    this.setData({ sizeTab: v }, () => {
      this.recompute();
    });
  },

  onPickModel(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.modelList[idx];
    if (!m) return;
    // 左转角场景下，初始 state 没有任何 standard，replaceLast 会失败；
    // 此时点 picker 的语义应当是"放第一个标准柜"，退化为 addNext。
    const hasStandard = this._state.items.some((it) => it.kind === 'standard');
    const r = hasStandard
      ? layoutEngine.replaceLast(this._state, { code: m.code, size: this.data.sizeTab })
      : layoutEngine.addNext(this._state, { code: m.code, size: this.data.sizeTab });
    if (!r.ok) {
      this.showToast(r.message || '替换失败');
      return;
    }
    // 高亮先按用户点的 idx 设置；recompute 末尾会按"末块镜像"再校准一次
    this.setData({ selectedModelIdx: idx });
    this.recompute();
  },

  onPickColor(e) {
    const id = e.currentTarget.dataset.id;
    layoutEngine.applyColor(this._state, id);
    this.recompute();
    this._recolorThumbCanvases(this._state.meta.color);
  },

  onToggleDoor() {
    layoutEngine.toggleDoor(this._state);
    this.recompute();
  },

  onResetWall() {
    wx.redirectTo({ url: '/pages/space-setup/index' });
  },

  onPrev() {
    const state = this._state;
    // 第一格判断只看 standard：左转角下首位由 corner 占据，corner 不可删；
    // 唯一的 standard 是用户主动添加的，可以删
    const standards = state.items.filter((it) => it.kind === 'standard');
    if (standards.length === 1 && standards[0].isFirst && !state.meta.isFull) {
      this.showToast('第一个模块只能替换，不能删除');
      return;
    }
    const r = layoutEngine.removeLast(state);
    if (!r.ok) {
      this.showToast(r.message || '无可删除模块');
    }
    this.recompute();
  },

  onNext() {
    const state = this._state;
    if (state.meta.isFull) {
      this.onConfirmLayout();
      return;
    }
    const list = this.data.modelList;
    const m = list[this.data.selectedModelIdx] || list[0];
    if (!m) return;
    const remaining = layoutEngine.standardRemaining(state);
    let chosen = { code: m.code, size: this.data.sizeTab };
    if (remaining < this.data.sizeTab) {
      const fb = this._grouped.s50[0];
      chosen = { code: fb.code, size: 50 };
    }
    const r = layoutEngine.addNext(state, chosen);
    if (!r.ok) {
      this.showToast(r.message || '无法添加');
    }
    this.recompute();
  },

  /**
   * 上传单张图到云存储；成功后 imgCache.register 挂钩，返回 fileID。
   * 失败返回 ''。空 wxfile 输入直接 resolve ''。
   */
  _uploadDesignImage(wxfilePath, planId, tag, ext) {
    if (!wxfilePath) return Promise.resolve('');
    if (!wx.cloud || !wx.cloud.uploadFile) return Promise.resolve('');
    const cloudPath = 'designs/' + planId + '_' + Date.now() + '_' + tag + '.' + (ext || 'png');
    return wx.cloud.uploadFile({ cloudPath, filePath: wxfilePath })
      .then((res) => {
        const fileID = res && res.fileID;
        if (fileID) {
          try { imgCache.register(fileID, wxfilePath); } catch (e) { /* ignore */ }
        }
        return fileID || '';
      })
      .catch((err) => {
        console.warn('[design] uploadFile ' + tag + ' 失败:', err && err.errMsg);
        return '';
      });
  },

  async onConfirmLayout() {
    const state = this._state;
    const plan = this.data.plan;
    const meta = {
      userTag: 'guest',
      timestamp: plan.timestamp,
      name: plan.name,
    };
    const layoutSerialized = layoutEngine.serialize(state, meta);
    const cabinets = layoutEngine.flattenCabinets(state);
    // 方案完整命名（用户名-时间-名称-转角-H-h-W-w）
    const cornerCodeMap = { WZJ: 'WZJ', ZZJ: 'ZZJ', YZJ: 'YZJ', ZYZJ: 'SZJ' };
    const planFullName = [
      'guest',
      plan.timestamp,
      plan.name,
      cornerCodeMap[plan.cornerType] || 'WZJ',
      'H-' + plan.wall.h,
      'W-' + plan.wall.w,
    ].join('-');
    // 加高模块也算"一个柜子"
    const cabinetCount = cabinets.length;
    const cornerLabelMap = {
      WZJ: '无转角',
      ZZJ: '左转角',
      YZJ: '右转角',
      ZYZJ: '双侧转角',
    };
    // 截两张主 3D 图：previewImage（带墙）+ wireframeImage（去墙），都是正面 / zoom=1.5 / jpg
    let previewImage = '';
    let wireframeImage = '';
    if (this._renderer) {
      try {
        if (this._renderer.captureLayoutImage) {
          previewImage = await this._renderer.captureLayoutImage(0.95) || '';
        }
        if (this._renderer.captureWireframeImage) {
          wireframeImage = await this._renderer.captureWireframeImage(0.95) || '';
        }
      } catch (e) {
        console.warn('preview capture failed', e && e.message);
      }
    }

    // 并行上传 3 张图到云存储
    const app = getApp();
    const photoExt = (plan.photoPath && (plan.photoPath.match(/\.([a-zA-Z0-9]+)$/) || [])[1]) || 'jpg';
    const [previewFileID, wireframeFileID, photoFileID] = await Promise.all([
      this._uploadDesignImage(previewImage,   plan.id, 'preview', 'png'),
      this._uploadDesignImage(wireframeImage, plan.id, 'wire',    'png'),
      this._uploadDesignImage(plan.photoPath, plan.id, 'photo',   photoExt.toLowerCase()),
    ]);

    // 回填内存 plan：既留 FileID 也留本地路径，供本次会话直接渲染，跳过一次云端下载
    const updatedPlan = Object.assign({}, plan, {
      layout: { items: state.items, meta: state.meta },
      cabinets,
      layoutSerialized,
      planFullName,
      cabinetCount,
      cornerLabel: cornerLabelMap[plan.cornerType] || '无转角',
      color: state.meta.color,
      showDoor: state.meta.showDoor,
      previewImage,
      wireframeImage,
      wireframeHasLabels: false,
      wireframeLabelsVersion: 0, // 原始图，未烘编号；成本页会用当前版本重烘
      previewFileID: previewFileID || plan.previewFileID || '',
      wireframeFileID: wireframeFileID || plan.wireframeFileID || '',
      photoFileID: photoFileID || plan.photoFileID || '',
    });

    // 写入云 designs 集合（app.saveDesign 内部会剔除 wxfile 字段）
    const saveRes = await app.saveDesign(updatedPlan);
    if (saveRes && saveRes.success) {
      updatedPlan._id = saveRes._id || updatedPlan._id;
    } else {
      wx.showModal({
        title: '保存失败',
        content: (saveRes && saveRes.msg) || '请检查网络后重试',
        showCancel: false,
      });
      return;
    }

    getApp().globalData.draftPlan = updatedPlan;
    getApp().globalData.currentPlan = updatedPlan;
    wx.redirectTo({ url: '/cabinet/pages/materials/index?from=design' });
  },

  showToast(msg) {
    this.setData({ toast: msg });
    setTimeout(() => this.setData({ toast: '' }), 2000);
  },

  onOpenUploadModal() {
    this.setData({ uploadModalVisible: true });
  },

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

  onTouchStartCanvas(e) {
    if (!e.touches) return;
    if (e.touches.length === 2) {
      // 双指捏合缩放：记录初始两指距离与当前 zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this._pinch = {
        dist: Math.sqrt(dx * dx + dy * dy) || 1,
        zoom: this.data.zoom,
      };
      this._touch = null;
      return;
    }
    if (e.touches.length === 1) {
      this._pinch = null;
      this._touch = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        rx: this.data.rotation.x,
        ry: this.data.rotation.y,
      };
    }
  },

  onTouchMoveCanvas(e) {
    if (!e.touches) return;
    // 双指：用两指距离比缩放
    if (e.touches.length === 2 && this._pinch) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const cur = Math.sqrt(dx * dx + dy * dy) || 1;
      const ratio = cur / this._pinch.dist;
      let z = this._pinch.zoom * ratio;
      z = Math.max(0.75, Math.min(2.5, z));
      if (z !== this.data.zoom) {
        this.setData({ zoom: z });
        if (this._renderer) this._renderer.setZoom(z);
      }
      return;
    }
    // 单指：旋转
    if (this._touch && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this._touch.x;
      const dy = e.touches[0].clientY - this._touch.y;
      let ry = this._touch.ry + dx * 0.005;
      let rx = this._touch.rx - dy * 0.005;
      rx = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, rx));
      ry = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, ry));
      this.setData({ rotation: { x: rx, y: ry } });
      if (this._renderer) this._renderer.setRotation(rx, ry);
    }
  },

  onTouchEndCanvas(e) {
    // 抬起后清空状态，避免下次按下时遗留 pinch/touch
    if (!e.touches || e.touches.length === 0) {
      this._touch = null;
      this._pinch = null;
    } else if (e.touches.length === 1) {
      // 双指改单指：重置成旋转模式
      this._pinch = null;
      this._touch = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        rx: this.data.rotation.x,
        ry: this.data.rotation.y,
      };
    }
  },

  onCanvasWheel(e) {
    // 鼠标滚轮缩放：deltaY < 0 向上滚轮 = 放大；> 0 向下滚轮 = 缩小
    const deltaY = (e && e.detail && typeof e.detail.deltaY === 'number')
      ? e.detail.deltaY
      : (e && typeof e.deltaY === 'number' ? e.deltaY : 0);
    if (!deltaY) return;
    const step = deltaY > 0 ? -0.08 : 0.08;
    const z = Math.max(0.5, Math.min(2.5, this.data.zoom + step));
    if (z === this.data.zoom) return;
    this.setData({ zoom: z });
    if (this._renderer) this._renderer.setZoom(z);
  },
});
