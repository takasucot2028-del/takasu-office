// マニュアル共通のスタイルと組み立てヘルパー（A4縦・日本語）
const d = require('docx');
const {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, ShadingType, AlignmentType, BorderStyle,
  LevelFormat, PageNumber, Header, Footer, TableOfContents, PageBreak,
} = d;

const FONT = { name: 'Meiryo', eastAsia: 'Meiryo' };
const NAVY = '0B5169';
const TEAL = '137C7C';
const GRAY = '555555';
const LIGHT = 'EEF4F6';
const AMBER = '9A6700';

// A4縦・余白20mm のときの本文幅（DXA, 1mm≒56.7）
const CW = 9600;

const t = (text, o = {}) => new TextRun({ text, font: FONT, ...o });

/**
 * 段落の中身をそろえる。
 * 文字列・TextRun・それらの配列のどれを渡しても TextRun の配列にする。
 * （配列の中に素の文字列が混ざっていると Word 側で消えてしまうため）
 */
const runs = (x, o = {}) => (Array.isArray(x) ? x : [x])
  .map(v => (typeof v === 'string' ? t(v, o) : v));

/** 本文の段落 */
const p = (text, o = {}) => new Paragraph({
  children: runs(text),
  spacing: { after: 110, line: 300 },
  ...o,
});

/** 章見出し（目次に載る） */
const h1 = (text) => new Paragraph({
  children: [t(text, { bold: true, size: 30, color: NAVY })],
  heading: HeadingLevel.HEADING_1,
  pageBreakBefore: true,
  spacing: { before: 0, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NAVY, space: 6 } },
});

/** 節見出し */
const h2 = (text) => new Paragraph({
  children: [t(text, { bold: true, size: 24, color: TEAL })],
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 100 },
});

/** 小見出し */
const h3 = (text) => new Paragraph({
  children: [t(text, { bold: true, size: 21 })],
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 160, after: 70 },
});

/** 箇条書き */
const li = (text, level = 0) => new Paragraph({
  children: runs(text),
  numbering: { reference: 'bullets', level },
  spacing: { after: 70, line: 290 },
});

/**
 * 手順（番号付き）。1 つの手順のまとまりごとに呼ぶ。
 * まとまりごとに別のインスタンスを使うので、番号は必ず 1 から始まる。
 */
let _stepInstance = 0;
function steps(list) {
  const instance = ++_stepInstance;
  return list.map(x => new Paragraph({
    children: runs(x),
    numbering: { reference: 'steps', level: 0, instance },
    spacing: { after: 70, line: 290 },
  }));
}

/** 補足・注意のボックス */
function noteTable(title, lines, color = NAVY, fill = LIGHT) {
  const body = [new Paragraph({
    children: [t(title, { bold: true, color, size: 20 })],
    spacing: { after: 60 },
  })];
  for (const l of lines) {
    body.push(new Paragraph({
      children: runs(l, { size: 19 }),
      spacing: { after: 50, line: 280 },
    }));
  }
  return new Table({
    columnWidths: [CW],
    width: { size: CW, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color },
      bottom: { style: BorderStyle.SINGLE, size: 2, color },
      left: { style: BorderStyle.SINGLE, size: 18, color },
      right: { style: BorderStyle.SINGLE, size: 2, color },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        width: { size: CW, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: body,
      })],
    })],
  });
}

/** 注意ボックス＋後ろの余白。children には ...note(...) の形で展開して使う */
const note = (title, lines) => [noteTable(title, lines, NAVY, LIGHT), gap(140)];
const warn = (title, lines) => [noteTable(title, lines, AMBER, 'FFF8E6'), gap(140)];

/**
 * 表。head は見出し行の文字列配列、rows は行の配列。
 * widths は列幅（DXA）で、合計が CW になるようにする。
 */
function tableOnly(head, rows, widths) {
  const w = widths || head.map(() => Math.floor(CW / head.length));
  const cell = (text, i, opt = {}) => new TableCell({
    width: { size: w[i], type: WidthType.DXA },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: opt.fill ? { type: ShadingType.CLEAR, fill: opt.fill } : undefined,
    children: String(text).split('\n').map((line, n) => new Paragraph({
      children: [t(line, { size: 18, bold: !!opt.bold, color: opt.color })],
      spacing: { after: n === String(text).split('\n').length - 1 ? 0 : 40, line: 270 },
    })),
  });
  return new Table({
    columnWidths: w,
    width: { size: CW, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '9AA7AD' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '9AA7AD' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '9AA7AD' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '9AA7AD' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: 'C7D2D7' },
      insideVertical: { style: BorderStyle.SINGLE, size: 3, color: 'C7D2D7' },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: head.map((x, i) => cell(x, i, { bold: true, fill: LIGHT, color: NAVY })),
      }),
      ...rows.map(r => new TableRow({ children: r.map((x, i) => cell(x, i)) })),
    ],
  });
}

const table = (head, rows, widths) => [tableOnly(head, rows, widths), gap(160)];

/** 余白だけの段落 */
const gap = (after = 160) => new Paragraph({ children: [t('')], spacing: { after } });

/** 表紙 */
function cover(title, subtitle, note1) {
  return [
    new Paragraph({ children: [t('')], spacing: { after: 2400 } }),
    new Paragraph({
      children: [t('一般社団法人 たかすスポーツクラブ', { size: 22, color: GRAY })],
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
    }),
    new Paragraph({
      children: [t(title, { bold: true, size: 44, color: NAVY })],
      alignment: AlignmentType.CENTER, spacing: { after: 140 },
    }),
    new Paragraph({
      children: [t(subtitle, { size: 26, color: TEAL })],
      alignment: AlignmentType.CENTER, spacing: { after: 1400 },
    }),
    new Paragraph({
      children: [t(note1, { size: 19, color: GRAY })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }),
  ];
}

/** 目次（Wordで開いたときにページ番号付きで表示される） */
function toc() {
  return [
    new Paragraph({
      children: [t('目次', { bold: true, size: 30, color: NAVY })],
      pageBreakBefore: true,
      spacing: { after: 140 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NAVY, space: 6 } },
    }),
    new TableOfContents('目次', { hyperlink: true, headingStyleRange: '1-2' }),
  ];
}

/** ドキュメントを組み立てる */
function buildDoc(title, children) {
  return new Document({
    creator: '一般社団法人たかすスポーツクラブ',
    title,
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: '1A1A1A' } },
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', quickFormat: true,
          run: { font: FONT, bold: true, size: 30, color: NAVY } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', quickFormat: true,
          run: { font: FONT, bold: true, size: 24, color: TEAL } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', quickFormat: true,
          run: { font: FONT, bold: true, size: 21 } },
        // 目次は行を詰めて1ページに収める
        { id: 'TOC1', name: 'toc 1', basedOn: 'Normal',
          run: { font: FONT, size: 19, bold: true },
          paragraph: { spacing: { before: 40, after: 0, line: 230 } } },
        { id: 'TOC2', name: 'toc 2', basedOn: 'Normal',
          run: { font: FONT, size: 18 },
          paragraph: { spacing: { before: 0, after: 0, line: 220 }, indent: { left: 340 } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [
          { level: 0, format: LevelFormat.BULLET, text: '●', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 230 } }, run: { color: TEAL, font: FONT } } },
          { level: 1, format: LevelFormat.BULLET, text: '○', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 760, hanging: 230 } }, run: { color: TEAL, font: FONT } } },
        ] },
        { reference: 'steps', levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 280 } }, run: { bold: true, color: NAVY, font: FONT } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 800, hanging: 280 } }, run: { font: FONT } } },
        ] },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } }, // 20mm
        titlePage: true, // 表紙にはヘッダー・ページ番号を出さない
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          children: [t(title, { size: 16, color: GRAY })],
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2D7', space: 4 } },
        })] }),
        first: new Header({ children: [new Paragraph({ children: [t('')] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          children: [t('', { size: 16 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY }),
            t(' / ', { size: 16, color: GRAY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GRAY })],
          alignment: AlignmentType.CENTER,
        })] }),
        first: new Footer({ children: [new Paragraph({ children: [t('')] })] }),
      },
      children,
    }],
  });
}

module.exports = { d, FONT, runs, NAVY, TEAL, GRAY, LIGHT, AMBER, CW, t, p, h1, h2, h3, li, steps, note, warn, table, gap, cover, toc, buildDoc, PageBreak };
