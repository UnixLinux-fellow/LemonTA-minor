// 服务端上下文云函数封装。设计方案的 CRUD 已改走 db.collection('designs') 直连，
// 这里只保留对 quickstartFunctions 内"读服务端上下文"类分支的封装。

function call(type, data) {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
      resolve({ ok: false, error: 'cloud_unavailable' });
      return;
    }
    wx.cloud
      .callFunction({
        name: 'quickstartFunctions',
        data: Object.assign({ type }, data || {}),
      })
      .then((resp) => {
        resolve({ ok: true, data: resp.result });
      })
      .catch((err) => {
        console.warn('cloud call failed', type, err);
        resolve({ ok: false, error: err && err.errMsg });
      });
  });
}

module.exports = {
  getModelInfo: (localList) => call('getModelInfo', { localList }),
  requestDownload: (planId) => call('requestDownload', { planId }),
  listCabinetModels: () => call('listCabinetModels'),
  listHardwareFittings: () => call('listHardwareFittings'),
};
