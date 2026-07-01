const { cleanFileName } = require('../miniprogram/utils/filename-cleaner.js');

describe('cleanFileName', () => {
  test('empty input falls back to default', () => {
    expect(cleanFileName('')).toBe('我的衣柜方案.pdf');
    expect(cleanFileName(null)).toBe('我的衣柜方案.pdf');
    expect(cleanFileName(undefined)).toBe('我的衣柜方案.pdf');
    expect(cleanFileName('   ')).toBe('我的衣柜方案.pdf');
  });

  test('appends .pdf if missing', () => {
    expect(cleanFileName('老李的衣柜')).toBe('老李的衣柜.pdf');
    expect(cleanFileName('plan')).toBe('plan.pdf');
  });

  test('keeps .pdf if present', () => {
    expect(cleanFileName('a.pdf')).toBe('a.pdf');
    expect(cleanFileName('a.PDF')).toBe('a.PDF');
  });

  test('replaces illegal characters with _', () => {
    expect(cleanFileName('a/b\\c:d*e?f"g<h>i|j.pdf'))
      .toBe('a_b_c_d_e_f_g_h_i_j.pdf');
  });

  test('trims surrounding whitespace', () => {
    expect(cleanFileName('  abc.pdf  ')).toBe('abc.pdf');
  });
});
