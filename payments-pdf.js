'use strict';

/**
 * Payment recap PDF (A4 landscape) for one event: header with event name/date,
 * head count and total; one table of all rows; a sign-off block
 * (prepared by / approved by), print date and the printing staff name; and a
 * diagonal watermark with the downloader + download time on every page, so a
 * leaked copy can be traced. Streams straight to the HTTP response (never stored).
 *
 * data = { event: { name, date, location }, rows: [{ name, position, division,
 *          phone, bankName, acct, holder, days, feeDay, fee, paid }], missing: [names],
 *          totals: { people, total }, printedBy, printedAt: Date }
 */
const PDFDocument = require('pdfkit');

const RED = '#E4121F';
const INK = '#17171d';
const MUTED = '#6b7280';
const LINE = '#e3e7ed';

const rp = (n) => (n == null ? '—' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID'));
const wib = (d) => new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';

function renderPaymentsPdf(out, data) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: 'Rekap Pembayaran — ' + (data.event.name || '') } });
  doc.pipe(out);
  const W = doc.page.width, H = doc.page.height;
  const left = 36, tableW = W - 72;
  const mark = 'Diunduh oleh ' + (data.printedBy || '-') + ' · ' + wib(data.printedAt || new Date());
  const cols = [
    { key: 'no', label: 'No', w: 26, align: 'center' },
    { key: 'name', label: 'Nama Lengkap', w: 128 },
    { key: 'position', label: 'Posisi', w: 96 },
    { key: 'phone', label: 'No. HP', w: 84 },
    { key: 'bankName', label: 'Bank', w: 62 },
    { key: 'acct', label: 'No. Rekening', w: 96 },
    { key: 'holder', label: 'Atas Nama', w: 118 },
    { key: 'days', label: 'Hari', w: 32, align: 'center' },
    { key: 'fee', label: 'Fee', w: 76, align: 'right' },
    { key: 'paid', label: 'Status', w: 52, align: 'center' },
  ];
  let y = 0;

  function watermark() {
    doc.save();
    doc.fillColor('#000000').opacity(0.06).font('Helvetica-Bold').fontSize(26);
    doc.rotate(-24, { origin: [W / 2, H / 2] });
    for (let i = -2; i <= 2; i++) doc.text(mark, 0, H / 2 + i * 120 - 12, { width: W, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }
  function header(first) {
    doc.rect(0, 0, W, 58).fill(RED);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('20FIT TALENT', left, 13, { characterSpacing: 2 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('Rekap Pembayaran Talent', left, 26);
    doc.fillColor('#ffd9db').font('Helvetica').fontSize(9).text(String(data.event.name || ''), left, 16, { width: tableW, align: 'right' });
    doc.text([data.event.date, data.event.location].filter(Boolean).join(' · '), left, 30, { width: tableW, align: 'right' });
    y = 70;
    if (first) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Jumlah orang: ' + data.totals.people + '      Total: ' + rp(data.totals.total), left, y);
      y += 20;
    }
  }
  function newPage() { doc.addPage(); watermark(); header(false); }
  function tableHead() {
    doc.rect(left, y, tableW, 20).fill('#2b2b33');
    let x = left;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    cols.forEach((c) => { doc.text(c.label, x + 4, y + 6, { width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true }); x += c.w; });
    y += 20;
  }
  function ensure(h) { if (y + h > H - 46) { newPage(); tableHead(); } }

  watermark();
  header(true);

  if (!data.rows.length) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(11).text('Belum ada talent yang memenuhi syarat dengan data rekening lengkap.', left, y + 10);
  }
  // One table for everyone (division is no longer shown); rows arrive sorted by position, then name.
  const groups = new Map();
  if (data.rows.length) groups.set('', data.rows);
  let n = 0;
  groups.forEach((list) => {
    ensure(64);
    y += 6;
    tableHead();
    list.forEach((r, i) => {
      ensure(19);
      if (i % 2) doc.rect(left, y, tableW, 19).fill('#f7f8fa');
      n++;
      const vals = { no: String(n), name: r.name, position: r.position, phone: r.phone, bankName: r.bankName, acct: r.acct, holder: r.holder, days: String(r.days), fee: rp(r.fee), paid: r.paid ? 'Lunas' : 'Belum' };
      let x = left;
      cols.forEach((c) => {
        doc.font(c.key === 'acct' || c.key === 'fee' ? 'Helvetica-Bold' : 'Helvetica').fillColor(c.key === 'paid' && r.paid ? '#178A54' : INK).fontSize(8.5)
          .text(String(vals[c.key] == null ? '' : vals[c.key]), x + 4, y + 5.5, { width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true });
        x += c.w;
      });
      doc.moveTo(left, y + 19).lineTo(left + tableW, y + 19).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 19;
    });
    y += 8;
  });

  if (data.missing && data.missing.length) {
    ensure(40);
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5)
      .text('Belum melengkapi data rekening (tidak dihitung): ' + data.missing.length + ' orang — ' + data.missing.join(', '), left, y + 4, { width: tableW });
    y = doc.y + 8;
  }

  // Sign-off block + print info
  ensure(110);
  y += 10;
  const boxW = 220;
  [['Dibuat oleh', data.printedBy || ''], ['Disetujui oleh', '']].forEach(([label, name], i) => {
    const x = left + i * (boxW + 40);
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(label, x, y);
    doc.moveTo(x, y + 62).lineTo(x + boxW, y + 62).lineWidth(0.7).strokeColor('#9aa0a8').stroke();
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(name || 'Nama & tanda tangan', x, y + 66, { width: boxW });
  });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text('Dicetak: ' + wib(data.printedAt || new Date()) + ' oleh ' + (data.printedBy || '-'), left, y + 6, { width: tableW, align: 'right' });
  doc.text('Dokumen rahasia — berisi data rekening talent. Jangan disebarkan.', left, y + 20, { width: tableW, align: 'right' });

  doc.end();
}

module.exports = { renderPaymentsPdf };
