// 选项 id 直接用 price / brand code, 保存到 plan.materials 后由 cost-engine v2 用 code 查价字典。
// name / desc 仅用于 UI 显示 —— 见 docs/superpowers/specs/2026-07-14-cost-calculation-redesign-design.md §4。

const PANEL_OPTIONS = [
  { id: 'panel_e2_domestic', name: 'E2 国产板', desc: '性价比之选' },
  { id: 'panel_tu_baby_domestic', name: '兔宝宝', desc: '国产环保板材' },
  { id: 'panel_kronospan_domestic', name: '国产克诺斯帮', desc: '中国制造，欧洲品牌' },
  { id: 'panel_kronospan_germany', name: '德国克诺斯帮', desc: '德国原装进口' },
  { id: 'panel_egger', name: '爱格', desc: '奥地利顶级板材' },
];

const DOOR_PANEL_OPTIONS = [
  { id: 'door_material_same_as_cabinet', name: '与柜体相同', desc: '不加价' },
  { id: 'door_material_piano_lacquer', name: '钢琴烤漆', desc: '光泽细腻' },
  { id: 'door_material_skin_feel_lacquer', name: '肤感烤漆', desc: '柔和触感' },
  { id: 'door_material_aluminum_frame_ag_glass', name: '铝框 AG 玻璃', desc: '通透显大' },
  { id: 'door_material_wood_veneer', name: '实木贴皮', desc: '木纹纹理' },
  { id: 'door_material_rubber_solid_wood', name: '橡胶实木', desc: '中等档次' },
  { id: 'door_material_ash_solid_wood', name: '白蜡实木', desc: '高端实木' },
];

const DOOR_CRAFT_OPTIONS = [
  { id: 'door_craft_none', name: '无' },
  { id: 'door_craft_skeleton_line_shallow', name: '骨格线' },
  { id: 'door_craft_european_deep', name: '欧式' },
  { id: 'door_craft_grille_door', name: '格栅门' },
];

// hardware 存的是 brand_type 本身 (domestic / import), 与 price code 的后缀对齐
const HARDWARE_OPTIONS = [
  { id: 'domestic', name: '中国品牌', desc: '默认 DTC' },
  { id: 'import', name: '海外品牌', desc: '百隆 + 海福乐' },
];

// lighting 是分流: none / led_domestic / led_import, 与 hardware 独立
const LIGHTING_OPTIONS = [
  { id: 'none', name: '无' },
  { id: 'led_domestic', name: '国产灯带', desc: '10mm × 10mm 超薄' },
  { id: 'led_import', name: '海福乐灯带', desc: '柔光均匀' },
];

const DEFAULT_MATERIALS = {
  panel: 'panel_e2_domestic',
  doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none',
  hardware: 'domestic',
  lighting: 'none',
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
