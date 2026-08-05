'use strict';

/**
 * Minimal transactional email for password-reset links.
 * Uses Resend (https://resend.com) — a single API key over HTTPS, no SMTP.
 *
 * Env:
 *   RESEND_API_KEY   — Resend API key (required to actually deliver mail).
 *   RESET_EMAIL_FROM — sender, e.g. "20FIT Talent <no-reply@20fit.id>"
 *                      (the domain must be verified in Resend to reach real inboxes).
 *   MAIL_MOCK=1      — never call the API; just log the link (local testing).
 *
 * When no key is configured the send is a no-op that logs the link, so the
 * flow keeps working (and the link is recoverable from the server logs) until
 * the email service is wired up.
 */

const API_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM = (process.env.RESET_EMAIL_FROM || '20FIT Talent <onboarding@resend.dev>').trim();

function configured() { return !!API_KEY; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function resetEmailHtml({ name, link, lang }) {
  const id = lang !== 'en';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Kami menerima permintaan untuk mengatur ulang password akun 20FIT Talent kamu. Klik tombol di bawah untuk membuat password baru. Link ini berlaku 1 jam dan hanya bisa dipakai sekali.',
    btn: 'Buat Password Baru',
    ignore: 'Kalau kamu tidak meminta ini, abaikan saja email ini — password kamu tidak berubah.',
    foot: 'Email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
  } : {
    hi: ('Hi ' + (name || '')).trim() + ',',
    body: 'We received a request to reset your 20FIT Talent account password. Click the button below to set a new one. This link is valid for 1 hour and can be used once.',
    btn: 'Set a New Password',
    ignore: 'If you did not request this, just ignore this email — your password stays the same.',
    foot: 'Automated email from 20FIT Talent. Please do not reply.',
  };
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#17171d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ed">
      <tr><td style="background:#E4121F;padding:20px 28px;color:#fff;font-size:20px;font-weight:800">20FIT Talent</td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(t.hi)}</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#41454d">${esc(t.body)}</p>
        <a href="${esc(link)}" style="display:inline-block;background:#E4121F;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${esc(t.btn)}</a>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#63676e">${esc(t.ignore)}</p>
        <p style="margin:18px 0 0;font-size:12px;word-break:break-all;color:#8b8f97">${esc(link)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e3e7ed;font-size:12px;color:#8b8f97">${esc(t.foot)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Send a reset link. Returns { delivered }. Never throws for a missing key. */
async function sendResetEmail({ to, name, link, lang }) {
  const subject = lang !== 'en' ? 'Reset Password — 20FIT Talent' : 'Reset your password — 20FIT Talent';
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — reset link for ' + to + ': ' + link);
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: resetEmailHtml({ name, link, lang }) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}

function acceptanceEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const id = lang === 'id';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Selamat! Pendaftaran kamu untuk event di bawah ini sudah <b>disetujui</b>. Berikut detail penugasan kamu:',
    ev: 'Event', date: 'Tanggal', loc: 'Lokasi', cat: 'Kategori', stn: 'Penugasan / Station',
    stnPending: 'Akan diinformasikan lebih lanjut oleh tim.',
    next: 'Tim 20FIT Talent akan menghubungi kamu untuk info teknis, jadwal briefing, dan persiapan yang dibutuhkan sebelum event.',
    keep: 'Mohon simpan email ini sebagai konfirmasi keberhasilan pendaftaran kamu.',
    thanks: 'Terima kasih sudah menjadi bagian dari event ini. Sampai jumpa di lokasi!',
    regards: 'Salam hangat,',
    team: '20FIT Talent Team',
    foot: 'Ini adalah email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
  } : {
    hi: ('Hello ' + (name || '')).trim() + ',',
    body: 'Congratulations! Your registration for the following event has been <b>approved</b>. Below are your assignment details:',
    ev: 'Event', date: 'Date', loc: 'Location', cat: 'Category', stn: 'Assignment / Station',
    stnPending: 'Will be shared by the team soon.',
    next: 'The 20FIT Talent team will contact you with technical information, the briefing schedule, and any preparations required before the event.',
    keep: 'Please keep this email as confirmation of your successful registration.',
    thanks: 'Thank you for being part of the event. We look forward to seeing you there.',
    regards: 'Best regards,',
    team: '20FIT Talent Team',
    foot: 'This is an automated email from 20FIT Talent. Please do not reply to this email.',
  };
  t.hero = id ? 'Pendaftaran Disetujui' : 'Registration Approved';
  t.heroSub = id ? 'Kamu sudah siap untuk event ini' : "You're all set for the event";
  t.pre = id ? 'Kamu disetujui — ini detail penugasan kamu.' : "You're approved — here are your assignment details.";

  // Light, premium layout. Off-white text tones (#fffffe / #feffff) and explicit
  // color-scheme metas make the hero resist email-client dark-mode inversion,
  // which was flipping the wordmark to dark-on-red in the old flat template.
  const stationVal = station ? esc(station) + (stationLoc ? ' · ' + esc(stationLoc) : '')
    : '<span style="color:#8b8f97">' + esc(t.stnPending) + '</span>';
  const row = (label, value, accent) => value
    ? `<tr>
        <td style="padding:13px 16px;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:#8b8f97;vertical-align:top;border-top:1px solid #eceff3;${accent ? 'background:#fff2f3' : ''}">${esc(label)}</td>
        <td style="padding:13px 16px;font-size:14px;font-weight:700;text-align:right;vertical-align:top;color:${accent ? '#E4121F' : '#17171d'};border-top:1px solid #eceff3;${accent ? 'background:#fff2f3' : ''}">${value}</td>
      </tr>`
    : '';
  // Strip the top border from the first present row (the card edge frames it).
  const rowsHtml = [
    row(t.ev, esc(eventName)),
    row(t.date, eventDate ? esc(eventDate) : ''),
    row(t.loc, location ? esc(location) : ''),
    row(t.cat, esc(category)),
    row(t.stn, stationVal, true),
  ].filter(Boolean).join('')
    .replace('border-top:1px solid #eceff3', 'border-top:0').replace('border-top:1px solid #eceff3', 'border-top:0');
  const para = (txt, color) => `<p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;color:${color || '#4a4e57'}">${txt}</p>`;
  return `<!doctype html><html lang="${id ? 'id' : 'en'}"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  </head><body style="margin:0;padding:0;background:#eef1f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17171d">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(t.pre)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6"><tr><td align="center" style="padding:28px 14px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e4e8ee;box-shadow:0 8px 26px rgba(20,24,40,.08)">
      <tr><td bgcolor="#E4121F" style="background:#E4121F;background:linear-gradient(135deg,#ff3b47,#d10f1b);padding:34px 30px 30px;text-align:center">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fffffe">20FIT Talent</div>
        <div style="width:62px;height:62px;border-radius:50%;background:#fffffe;font-size:30px;font-weight:900;color:#E4121F;line-height:62px;margin:20px auto 0">&#10003;</div>
        <div style="margin-top:16px;font-size:22px;font-weight:800;color:#fffffe">${esc(t.hero)}</div>
        <div style="margin-top:6px;font-size:13.5px;color:#ffe3e5">${esc(t.heroSub)}</div>
      </td></tr>
      <tr><td style="padding:28px 30px 6px">
        <p style="margin:0 0 10px;font-size:17px;font-weight:800;color:#17171d">${esc(t.hi)}</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#4a4e57">${t.body.replace('<b>', '<b style="color:#E4121F">')}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfc;border:1px solid #eceff3;border-radius:14px">
          ${rowsHtml}
        </table>
      </td></tr>
      <tr><td style="padding:22px 30px 4px">
        ${para(esc(t.next))}
        ${para(esc(t.keep))}
        ${para(esc(t.thanks))}
        <p style="margin:20px 0 4px;font-size:13.5px;line-height:1.6;color:#4a4e57">${esc(t.regards)}<br><b style="color:#17171d">${esc(t.team)}</b></p>
      </td></tr>
      <tr><td style="padding:20px 30px 26px;border-top:1px solid #eceff3"><p style="margin:0;font-size:11.5px;line-height:1.5;color:#9498a1">${esc(t.foot)}</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function reminderEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const id = lang !== 'en';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Pengingat ya! 📅 <b>Besok</b> kamu bertugas di event berikut. Mohon datang tepat waktu dan siapkan semua kebutuhanmu.',
    ev: 'Event', date: 'Tanggal', loc: 'Lokasi', cat: 'Kategori', stn: 'Penempatan / station',
    stnPending: 'Akan diinformasikan lebih lanjut oleh tim.',
    next: 'Sampai jumpa besok di lokasi! Kalau ada kendala, segera hubungi tim 20FIT.',
    foot: 'Email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
  } : {
    hi: ('Hi ' + (name || '')).trim() + ',',
    body: "Friendly reminder! 📅 You're on duty for the event below <b>tomorrow</b>. Please arrive on time and bring everything you need.",
    ev: 'Event', date: 'Date', loc: 'Location', cat: 'Category', stn: 'Placement / station',
    stnPending: 'Will be shared by the team soon.',
    next: 'See you there tomorrow! If anything comes up, reach out to the 20FIT team.',
    foot: 'Automated email from 20FIT Talent. Please do not reply.',
  };
  const stationVal = station ? esc(station) + (stationLoc ? ' · ' + esc(stationLoc) : '')
    : '<span style="color:#8b8f97">' + esc(t.stnPending) + '</span>';
  const row = (label, value) => value
    ? `<tr><td style="padding:7px 0;font-size:13px;color:#8b8f97;width:150px;vertical-align:top">${esc(label)}</td><td style="padding:7px 0;font-size:14px;color:#17171d;font-weight:600">${value}</td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#17171d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ed">
      <tr><td style="background:#E4121F;padding:20px 28px;color:#fff;font-size:20px;font-weight:800">20FIT Talent</td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(t.hi)}</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#41454d">${t.body}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #e8ebf0;border-radius:12px;padding:6px 18px">
          ${row(t.ev, esc(eventName))}
          ${row(t.date, eventDate ? esc(eventDate) : '')}
          ${row(t.loc, location ? esc(location) : '')}
          ${row(t.cat, esc(category))}
          ${row(t.stn, stationVal)}
        </table>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#63676e">${esc(t.next)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e3e7ed;font-size:12px;color:#8b8f97">${esc(t.foot)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Remind a talent their event is tomorrow (H-1). Returns { delivered }. Never throws for a missing key. */
async function sendReminderEmail({ to, name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const subject = (lang !== 'en' ? 'Pengingat: ' : 'Reminder: ') + (eventName || 'event 20FIT') + (lang !== 'en' ? ' besok!' : ' is tomorrow!') + ' — 20FIT Talent';
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — reminder for ' + to + ' (' + eventName + ')');
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: reminderEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}

/** Notify a talent their application was approved. Returns { delivered }. Never throws for a missing key. */
async function sendAcceptanceEmail({ to, name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const subject = lang === 'id'
    ? 'Pendaftaran Event Kamu Telah Disetujui — 20FIT Talent'
    : 'Your Event Registration Has Been Approved';
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — acceptance for ' + to + ' (' + eventName + ')');
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: acceptanceEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}

module.exports = { configured, sendResetEmail, sendAcceptanceEmail, sendReminderEmail };
