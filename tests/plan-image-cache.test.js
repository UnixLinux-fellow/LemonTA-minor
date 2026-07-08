// resolvePlanImages 单元测试：
// 场景对齐"清缓存后从云端拉回方案"——plan 只带 previewFileID/wireframeFileID/photoFileID，
// 需要就地把三个本地路径字段（previewImage / wireframeImage / photoPath）补齐，
// 让 materials / cost / space-setup 页 wxml 直接可用。

// mock img-cache：可控地模拟命中 / 未命中 / 失败
jest.mock('../miniprogram/utils/img-cache.js', () => ({
  resolve: jest.fn(),
  register: jest.fn(),
  remove: jest.fn(),
  hasReady: jest.fn(),
}));

const imgCache = require('../miniprogram/utils/img-cache.js');
const { resolvePlanImages, arePlanImagesReady } = require('../miniprogram/utils/plan-image-cache.js');

beforeEach(() => {
  imgCache.resolve.mockReset();
  imgCache.hasReady.mockReset();
});

describe('resolvePlanImages', () => {
  test('云端拉回的 plan：三个 fileID 都被解析为本地路径', async () => {
    imgCache.resolve.mockImplementation((fileID) => {
      const map = {
        'cloud://a/preview.png': 'wxfile://usr/img-cache/aa.png',
        'cloud://a/wire.png':    'wxfile://usr/img-cache/bb.png',
        'cloud://a/photo.jpg':   'wxfile://usr/img-cache/cc.jpg',
      };
      return Promise.resolve(map[fileID]);
    });

    const plan = {
      id: '111',
      previewFileID:   'cloud://a/preview.png',
      wireframeFileID: 'cloud://a/wire.png',
      photoFileID:     'cloud://a/photo.jpg',
      // 三个本地路径字段云端 doc 里不存在
    };

    await resolvePlanImages([plan]);

    expect(plan.previewImage).toBe('wxfile://usr/img-cache/aa.png');
    expect(plan.wireframeImage).toBe('wxfile://usr/img-cache/bb.png');
    expect(plan.photoPath).toBe('wxfile://usr/img-cache/cc.jpg');
    expect(imgCache.resolve).toHaveBeenCalledTimes(3);
  });

  test('已有 wxfile:// 本地路径：跳过下载，直接保留', async () => {
    imgCache.resolve.mockResolvedValue('SHOULD_NOT_BE_USED');
    const plan = {
      previewFileID: 'cloud://a/preview.png',
      previewImage:  'wxfile://tmp/session-preview.png', // 同会话产物
    };
    await resolvePlanImages([plan]);
    expect(plan.previewImage).toBe('wxfile://tmp/session-preview.png');
    // 只对空的 wireframeFileID / photoFileID 处理（都是 undefined），imgCache.resolve 完全不该被调用
    expect(imgCache.resolve).not.toHaveBeenCalled();
  });

  test('缺 fileID 又缺本地路径：字段置空串（wxml 的 wx:if 兜底不渲染）', async () => {
    const plan = { id: '222' }; // 什么都没有
    await resolvePlanImages([plan]);
    expect(plan.previewImage).toBe('');
    expect(plan.wireframeImage).toBe('');
    expect(plan.photoPath).toBe('');
    expect(imgCache.resolve).not.toHaveBeenCalled();
  });

  test('imgCache.resolve 失败：字段置空串，不抛错', async () => {
    imgCache.resolve.mockRejectedValue(new Error('net down'));
    const plan = {
      previewFileID:   'cloud://a/preview.png',
      wireframeFileID: 'cloud://a/wire.png',
    };
    await expect(resolvePlanImages([plan])).resolves.not.toThrow();
    expect(plan.previewImage).toBe('');
    expect(plan.wireframeImage).toBe('');
  });

  test('多个 plan 并发解析：互不干扰', async () => {
    imgCache.resolve.mockImplementation((fileID) =>
      Promise.resolve('local://' + fileID)
    );
    const plans = [
      { previewFileID: 'cloud://a/p1.png' },
      { wireframeFileID: 'cloud://a/w2.png' },
    ];
    await resolvePlanImages(plans);
    expect(plans[0].previewImage).toBe('local://cloud://a/p1.png');
    expect(plans[0].wireframeImage).toBe('');
    expect(plans[1].previewImage).toBe('');
    expect(plans[1].wireframeImage).toBe('local://cloud://a/w2.png');
  });
});

describe('arePlanImagesReady', () => {
  test('三张 fileID 都在 imgCache 里 → ready', () => {
    imgCache.hasReady.mockReturnValue(true);
    const plan = {
      previewFileID:   'cloud://a/p.png',
      wireframeFileID: 'cloud://a/w.png',
      photoFileID:     'cloud://a/photo.jpg',
    };
    expect(arePlanImagesReady([plan])).toBe(true);
  });

  test('plan 里已有 wxfile:// 也算 ready（同会话产物）', () => {
    imgCache.hasReady.mockReturnValue(false);
    const plan = {
      previewFileID:   'cloud://a/p.png',
      previewImage:    'wxfile://tmp/session.png',
      // 其它 fileID 为空 → 视为不需要
    };
    expect(arePlanImagesReady([plan])).toBe(true);
    // 有 wxfile:// 就不必查缓存
    expect(imgCache.hasReady).not.toHaveBeenCalled();
  });

  test('任一 fileID 没在缓存里 → not ready', () => {
    imgCache.hasReady.mockImplementation((fileID) => fileID === 'cloud://a/p.png');
    const plan = {
      previewFileID:   'cloud://a/p.png',   // 命中
      wireframeFileID: 'cloud://a/w.png',   // 未命中
    };
    expect(arePlanImagesReady([plan])).toBe(false);
  });

  test('没有任何 fileID → ready（没图可拉，UI 直接兜底）', () => {
    expect(arePlanImagesReady([{ id: 'x' }])).toBe(true);
    expect(imgCache.hasReady).not.toHaveBeenCalled();
  });
});
