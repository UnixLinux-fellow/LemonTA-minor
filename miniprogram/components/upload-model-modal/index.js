const CATEGORIES = [
  { id: 'wardrobe',      label: 'wardrobe (衣柜)' },
  { id: 'shoe cabinet',  label: 'shoe cabinet (鞋柜)' },
];

Component({
  properties: {
    visible: { type: Boolean, value: false },
  },
  data: {
    file: null,           // { name, size, path }
    fileSizeText: '',
    categoryIdx: 0,
    categoryLabels: CATEGORIES.map((c) => c.label),
  },
  observers: {
    // 关闭时重置状态,避免下次打开还留着上次的选择
    'visible': function (visible) {
      if (!visible) {
        this.setData({ file: null, fileSizeText: '', categoryIdx: 0 });
      }
    },
  },
  methods: {
    onChooseFile() {
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['glb'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          if (!f) return;
          if (!/\.glb$/i.test(f.name)) {
            wx.showToast({ title: '仅支持 GLB 格式', icon: 'none' });
            return;
          }
          this.setData({
            file: { name: f.name, size: f.size, path: f.path },
            fileSizeText: _formatSize(f.size),
          });
        },
        fail: () => { /* 用户取消,忽略 */ },
      });
    },
    onPickCategory(e) {
      this.setData({ categoryIdx: Number(e.detail.value) });
    },
    onCancel() {
      this.triggerEvent('uploadcancel');
    },
    onConfirm() {
      if (!this.data.file) {
        wx.showToast({ title: '请先选择 GLB 文件', icon: 'none' });
        return;
      }
      const category = CATEGORIES[this.data.categoryIdx].id;
      this.triggerEvent('uploadconfirm', {
        file: this.data.file,
        category,
      });
    },
  },
});

function _formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
