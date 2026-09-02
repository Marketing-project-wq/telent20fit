'use strict';

/**
 * Digital certificate rendering for 20FIT Talent.
 * PDF is produced on demand with pdfkit (pure JS, built-in Helvetica — no
 * external fonts or browser needed, so it runs anywhere Node runs).
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');

const RED = '#E4121F';
const INK = '#17171d';
const MUTED = '#6b7280';

/** Human-facing certificate number, e.g. "20FIT-2026-A1B2C3". */
function makeCertNo(year) {
  const y = year || new Date().getUTCFullYear();
  return `20FIT-${y}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// --- 20FIT Talent certificate (new design) -------------------------------
// Crockford base32 (no I/L/O/U — avoids look-alikes). Random, so ids are not
// guessable in sequence; the DB unique index on cert_no is the real guard, and
// the caller retries on collision.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** e.g. "20FIT-TAL-7QX2K9" — random, non-sequential, collision-checked by DB. */
function makeTalentCertNo() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += B32[bytes[i] % 32];
  return `20FIT-TAL-${s}`;
}

const CERT_DIR = path.join(__dirname, 'assets', 'cert');
const CERT_TPL = path.join(CERT_DIR, 'template.png');
const CERT_FONT_R = path.join(CERT_DIR, 'Carlito-Regular.ttf');
const CERT_FONT_B = path.join(CERT_DIR, 'Carlito-Bold.ttf');

/**
 * Render the 20FIT Talent certificate to a PDF Buffer (Jalur B: pure pdfkit,
 * no browser). The full static artwork (stadium background, red corners, logo,
 * headings, signature rule, QR box, footer) is the bundled template image; only
 * the dynamic fields are overlaid as crisp vector Carlito text. 1920×1080.
 * cert = { talent_name, role, event_name, event_date, location,
 *          signatory_name, signatory_title, cert_no, verify }
 */
async function renderTalentCertificatePDF(cert) {
  // QR encodes the full verify URL so the box on the template becomes scannable.
  let qrBuf = null;
  if (cert.verify) {
    const url = /^https?:\/\//i.test(cert.verify) ? cert.verify : 'https://' + cert.verify;
    try { qrBuf = await QRCode.toBuffer(url, { type: 'png', margin: 0, width: 240, color: { dark: '#141417', light: '#ffffff' } }); } catch (e) { qrBuf = null; }
  }
  return new Promise((resolve, reject) => {
    const W = 1920, H = 1080;
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', CERT_FONT_R);
    doc.registerFont('b', CERT_FONT_B);

    doc.image(CERT_TPL, 0, 0, { width: W, height: H });

    const BLACK = '#111111', GREY = '#5a5a5f';
    const centerAt = (str, font, size, cx, top, color) => {
      doc.font(font).fontSize(size).fillColor(color || BLACK);
      const w = doc.widthOfString(String(str));
      doc.text(String(str), cx - w / 2, top, { lineBreak: false });
    };

    // Recipient name — auto-shrink so a very long name never overflows/clips.
    let nameSize = 76;
    doc.font('b').fontSize(nameSize);
    while (doc.widthOfString(String(cert.talent_name || '')) > 1240 && nameSize > 34) {
      nameSize -= 2; doc.fontSize(nameSize);
    }
    centerAt(cert.talent_name || '', 'b', nameSize, 960, 500 - nameSize / 2, BLACK);

    // Recognition sentence (role + event name inline); wraps for long values.
    const recTop = 626;
    doc.font('r').fontSize(28).fillColor(BLACK);
    const sentence = `In recognition of their verified contribution and professional role as ${cert.role || '-'} at ${cert.event_name || '-'}.`;
    doc.text(sentence, 460, recTop, { width: 1000, align: 'center', lineGap: 4 });
    const recBottom = doc.y; // pdfkit advances y past the wrapped block

    // Event date • location — flows just below the recognition block (never
    // overlaps it), but not above the design's natural slot.
    const metaTop = Math.min(786, Math.max(700, recBottom + 14));
    centerAt(`${cert.event_date || ''}      •      ${cert.location || ''}`, 'b', 29, 960, metaTop, BLACK);

    // Signature block — the template's baked rule sits right-of-centre and a bit
    // high, so hide it and redraw the rule + title + name centred on the page
    // and lower.
    doc.rect(852, 842, 384, 12).fill('#ffffff');
    const sigCx = 960, sigLineY = 894;
    doc.moveTo(sigCx - 175, sigLineY).lineTo(sigCx + 175, sigLineY).lineWidth(1.4).strokeColor('#3a3a3f').stroke();
    centerAt(cert.signatory_title || '', 'b', 24, sigCx, sigLineY + 12, BLACK);
    centerAt(cert.signatory_name || '', 'r', 23, sigCx, sigLineY + 52, BLACK);
    centerAt(cert.cert_no || '', 'b', 24, 1606, 884, BLACK);
    if (cert.verify) centerAt(cert.verify, 'r', 15, 1606, 924, GREY);
    // QR inside the template's box (top-left ~1361,833; ~125×123), inset a little.
    if (qrBuf) { doc.rect(1364, 836, 119, 117).fill('#ffffff'); doc.image(qrBuf, 1372, 843, { width: 103, height: 103 }); }

    doc.end();
  });
}

/**
 * Render a certificate to a PDF Buffer.
 * cert = { cert_no, talent_name, role, event_name, event_date, issued_at, verifyUrl }
 */
function renderCertificatePDF(cert) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const cx = W / 2;

    // Background + double border
    doc.rect(0, 0, W, H).fill('#ffffff');
    doc.lineWidth(6).strokeColor(RED).rect(24, 24, W - 48, H - 48).stroke();
    doc.lineWidth(1).strokeColor('#e3e7ed').rect(36, 36, W - 72, H - 72).stroke();

    // Brand + title
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(22).text('20FIT', 0, 66, { width: W, align: 'center' });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(42).text('SERTIFIKAT', 0, 104, { width: W, align: 'center', characterSpacing: 4 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('CERTIFICATE OF PARTICIPATION', 0, 156, { width: W, align: 'center', characterSpacing: 3 });

    // Recipient
    doc.fillColor(MUTED).font('Helvetica').fontSize(13).text('Diberikan kepada', 0, 200, { width: W, align: 'center' });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(34).text(cert.talent_name || '-', 60, 224, { width: W - 120, align: 'center' });
    doc.moveTo(cx - 130, 282).lineTo(cx + 130, 282).lineWidth(2).strokeColor(RED).stroke();

    // Body
    doc.fillColor(MUTED).font('Helvetica').fontSize(14)
      .text(`atas partisipasinya sebagai ${cert.role || '-'} pada`, 80, 302, { width: W - 160, align: 'center' });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20)
      .text(cert.event_name || '-', 80, 328, { width: W - 160, align: 'center' });
    if (cert.event_date) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(13).text(cert.event_date, 0, 362, { width: W, align: 'center' });
    }

    // Footer: number / verify / issued
    const fy = H - 92;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10);
    doc.text(`No. Sertifikat: ${cert.cert_no || '-'}`, 60, fy, { width: W / 2 - 80, align: 'left' });
    if (cert.verifyUrl) doc.text(cert.verifyUrl, 60, fy + 14, { width: W / 2 - 80, align: 'left' });
    doc.text(cert.issued_at ? `Diterbitkan: ${cert.issued_at}` : '', W / 2 + 20, fy, { width: W / 2 - 80, align: 'right' });
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(11).text('20FIT Talent', W / 2 + 20, fy + 13, { width: W / 2 - 80, align: 'right' });

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

module.exports = { makeCertNo, makeTalentCertNo, renderCertificatePDF, renderTalentCertificatePDF, renderAttendanceReportPDF };
