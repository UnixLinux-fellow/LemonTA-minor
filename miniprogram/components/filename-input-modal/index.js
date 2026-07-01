Component({
  properties: {
    visible: { type: Boolean, value: false },
    defaultValue: { type: String, value: '我的衣柜方案.pdf' },
  },
  data: { value: '' },
  observers: {
    'visible, defaultValue': function (visible, def) {
      if (visible) this.setData({ value: def });
    },
  },
  methods: {
    onInput(e) { this.setData({ value: e.detail.value }); },
    onCancel() { this.triggerEvent('cancel'); },
    onConfirm() { this.triggerEvent('confirm', { value: this.data.value }); },
  },
});
