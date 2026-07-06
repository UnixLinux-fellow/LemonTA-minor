// 云函数封装。失败时不阻塞本地存储流程。

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
  getOpenId: () => call('getOpenId'),
  getModelInfo: (localList) => call('getModelInfo', { localList }),
  savePlan: (plan) => call('savePlan', { plan }),
  saveMaterials: (planId, materials) => call('saveMaterials', { planId, materials }),
  listPlans: () => call('listPlans'),
  requestDownload: (planId) => call('requestDownload', { planId }),
  listCabinetModels: () => call('listCabinetModels'),
  listHardwareFittings: () => call('listHardwareFittings'),
};
