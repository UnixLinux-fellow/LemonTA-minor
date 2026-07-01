Component({
  properties: {
    visible: { type: Boolean, value: false },
    plans: { type: Array, value: [] },
  },
  data: { selectedIds: [], selectedMap: {} },
  observers: {
    'visible, plans': function (visible) {
      if (visible) this.setData({ selectedIds: [], selectedMap: {} });
    },
  },
  methods: {
    onToggle(e) {
      const id = e.currentTarget.dataset.id;
      const selectedIds = this.data.selectedIds.slice();
      const selectedMap = Object.assign({}, this.data.selectedMap);
      const idx = selectedIds.indexOf(id);
      if (idx >= 0) {
        selectedIds.splice(idx, 1);
        delete selectedMap[id];
      } else {
        selectedIds.push(id);
        selectedMap[id] = true;
      }
      this.setData({ selectedIds, selectedMap });
    },
    onToggleAll() {
      const all = this.data.plans.map((p) => p.id);
      const isAll = this.data.selectedIds.length === all.length;
      const selectedMap = {};
      if (!isAll) all.forEach((id) => { selectedMap[id] = true; });
      this.setData({ selectedIds: isAll ? [] : all, selectedMap });
    },
    onCancel() { this.triggerEvent('cancel'); },
    onConfirm() {
      if (this.data.selectedIds.length === 0) return;
      this.triggerEvent('confirm', { ids: this.data.selectedIds.slice() });
    },
  },
});
