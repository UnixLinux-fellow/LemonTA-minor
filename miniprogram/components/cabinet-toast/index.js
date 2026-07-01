Component({
  properties: {
    text: { type: String, value: '' },
  },
  data: { visible: false },
  observers: {
    text(v) {
      if (v) {
        this.setData({ visible: true });
      } else {
        this.setData({ visible: false });
      }
    },
  },
});
