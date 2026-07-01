// app.js
App({
  onLaunch: function () {
    this.globalData = {
      env: "",
      // 跨页传递草稿（避免 url 携带过多参数）
      draftPlan: null,
      // 当前正在编辑/查看的方案
      currentPlan: null,
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },
});
