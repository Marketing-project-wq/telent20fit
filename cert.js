'use strict';

/**
 * Digital certificate rendering for 20FIT Talent.
 * PDF is produced on demand with pdfkit (pure JS, built-in Helvetica — no
 * external fonts or browser needed, so it runs anywhere Node runs).
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RED = '#E4121F';
const INK = '#17171d';
const MUTED = '#6b7280';

// Embedded TTF fonts (SIL OFL) bundled under ./fonts so the certificate renders
// identically anywhere Node runs — no browser, no network, no runtime download.
// Missing files degrade to Helvetica rather than throwing, so a bad deploy still
// serves a (plainer) certificate instead of a 500.
const FONT_DIR = path.join(__dirname, 'fonts');
function loadFont(file) {
  try { return fs.readFileSync(path.join(FONT_DIR, file)); } catch (e) { return null; }
}
const FB = {
  b9: loadFont('BarlowCondensed-Black.ttf'),
  b8: loadFont('BarlowCondensed-ExtraBold.ttf'),
  b7: loadFont('BarlowCondensed-Bold.ttf'),
  gv: loadFont('GreatVibes-Regular.ttf'),
  m4: loadFont('Manrope-Regular.ttf'),
  m8: loadFont('Manrope-ExtraBold.ttf'),
  mo: loadFont('JetBrainsMono-Regular.ttf'),
};

/** Title-case a stored name for display, e.g. "clio" -> "Clio". */
function titleCase(s) {
  return String(s || '').trim().replace(/\s+/g, ' ')
    .split(' ').map((w) => (w ? w[0].toLocaleUpperCase('id') + w.slice(1) : w)).join(' ');
}

/** Human-facing certificate number, e.g. "20FIT-2026-A1B2C3". */
function makeCertNo(year) {
  const y = year || new Date().getUTCFullYear();
  return `20FIT-${y}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Certificate palette (matches the 20FIT brand mockup; kept separate from the
// attendance-report colours above).
const C_INK = '#141417', C_GRAY = '#26262B', C_RED = '#E4002B', C_DRED = '#B00021';
const C_MUTED = '#4A4A50', C_BODY = '#2A2A2E', C_SUB = '#6E6E73';

/**
 * Render a "Certificate of Participation" to a PDF Buffer (1200x800 landscape),
 * matching the 20FIT brand mockup. Vector ornaments and dot grids are copied
 * verbatim from the mockup's SVG; headings/body/script use embedded TTF fonts.
 *
 * cert = { cert_no, talent_name, role, event_name, event_date, location,
 *          verifyUrl, signatory?, signatoryTitle? }
 */
function renderCertificatePDF(cert) {
  cert = cert || {};
  return new Promise((resolve, reject) => {
    const W = 1200, H = 800, CX = W / 2;
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Register whichever fonts loaded; fall back to a built-in for any missing.
    const reg = (key, alias, fallback) => {
      if (FB[key]) { try { doc.registerFont(alias, FB[key]); return alias; } catch (e) { /* fall through */ } }
      return fallback;
    };
    const B9 = reg('b9', 'B9', 'Helvetica-Bold');   // heavy display (title, logo)
    const B8 = reg('b8', 'B8', 'Helvetica-Bold');   // headings (role)
    const B7 = reg('b7', 'B7', 'Helvetica-Bold');   // small caps (signatory title)
    const GV = reg('gv', 'GV', 'Helvetica-Oblique'); // script (recipient name)
    const M4 = reg('m4', 'M4', 'Helvetica');        // body
    const M8 = reg('m8', 'M8', 'Helvetica-Bold');   // signatory name
    const MO = reg('mo', 'MO', 'Courier');          // mono (cert no + verify)

    // ---- Canvas ----
    doc.rect(0, 0, W, H).fill('#FFFFFF');

    // ---- Corner ornaments (SVG paths verbatim; draw order back->front) ----
    const TL = [
      ['M0 0 H330 C215 55 120 150 66 330 H0 Z', C_INK],
      ['M0 0 H250 C160 60 88 152 44 330 H0 Z', C_GRAY],
      ['M0 0 H150 C96 62 48 156 18 330 H0 Z', C_RED],
      ['M0 0 H86 C56 66 26 160 8 330 H0 Z', C_DRED],
    ];
    TL.forEach(([d, c]) => { doc.save(); doc.path(d).fill(c); doc.restore(); });
    const BR = [
      ['M420 330 H90 C205 275 300 180 354 0 H420 Z', C_INK],
      ['M420 330 H170 C260 270 332 178 376 0 H420 Z', C_GRAY],
      ['M420 330 H270 C324 268 372 174 402 0 H420 Z', C_RED],
      ['M420 330 H334 C364 264 394 170 412 0 H420 Z', C_DRED],
    ];
    doc.save(); doc.translate(780, 470);
    BR.forEach(([d, c]) => { doc.save(); doc.path(d).fill(c); doc.restore(); });
    doc.restore();

    // ---- Dot grids (r=4, brand red, varying opacity) ----
    const dot = (ox, oy, cx, cy, op) => {
      doc.save(); doc.circle(ox + cx, oy + cy, 4).fillOpacity(op).fill(C_RED); doc.restore();
    };
    [[8, 8, 1], [30, 8, 1], [52, 8, 1], [74, 8, 1], [96, 8, 1], [112, 8, 0.45],
     [8, 30, 0.7], [30, 30, 0.7], [52, 30, 0.7], [74, 30, 0.45], [96, 30, 0.3]]
      .forEach(([x, y, o]) => dot(1024, 34, x, y, o)); // top-right
    [[8, 8, 0.3], [30, 8, 0.45], [52, 8, 0.7], [74, 8, 0.7], [96, 8, 0.7],
     [8, 30, 0.45], [30, 30, 1], [52, 30, 1], [74, 30, 1], [96, 30, 1], [112, 30, 1]]
      .forEach(([x, y, o]) => dot(56, 724, x, y, o)); // bottom-left

    // ---- Centered text helper (y = top of text) ----
    const T = (font, size, color, str, y, ls, opts) => {
      opts = opts || {};
      doc.font(font).fontSize(size).fillColor(color).fillOpacity(1);
      doc.text(String(str == null ? '' : str), opts.x != null ? opts.x : 0, y, {
        width: opts.w != null ? opts.w : W, align: 'center',
        characterSpacing: ls || 0, lineBreak: opts.lineBreak || false,
      });
    };

    // ---- Title ----
    T(B9, 58, C_INK, 'CERTIFICATE', 74, 58 * 0.02);
    T(B8, 22, C_INK, 'OF PARTICIPATION', 146, 22 * 0.42);

    // ---- Presented to + recipient name ----
    T(M4, 15, C_MUTED, 'Proudly presented to:', 199, 0);
    T(GV, 62, C_INK, titleCase(cert.talent_name) || '—', 236, 0);

    // ---- Divider (hollow rings + line) ----
    doc.save();
    doc.moveTo(341, 310).lineTo(859, 310).lineWidth(1.5).strokeColor(C_RED).stroke();
    doc.restore();
    [324.5, 875.5].forEach((x) => {
      doc.save();
      doc.circle(x, 310, 6).fill('#FFFFFF');
      doc.circle(x, 310, 5).lineWidth(2).strokeColor(C_RED).stroke();
      doc.restore();
    });

    // ---- as / role ----
    T(M4, 14, C_MUTED, 'as', 339, 0);
    T(B8, 30, C_INK, String(cert.role || '').toUpperCase(), 366, 30 * 0.14);

    // ---- Body (event / date / location), wraps within 640px ----
    const ev = cert.event_name ? String(cert.event_name) : '';
    let body = ev ? `for serving as part of the official 20FIT team at ${ev}` : 'for serving as part of the official 20FIT team';
    if (cert.event_date) body += `, held on ${cert.event_date}`;
    if (cert.location) body += ` at ${cert.location}`;
    body += '.';
    doc.font(M4).fontSize(15).fillColor(C_BODY).fillOpacity(1);
    doc.text(body, (W - 640) / 2, 424, { width: 640, align: 'center', lineGap: 12 });

    // ---- Signature line + signatory ----
    doc.save();
    doc.moveTo(475, 539).lineTo(725, 539).lineWidth(1).strokeOpacity(0.28).strokeColor(C_INK).stroke();
    doc.restore();
    T(M8, 17, C_INK, cert.signatory || 'Novi Eastiyanto', 546, 0);
    T(B7, 12.5, C_SUB, (cert.signatoryTitle || 'Chief Operating Officer · 20FIT').toUpperCase(), 575, 12.5 * 0.18);

    // ---- 20●FIT logo ----
    const ly = 611;
    doc.font(B9).fontSize(44);
    const w20 = doc.widthOfString('20'), wFIT = doc.widthOfString('FIT'), dotGap = 30;
    const sx = CX - (w20 + dotGap + wFIT) / 2;
    doc.fillColor(C_INK).fillOpacity(1).text('20', sx, ly, { lineBreak: false, characterSpacing: 44 * 0.01 });
    doc.fillColor(C_INK).text('FIT', sx + w20 + dotGap, ly, { lineBreak: false, characterSpacing: 44 * 0.01 });
    doc.save(); doc.circle(sx + w20 + dotGap / 2, ly + 24, 9).fill(C_RED); doc.restore();

    // ---- Certificate number + verification URL (bottom-centre) ----
    if (cert.cert_no) T(MO, 11, '#55555B', 'No. ' + cert.cert_no, 688, 0.5);
    if (cert.verifyUrl) T(MO, 9, '#9A9AA0', 'Verify at ' + String(cert.verifyUrl).replace(/^https?:\/\//, ''), 707, 0.2);

    doc.end();
  });
}

/**
 * Render a Man Power attendance report to a PDF Buffer (A4 landscape table).
 * rows = [{ name, event, phone, bank, acct, holder, count }], sorted by caller.
 * opts = { subtitle }
 */
function renderAttendanceReportPDF(rows, opts) {
  opts = opts || {};
  rows = rows || [];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width, H = doc.page.height;
    const left = 40, tableW = W - 80;
    const cols = [
      { key: 'no', label: 'No', w: 28, align: 'center' },
      { key: 'name', label: 'Nama', w: 132 },
      { key: 'event', label: 'Event', w: 92 },
      { key: 'phone', label: 'No. Telepon', w: 92 },
      { key: 'bank', label: 'Nama Bank', w: 74 },
      { key: 'acct', label: 'No. Rekening', w: 104 },
      { key: 'holder', label: 'Atas Nama', w: 190 },
      { key: 'count', label: 'Absen', w: 50, align: 'center' },
    ];
    let y = 0;

    function topBar() {
      doc.rect(0, 0, W, 62).fill(RED);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('20FIT TALENT', left, 16, { characterSpacing: 2 });
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('Report Absensi Man Power', left, 29);
      if (opts.subtitle) doc.fillColor('#ffd9db').font('Helvetica').fontSize(9).text(opts.subtitle, left, 31, { width: tableW, align: 'right' });
    }
    function tableHeader() {
      doc.rect(left, y, tableW, 22).fill(RED);
      let x = left;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      cols.forEach((c) => { doc.text(c.label, x + 5, y + 7, { width: c.w - 10, align: c.align || 'left', lineBreak: false, ellipsis: true }); x += c.w; });
      y += 22;
    }

    topBar();
    y = 82;
    tableHeader();

    if (!rows.length) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(11).text('Belum ada Man Power yang melakukan absensi.', left, y + 14);
      doc.end();
      return;
    }

    rows.forEach((r, i) => {
      if (y + 20 > H - 40) { doc.addPage(); topBar(); y = 82; tableHeader(); }
      if (i % 2) doc.rect(left, y, tableW, 20).fill('#f7f8fa');
      const vals = { no: String(i + 1), name: r.name, event: r.event, phone: r.phone, bank: r.bank, acct: r.acct, holder: r.holder, count: (r.count || 0) + '×' };
      let x = left;
      cols.forEach((c) => {
        if (c.key === 'count') doc.font('Helvetica-Bold').fillColor(RED);
        else doc.font('Helvetica').fillColor(INK);
        doc.fontSize(9).text(String(vals[c.key] == null ? '' : vals[c.key]), x + 5, y + 6, { width: c.w - 10, align: c.align || 'left', lineBreak: false, ellipsis: true });
        x += c.w;
      });
      doc.moveTo(left, y + 20).lineTo(left + tableW, y + 20).lineWidth(0.5).strokeColor('#e3e7ed').stroke();
      y += 20;
    });

    doc.end();
  });
}

module.exports = { makeCertNo, renderCertificatePDF, renderAttendanceReportPDF };
