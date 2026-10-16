'use strict';
/**
 * Clickwrap agreement copy as a PDF (pure pdfkit, same fonts as the certificate).
 * Contents: title, assignment details, the agreement text exactly as rendered
 * for that application (HTML → paragraphs / numbered lists), and — once accepted
 * — the acceptance record (typed name, time in WIB, IP, device, version, proof ID).
 * Before acceptance it renders a marked "not yet agreed" copy.
 */
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, 'assets', 'cert');
const FONT_R = path.join(FONT_DIR, 'Carlito-Regular.ttf');
const FONT_B = path.join(FONT_DIR, 'Carlito-Bold.ttf');
const RED = '#E4121F';
const INK = '#14161a';
const MUTED = '#6b7280';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&times;/g, '×')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}
const stripTags = (s) => decodeEntities(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

// Agreement HTML → blocks: { type:'h'|'p'|'li', text, n }. Only the tags the
// templates use (h1–h4, p, ol/ul > li); anything else is flattened to text.
function htmlBlocks(html) {
  const out = [];
  const re = /<(h[1-4]|p|ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[1].toLowerCase();
    if (tag === 'ol' || tag === 'ul') {
      const items = [...m[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => stripTags(x[1])).filter(Boolean);
      items.forEach((text, i) => out.push({ type: 'li', text, n: tag === 'ol' ? (i + 1) + '.' : '•' }));
    } else {
      const text = stripTags(m[2]);
      if (text) out.push({ type: tag === 'p' ? 'p' : 'h', text });
    }
  }
  if (!out.length) { const t = stripTags(html); if (t) out.push({ type: 'p', text: t }); }
  return out;
}

// Date/time in WIB, e.g. "16/10/2026 14:05:09 WIB".
function wib(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())} WIB`;
}

const L10N = {
  id: { event: 'Event', position: 'Posisi', date: 'Tanggal', session: 'Sesi', hours: 'Jam bertugas', arrival: 'Jam tiba', location: 'Lokasi',
    record: 'Data Persetujuan', name: 'Nama (diketik)', at: 'Waktu setuju', ip: 'Alamat IP', ua: 'Perangkat', version: 'Versi dokumen', id: 'ID bukti', method: 'Metode',
    draft: 'SALINAN — BELUM DISETUJUI', footer: 'Dokumen ini dihasilkan otomatis oleh platform 20FIT Talent.' },
  en: { event: 'Event', position: 'Position', date: 'Date', session: 'Session', hours: 'Working hours', arrival: 'Arrival time', location: 'Location',
    record: 'Acceptance Record', name: 'Name (typed)', at: 'Accepted at', ip: 'IP address', ua: 'Device', version: 'Document version', id: 'Proof ID', method: 'Method',
    draft: 'COPY — NOT YET AGREED', footer: 'This document was generated automatically by the 20FIT Talent platform.' },
};

/**
 * @param {object} o
 * @param {string} o.title      agreement title
 * @param {string} o.bodyHtml   rendered agreement HTML (placeholders already filled)
 * @param {object} o.details    { event, position, date, session, hours, arrival, location }
 * @param {object} [o.acceptance] { id, typed_name, accepted_at, ip_address, user_agent, template_version, acceptance_method }
 * @param {string} [o.lang]     'id' | 'en'
 * @returns {Promise<Buffer>}
 */
function renderAgreementPdf(o) {
  const t = L10N[o.lang === 'en' ? 'en' : 'id'];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: o.title || 'Agreement', Author: '20FIT Talent' } });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);
    doc.registerFont('r', FONT_R);
    doc.registerFont('b', FONT_B);
    const W = doc.page.width - 112;

    doc.font('b').fontSize(10).fillColor(RED).text('20FIT TALENT', { characterSpacing: 1.5 });
    doc.moveDown(0.3);
    doc.font('b').fontSize(18).fillColor(INK).text(o.title || '');
    if (!o.acceptance) { doc.moveDown(0.2); doc.font('b').fontSize(10).fillColor(RED).text(t.draft); }
    doc.moveDown(0.6);

    // Assignment details (two columns)
    const d = o.details || {};
    const rows = [[t.event, d.event], [t.position, d.position], [t.date, d.date], [t.session, d.session], [t.hours, d.hours], [t.arrival, d.arrival], [t.location, d.location]];
    rows.forEach(([k, v]) => {
      const y = doc.y;
      doc.font('r').fontSize(10).fillColor(MUTED).text(k, 56, y, { width: 110 });
      doc.font('b').fontSize(10).fillColor(INK).text(String(v || '—'), 170, y, { width: W - 114 });
      doc.moveDown(0.25);
    });
    doc.moveDown(0.6);
    doc.moveTo(56, doc.y).lineTo(56 + W, doc.y).strokeColor('#e3e5e9').lineWidth(1).stroke();
    doc.moveDown(0.8);

    htmlBlocks(o.bodyHtml).forEach((b) => {
      if (b.type === 'h') {
        doc.moveDown(0.4);
        doc.font('b').fontSize(10.5).fillColor(RED).text(b.text.toUpperCase(), 56, doc.y, { width: W, characterSpacing: 0.3 });
        doc.moveDown(0.25);
      } else if (b.type === 'li') {
        const y = doc.y;
        doc.font('r').fontSize(10).fillColor(INK).text(b.n, 56, y, { width: 18 });
        doc.text(b.text, 76, y, { width: W - 20, align: 'justify' });
        doc.moveDown(0.25);
      } else {
        doc.font('r').fontSize(10).fillColor(INK).text(b.text, 56, doc.y, { width: W, align: 'justify' });
        doc.moveDown(0.45);
      }
    });

    if (o.acceptance) {
      const a = o.acceptance;
      if (doc.y > doc.page.height - 220) doc.addPage();
      doc.moveDown(0.8);
      doc.moveTo(56, doc.y).lineTo(56 + W, doc.y).strokeColor('#e3e5e9').stroke();
      doc.moveDown(0.6);
      doc.font('b').fontSize(12).fillColor(INK).text(t.record, 56, doc.y);
      doc.moveDown(0.4);
      const rec = [[t.name, a.typed_name], [t.at, wib(a.accepted_at)], [t.ip, a.ip_address || '—'], [t.ua, a.user_agent || '—'],
        [t.version, 'v' + a.template_version], [t.method, a.acceptance_method || 'clickwrap'], [t.id, a.id]];
      rec.forEach(([k, v]) => {
        const y = doc.y;
        doc.font('r').fontSize(9.5).fillColor(MUTED).text(k, 56, y, { width: 110 });
        doc.font('b').fontSize(9.5).fillColor(INK).text(String(v || '—'), 170, y, { width: W - 114 });
        doc.moveDown(0.2);
      });
    }
    doc.moveDown(1);
    doc.font('r').fontSize(8.5).fillColor(MUTED).text(t.footer, 56, doc.y, { width: W });
    doc.end();
  });
}

module.exports = { renderAgreementPdf, htmlBlocks, wib };
