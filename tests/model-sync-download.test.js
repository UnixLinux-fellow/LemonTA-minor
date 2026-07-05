// downloadOne 单元测试：验证 getTempFileURL + wx.downloadFile 两步法

// ---- wx global mock ----
// jest 默认没有 wx，需要在 require 目标模块前挂到 global
function installWxMock(overrides) {
  const files = {};
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    cloud: {
      getTempFileURL: overrides.getTempFileURL,
    },
    downloadFile: overrides.downloadFile,
    getFileSystemManager: () => ({
      accessSync: (p) => {
        if (!files[p]) { const err = new Error('no access'); err.errMsg = 'accessSync:fail'; throw err; }
      },
      mkdirSync: (p) => { files[p] = 'dir'; },
      readFileSync: (p) => { if (!files[p]) throw new Error('no file'); return files[p]; },
      writeFileSync: (p, buf) => { files[p] = buf; },
      unlinkSync: (p) => { delete files[p]; },
      saveFile: ({ tempFilePath, filePath, success, fail }) => {
        if (overrides.saveFileShouldFail) { fail && fail({ errMsg: 'saveFile:fail' }); return; }
        files[filePath] = 'saved:' + tempFilePath;
        success && success({ savedFilePath: filePath });
      },
      renameSync: (from, to) => {
        if (overrides.renameShouldFail) { const e = new Error('rename fail'); e.errMsg = 'rename:fail'; throw e; }
        files[to] = files[from]; delete files[from];
      },
    }),
  };
  return files;
}

function clearWxMock() {
  delete global.wx;
  // 强制下次 require 重新初始化模块单例
  jest.resetModules();
}

describe('model-sync downloadOne (two-step)', () => {
  afterEach(() => { clearWxMock(); });

  test('placeholder — real tests added in later tasks', () => {
    expect(true).toBe(true);
  });
});
