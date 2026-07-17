// 5 组选项 + DEFAULT_MATERIALS 已抽到 utils/materials-options.js, 供页面 + pdf-exporter 等共用。
const {
  PANEL_OPTIONS,
  DOOR_PANEL_OPTIONS,
  DOOR_CRAFT_OPTIONS,
  HARDWARE_OPTIONS,
  LIGHTING_OPTIONS,
  DEFAULT_MATERIALS,
} = require('../../../utils/materials-options.js');
const costEngine = require('../../../utils/cost-engine.js');
const bootstrap = require('../../../utils/bootstrap.js');

Page({
  data: {
    plan: null,
    from: 'design', // design | list
    materials: Object.assign({}, DEFAULT_MATERIALS),
    panelOpts: PANEL_OPTIONS,
    doorPanelOpts: DOOR_PANEL_OPTIONS,
    doorCraftOpts: DOOR_CRAFT_OPTIONS,
    hardwareOpts: HARDWARE_OPTIONS,
    lightingOpts: LIGHTING_OPTIONS,
    cabinetCount: 0,
    bottomRow: [],
    topRow: [],
    // —— 费用预览 —— //
    cost: null,           // { grandTotal, panelTotal, hardwareTotal, transport, install, categoryCost }
    dataReady: false,     // 价格字典是否就绪
    dataNotice: '',       // 未就绪时的提示文案
    // —— 吸顶控制 (js 驱动, 见 wxss 注释解释为何不用 position:sticky) —— //
    isSticky: false,      // 页面下滑越过阈值后为 true
    previewHeight: 0,     // .cost-preview 的实际像素高度, 供占位块保等高
  },

  onLoad(query) {
    const from = query.from || 'design';
    let plan;
    if (from === 'list') {
      plan = getApp().globalData.currentPlan;
    } else {
      plan = getApp().globalData.draftPlan;
    }
    if (!plan) {
      wx.navigateBack();
      return;
    }
    const cabinets = plan.cabinets || [];
    const materials = plan.materials || Object.assign({}, DEFAULT_MATERIALS);
    const bottomRow = cabinets.filter((c) => c.kind !== 'raise');
    const topRow = cabinets.filter((c) => c.kind === 'raise');
    this.setData({
      plan,
      from,
      materials,
      // 加高模块也算"一个柜子"
      cabinetCount: cabinets.length,
      bottomRow,
      topRow,
    });
    this._computeCost();
  },

  onReady() {
    this._measureStickyThreshold();
  },

  // 预览图 mode=widthFix 是异步加载, 加载完成会撑高 .preview-wireframe, 让 .cost-preview
  // 的位置发生变化 —— 必须在图片 load 后重新测一次, 否则阈值偏小会导致一进页面就吸顶。
  onPreviewImageLoaded() {
    this._measureStickyThreshold();
  },

  // 测量 .cost-preview 的 top (吸顶阈值) 与自身高度 (占位块保等高)。
  // top 用页面坐标系 = rect.top (相对视口) + scrollTop (当前滚动位置), 与 onPageScroll
  // 收到的 e.scrollTop 同坐标系。
  // 仅在非吸顶状态测量: 吸顶时 .cost-preview 是 fixed, rect.top=0 会污染阈值。
  _measureStickyThreshold() {
    if (this.data.isSticky) return;
    wx.createSelectorQuery().in(this)
      .select('.cost-preview').boundingClientRect()
      .selectViewport().scrollOffset()
      .exec((res) => {
        if (!res || !res[0]) return;
        const rect = res[0];
        const scrollTop = (res[1] && res[1].scrollTop) || 0;
        this._stickyThreshold = rect.top + scrollTop;
        if (rect.height && rect.height !== this.data.previewHeight) {
          this.setData({ previewHeight: rect.height });
        }
      });
  },

  onPageScroll(e) {
    if (typeof this._stickyThreshold !== 'number') return;
    const shouldStick = e.scrollTop >= this._stickyThreshold;
    // 短路: 状态没变不 setData, 避免每帧刷新
    if (shouldStick !== this.data.isSticky) {
      this.setData({ isSticky: shouldStick });
    }
  },

  pickPanel(e) {
    this._pick('panel', e.currentTarget.dataset.id);
  },
  pickDoorPanel(e) {
    this._pick('doorPanel', e.currentTarget.dataset.id);
  },
  pickDoorCraft(e) {
    this._pick('doorCraft', e.currentTarget.dataset.id);
  },
  pickHardware(e) {
    this._pick('hardware', e.currentTarget.dataset.id);
  },
  pickLighting(e) {
    this._pick('lighting', e.currentTarget.dataset.id);
  },
  _pick(key, id) {
    const m = Object.assign({}, this.data.materials, { [key]: id });
    this.setData({ materials: m });
    this._computeCost();
  },

  async _computeCost() {
    await bootstrap.ensureCostDataReady();
    const plan = this.data.plan;
    if (!plan) return;
    if (!bootstrap.isAllReady()) {
      this.setData({
        cost: null,
        dataReady: false,
        dataNotice: '价格数据未就绪，请重试',
      });
      return;
    }
    // 与 cost/index.js 不同, 这里加 try/catch 防御性兜底: 用户在选择页会频繁切换选项,
    // engine 若因字典部分 miss 抛错也不该让 UI 卡死。见 spec §6.2。
    try {
      const cost = costEngine.calc({
        cabinets: plan.cabinets || [],
        materials: this.data.materials,
        wall: plan.wall,
      });
      this.setData({ cost, dataReady: true, dataNotice: '' });
    } catch (err) {
      console.warn('[materials] _computeCost failed:', err);
      this.setData({ cost: null, dataReady: false, dataNotice: '计算失败，请重试' });
    }
  },

  onRetryDataFetch() {
    this.setData({ dataNotice: '正在重试…' });
    bootstrap.ensureCostDataReady({ force: true }).then(() => this._computeCost());
  },

  async onCalc() {
    const plan = Object.assign({}, this.data.plan, {
      materials: this.data.materials,
    });
    const app = getApp();
    // 已有 _id 才能命中云端 update；没有说明是走 list 场景但缓存里已被替换过（罕见）
    if (plan._id) {
      const res = await app.saveDesign(plan);
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.msg) || '保存失败', icon: 'none' });
        return;
      }
    } else {
      console.warn('[materials] plan has no _id, skipping saveDesign');
    }
    if (this.data.from === 'design') {
      app.globalData.draftPlan = plan;
    }
    app.globalData.currentPlan = plan;
    wx.redirectTo({
      url: '/cabinet/pages/cost/index?from=' + this.data.from + '&id=' + plan.id,
    });
  },
});
