'use strict';

/**
 * Digital certificate rendering for 20FIT Talent.
 * PDF is produced on demand with pdfkit (pure JS, built-in Helvetica — no
 * external fonts or browser needed, so it runs anywhere Node runs).
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const RED = '#E4121F';
const INK = '#17171d';
const MUTED = '#6b7280';

/** Human-facing certificate number, e.g. "20FIT-2026-A1B2C3". */
function makeCertNo(year) {
  const y = year || new Date().getUTCFullYear();
  return `20FIT-${y}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
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

module.exports = { makeCertNo, renderCertificatePDF };
