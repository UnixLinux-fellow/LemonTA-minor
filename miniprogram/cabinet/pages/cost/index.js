const costEngine = require('../../../utils/cost-engine.js');
const cloud = require('../../../utils/cloud.js');
const wireframeLabels = require('../../utils/wireframe-labels.js');
const imgCache = require('../../../utils/img-cache.js');

Page({
  data: {
    plan: null,
    from: 'design',
    cost: { modules: [], grandTotal: 0 },
    bottomRow: [],
    topRow: [],
    labelPositions: [],
    detailOpen: false,
    currentDetail: null,
    downloadOpen: false,
    downloadInfo: { link: '', code: '' },
    floatToast: '',
  },

  onLoad(query) {
    const from = query.from || 'design';
    const id = query.id;
    const app = getApp();
    // 优先内存 currentPlan；否则按 id 从 globalData.designs 找
    let plan = app.globalData.currentPlan;
    if ((!plan || plan.id !== id) && id) {
      plan = app.getDesignById(id) || plan;
    }
    if (!plan) {
      wx.navigateBack();
      return;
    }
    const cabinets = plan.cabinets || [];
    const cost = costEngine.calc({
      cabinets,
      materials: plan.materials || {},
      wall: plan.wall,
    });
    const bottomRow = cabinets.filter((c) => c.kind !== 'raise');
    const topRow = cabinets.filter((c) => c.kind === 'raise');
    this.setData({
      plan,
      from,
      cost,
      bottomRow,
      topRow,
      labelPositions: wireframeLabels.computeLabelPositions(plan),
    });
    this._maybeBakeWireframe();
  },

  _maybeBakeWireframe() {
    const plan = this.data.plan;
    if (!plan || !plan.wireframeImage) return;
    if (plan.wireframeHasLabels) return;

    wx.createSelectorQuery().in(this)
      .select('#wf-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0, img.width, img.height);

          const labels = wireframeLabels.computeLabelPositions(plan);
          const fontPx = Math.max(12, Math.round(img.width * 0.05));
          ctx.font = 'bold ' + fontPx + 'px sans-serif';
          ctx.fillStyle = '#EE822F';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          labels.forEach((label) => {
            const x = (label.left / 100) * img.width;
            const y = (label.top / 100) * img.height;
            ctx.fillText(String(label.idx), x, y);
          });

          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            success: (out) => {
              this._persistBakedWireframe(plan, out.tempFilePath);
            },
            fail: (err) => {
              console.warn('[cost] bake wireframe failed:', err && err.errMsg);
            },
          });
        };
        img.onerror = (err) => {
          console.warn('[cost] load wireframeImage failed:', err && err.errMsg);
        };
        img.src = plan.wireframeImage;
      });
  },

  /**
   * 烘完带编号的线框图后：上传新 fileID → 更新 designs 文档 → 清旧云文件与本地缓存
   */
  _persistBakedWireframe(plan, tempFilePath) {
    const app = getApp();
    const oldFileID = plan.wireframeFileID || '';

    const uploadStep = (wx.cloud && wx.cloud.uploadFile)
      ? wx.cloud.uploadFile({
          cloudPath: 'designs/' + plan.id + '_' + Date.now() + '_wire.png',
          filePath: tempFilePath,
        }).then((res) => (res && res.fileID) || '')
        .catch((err) => {
          console.warn('[cost] uploadFile wire 失败:', err && err.errMsg);
          return '';
        })
      : Promise.resolve('');

    uploadStep.then((newFileID) => {
      if (newFileID) {
        try { imgCache.register(newFileID, tempFilePath); } catch (e) { /* ignore */ }
      }
      const updated = Object.assign({}, plan, {
        wireframeImage: tempFilePath,
        wireframeHasLabels: true,
        wireframeFileID: newFileID || plan.wireframeFileID || '',
      });
      this.setData({ plan: updated });
      app.globalData.currentPlan = updated;

      // 更新云 doc（有 _id 才能 update）
      if (updated._id && newFileID) {
        app.saveDesign({
          _id: updated._id,
          wireframeFileID: newFileID,
          wireframeHasLabels: true,
        }).catch((err) => {
          console.warn('[cost] saveDesign 更新线框图 fileID 失败:', err);
        });
      }

      // 清旧云文件 + 本地缓存
      if (oldFileID && oldFileID !== newFileID && newFileID && wx.cloud && wx.cloud.deleteFile) {
        wx.cloud.deleteFile({ fileList: [oldFileID] }).catch((err) => {
          console.warn('[cost] 清旧线框图失败:', err);
        });
        try { imgCache.remove(oldFileID); } catch (e) { /* ignore */ }
      }
    });
  },

  openDetail(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.cost.modules[idx];
    // 过滤数量/小计为 0 的明细行
    const filteredPanels = (m.detail.panels || []).filter((p) => p.qty > 0 && p.total > 0);
    const filteredHardware = (m.detail.hardware || []).filter((h) => h.qty > 0 && h.total > 0);
    const filtered = Object.assign({}, m, {
      detail: { panels: filteredPanels, hardware: filteredHardware },
    });
    this.setData({ detailOpen: true, currentDetail: filtered });
  },

  closeDetail() {
    this.setData({ detailOpen: false, currentDetail: null });
  },

  onChangeConfig() {
    const from = this.data.from || 'design';
    const id = (this.data.plan && this.data.plan.id) || '';
    wx.redirectTo({
      url: '/cabinet/pages/materials/index?from=' + from + '&id=' + id,
    });
  },

  onDownload() {
    cloud.requestDownload(this.data.plan.id).then((res) => {
      const data = (res && res.data) || {};
      this.setData({
        downloadOpen: true,
        downloadInfo: {
          link: data.link || 'https://pan.baidu.com/s/lemonta-demo',
          code: data.code || 'lmt8',
        },
      });
    });
  },

  closeDownload() {
    this.setData({ downloadOpen: false });
  },

  onCopyLink() {
    const text =
      this.data.downloadInfo.link + ' 提取码: ' + this.data.downloadInfo.code;
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setData({
          downloadOpen: false,
          floatToast: '已复制，请5到10分钟后到百度网盘App复制下载',
        });
        setTimeout(() => this.setData({ floatToast: '' }), 3000);
      },
    });
  },
});
