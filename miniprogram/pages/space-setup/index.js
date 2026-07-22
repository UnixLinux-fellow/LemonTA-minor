const rules = require('../../utils/cabinet-rules.js');
const planStore = require('../../utils/plan-store.js');

Page({
  data: {
    photoPath: '',
    name: '',
    wallW: '',
    wallH: '',
    cornerType: 'WZJ',
    errorMsg: '',
    canSubmit: false,
    mode: 'wardrobe',
    wallHint: { w: '44 ~ 1000 cm', h: '232 ~ 1000 cm' },
    cornerSectionLabel: '是否有转角衣柜',
    cornerOptions: [
      { id: 'WZJ',  name: '无转角' },
      { id: 'ZZJ',  name: '左转角柜' },
      { id: 'YZJ',  name: '右转角柜' },
      { id: 'ZYZJ', name: '双侧转角柜' },
    ],
  },

  CORNER_OPTIONS_WARDROBE: [
    { id: 'WZJ',  name: '无转角' },
    { id: 'ZZJ',  name: '左转角柜' },
    { id: 'YZJ',  name: '右转角柜' },
    { id: 'ZYZJ', name: '双侧转角柜' },
  ],
  CORNER_OPTIONS_SHOE: [
    { id: 'BKQ',  name: '不靠墙' },
    { id: 'ZKQ',  name: '左靠墙' },
    { id: 'YKQ',  name: '右靠墙' },
    { id: 'ZYKQ', name: '左右靠墙' },
  ],

  onLoad() {
    // 首次进页触发 UI 文案字典拉取 (fire-and-forget, 命中缓存即零耗时)
    require('../../utils/bootstrap.js').ensureUiDescReady();

    const draft = getApp().globalData.draftPlan;
    const mode = (draft && draft.mode) || 'wardrobe';
    const isShoe = mode === 'shoe';
    const wallHint = isShoe
      ? { w: '80 ~ 300 cm', h: '220 ~ 270 cm' }
      : { w: '44 ~ 1000 cm', h: '232 ~ 1000 cm' };
    const cornerOptions = isShoe ? this.CORNER_OPTIONS_SHOE : this.CORNER_OPTIONS_WARDROBE;
    const cornerSectionLabel = isShoe ? '是否靠墙' : '是否有转角衣柜';
    const defaultCorner = isShoe ? 'BKQ' : 'WZJ';
    this.setData({
      mode,
      wallHint,
      cornerOptions,
      cornerSectionLabel,
      photoPath: (draft && draft.photoPath) || '',
      name: (draft && draft.name) || '',
      wallW: draft && draft.wall && draft.wall.w ? String(draft.wall.w) : '',
      wallH: draft && draft.wall && draft.wall.h ? String(draft.wall.h) : '',
      cornerType: (draft && draft.cornerType) || defaultCorner,
    });
    if (draft && draft.wall) this.validate();
  },

  onChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (f) this.setData({ photoPath: f.tempFilePath });
      },
    });
  },

  onInputName(e) {
    this.setData({ name: e.detail.value });
    this.validate();
  },

  onInputW(e) {
    this.setData({ wallW: e.detail.value });
    this.validate();
  },

  onInputH(e) {
    this.setData({ wallH: e.detail.value });
    this.validate();
  },

  onCornerChange(e) {
    this.setData({ cornerType: e.detail.id });
    this.validate();
  },

  validate() {
    const { name, wallW, wallH, cornerType, mode } = this.data;
    const w = parseInt(wallW, 10);
    const h = parseInt(wallH, 10);

    const draft = getApp().globalData.draftPlan;
    const editingId = draft && draft.id;
    const existingNames = (getApp().globalData.designs || [])
      .filter((p) => p.id !== editingId)
      .map((p) => p.name);

    let errorMsg = '';
    let ok = true;

    const nameCheck = rules.validateName(name, existingNames);
    if (!nameCheck.ok) {
      ok = false;
      errorMsg = nameCheck.message;
    }
    if (ok && wallW && wallH) {
      const wallCheck = rules.validateWall(w, h, mode);
      if (!wallCheck.ok) {
        ok = false;
        errorMsg = wallCheck.message;
      }
    }
    // 鞋柜模式跳过转角与标准段校验
    if (ok && wallW && mode !== 'shoe') {
      const cornerCheck = rules.validateCorner(w, cornerType);
      if (!cornerCheck.ok) {
        ok = false;
        errorMsg = cornerCheck.message;
      }
    }
    if (ok && wallW && mode !== 'shoe') {
      const range = rules.computeStandardRange(w, cornerType);
      if (!range.valid || range.x < 50) {
        ok = false;
        errorMsg = '当前墙体宽度不足以摆放任何标准衣柜，请调整宽度或转角设置';
      }
    }
    const required = name && wallW && wallH;
    this.setData({
      errorMsg,
      canSubmit: !!(ok && required),
    });
  },

  onConfirm() {
    const { name, wallW, wallH, cornerType, photoPath, mode } = this.data;
    if (!this.data.canSubmit) return;
    if ((getApp().globalData.designs || []).length >= 30) {
      wx.showToast({ title: '设计库已满30条', icon: 'none' });
      return;
    }
    const draft = getApp().globalData.draftPlan || {};
    const now = new Date();
    // 不再显式写 hasRaise —— 编辑既有方案时 Object.assign 会保留 draft.hasRaise，
    // 首创方案时留 undefined，设计页 layoutEngine.init 会当 false 处理。
    const plan = Object.assign({}, draft, {
      id: draft.id || planStore.makeId(),
      name,
      wall: { w: parseInt(wallW, 10), h: parseInt(wallH, 10), d: mode === 'shoe' ? 50 : 150 },
      cornerType,
      mode,
      photoPath,
      photoName: photoPath ? planStore.photoName(name, now) : '',
      timestamp: planStore.timestamp(now),
      createdAt: draft.createdAt || now.getTime(),
    });
    getApp().globalData.draftPlan = plan;
    wx.redirectTo({ url: '/cabinet/pages/design/index' });
  },
});
