const planStore = require('../../../utils/plan-store.js');
const cloud = require('../../../utils/cloud.js');

const PANEL_OPTIONS = [
  { id: 'E2国产板', name: 'E2 国产板', desc: '性价比之选' },
  { id: '兔宝宝', name: '兔宝宝', desc: '国产环保板材' },
  { id: '克诺斯帮', name: '克诺斯帮', desc: '中国制造，欧洲品牌' },
  { id: '德国克诺斯帮', name: '德国克诺斯帮', desc: '德国原装进口' },
  { id: '爱格', name: '爱格', desc: '奥地利顶级板材' },
];

const DOOR_PANEL_OPTIONS = [
  { id: '柜体相同', name: '与柜体相同', desc: '不加价' },
  { id: '钢琴烤漆', name: '钢琴烤漆', desc: '光泽细腻' },
  { id: '肤感烤漆', name: '肤感烤漆', desc: '柔和触感' },
  { id: '铝框AG玻璃', name: '铝框 AG 玻璃', desc: '通透显大' },
  { id: '实木贴皮', name: '实木贴皮', desc: '木纹纹理' },
  { id: '橡胶实木', name: '橡胶实木', desc: '中等档次' },
  { id: '白蜡实木', name: '白蜡实木', desc: '高端实木' },
];

const DOOR_CRAFT_OPTIONS = [
  { id: '无', name: '无' },
  { id: '骨格线', name: '骨格线' },
  { id: '欧式', name: '欧式' },
  { id: '格栅门', name: '格栅门' },
];

const HARDWARE_OPTIONS = [
  { id: '中国品牌', name: '中国品牌', desc: '默认 DTC' },
  { id: '海外品牌', name: '海外品牌', desc: '百隆 + 海福乐' },
];

const LIGHTING_OPTIONS = [
  { id: '无', name: '无' },
  { id: '国产', name: '国产灯带', desc: '10mm × 10mm 超薄' },
  { id: '进口', name: '海福乐灯带', desc: '柔光均匀' },
];

const DEFAULT_MATERIALS = {
  panel: 'E2国产板',
  doorPanel: '柜体相同',
  doorCraft: '无',
  hardware: '中国品牌',
  lighting: '无',
};

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

  onCalc() {
    const plan = Object.assign({}, this.data.plan, {
      materials: this.data.materials,
    });
    // 保存方案到本地
    planStore.upsert(plan);
    if (this.data.from === 'design') {
      getApp().globalData.draftPlan = plan;
    }
    getApp().globalData.currentPlan = plan;
    cloud.saveMaterials(plan.id, plan.materials);
    wx.redirectTo({
      url: '/cabinet/pages/cost/index?from=' + this.data.from + '&id=' + plan.id,
    });
  },
});
