const rules = require('../../utils/cabinet-rules.js');
const planStore = require('../../utils/plan-store.js');

Page({
  data: {
    photoPath: '',
    name: '',
    wallW: '',
    wallH: '',
    cornerType: 'WZJ',
    hasRaise: false,
    errorMsg: '',
    canSubmit: false,
  },

  onLoad() {
    const draft = getApp().globalData.draftPlan;
    if (draft) {
      this.setData({
        photoPath: draft.photoPath || '',
        name: draft.name || '',
        wallW: draft.wall && draft.wall.w ? String(draft.wall.w) : '',
        wallH: draft.wall && draft.wall.h ? String(draft.wall.h) : '',
        cornerType: draft.cornerType || 'WZJ',
        hasRaise: !!draft.hasRaise,
      });
      this.validate();
    }
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

  onPickCorner(e) {
    this.setData({ cornerType: e.currentTarget.dataset.v });
    this.validate();
  },

  onToggleRaise(e) {
    this.setData({ hasRaise: e.detail.value });
    this.validate();
  },

  validate() {
    const { name, wallW, wallH, cornerType, hasRaise } = this.data;
    const w = parseInt(wallW, 10);
    const h = parseInt(wallH, 10);

    const draft = getApp().globalData.draftPlan;
    const editingId = draft && draft.id;
    const existingNames = planStore
      .list()
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
      const wallCheck = rules.validateWall(w, h);
      if (!wallCheck.ok) {
        ok = false;
        errorMsg = wallCheck.message;
      }
    }
    if (ok && wallW) {
      const cornerCheck = rules.validateCorner(w, cornerType);
      if (!cornerCheck.ok) {
        ok = false;
        errorMsg = cornerCheck.message;
      }
    }
    if (ok && wallH) {
      const raiseCheck = rules.validateRaise(h, hasRaise);
      if (!raiseCheck.ok) {
        ok = false;
        errorMsg = raiseCheck.message;
      }
    }
    // 标准段必须 >= 50
    if (ok && wallW) {
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
    const { name, wallW, wallH, cornerType, hasRaise, photoPath } = this.data;
    if (!this.data.canSubmit) return;
    if (planStore.isFull()) {
      wx.showToast({ title: '设计库已满30条', icon: 'none' });
      return;
    }
    const draft = getApp().globalData.draftPlan || {};
    const now = new Date();
    const plan = Object.assign({}, draft, {
      id: draft.id || planStore.makeId(),
      name,
      wall: { w: parseInt(wallW, 10), h: parseInt(wallH, 10), d: 150 },
      cornerType,
      hasRaise,
      photoPath,
      photoName: photoPath ? planStore.photoName(name, now) : '',
      timestamp: planStore.timestamp(now),
      createdAt: draft.createdAt || now.getTime(),
    });
    getApp().globalData.draftPlan = plan;
    wx.redirectTo({ url: '/cabinet/pages/design/index' });
  },
});
