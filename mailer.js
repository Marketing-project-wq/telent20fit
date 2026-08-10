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

// Reuse the reset email layout for the EO email-verification link.
function verifyEmailHtml({ name, link, lang }) {
  const id = lang !== 'en';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Terima kasih sudah mendaftar sebagai Event Organizer di 20FIT Talent. Klik tombol di bawah untuk memverifikasi email dan mengaktifkan akunmu. Link ini berlaku 24 jam.',
    btn: 'Verifikasi Email',
    ignore: 'Kalau kamu tidak mendaftar, abaikan saja email ini.',
    foot: 'Email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
  } : {
    hi: ('Hi ' + (name || '')).trim() + ',',
    body: 'Thanks for registering as an Event Organizer on 20FIT Talent. Click the button below to verify your email and activate your account. This link is valid for 24 hours.',
    btn: 'Verify Email',
    ignore: 'If you did not register, just ignore this email.',
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

/** Send an EO email-verification link. Never throws for a missing key. */
async function sendVerifyEmail({ to, name, link, lang }) {
  const subject = lang !== 'en' ? 'Verifikasi Email — 20FIT Talent' : 'Verify your email — 20FIT Talent';
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — verify link for ' + to + ': ' + link);
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: verifyEmailHtml({ name, link, lang }) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}

/**
 * Shared light, premium email shell used by both the acceptance and the H-1
 * reminder emails so their design stays identical. Off-white tones (#fffffe)
 * plus color-scheme metas keep the hero from being flipped by client dark mode.
 * Caller supplies the copy (hero/hi/body/paragraphs) and the details fields.
 */
function brandedEmailHtml(o) {
  const id = o.lang === 'id';
  const L = o.labels || {};
  const icon = o.icon || '&#10003;';
  const stationVal = o.station ? esc(o.station) + (o.stationLoc ? ' · ' + esc(o.stationLoc) : '')
    : '<span style="color:#8b8f97">' + esc(o.stnPending || '') + '</span>';
  const row = (label, value, accent) => value
    ? `<tr>
        <td style="padding:13px 16px;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:#8b8f97;vertical-align:top;border-top:1px solid #eceff3;${accent ? 'background:#fff2f3' : ''}">${esc(label)}</td>
        <td style="padding:13px 16px;font-size:14px;font-weight:700;text-align:right;vertical-align:top;color:${accent ? '#E4121F' : '#17171d'};border-top:1px solid #eceff3;${accent ? 'background:#fff2f3' : ''}">${value}</td>
      </tr>`
    : '';
  // Strip the top border from the first present row (the card edge frames it).
  const rowsHtml = [
    row(L.ev, esc(o.eventName)),
    row(L.date, o.eventDate ? esc(o.eventDate) : ''),
    row(L.loc, o.location ? esc(o.location) : ''),
    row(L.cat, esc(o.category)),
    row(L.stn, stationVal, true),
  ].filter(Boolean).join('')
    .replace('border-top:1px solid #eceff3', 'border-top:0').replace('border-top:1px solid #eceff3', 'border-top:0');
  const para = (txt) => `<p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;color:#4a4e57">${esc(txt)}</p>`;
  const parasHtml = (o.paras || []).map(para).join('');
  return `<!doctype html><html lang="${id ? 'id' : 'en'}"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  </head><body style="margin:0;padding:0;background:#eef1f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17171d">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.pre || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6"><tr><td align="center" style="padding:28px 14px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e4e8ee;box-shadow:0 8px 26px rgba(20,24,40,.08)">
      <tr><td bgcolor="#E4121F" style="background:#E4121F;background:linear-gradient(135deg,#ff3b47,#d10f1b);padding:34px 30px 30px;text-align:center">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#fffffe">20FIT Talent</div>
        <div style="width:62px;height:62px;border-radius:50%;background:#fffffe;font-size:30px;font-weight:900;color:#E4121F;line-height:62px;margin:20px auto 0">${icon}</div>
        <div style="margin-top:16px;font-size:22px;font-weight:800;color:#fffffe">${esc(o.hero)}</div>
        <div style="margin-top:6px;font-size:13.5px;color:#ffe3e5">${esc(o.heroSub)}</div>
      </td></tr>
      <tr><td style="padding:28px 30px 6px">
        <p style="margin:0 0 10px;font-size:17px;font-weight:800;color:#17171d">${esc(o.hi)}</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#4a4e57">${o.bodyHtml.replace('<b>', '<b style="color:#E4121F">')}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfc;border:1px solid #eceff3;border-radius:14px">
          ${rowsHtml}
        </table>
      </td></tr>
      <tr><td style="padding:22px 30px 4px">
        ${parasHtml}
        <p style="margin:20px 0 4px;font-size:13.5px;line-height:1.6;color:#4a4e57">${esc(o.regards)}<br><b style="color:#17171d">${esc(o.team)}</b></p>
      </td></tr>
      <tr><td style="padding:20px 30px 26px;border-top:1px solid #eceff3"><p style="margin:0;font-size:11.5px;line-height:1.5;color:#9498a1">${esc(o.foot)}</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function acceptanceEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const id = lang === 'id';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Selamat! Pendaftaran kamu untuk event di bawah ini sudah <b>disetujui</b>. Berikut detail penugasan kamu:',
    ev: 'Event', date: 'Tanggal', loc: 'Lokasi', cat: 'Kategori', stn: 'Penugasan / Station',
    stnPending: 'Akan diinformasikan lebih lanjut oleh tim.',
    p1: 'Tim 20FIT Talent akan menghubungi kamu untuk info teknis, jadwal briefing, dan persiapan yang dibutuhkan sebelum event.',
    p2: 'Mohon simpan email ini sebagai konfirmasi keberhasilan pendaftaran kamu.',
    p3: 'Terima kasih sudah menjadi bagian dari event ini. Sampai jumpa di lokasi!',
    regards: 'Salam hangat,',
    team: '20FIT Talent Team',
    foot: 'Ini adalah email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
    hero: 'Pendaftaran Disetujui', heroSub: 'Kamu sudah siap untuk event ini',
    pre: 'Kamu disetujui — ini detail penugasan kamu.',
  } : {
    hi: ('Hello ' + (name || '')).trim() + ',',
    body: 'Congratulations! Your registration for the following event has been <b>approved</b>. Below are your assignment details:',
    ev: 'Event', date: 'Date', loc: 'Location', cat: 'Category', stn: 'Assignment / Station',
    stnPending: 'Will be shared by the team soon.',
    p1: 'The 20FIT Talent team will contact you with technical information, the briefing schedule, and any preparations required before the event.',
    p2: 'Please keep this email as confirmation of your successful registration.',
    p3: 'Thank you for being part of the event. We look forward to seeing you there.',
    regards: 'Best regards,',
    team: '20FIT Talent Team',
    foot: 'This is an automated email from 20FIT Talent. Please do not reply to this email.',
    hero: 'Registration Approved', heroSub: "You're all set for the event",
    pre: "You're approved — here are your assignment details.",
  };
  return brandedEmailHtml({
    lang, pre: t.pre, hero: t.hero, heroSub: t.heroSub, icon: '&#10003;',
    hi: t.hi, bodyHtml: t.body,
    labels: { ev: t.ev, date: t.date, loc: t.loc, cat: t.cat, stn: t.stn }, stnPending: t.stnPending,
    eventName, eventDate, location, category, station, stationLoc,
    paras: [t.p1, t.p2, t.p3], regards: t.regards, team: t.team, foot: t.foot,
  });
}

function reminderEmailHtml({ name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const id = lang === 'id';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Ini pengingat bahwa <b>besok</b> kamu dijadwalkan bertugas di event berikut. Mohon datang tepat waktu dan pastikan kamu sudah menyiapkan semua kebutuhan sebelum event dimulai.',
    ev: 'Event', date: 'Tanggal', loc: 'Lokasi', cat: 'Kategori', stn: 'Penugasan / Station',
    stnPending: 'Akan diinformasikan lebih lanjut oleh tim.',
    p1: 'Jika ada kendala atau kamu berhalangan hadir, mohon segera hubungi tim 20FIT Talent.',
    p2: 'Sampai jumpa di lokasi event.',
    regards: 'Salam hangat,',
    team: '20FIT Talent Team',
    foot: 'Ini adalah email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
    hero: 'Pengingat Event', heroSub: 'Tugasmu besok',
    pre: 'Pengingat — tugasmu besok.',
  } : {
    hi: ('Hello ' + (name || '')).trim() + ',',
    body: 'This is a reminder that you are scheduled to work at the following event <b>tomorrow</b>. Please arrive on time and ensure you have everything you need before the event begins.',
    ev: 'Event', date: 'Date', loc: 'Location', cat: 'Category', stn: 'Assignment / Station',
    stnPending: 'Will be shared by the team soon.',
    p1: 'If you have any issues or are unable to attend, please contact the 20FIT Talent team as soon as possible.',
    p2: 'We look forward to seeing you at the event.',
    regards: 'Best regards,',
    team: '20FIT Talent Team',
    foot: 'This is an automated email from 20FIT Talent. Please do not reply to this email.',
    hero: 'Event Reminder', heroSub: 'Your assignment is tomorrow',
    pre: 'Reminder — your assignment is tomorrow.',
  };
  return brandedEmailHtml({
    lang, pre: t.pre, hero: t.hero, heroSub: t.heroSub, icon: '&#128276;',
    hi: t.hi, bodyHtml: t.body,
    labels: { ev: t.ev, date: t.date, loc: t.loc, cat: t.cat, stn: t.stn }, stnPending: t.stnPending,
    eventName, eventDate, location, category, station, stationLoc,
    paras: [t.p1, t.p2], regards: t.regards, team: t.team, foot: t.foot,
  });
}

/** Remind a talent their event is tomorrow (H-1). Returns { delivered }. Never throws for a missing key. */
async function sendReminderEmail({ to, name, lang, eventName, eventDate, location, category, station, stationLoc }) {
  const subject = lang === 'id'
    ? 'Pengingat: Tugas Event Kamu Mulai Besok — 20FIT Talent'
    : 'Reminder: Your Event Assignment Starts Tomorrow';
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

module.exports = { configured, sendResetEmail, sendVerifyEmail, sendAcceptanceEmail, sendReminderEmail };
