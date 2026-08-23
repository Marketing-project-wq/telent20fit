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

// Shared brand mark for every email. A white band keeps the logo (which sits on
// a white background) clean across email clients, including dark mode.
const LOGO_URL = 'https://media.20fit.id/wp-content/uploads/2026/07/Copy-of-new-logo-20fit-putih-3.png';
function logoBar() {
  // Dark bar so the white 20FIT logo stays visible across email clients.
  return `<tr><td style="background:#17171d;padding:22px 28px 18px;text-align:center"><img src="${LOGO_URL}" alt="20FIT" width="160" style="display:block;margin:0 auto;width:160px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none"></td></tr>`;
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
      ${logoBar()}
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(t.hi)}</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#41454d">${esc(t.body)}</p>
        <a href="${esc(link)}" style="display:inline-block;background:#E4121F;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${esc(t.btn)}</a>
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
    if (res.status === 401 || /invalid api key/i.test(body)) {
      console.warn('[mail] Resend API key is invalid; email not sent to ' + to);
      return { delivered: false, error: 'Invalid API key' };
    }
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
      ${logoBar()}
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(t.hi)}</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#41454d">${esc(t.body)}</p>
        <a href="${esc(link)}" style="display:inline-block;background:#E4121F;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${esc(t.btn)}</a>
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
    if (res.status === 401 || /invalid api key/i.test(body)) {
      console.warn('[mail] Resend API key is invalid; verify email not sent to ' + to);
      return { delivered: false, error: 'Invalid API key' };
    }
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
  // Banner color per outcome: green for approvals, red for rejections (default red).
  const heroBg = o.heroBg || '#E4121F';
  const heroGrad = o.heroGrad || 'linear-gradient(135deg,#ff3b47,#d10f1b)';
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
      ${logoBar()}
      <tr><td bgcolor="${heroBg}" style="background:${heroBg};background:${heroGrad};padding:32px 30px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#fffffe">${esc(o.hero)}</div>
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
    lang, pre: t.pre, hero: t.hero, heroSub: t.heroSub,
    heroBg: '#178A54', heroGrad: 'linear-gradient(135deg,#22a866,#0f7a45)',
    hi: t.hi, bodyHtml: t.body,
    labels: { ev: t.ev, date: t.date, loc: t.loc, cat: t.cat, stn: t.stn }, stnPending: t.stnPending,
    eventName, eventDate, location, category, station, stationLoc,
    paras: [t.p1, t.p2, t.p3], regards: t.regards, team: t.team, foot: t.foot,
  });
}

function rejectionEmailHtml({ name, lang, eventName, eventDate, location, category }) {
  const id = lang === 'id';
  const t = id ? {
    hi: ('Halo ' + (name || '')).trim() + ',',
    body: 'Terima kasih sudah mendaftar untuk event di bawah ini. Mohon maaf, untuk kesempatan ini pendaftaran kamu <b>belum bisa kami setujui</b>.',
    ev: 'Event', date: 'Tanggal', loc: 'Lokasi', cat: 'Kategori',
    p1: 'Jangan berkecil hati — kesempatan lain akan terus dibuka. Kami harap kamu tetap semangat dan mendaftar lagi di event 20FIT berikutnya.',
    p2: 'Terima kasih atas minat dan waktu kamu.',
    regards: 'Salam hangat,', team: '20FIT Talent Team',
    foot: 'Ini adalah email otomatis dari 20FIT Talent. Mohon jangan balas email ini.',
    hero: 'Pendaftaran Belum Disetujui',
    pre: 'Update status pendaftaran kamu.',
  } : {
    hi: ('Hello ' + (name || '')).trim() + ',',
    body: 'Thank you for registering for the event below. Unfortunately, your registration <b>has not been approved</b> this time.',
    ev: 'Event', date: 'Date', loc: 'Location', cat: 'Category',
    p1: "Please don't be discouraged — more opportunities keep opening up. We hope you'll apply again for the next 20FIT event.",
    p2: 'Thank you for your interest and your time.',
    regards: 'Best regards,', team: '20FIT Talent Team',
    foot: 'This is an automated email from 20FIT Talent. Please do not reply to this email.',
    hero: 'Registration Not Approved',
    pre: 'An update on your registration status.',
  };
  return brandedEmailHtml({
    lang, pre: t.pre, hero: t.hero,
    heroBg: '#E4121F', heroGrad: 'linear-gradient(135deg,#ff3b47,#d10f1b)',
    hi: t.hi, bodyHtml: t.body,
    labels: { ev: t.ev, date: t.date, loc: t.loc, cat: t.cat },
    eventName, eventDate, location, category,
    paras: [t.p1, t.p2], regards: t.regards, team: t.team, foot: t.foot,
  });
}

async function sendRejectionEmail({ to, name, lang, eventName, eventDate, location, category }) {
  const subject = lang === 'id'
    ? 'Update Pendaftaran Event Kamu — 20FIT Talent'
    : 'An Update on Your Event Registration';
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — rejection for ' + to + ' (' + eventName + ')');
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: rejectionEmailHtml({ name, lang, eventName, eventDate, location, category }) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || /invalid api key/i.test(body)) {
      console.warn('[mail] Resend API key is invalid; rejection email not sent to ' + to);
      return { delivered: false, error: 'Invalid API key' };
    }
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
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
    if (res.status === 401 || /invalid api key/i.test(body)) {
      console.warn('[mail] Resend API key is invalid; reminder email not sent to ' + to);
      return { delivered: false, error: 'Invalid API key' };
    }
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
    if (res.status === 401 || /invalid api key/i.test(body)) {
      console.warn('[mail] Resend API key is invalid; acceptance email not sent to ' + to);
      return { delivered: false, error: 'Invalid API key' };
    }
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}

// ---- Cancellation/standby flow emails (policy F: NEVER name the position) ----
// Every email only says a decision exists and asks the talent to open the web to
// see the detail and click their approval. Title + deadline are allowed so the
// email isn't ignored.
function decisionEmailHtml({ name, lang, eventName, link, kind, deadline }) {
  const id = lang !== 'en';
  const body = id ? {
    accepted: 'Ada keputusan untuk pendaftaranmu di event ini. Masuk ke web untuk melihat detail dan menekan persetujuanmu.',
    standby: 'Kamu masuk daftar kandidat cadangan untuk event ini. Masuk ke web untuk menyatakan apakah kamu bersedia siaga sampai hari-H.',
    substitute: 'Ada kesempatan untukmu di event ini. Masuk ke web untuk melihat detail dan menekan persetujuanmu.',
    reminder: 'Pengingat: konfirmasimu masih ditunggu. Masuk ke web untuk menekan persetujuanmu sebelum tenggat.',
  }[kind] : {
    accepted: 'There is a decision on your registration for this event. Open the web to see the details and click your approval.',
    standby: 'You are on the standby candidate list for this event. Open the web to state whether you are available on standby until event day.',
    substitute: 'There is an opportunity for you at this event. Open the web to see the details and click your approval.',
    reminder: 'Reminder: your confirmation is still awaited. Open the web to click your approval before the deadline.',
  }[kind];
  const cta = id ? (kind === 'standby' ? 'Nyatakan Kesediaan' : 'Lihat & Setujui') : (kind === 'standby' ? 'State Availability' : 'View & Approve');
  const hi = (id ? 'Halo ' : 'Hi ') + (name || '');
  const dl = deadline ? (id ? `Batas waktu: ${deadline} WIB.` : `Deadline: ${deadline} WIB.`) : '';
  const foot = id ? 'Email otomatis dari 20FIT Talent. Mohon jangan balas email ini.' : 'Automated email from 20FIT Talent. Please do not reply.';
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#17171d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ed">
      ${logoBar()}
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(hi.trim())},</p>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#41454d">${esc(body)}</p>
        <p style="margin:0 0 18px;font-size:14px;font-weight:700">${esc(eventName || 'Event 20FIT')}</p>
        ${dl ? `<p style="margin:0 0 18px;font-size:13px;color:#8a1c1c;font-weight:700">${esc(dl)}</p>` : ''}
        <a href="${esc(link)}" style="display:inline-block;background:#E4121F;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${esc(cta)}</a>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e3e7ed;font-size:12px;color:#8b8f97">${esc(foot)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
function closingEmailHtml({ name, lang, eventName, kind }) {
  const id = lang !== 'en';
  const body = id ? {
    not_selected: 'Terima kasih sudah mendaftar. Untuk kesempatan ini kamu belum terpilih. Semoga bisa bergabung di event berikutnya.',
    lapsed: 'Kesempatan untuk event ini sudah tidak tersedia karena melewati tenggat konfirmasi. Terima kasih atas ketertarikanmu.',
    standby_closed: 'Terima kasih atas kesediaanmu. Untuk event ini kamu tidak jadi dipanggil. Sampai jumpa di kesempatan berikutnya.',
  }[kind] : {
    not_selected: 'Thank you for registering. You were not selected for this opportunity. We hope you can join a future event.',
    lapsed: 'The opportunity for this event is no longer available as the confirmation deadline passed. Thank you for your interest.',
    standby_closed: 'Thank you for being available. You were not called for this event. See you next time.',
  }[kind];
  const hi = (id ? 'Halo ' : 'Hi ') + (name || '');
  const foot = id ? 'Email otomatis dari 20FIT Talent. Mohon jangan balas email ini.' : 'Automated email from 20FIT Talent. Please do not reply.';
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#17171d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ed">
      ${logoBar()}
      <tr><td style="padding:28px">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${esc(hi.trim())},</p>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#41454d">${esc(body)}</p>
        <p style="margin:0;font-size:14px;font-weight:700">${esc(eventName || 'Event 20FIT')}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e3e7ed;font-size:12px;color:#8b8f97">${esc(foot)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
async function _send(to, subject, html, label) {
  if (!API_KEY || process.env.MAIL_MOCK === '1') {
    console.log('[mail] email service not configured — ' + label + ' for ' + to);
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || /invalid api key/i.test(body)) { console.warn('[mail] Resend API key is invalid; ' + label + ' not sent to ' + to); return { delivered: false, error: 'Invalid API key' }; }
    throw new Error('Resend ' + res.status + ': ' + body.slice(0, 300));
  }
  return { delivered: true };
}
async function sendDecisionEmail({ to, name, lang, eventName, link, kind, deadline }) {
  const id = lang !== 'en';
  const subj = {
    accepted: id ? 'Ada Keputusan untuk Pendaftaranmu — 20FIT Talent' : 'A Decision on Your Registration — 20FIT Talent',
    standby: id ? 'Kamu Jadi Kandidat Cadangan — 20FIT Talent' : "You're a Standby Candidate — 20FIT Talent",
    substitute: id ? 'Ada Kesempatan untukmu — 20FIT Talent' : 'An Opportunity for You — 20FIT Talent',
    reminder: id ? 'Pengingat: Konfirmasimu Ditunggu — 20FIT Talent' : 'Reminder: Your Confirmation Is Awaited — 20FIT Talent',
  }[kind] || (id ? 'Kabar dari 20FIT Talent' : 'News from 20FIT Talent');
  return _send(to, subj, decisionEmailHtml({ name, lang, eventName, link, kind, deadline }), 'decision:' + kind);
}
async function sendClosingEmail({ to, name, lang, eventName, kind }) {
  const id = lang !== 'en';
  const subj = kind === 'lapsed'
    ? (id ? 'Kesempatan Sudah Berlalu — 20FIT Talent' : 'Opportunity Has Passed — 20FIT Talent')
    : (id ? 'Kabar Pendaftaran Event — 20FIT Talent' : 'Your Event Registration — 20FIT Talent');
  return _send(to, subj, closingEmailHtml({ name, lang, eventName, kind }), 'closing:' + kind);
}

// Tahap 7: notify the talent whenever their attendance status changes. The
// status is the basis of payment, so the talent is told on every change (who
// recorded it + when) and can request a correction from their dashboard.
function attendanceEmailHtml({ name, lang, eventName, day, status, markedBy }) {
  const id = lang !== 'en';
  const label = {
    present: id ? 'Hadir' : 'Present',
    absent_notified: id ? 'Tidak hadir (ada kabar)' : 'Absent (notified)',
    absent_no_notice: id ? 'Tidak hadir (tanpa kabar)' : 'Absent (no notice)',
  }[status] || status;
  const l = id ? {
    hi: 'Halo ' + (name || '') + ',',
    body: 'Status kehadiranmu untuk acara berikut diperbarui:',
    st: 'Status', by: 'Ditandai oleh', when: 'Tanggal',
    foot: 'Jika ini keliru, buka dashboard 20FIT Talent dan ajukan koreksi. Status ini dipakai sebagai dasar pembayaran.',
  } : {
    hi: 'Hi ' + (name || '') + ',',
    body: 'Your attendance status for this event was updated:',
    st: 'Status', by: 'Marked by', when: 'Date',
    foot: 'If this is wrong, open the 20FIT Talent dashboard and request a correction. This status is the basis for payment.',
  };
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <p>${l.hi}</p><p>${l.body}</p>
    <div style="border:1px solid #eee;border-radius:10px;padding:14px 16px;margin:12px 0">
      <div style="font-weight:700;font-size:16px">${eventName || ''}</div>
      <div style="margin-top:6px">${l.st}: <b>${label}</b></div>
      ${day ? `<div>${l.when}: ${day}</div>` : ''}
      ${markedBy ? `<div>${l.by}: ${markedBy}</div>` : ''}
    </div>
    <p style="color:#6b6b70;font-size:13px">${l.foot}</p>
  </div>`;
}
async function sendAttendanceEmail({ to, name, lang, eventName, day, status, markedBy }) {
  const id = lang !== 'en';
  const subj = id ? 'Absensimu Diperbarui — 20FIT Talent' : 'Your Attendance Was Updated — 20FIT Talent';
  return _send(to, subj, attendanceEmailHtml({ name, lang, eventName, day, status, markedBy }), 'attendance:' + status);
}

// Offer/confirmation flow (Tahap 5). NEVER names the position — only tells the
// talent there is a decision to answer on the web, with the deadline + a button
// straight to the confirmation page. `kind`: 'offer' (accepted) | 'substitute'.
function offerEmailHtml({ name, lang, eventName, deadline, link, kind }) {
  const id = lang !== 'en';
  const l = id ? {
    hi: 'Halo ' + (name || '') + ',',
    lead: kind === 'substitute'
      ? 'Ada kesempatan untuk kamu di <b>' + (eventName || '') + '</b>. Kamu ditawari mengisi slot yang kosong.'
      : 'Ada keputusan untuk lamaran kamu di <b>' + (eventName || '') + '</b>.',
    need: 'Kamu perlu masuk ke web untuk melihat detail dan memberi jawaban.',
    dl: deadline ? ('Jawab sebelum <b>' + deadline + ' WIB</b>. Lewat dari itu, tawaran otomatis hangus.') : '',
    btn: 'Buka halaman konfirmasi',
    foot: 'Kalau tombol tidak jalan, salin tautan ini ke browser: ',
  } : {
    hi: 'Hi ' + (name || '') + ',',
    lead: kind === 'substitute'
      ? 'There is an opportunity for you at <b>' + (eventName || '') + '</b>. You have been offered an open slot.'
      : 'There is a decision on your application for <b>' + (eventName || '') + '</b>.',
    need: 'Please open the web to see the details and give your answer.',
    dl: deadline ? ('Answer before <b>' + deadline + ' WIB</b>. After that, the offer lapses automatically.') : '',
    btn: 'Open confirmation page',
    foot: 'If the button does not work, copy this link into your browser: ',
  };
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <p>${l.hi}</p><p>${l.lead}</p><p>${l.need}</p>
    ${l.dl ? `<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px">${l.dl}</p>` : ''}
    <p style="margin:20px 0"><a href="${link}" style="background:#e11d48;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${l.btn}</a></p>
    <p style="color:#6b6b70;font-size:12.5px">${l.foot}<br><a href="${link}">${link}</a></p>
  </div>`;
}
// F1: registration closed — tell an applicant their application entered
// screening. No position, no result — just that curation has begun.
function screeningEmailHtml({ name, lang, eventName }) {
  const id = lang !== 'en';
  const l = id
    ? { hi: 'Halo ' + (name || '') + ',', body: 'Pendaftaran untuk <b>' + (eventName || '') + '</b> sudah ditutup. Lamaran kamu masuk tahap seleksi.', tail: 'Hasilnya akan diumumkan setelah kurasi selesai. Kami akan mengabari kamu lewat email lagi.' }
    : { hi: 'Hi ' + (name || '') + ',', body: 'Registration for <b>' + (eventName || '') + '</b> is now closed. Your application has entered the screening stage.', tail: 'Results will be announced after curation. We will email you again.' };
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a"><p>${l.hi}</p><p>${l.body}</p><p style="color:#6b6b70;font-size:13px">${l.tail}</p></div>`;
}
async function sendScreeningEmail({ to, name, lang, eventName }) {
  const id = lang !== 'en';
  const subj = id ? ('Lamaran kamu masuk tahap seleksi — ' + (eventName || 'Event 20FIT')) : ('Your application is in screening — ' + (eventName || '20FIT Event'));
  return _send(to, subj, screeningEmailHtml({ name, lang, eventName }), 'screening');
}
// F8: standby not yet called by ~H-2 — tell them their chance is now small so
// they are not left waiting until the event day.
function standbyFadeEmailHtml({ name, lang, eventName }) {
  const id = lang !== 'en';
  const l = id
    ? { hi: 'Halo ' + (name || '') + ',', body: 'Sampai mendekati hari-H, slot untuk <b>' + (eventName || '') + '</b> belum terbuka untuk kamu.', tail: 'Kemungkinan dipanggil sekarang sudah kecil. Terima kasih sudah bersedia jadi cadangan — kamu tidak perlu menunggu di hari-H.' }
    : { hi: 'Hi ' + (name || '') + ',', body: 'As the event nears, a slot for <b>' + (eventName || '') + '</b> has not opened for you.', tail: 'The chance of being called now is small. Thank you for standing by — you do not need to wait on the event day.' };
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a"><p>${l.hi}</p><p>${l.body}</p><p style="color:#6b6b70;font-size:13px">${l.tail}</p></div>`;
}
async function sendStandbyFadeEmail({ to, name, lang, eventName }) {
  const id = lang !== 'en';
  const subj = id ? ('Kabar status cadangan kamu — ' + (eventName || 'Event 20FIT')) : ('Your standby status — ' + (eventName || '20FIT Event'));
  return _send(to, subj, standbyFadeEmailHtml({ name, lang, eventName }), 'standby-fade');
}
// After the talent CONFIRMS: a "you're in" email that MAY include the Man Power
// group link + their station. Only sent post-confirmation (never before), so the
// group link is not exposed until they have agreed on the web.
function confirmedEmailHtml({ name, lang, eventName, station, groupUrl }) {
  const id = lang !== 'en';
  const l = id
    ? { hi: 'Halo ' + (name || '') + ',', body: 'Kehadiranmu untuk <b>' + (eventName || '') + '</b> sudah <b>dikonfirmasi</b>. Sampai jumpa di lokasi!', st: 'Station kamu', grp: 'Gabung grup Man Power di sini:', foot: 'Detail juga bisa kamu lihat kapan saja di dashboard 20FIT Talent.' }
    : { hi: 'Hi ' + (name || '') + ',', body: 'Your attendance for <b>' + (eventName || '') + '</b> is <b>confirmed</b>. See you there!', st: 'Your station', grp: 'Join the Man Power group here:', foot: 'You can also see the details anytime on your 20FIT Talent dashboard.' };
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <p>${l.hi}</p><p>${l.body}</p>
    ${station ? `<p style="background:#eef1f6;border-radius:8px;padding:10px 12px">📍 ${l.st}: <b>${station}</b></p>` : ''}
    ${groupUrl ? `<p style="margin:18px 0">${l.grp}<br><a href="${groupUrl}" style="background:#25D366;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;display:inline-block;margin-top:8px">💬 ${id ? 'Gabung Grup Man Power' : 'Join Man Power Group'}</a></p>` : ''}
    <p style="color:#6b6b70;font-size:12.5px">${l.foot}</p>
  </div>`;
}
async function sendConfirmedEmail({ to, name, lang, eventName, station, groupUrl }) {
  const id = lang !== 'en';
  const subj = id ? ('Kehadiranmu dikonfirmasi — ' + (eventName || 'Event 20FIT')) : ('Your attendance is confirmed — ' + (eventName || '20FIT Event'));
  return _send(to, subj, confirmedEmailHtml({ name, lang, eventName, station, groupUrl }), 'confirmed');
}
async function sendOfferEmail({ to, name, lang, eventName, deadline, link, kind }) {
  const id = lang !== 'en';
  const subj = id
    ? ('Ada keputusan untuk lamaran kamu di ' + (eventName || 'Event 20FIT') + (deadline ? ' — perlu jawaban sebelum ' + deadline + ' WIB' : ''))
    : ('A decision on your application at ' + (eventName || '20FIT Event') + (deadline ? ' — answer before ' + deadline + ' WIB' : ''));
  return _send(to, subj, offerEmailHtml({ name, lang, eventName, deadline, link, kind }), 'offer:' + (kind || 'offer'));
}

module.exports = { configured, sendResetEmail, sendVerifyEmail, sendAcceptanceEmail, sendRejectionEmail, sendReminderEmail, acceptanceEmailHtml, rejectionEmailHtml, sendDecisionEmail, sendClosingEmail, decisionEmailHtml, closingEmailHtml, sendAttendanceEmail, attendanceEmailHtml, sendOfferEmail, offerEmailHtml, sendScreeningEmail, screeningEmailHtml, sendStandbyFadeEmail, standbyFadeEmailHtml, sendConfirmedEmail, confirmedEmailHtml };
