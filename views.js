'use strict';

/** HTML-escape a value for safe interpolation. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO timestamp as a short Indonesian date-time. */
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STYLE = `
:root{--red:#E4121F;--red-soft:rgba(228,18,31,.12);--ink:#101013;--ink2:#2a2a30;
  --bg:#f6f6f4;--card:#fff;--line:#e7e7e3;--muted:#6b6b72;--ok:#12855a;--ok-soft:#e4f5ec;
  --warn:#8a5a00;--warn-soft:#fbf0d8;--err:#b3160f;--err-soft:#fdecec;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
a{color:var(--red)}
.topbar{background:var(--ink);color:#fff;position:sticky;top:0;z-index:100}
.topbar .in{max-width:1000px;margin:0 auto;padding:0 20px;height:58px;display:flex;align-items:center;gap:18px}
.logo{font-weight:800;font-size:19px;letter-spacing:.02em;text-decoration:none;color:#fff}
.logo b{color:var(--red)}
.topbar nav{display:flex;gap:4px;margin-left:auto}
.topbar nav a{color:#cfcfd6;text-decoration:none;font-weight:600;font-size:14px;padding:7px 12px;border-radius:8px}
.topbar nav a.active,.topbar nav a:hover{background:#26262c;color:#fff}
.wrap{max-width:1000px;margin:0 auto;padding:30px 20px 70px}
.wrap.narrow{max-width:640px}
h1{font-size:27px;font-weight:800;letter-spacing:-.01em}
h2{font-size:18px;font-weight:700;margin:0 0 14px}
.sub{color:var(--muted);font-size:15px;margin-top:5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:20px}
label{display:block;font-weight:600;font-size:14px;margin-bottom:8px}
.hint{color:var(--muted);font-weight:400;font-size:13px}
input[type=text],input[type=url],input[type=password],select,textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:15px;background:#fff;font-family:inherit;color:var(--ink)}
input[type=file]{width:100%;font-size:14px}
input:focus,select:focus{outline:2px solid var(--red);border-color:var(--red)}
.field{margin-bottom:22px}
.repeat-row{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.repeat-row>*:first-child{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 22px;border-radius:10px;border:none;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;text-decoration:none;color:#fff;background:var(--red)}
.btn:hover{background:#c40f1b}
.btn-ghost{background:#fff;color:var(--ink);border:1.5px solid var(--line)}
.btn-ghost:hover{background:#f2f2ef}
.btn-block{width:100%}
.btn-sm{padding:8px 13px;font-size:13px}
.add-btn{background:var(--red-soft);color:var(--red);border:1px dashed rgba(228,18,31,.45)}
.add-btn:hover{background:rgba(228,18,31,.18)}
.rm{background:#fff;border:1px solid var(--line);color:var(--muted);border-radius:9px;width:40px;height:40px;flex-shrink:0;cursor:pointer;font-size:17px;line-height:1}
.rm:hover{border-color:var(--red);color:var(--red)}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.stat .n{font-size:34px;font-weight:800;line-height:1}
.stat .l{color:var(--muted);font-size:13px;margin-top:6px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;background:var(--red-soft);color:var(--red);font-size:12px;font-weight:600;padding:3px 9px;border-radius:100px}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:100px}
.pill-ok{background:var(--ok-soft);color:var(--ok)}
.pill-off{background:#ececec;color:var(--muted)}
.rank{font-weight:800;color:var(--muted);width:34px}
.rank-1{color:#c99700}.rank-2{color:#8a8a8a}.rank-3{color:#b06a2c}
.thumbs{display:flex;gap:6px;flex-wrap:wrap}
.thumbs img{width:44px;height:44px;object-fit:cover;border-radius:7px;border:1px solid var(--line)}
.banner{padding:14px 16px;border-radius:12px;font-size:14px;margin-top:18px}
.banner-ok{background:var(--ok-soft);color:var(--ok)}
.banner-warn{background:var(--warn-soft);color:var(--warn)}
.banner-err{background:var(--err-soft);color:var(--err)}
.banner ul{margin:6px 0 0 18px}
.success{text-align:center;padding:46px 20px}
.success .check{width:78px;height:78px;background:var(--ok-soft);color:var(--ok);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 20px}
.muted{color:var(--muted)}
.cat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:24px}
.cat-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:12px}
.cat-card.soon{opacity:.72}
.cat-card.cat-active{border-color:var(--red);box-shadow:0 6px 24px rgba(228,18,31,.09)}
.cat-tag{width:46px;height:46px;border-radius:12px;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.cat-name{font-size:20px;font-weight:800}
.cat-desc{color:var(--muted);font-size:14px;flex:1;margin:0}
.linklist a{display:block;font-size:13px;word-break:break-all;margin-bottom:2px}
.inline-form{display:inline}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:36px 0 0}
@media(max-width:600px){
  .topbar nav a{padding:7px 9px;font-size:13px}
  /* Reflow wide tables into stacked cards on phones */
  table{min-width:0 !important}
  thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:-1px;border:0;padding:0}
  table,tbody,tr,td{display:block}
  tr{border:1px solid var(--line);border-radius:12px;margin-bottom:12px;padding:4px 2px}
  tr:last-child{margin-bottom:0}
  td{border:none;display:flex;flex-direction:column;gap:5px;padding:9px 14px;align-items:flex-start}
  td[data-label]::before{content:attr(data-label);font:600 11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
  .rank{width:auto}
  .section-head{flex-wrap:wrap}
}
`;

function layout({ title, body, admin, brand, home }) {
  const label = brand || 'KOL';
  const homeHref = home || (admin ? '/admin' : '/kol');
  const nav = admin
    ? `<a href="/admin"${admin === 'admin' ? ' class="active"' : ''}>Admin</a>
       <a href="/performance"${admin === 'perf' ? ' class="active"' : ''}>Performance</a>`
    : '';
  return `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
<div class="topbar"><div class="in">
  <a href="${homeHref}" class="logo">20FIT<b> ${esc(label)}</b></a>
  <nav>${nav}</nav>
</div></div>
${body}
</body></html>`;
}

/**
 * Landing page at "/" (dark prototype hero) with an ID/EN language toggle.
 * CTAs lead to the talent-type picker for sign up (/register) and log in (/login).
 */
function landingPage(lang) {
  const L = (lang === 'en') ? 'en' : 'id';
  const t = {
    id: {
      badge: 'Talent Management · Multi-Tenant', title: 'Rekrut talent event', accent: 'tanpa ribet.',
      sub: 'Platform rekrutmen &amp; manajemen talent untuk event olahraga. Verifikasi identitas KTP, foto 3 sudut via AI, dan SOW jelas per peran — semua dalam satu sistem.',
      join: 'Gabung Sekarang', login: 'Masuk',
      featTitle: 'Kenapa 20FIT Talent', featSub: 'Dibangun untuk skala — dari 1 event ke ratusan.',
      finalCta: 'Siap jadi bagian dari event berikutnya?', finalCtaSub: 'Daftar gratis, verifikasi otomatis, langsung apply.',
      slot: '4 slot tersisa', foot: 'Digunakan 20FIT &amp; Event Organizer lain',
      stats: [['8', 'Kota'], ['3', 'Kategori Talent'], ['AI', 'Verifikasi Foto']],
      feats: [
        ['ID', 'Validasi KTP', '1 nomor KTP = 1 akun. Sistem blok otomatis registrasi ganda.'],
        ['AI', 'Verifikasi Foto 3 Sudut', 'Full face, full body, samping — divalidasi AI dalam hitungan detik.'],
        ['SOW', 'SOW Per Peran', 'Ekspektasi tugas, durasi, dan kompensasi jelas sebelum apply.'],
        ['★', '3 Kategori Talent', 'Main Power, KOL, dan Fotografer — masing-masing alur berbeda.'],
        ['@', 'Notifikasi Otomatis', 'Email station Judges &amp; link grup WA terkirim otomatis saat approved.'],
        ['⬢', 'Multi-Tenant', 'Dipakai 20FIT maupun event organizer lain dalam satu platform.'],
      ],
    },
    en: {
      badge: 'Talent Management · Multi-Tenant', title: 'Recruit event talent', accent: 'the easy way.',
      sub: 'A recruitment &amp; talent management platform for sports events. ID verification, 3-angle AI photo checks, and clear per-role SOWs — all in one system.',
      join: 'Join Now', login: 'Log in',
      featTitle: 'Why 20FIT Talent', featSub: 'Built to scale — from 1 event to hundreds.',
      finalCta: 'Ready to be part of the next event?', finalCtaSub: 'Free sign-up, automatic verification, apply instantly.',
      slot: '4 slots left', foot: 'Used by 20FIT &amp; other Event Organizers',
      stats: [['8', 'Cities'], ['3', 'Talent Types'], ['AI', 'Photo Check']],
      feats: [
        ['ID', 'ID Validation', '1 ID number = 1 account. Duplicate sign-ups blocked automatically.'],
        ['AI', '3-Angle Photo Check', 'Full face, full body, side — validated by AI in seconds.'],
        ['SOW', 'Per-Role SOW', 'Clear task, duration, and compensation before you apply.'],
        ['★', '3 Talent Types', 'Main Power, KOL, and Photographer — each with its own flow.'],
        ['@', 'Auto Notifications', 'Judges station email &amp; WA group link sent automatically on approval.'],
        ['⬢', 'Multi-Tenant', 'Used by 20FIT and other event organizers on one platform.'],
      ],
    },
  }[L];

  const statHtml = t.stats.map(([n, l]) => `<div>
      <div style="font:800 30px/1 'Barlow Condensed',sans-serif;color:var(--red)">${esc(n)}</div>
      <div style="font-size:13px;color:#8a8990;margin-top:4px">${esc(l)}</div>
    </div>`).join('');
  const featHtml = t.feats.map(([i, ti, d]) => `<div style="background:#141419;border:1px solid #26262d;border-radius:14px;padding:24px">
      <div style="width:44px;height:44px;background:rgba(228,18,31,.14);border:1px solid rgba(228,18,31,.3);border-radius:10px;display:flex;align-items:center;justify-content:center;font:800 18px/1 'Barlow Condensed',sans-serif;color:var(--red);margin-bottom:16px">${esc(i)}</div>
      <div style="font:700 19px/1.1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin-bottom:8px">${esc(ti)}</div>
      <p style="color:#8a8990;font-size:14px;line-height:1.5;margin:0">${d}</p>
    </div>`).join('');

  const langBtn = (code, label) => {
    const on = code === L;
    return `<a href="/?lang=${code}" style="padding:6px 11px;border-radius:6px;font:700 12px/1 Barlow,sans-serif;color:${on ? '#fff' : '#8a8990'};background:${on ? 'var(--red)' : 'transparent'}">${label}</a>`;
  };
  const toggle = `<div style="display:flex;background:#1c1c22;border:1px solid #2c2c34;border-radius:8px;padding:3px;gap:2px">${langBtn('id', 'ID')}${langBtn('en', 'EN')}</div>`;
  const q = `?lang=${L}`;

  return `<!doctype html><html lang="${L}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>20FIT Talent</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--red:#E4121F;--ink:#101013;--ok:#178A54}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--ink);color:#fff;line-height:1.5}
a{text-decoration:none}
.stripe{background-image:repeating-linear-gradient(135deg,#eceae5 0 10px,#f4f2ee 10px 20px)}
.resp1{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.resp3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:860px){.resp1{grid-template-columns:1fr !important}.resp3{grid-template-columns:1fr 1fr !important}}
@media(max-width:560px){.resp3{grid-template-columns:1fr !important}}
</style></head>
<body>
<div style="min-height:100vh">
  <header style="max-width:1180px;margin:0 auto;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:11px">
      <div style="width:40px;height:40px;background:var(--red);border-radius:10px;display:flex;align-items:center;justify-content:center;font:800 20px/1 'Barlow Condensed',sans-serif;transform:skewX(-7deg)">20</div>
      <div style="font:800 22px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em">20FIT<span style="color:var(--red)"> TALENT</span></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      ${toggle}
      <a href="/login${q}" style="padding:10px 18px;background:transparent;color:#fff;border:1px solid #3a3a42;border-radius:8px;font:600 14px/1 Barlow,sans-serif">${esc(t.login)}</a>
      <a href="/register${q}" style="padding:10px 20px;background:var(--red);color:#fff;border-radius:8px;font:600 14px/1 Barlow,sans-serif">${esc(t.join)}</a>
    </div>
  </header>

  <section class="resp1" style="max-width:1180px;margin:0 auto;padding:48px 28px 60px">
    <div>
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(228,18,31,.14);border:1px solid rgba(228,18,31,.35);color:#ff5b66;padding:7px 14px;border-radius:100px;font:600 12px/1 Barlow,sans-serif;letter-spacing:.06em;text-transform:uppercase;margin-bottom:22px">${esc(t.badge)}</div>
      <h1 style="font:800 clamp(40px,6vw,72px)/0.92 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin:0 0 20px">${esc(t.title)}<span style="color:var(--red)"> ${esc(t.accent)}</span></h1>
      <p style="font-size:18px;line-height:1.55;color:#b9b8bf;max-width:520px;margin:0 0 30px">${t.sub}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="/register${q}" style="padding:16px 30px;background:var(--red);color:#fff;border-radius:10px;font:700 16px/1 Barlow,sans-serif;box-shadow:0 8px 24px rgba(228,18,31,.4)">${esc(t.join)} →</a>
        <a href="/login${q}" style="padding:16px 30px;background:#1c1c22;color:#fff;border:1px solid #33333c;border-radius:10px;font:700 16px/1 Barlow,sans-serif">${esc(t.login)}</a>
      </div>
      <div style="display:flex;gap:30px;margin-top:42px">${statHtml}</div>
    </div>
    <div style="position:relative">
      <div style="background:linear-gradient(150deg,#1d1d24,#141419);border:1px solid #2c2c34;border-radius:20px;padding:22px">
        <div class="stripe" style="height:200px;border-radius:12px;display:flex;align-items:center;justify-content:center;opacity:.5;margin-bottom:16px;filter:grayscale(1)">
          <span style="font:600 12px/1 monospace;color:#555;background:#0e0e12;padding:6px 12px;border-radius:6px">event.jpg</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font:700 18px/1 'Barlow Condensed',sans-serif;text-transform:uppercase">Jakarta Run Series</div>
          <span style="background:var(--ok);color:#fff;font:600 11px/1 Barlow,sans-serif;padding:5px 9px;border-radius:6px">${esc(t.slot)}</span>
        </div>
        <div style="font-size:13px;color:#8a8990">12 Sep 2026 · Jakarta · Judges</div>
      </div>
    </div>
  </section>

  <section style="background:#0b0b0e;padding:56px 0">
    <div style="max-width:1180px;margin:0 auto;padding:0 28px">
      <h2 style="font:800 32px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 6px">${esc(t.featTitle)}</h2>
      <p style="color:#8a8990;margin:0 0 34px;font-size:15px">${esc(t.featSub)}</p>
      <div class="resp3">${featHtml}</div>
    </div>
  </section>

  <section style="max-width:900px;margin:0 auto;padding:64px 28px;text-align:center">
    <h2 style="font:800 clamp(30px,4.5vw,48px)/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 16px">${esc(t.finalCta)}</h2>
    <p style="color:#8a8990;font-size:16px;margin:0 0 26px">${esc(t.finalCtaSub)}</p>
    <a href="/register${q}" style="display:inline-block;padding:16px 36px;background:var(--red);color:#fff;border-radius:10px;font:700 16px/1 Barlow,sans-serif;box-shadow:0 8px 24px rgba(228,18,31,.4)">${esc(t.join)} →</a>
    <div style="margin-top:60px;padding-top:22px;border-top:1px solid #23232a;color:#66666d;font-size:13px">talent.20fit.id · © 2026 PT Kredo AUM · ${t.foot} · <a href="/admin/login" style="color:#8a8990">Login Admin / EO</a></div>
  </section>
</div>
</body></html>`;
}

/** Talent-type picker shown for sign up (mode='register') and log in (mode='login'). */
function talentPicker(mode, lang) {
  const L = (lang === 'en') ? 'en' : 'id';
  const T = {
    id: { reg: 'Daftar sebagai', log: 'Masuk sebagai', regSub: 'Pilih tipe talent kamu untuk membuat akun.', logSub: 'Pilih tipe talent kamu untuk masuk.', soon: 'Segera hadir', go: mode === 'register' ? 'Daftar' : 'Masuk', back: '← Kembali' },
    en: { reg: 'Sign up as', log: 'Log in as', regSub: 'Choose your talent type to create an account.', logSub: 'Choose your talent type to sign in.', soon: 'Coming soon', go: mode === 'register' ? 'Sign up' : 'Log in', back: '← Back' },
  }[L];
  const cats = [
    { type: 'kol', tag: 'KOL', name: 'KOL', id: 'Konten & endorsement campaign.', en: 'Content & campaign endorsement.', active: true },
    { type: 'main_power', tag: 'MP', name: 'Main Power', id: 'Talent utama event — brand ambassador, aktivasi.', en: 'Core event talent — brand ambassador, activation.', active: false },
    { type: 'fotografer', tag: 'FG', name: 'Fotografer', id: 'Dokumentasi & portofolio foto.', en: 'Documentation & photo portfolio.', active: false },
  ];
  const q = `?lang=${L}`;
  const cards = cats.map((c) => `
    <div class="cat-card ${c.active ? 'cat-active' : 'soon'}">
      <div class="cat-tag">${esc(c.tag)}</div>
      <div class="cat-name">${esc(c.name)}</div>
      <p class="cat-desc">${esc(L === 'en' ? c.en : c.id)}</p>
      ${c.active
        ? `<a href="/${talentPath(c.type)}/${mode}${q}" class="btn btn-block">${esc(T.go)} →</a>`
        : `<span class="pill pill-off" style="align-self:flex-start">${esc(T.soon)}</span>`}
    </div>`).join('');
  const title = mode === 'register' ? T.reg : T.log;
  const sub = mode === 'register' ? T.regSub : T.logSub;
  const body = `<div class="wrap">
  <a href="/${q}" class="btn btn-ghost btn-sm" style="margin-bottom:18px">${esc(T.back)}</a>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(sub)}</p>
  <div class="cat-grid">${cards}</div>
</div>`;
  return layout({ title: `${title} — 20FIT Talent`, body, brand: 'TALENT', home: '/' + q });
}

/** Public KOL submission form. `opts.errors` and `opts.values` re-render on validation failure. */
function kolForm(campaigns, opts = {}) {
  const errors = opts.errors || [];
  const v = opts.values || {};
  const talent = opts.talent || {};
  const options = (campaigns || [])
    .map((c) => `<option value="${esc(c.id)}"${v.campaign_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  const noCampaigns = !campaigns || campaigns.length === 0;
  const errorBanner = errors.length
    ? `<div class="banner banner-err"><b>Periksa lagi:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
    : '';
  const prefLinks = (v.links && v.links.length ? v.links : ['']);

  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/" class="btn btn-ghost btn-sm">← Kembali</a>
    <form method="post" action="/kol/logout" style="margin:0"><button class="btn btn-ghost btn-sm">Keluar</button></form>
  </div>
  <h1>Submit Hasil KOL</h1>
  <p class="sub">Halo <b>${esc(talent.name || '')}</b> — isi form ini setelah kamu selesai menjalankan event. Nama KOL otomatis dari akunmu.</p>
  ${errorBanner}
  ${noCampaigns ? '<div class="banner banner-warn">Belum ada campaign aktif. Hubungi admin untuk membuka campaign.</div>' : ''}
  <form class="card" method="post" action="/kol/submit" enctype="multipart/form-data" id="kolForm">
    <div class="field">
      <label for="campaign_id">Campaign</label>
      <select id="campaign_id" name="campaign_id" required ${noCampaigns ? 'disabled' : ''}>
        <option value="" disabled ${v.campaign_id ? '' : 'selected'}>— Pilih campaign —</option>
        ${options}
      </select>
    </div>

    <div class="field">
      <label>Upload Hasil <span class="hint">(gambar, 1–5 file)</span></label>
      <div id="images"></div>
      <button type="button" class="btn add-btn btn-sm" id="addImage">＋ Tambah gambar</button>
    </div>

    <div class="field">
      <label>Link Postingan <span class="hint">(bisa lebih dari 1)</span></label>
      <div id="links"></div>
      <button type="button" class="btn add-btn btn-sm" id="addLink">＋ Tambah link</button>
    </div>

    <button type="submit" class="btn btn-block" ${noCampaigns ? 'disabled' : ''}>Kirim Submission</button>
  </form>
</div>
<script>
(function(){
  var MAX_IMG = 5;
  var images = document.getElementById('images');
  var links = document.getElementById('links');
  var addImage = document.getElementById('addImage');
  var addLink = document.getElementById('addLink');
  var prefLinks = ${JSON.stringify(prefLinks)};

  function imgRow(){
    var row = document.createElement('div');
    row.className = 'repeat-row';
    row.innerHTML = '<input type="file" name="images" accept="image/*" required>' +
      '<button type="button" class="rm" title="Hapus">&times;</button>';
    row.querySelector('.rm').onclick = function(){ row.remove(); syncImg(); };
    images.appendChild(row);
    syncImg();
  }
  function syncImg(){
    var rows = images.querySelectorAll('.repeat-row');
    rows.forEach(function(r){ r.querySelector('.rm').style.visibility = rows.length > 1 ? 'visible' : 'hidden'; });
    addImage.style.display = rows.length >= MAX_IMG ? 'none' : '';
  }
  function linkRow(val){
    var row = document.createElement('div');
    row.className = 'repeat-row';
    var inp = document.createElement('input');
    inp.type = 'url'; inp.name = 'post_links'; inp.placeholder = 'https://instagram.com/p/...'; inp.required = true;
    if(val) inp.value = val;
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'rm'; rm.title = 'Hapus'; rm.innerHTML = '&times;';
    rm.onclick = function(){ row.remove(); syncLink(); };
    row.appendChild(inp); row.appendChild(rm);
    links.appendChild(row);
    syncLink();
  }
  function syncLink(){
    var rows = links.querySelectorAll('.repeat-row');
    rows.forEach(function(r){ r.querySelector('.rm').style.visibility = rows.length > 1 ? 'visible' : 'hidden'; });
  }
  addImage.onclick = imgRow;
  addLink.onclick = function(){ linkRow(''); };
  imgRow();
  prefLinks.forEach(function(l){ linkRow(l); });
})();
</script>`;
  return layout({ title: 'Submit Hasil KOL — 20FIT', body, home: '/' });
}

const TALENT_LABEL = { kol: 'KOL', main_power: 'Main Power', fotografer: 'Fotografer' };
function talentPath(type) { return type.replace(/_/g, '-'); }

function authShell(type, title, sub, formHtml, footHtml, errors) {
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>Gagal:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <a href="/" class="btn btn-ghost btn-sm" style="margin-bottom:18px">← Kembali</a>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(sub)}</p>
  ${errorBanner}
  <div class="card">${formHtml}</div>
  <p style="text-align:center;color:var(--muted);font-size:14px;margin-top:18px">${footHtml}</p>
</div>`;
  return layout({ title: `${title} — 20FIT ${TALENT_LABEL[type] || ''}`, body, brand: TALENT_LABEL[type] || 'Talent', home: '/' });
}

function talentLogin(type, opts = {}) {
  const p = talentPath(type);
  const v = opts.values || {};
  const form = `<form method="post" action="/${p}/login">
    <div class="field">
      <label for="login">Email / No. HP</label>
      <input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
    </div>
    <button type="submit" class="btn btn-block">Masuk</button>
  </form>`;
  const foot = `Belum punya akun? <a href="/${p}/register">Daftar di sini</a>`;
  return authShell(type, `Masuk ${TALENT_LABEL[type] || ''}`, 'Masuk ke akun kamu untuk submit hasil.', form, foot, opts.errors);
}

function talentRegister(type, opts = {}) {
  const p = talentPath(type);
  const v = opts.values || {};
  const form = `<form method="post" action="/${p}/register">
    <div class="field">
      <label for="name">Nama Lengkap</label>
      <input type="text" id="name" name="name" required maxlength="120" value="${esc(v.name || '')}">
    </div>
    <div class="field">
      <label for="login">Email / No. HP</label>
      <input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
      <div class="hint" style="margin-top:6px">Dipakai untuk login.</div>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
      <div class="hint" style="margin-top:6px">Minimal 6 karakter.</div>
    </div>
    <button type="submit" class="btn btn-block">Daftar</button>
  </form>`;
  const foot = `Sudah punya akun? <a href="/${p}/login">Masuk di sini</a>`;
  return authShell(type, `Daftar ${TALENT_LABEL[type] || ''}`, 'Buat akun untuk mulai submit hasil campaign.', form, foot, opts.errors);
}

function kolSuccess(name, campaign) {
  const body = `<div class="wrap narrow">
  <div class="card success">
    <div class="check">✓</div>
    <h1>Submission Terkirim!</h1>
    <p class="sub" style="margin:10px 0 24px">Terima kasih, <b>${esc(name)}</b>. Hasil kamu untuk campaign
      <b>${esc(campaign)}</b> sudah masuk dan menunggu review tim 20FIT.</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a href="/kol" class="btn btn-ghost">Kirim submission lagi</a>
      <a href="/" class="btn btn-ghost">← Beranda</a>
    </div>
  </div>
</div>`;
  return layout({ title: 'Terkirim — 20FIT KOL', body, home: '/' });
}

/** Staff (Super Admin / EO) login page. */
function staffLogin(opts = {}) {
  const v = opts.values || {};
  const errorBanner = (opts.errors && opts.errors.length)
    ? `<div class="banner banner-err"><b>Gagal:</b><ul>${opts.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <a href="/" class="btn btn-ghost btn-sm" style="margin-bottom:18px">← Kembali</a>
  <h1>Login Admin</h1>
  <p class="sub">Masuk sebagai Super Admin atau Event Organizer.</p>
  ${errorBanner}
  <div class="card">
    <form method="post" action="/admin/login">
      <div class="field"><label for="login">Email</label><input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}"></div>
      <div class="field"><label for="password">Password</label><input type="password" id="password" name="password" required autocomplete="current-password"></div>
      <button type="submit" class="btn btn-block">Masuk</button>
    </form>
  </div>
</div>`;
  return layout({ title: 'Login Admin — 20FIT', body, brand: 'ADMIN', home: '/' });
}

/**
 * Staff dashboard, role-aware.
 *   super_admin: EO management + campaign management + all talent submissions.
 *   eo:          read-only view of talent submissions (no EO/super-admin visibility).
 */
function adminPage({ staff, totalSubs, uniqueKol, camps, recent, eos }) {
  const isSuper = staff && staff.role === 'super_admin';
  const roleLabel = isSuper ? 'Super Admin' : 'Event Organizer';

  const campRows = camps.map((c) => `<tr>
    <td data-label="Campaign"><b>${esc(c.name)}</b></td>
    <td data-label="Submission">${c.count}</td>
    <td data-label="Status"><span class="pill ${c.is_active ? 'pill-ok' : 'pill-off'}">${c.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td style="text-align:right">
      <form class="inline-form" method="post" action="/admin/campaigns/${esc(c.id)}/toggle">
        <button class="btn btn-ghost btn-sm">${c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </form>
    </td></tr>`).join('');

  const recentRows = recent.length ? recent.map((s) => `<tr>
    <td data-label="Talent"><b>${esc(s.kol_name)}</b><div class="muted" style="font-size:12px">${fmtDate(s.created_at)}</div></td>
    <td data-label="Campaign">${esc(s.campaign_name || '—')}</td>
    <td data-label="Gambar"><div class="thumbs">${(s.images || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`).join('') || '<span class="muted">—</span>'}</div></td>
    <td class="linklist" data-label="Link Postingan">${(s.links || []).map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('') || '<span class="muted">—</span>'}</td>
  </tr>`).join('') : `<tr><td colspan="4" class="muted" style="padding:22px;text-align:center">Belum ada submission.</td></tr>`;

  const eoSection = isSuper ? `
  <div class="section-head"><h2 style="margin:0">Event Organizer</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/eos" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px">
      <input type="text" name="name" placeholder="Nama EO" required maxlength="120" style="flex:1;min-width:150px">
      <input type="text" name="login" placeholder="Email login" required style="flex:1;min-width:170px">
      <input type="text" name="password" placeholder="Password (min 6)" required minlength="6" style="flex:1;min-width:150px">
      <button class="btn btn-sm">Buat EO</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Nama</th><th>Email</th><th>Dibuat</th></tr></thead>
      <tbody>${(eos && eos.length) ? eos.map((e) => `<tr><td data-label="Nama"><b>${esc(e.name)}</b></td><td data-label="Email">${esc(e.login)}</td><td data-label="Dibuat" class="muted">${fmtDate(e.created_at)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">Belum ada EO.</td></tr>'}</tbody>
    </table></div>
  </div>` : '';

  const campaignSection = isSuper ? `
  <div class="section-head"><h2 style="margin:0">Campaign</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/campaigns" class="repeat-row" style="margin-bottom:18px">
      <input type="text" name="name" placeholder="Nama campaign baru" required maxlength="120">
      <button class="btn btn-sm">Tambah</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Campaign</th><th>Submission</th><th>Status</th><th></th></tr></thead>
      <tbody>${campRows || '<tr><td colspan="4" class="muted">Belum ada campaign.</td></tr>'}</tbody>
    </table></div>
  </div>` : '';

  const body = `<div class="wrap">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
    <div>
      <h1>Dashboard ${isSuper ? 'Super Admin' : 'EO'}</h1>
      <p class="sub">Login sebagai <b>${esc(staff ? staff.name : '')}</b> · ${roleLabel}</p>
    </div>
    <form method="post" action="/admin/logout" style="margin:0"><button class="btn btn-ghost btn-sm">Keluar</button></form>
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="n">${totalSubs}</div><div class="l">Total submission</div></div>
    <div class="stat"><div class="n">${uniqueKol}</div><div class="l">Talent unik</div></div>
    <div class="stat"><div class="n">${camps.filter((c) => c.is_active).length}</div><div class="l">Campaign aktif</div></div>
    ${isSuper ? `<div class="stat"><div class="n">${(eos || []).length}</div><div class="l">Event Organizer</div></div>` : ''}
  </div>
  ${eoSection}
  ${campaignSection}

  <div class="section-head"><h2 style="margin:0">Submission Terbaru</h2><a href="/performance" class="btn btn-ghost btn-sm">Lihat Leaderboard →</a></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>Talent</th><th>Campaign</th><th>Gambar</th><th>Link postingan</th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table></div>
  </div>
</div>`;
  return layout({ title: 'Dashboard — 20FIT', body, admin: 'admin' });
}

function performancePage(board, totalSubs) {
  const rows = board.length ? board.map((e, i) => `<tr>
    <td class="rank rank-${i + 1}" data-label="Peringkat">${i + 1}</td>
    <td data-label="KOL"><b>${esc(e.kol_name)}</b></td>
    <td data-label="Submission">${e.submissions}</td>
    <td data-label="Link Postingan">${e.posts}</td>
    <td data-label="Gambar">${e.images}</td>
    <td class="muted" data-label="Terakhir">${fmtDate(e.last)}</td>
  </tr>`).join('') : `<tr><td colspan="6" class="muted" style="padding:22px;text-align:center">Belum ada data.</td></tr>`;

  const body = `<div class="wrap">
  <h1>Leaderboard KOL</h1>
  <p class="sub">Peringkat KOL berdasarkan jumlah submission. ${totalSubs} total submission dari ${board.length} KOL.</p>
  <div class="card" style="margin-top:18px">
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>KOL</th><th>Submission</th><th>Link postingan</th><th>Gambar</th><th>Terakhir</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>
</div>`;
  return layout({ title: 'Leaderboard — 20FIT KOL', body, admin: 'perf' });
}

/** Shown when required env config is missing. */
function configError(missing) {
  const body = `<div class="wrap narrow"><div class="card">
    <h1>Konfigurasi belum lengkap</h1>
    <div class="banner banner-warn">Environment variable belum di-set: <b>${esc(missing)}</b>.<br>
    Set variabel ini di Railway dashboard (Variables) lalu redeploy.</div>
  </div></div>`;
  return layout({ title: 'Konfigurasi — 20FIT KOL', body });
}

function adminNoService() {
  const body = `<div class="wrap narrow"><div class="card">
    <h1>Service key belum di-set</h1>
    <div class="banner banner-warn">Halaman admin butuh <b>SUPABASE_SERVICE_ROLE_KEY</b> untuk membaca data.
    Ambil dari Supabase dashboard → Project Settings → API → <i>service_role</i> key, lalu set di Railway.</div>
  </div></div>`;
  return layout({ title: 'Admin — 20FIT KOL', body, admin: 'admin' });
}

function page500(msg) {
  const body = `<div class="wrap narrow"><div class="card">
    <h1>Terjadi kesalahan</h1>
    <div class="banner banner-err">${esc(msg || 'Unknown error')}</div>
    <a href="/kol" class="btn btn-ghost" style="margin-top:16px">Kembali ke form</a>
  </div></div>`;
  return layout({ title: 'Error — 20FIT KOL', body });
}

module.exports = {
  esc, fmtDate, landingPage, talentPicker, kolForm, kolSuccess, adminPage, performancePage,
  talentLogin, talentRegister, staffLogin, configError, adminNoService, page500,
};
