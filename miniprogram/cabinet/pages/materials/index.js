// 5 组选项 + DEFAULT_MATERIALS 已抽到 utils/materials-options.js, 供页面 + pdf-exporter 等共用。
const {
  PANEL_OPTIONS,
  DOOR_PANEL_OPTIONS,
  DOOR_CRAFT_OPTIONS,
  HARDWARE_OPTIONS,
  LIGHTING_OPTIONS,
  DEFAULT_MATERIALS,
} = require('../../../utils/materials-options.js');

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
