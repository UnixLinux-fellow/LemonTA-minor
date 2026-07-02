// 一次性脚本：把 4 张五金/尺寸参考图无损拼成 PDF。
// 零 npm 依赖，只用 Node 标准库（fs / path / zlib）。
//
// 用法：
//   node scripts/build-hardware-pdf.js
//
// 输入：miniprogram/cabinet/utils/cabinet-hardware/ 下的 4 张图
// 输出：miniprogram/cabinet/utils/cabinet-hardware/hardware-reference.pdf
//
// 原理：
//   - JPEG 走 /DCTDecode（PDF 原生支持 jpeg），原始字节直接塞入，零膨胀
//   - PNG (colorType 2/3/6, 8-bit, non-interlaced) 走 /FlateDecode + /Predictor 15
//     PDF 规范的 Predictor 15 语义等同 PNG scanline filter，所以 IDAT 无需解压重编码
//   - PNG RGBA (colorType 6) 需要拆 alpha 通道到 SMask 图像
//   - 页面尺寸 = 图片像素尺寸（1 px → 1 pt），跟原运行时导出的 _appendPngPage 保持一致

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HARDWARE_DIR = path.resolve(__dirname, '..', 'miniprogram', 'cabinet', 'utils', 'cabinet-hardware');
const OUTPUT = path.join(HARDWARE_DIR, 'hardware-reference.pdf');
const SOURCES = [
  '衣柜尺寸.png',
  '五金规范.png',
  '国产五金参数.jpg',
  '进口五金参数.jpg',
];

// ---------- JPEG parser ----------
function parseJpeg(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not a JPEG (missing SOI)');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) throw new Error('bad marker byte at offset ' + i);
    while (buf[i] === 0xFF) i++;
    const marker = buf[i++];
    // SOF0-SOF15 except DHT/JPG/DAC
    if ((marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)) {
      const height = buf.readUInt16BE(i + 3);
      const width  = buf.readUInt16BE(i + 5);
      const components = buf[i + 7];
      return { width, height, components };
    }
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    const segLen = buf.readUInt16BE(i);
    i += segLen;
  }
  throw new Error('no SOF marker found in JPEG');
}

// ---------- PNG parser ----------
function parsePng(buf) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG (bad signature)');
  let i = 8;
  let ihdr = null;
  const idats = [];
  let plte = null;
  let trns = null;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i); i += 4;
    const type = buf.slice(i, i + 4).toString('ascii'); i += 4;
    const data = buf.slice(i, i + len); i += len;
    i += 4; // CRC
    if (type === 'IHDR') {
      ihdr = {
        width:     data.readUInt32BE(0),
        height:    data.readUInt32BE(4),
        bitDepth:  data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'PLTE') {
      plte = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!ihdr) throw new Error('PNG missing IHDR');
  return Object.assign(ihdr, { idat: Buffer.concat(idats), plte, trns });
}

// ---------- PNG un-filter (only needed for RGBA to split alpha) ----------
function unfilterPng(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const dstBase = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dstBase + x - bpp] : 0;
      const b = y > 0    ? out[dstBase - stride + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[dstBase - stride + x - bpp] : 0;
      let val = raw[src + x];
      if (filter === 0) {
        // None
      } else if (filter === 1) {
        val = (val + a) & 0xFF;
      } else if (filter === 2) {
        val = (val + b) & 0xFF;
      } else if (filter === 3) {
        val = (val + ((a + b) >> 1)) & 0xFF;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        val = (val + pred) & 0xFF;
      } else {
        throw new Error('unknown PNG filter type ' + filter + ' at row ' + y);
      }
      out[dstBase + x] = val;
    }
    src += stride;
  }
  return out;
}

function wrapScanlinesFilterNone(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 0;
    raw.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return out;
}

// ---------- Build PDF image dict from parsed sources ----------
function buildJpegImage(buf) {
  const { width, height, components } = parseJpeg(buf);
  const cs = components === 1 ? '/DeviceGray' : '/DeviceRGB';
  return {
    width, height,
    dict: {
      Type: '/XObject',
      Subtype: '/Image',
      Width: width,
      Height: height,
      ColorSpace: cs,
      BitsPerComponent: 8,
      Filter: '/DCTDecode',
    },
    stream: buf,
    smask: null,
  };
}

function buildPngImage(buf) {
  const png = parsePng(buf);
  if (png.interlace) throw new Error('interlaced PNG not supported (set interlace=0 in your PNG)');
  if (png.bitDepth !== 8) throw new Error('only 8-bit PNG supported, got bitDepth=' + png.bitDepth);
  const { width, height, colorType, idat } = png;

  if (colorType === 0) {
    // grayscale, no alpha
    return {
      width, height,
      dict: {
        Type: '/XObject', Subtype: '/Image',
        Width: width, Height: height,
        ColorSpace: '/DeviceGray',
        BitsPerComponent: 8,
        Filter: '/FlateDecode',
        DecodeParms: `<< /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
      },
      stream: idat,
      smask: null,
    };
  }

  if (colorType === 2) {
    // RGB
    return {
      width, height,
      dict: {
        Type: '/XObject', Subtype: '/Image',
        Width: width, Height: height,
        ColorSpace: '/DeviceRGB',
        BitsPerComponent: 8,
        Filter: '/FlateDecode',
        DecodeParms: `<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >>`,
      },
      stream: idat,
      smask: null,
    };
  }

  if (colorType === 3) {
    // indexed
    if (!png.plte) throw new Error('indexed PNG missing PLTE');
    if (png.trns) throw new Error('indexed PNG with tRNS (palette alpha) not supported; please export without transparency');
    const hival = (png.plte.length / 3) - 1;
    const palHex = png.plte.toString('hex').toUpperCase();
    return {
      width, height,
      dict: {
        Type: '/XObject', Subtype: '/Image',
        Width: width, Height: height,
        ColorSpace: `[ /Indexed /DeviceRGB ${hival} <${palHex}> ]`,
        BitsPerComponent: 8,
        Filter: '/FlateDecode',
        DecodeParms: `<< /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
      },
      stream: idat,
      smask: null,
    };
  }

  if (colorType === 6) {
    // RGBA: split alpha channel to SMask
    const raw = zlib.inflateSync(idat);
    const unfilt = unfilterPng(raw, width, height, 4);
    const rgb   = Buffer.alloc(width * height * 3);
    const alpha = Buffer.alloc(width * height);
    for (let i = 0, j = 0, k = 0; i < unfilt.length; i += 4, j += 3, k += 1) {
      rgb[j]     = unfilt[i];
      rgb[j + 1] = unfilt[i + 1];
      rgb[j + 2] = unfilt[i + 2];
      alpha[k]   = unfilt[i + 3];
    }
    const rgbStream   = zlib.deflateSync(wrapScanlinesFilterNone(rgb,   width, height, 3));
    const alphaStream = zlib.deflateSync(wrapScanlinesFilterNone(alpha, width, height, 1));
    return {
      width, height,
      dict: {
        Type: '/XObject', Subtype: '/Image',
        Width: width, Height: height,
        ColorSpace: '/DeviceRGB',
        BitsPerComponent: 8,
        Filter: '/FlateDecode',
        DecodeParms: `<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >>`,
      },
      stream: rgbStream,
      smask: {
        dict: {
          Type: '/XObject', Subtype: '/Image',
          Width: width, Height: height,
          ColorSpace: '/DeviceGray',
          BitsPerComponent: 8,
          Filter: '/FlateDecode',
          DecodeParms: `<< /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
        },
        stream: alphaStream,
      },
    };
  }

  if (colorType === 4) {
    throw new Error('grayscale+alpha PNG (colorType 4) not supported; convert to RGB or RGBA');
  }
  throw new Error('unsupported PNG colorType ' + colorType);
}

function loadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return buildJpegImage(buf);
  if (ext === '.png') return buildPngImage(buf);
  throw new Error('unsupported extension: ' + ext);
}

// ---------- PDF builder (minimal, hand-rolled) ----------
class PdfBuilder {
  constructor() {
    // 1-based object ids; index [i-1] is the buffer for object i
    this.objects = [];
  }

  allocId() {
    this.objects.push(null);
    return this.objects.length;
  }

  writeObj(id, dictOrString, streamBuf) {
    let header = `${id} 0 obj\n`;
    if (typeof dictOrString === 'string') {
      header += dictOrString + '\n';
    } else {
      header += '<<\n';
      for (const [k, v] of Object.entries(dictOrString)) {
        header += `/${k} ${v}\n`;
      }
      if (streamBuf) header += `/Length ${streamBuf.length}\n`;
      header += '>>\n';
    }
    let parts;
    if (streamBuf) {
      parts = [
        Buffer.from(header, 'binary'),
        Buffer.from('stream\n', 'binary'),
        streamBuf,
        Buffer.from('\nendstream\nendobj\n', 'binary'),
      ];
    } else {
      parts = [Buffer.from(header, 'binary'), Buffer.from('endobj\n', 'binary')];
    }
    this.objects[id - 1] = Buffer.concat(parts);
  }

  finalize() {
    const parts = [];
    // binary comment forces PDF readers into binary mode
    parts.push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary'));
    const offsets = [];
    let pos = parts[0].length;
    for (const obj of this.objects) {
      if (!obj) throw new Error('object slot not written');
      offsets.push(pos);
      parts.push(obj);
      pos += obj.length;
    }
    const xrefStart = pos;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    }
    parts.push(Buffer.from(xref, 'binary'));
    const trailer = `trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    parts.push(Buffer.from(trailer, 'binary'));
    return Buffer.concat(parts);
  }
}

function buildPdf(images) {
  const pdf = new PdfBuilder();

  // Reserve ids: 1=Catalog, 2=Pages
  const catalogId = pdf.allocId();
  const pagesId   = pdf.allocId();

  const pageIds = [];
  const pageObjs = []; // {pageId, imageId, smaskId, imageInfo}

  for (const img of images) {
    const imageId = pdf.allocId();
    let smaskId = null;
    if (img.smask) smaskId = pdf.allocId();
    const contentId = pdf.allocId();
    const pageId = pdf.allocId();
    pageIds.push(pageId);
    pageObjs.push({ pageId, imageId, smaskId, contentId, img });
  }

  // Write image + smask + content + page objects
  for (const p of pageObjs) {
    // image XObject
    const imgDict = { ...p.img.dict };
    if (p.smaskId) imgDict.SMask = `${p.smaskId} 0 R`;
    imgDict.Name = '/Im0';
    pdf.writeObj(p.imageId, imgDict, p.img.stream);

    // smask XObject (if any)
    if (p.smaskId) {
      pdf.writeObj(p.smaskId, p.img.smask.dict, p.img.smask.stream);
    }

    // content stream: draw image at 0,0 with size = image px (1 px = 1 pt)
    const w = p.img.width;
    const h = p.img.height;
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    pdf.writeObj(p.contentId, {}, Buffer.from(content, 'binary'));

    // page
    const pageDict = {
      Type: '/Page',
      Parent: `${pagesId} 0 R`,
      MediaBox: `[ 0 0 ${w} ${h} ]`,
      Resources: `<< /XObject << /Im0 ${p.imageId} 0 R >> /ProcSet [ /PDF /ImageB /ImageC /ImageI ] >>`,
      Contents: `${p.contentId} 0 R`,
    };
    pdf.writeObj(p.pageId, pageDict, null);
  }

  // Pages tree
  const kids = '[ ' + pageIds.map(id => `${id} 0 R`).join(' ') + ' ]';
  pdf.writeObj(pagesId, {
    Type: '/Pages',
    Kids: kids,
    Count: pageIds.length,
  }, null);

  // Catalog
  pdf.writeObj(catalogId, {
    Type: '/Catalog',
    Pages: `${pagesId} 0 R`,
  }, null);

  return pdf.finalize();
}

// ---------- Main ----------
(function main() {
  const images = [];
  for (const name of SOURCES) {
    const filePath = path.join(HARDWARE_DIR, name);
    if (!fs.existsSync(filePath)) {
      console.error('missing source image:', filePath);
      process.exit(1);
    }
    const stat = fs.statSync(filePath);
    process.stdout.write(`parsing ${name} (${stat.size} bytes)... `);
    const img = loadImage(filePath);
    process.stdout.write(`${img.width}x${img.height}\n`);
    images.push(img);
  }
  const pdfBuf = buildPdf(images);
  fs.writeFileSync(OUTPUT, pdfBuf);
  console.log('wrote', OUTPUT, '(' + pdfBuf.length + ' bytes)');
})();
