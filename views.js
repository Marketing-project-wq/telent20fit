'use strict';

const { t: tr, normLang } = require('./i18n');

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

/** Format a date-only value ("YYYY-MM-DD") as a short Indonesian date, no time. */
function fmtDay(d) {
  if (!d) return '-';
  const p = String(d).slice(0, 10).split('-');
  if (p.length !== 3) return String(d);
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${+p[2]} ${bulan[+p[1] - 1] || ''} ${p[0]}`;
}

// Official 20FIT logos (served from the 20FIT CDN; loaded by the browser, no CSP restriction).
// One variant per theme so the mark is always readable with its red ring intact:
//   dark theme  -> light wordmark made for dark backgrounds
//   light theme -> standard wordmark made for light backgrounds
const LOGO_DARK = 'https://media.20fit.id/wp-content/uploads/2026/04/new-logo-20fit.png';
const LOGO_LIGHT = 'https://media.20fit.id/wp-content/uploads/2026/05/Logo-20fit.png';

/** 20FIT brand logo image (the wordmark already reads "20FIT"; no extra label).
 *  Both variants are emitted; CSS shows the one matching the active theme. */
function brandMark() {
  return `<img src="${LOGO_DARK}" alt="20FIT" class="brand-img brand-dark"><img src="${LOGO_LIGHT}" alt="20FIT" class="brand-img brand-light">`;
}

/**
 * Reusable "benefit card" — icon tile + uppercase title + muted description.
 * Shared by the landing "Kenapa Pilih 20FIT Talent" grid and the event-detail
 * "Posisi yang Dibutuhkan" (jobdesk) grid so both look identical. Both surfaces
 * render in light theme, so the palette is hard-coded here for pixel-identical
 * output across the two layouts (whose CSS vars/fonts otherwise differ).
 * CARD_CSS is injected into both stylesheets; benefitCard() emits the markup.
 *   icon   : inline <svg> string (tinted red via currentColor)
 *   title  : heading text (caller pre-escapes)
 *   desc   : description text (caller pre-escapes); optional
 *   corner : HTML shown top-right beside the icon, e.g. a status badge; optional
 *   foot   : extra HTML below the description, e.g. quota + apply button; optional
 *   id     : element id for deep-linking / scroll-to a card; optional
 */
const CARD_CSS = `
.bgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:860px){.bgrid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.bgrid{grid-template-columns:1fr}}
.bcard{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:24px;box-shadow:0 6px 20px rgba(16,16,19,.05)}
.bcard-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.bcard-ico{width:44px;height:44px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#E4121F;background:rgba(228,18,31,.14);border:1px solid rgba(228,18,31,.30);border-radius:10px}
.bcard-ico svg{width:22px;height:22px}
.bcard-h{font:700 19px/1.15 'Barlow Condensed','Barlow',-apple-system,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.01em;margin-top:15px}
.bcard-d{color:#5b6069;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:8px 0 0}
.bband{background:#eef1f5;border:1px solid #e6e9ef;border-radius:20px;padding:28px}
.bband-h{font:800 clamp(23px,3vw,31px)/1 'Barlow Condensed','Barlow',-apple-system,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.005em;margin:0 0 20px}
@media(max-width:560px){.bband{padding:20px 15px}}
`;
function benefitCard({ icon, title, desc = '', corner = '', foot = '', id = '' }) {
  return `<div class="bcard"${id ? ` id="${id}" style="scroll-margin-top:84px"` : ''}>
    <div class="bcard-top"><div class="bcard-ico">${icon}</div>${corner}</div>
    <div class="bcard-h">${title}</div>
    ${desc ? `<p class="bcard-d">${desc}</p>` : ''}
    ${foot}
  </div>`;
}

const STYLE = `
:root{--red:#E4121F;--red-hover:#ff2a37;--red-soft:rgba(228,18,31,.16);
  --bg:#0c0c0f;--panel:#141419;--card:#17171d;--card2:#20202a;--line:#2a2a33;
  --ink:#f3f3f6;--muted:#8f8f9b;--ok:#3ad29f;--ok-soft:rgba(58,210,159,.15);
  --warn:#f0b23a;--warn-soft:rgba(240,178,58,.15);--err:#ff5b66;--err-soft:rgba(228,18,31,.15);}
/* Light theme (brand red stays; surfaces + inks flip) */
:root[data-theme="light"]{
  --red-soft:rgba(228,18,31,.10);
  --bg:#f3f5f8;--panel:#ffffff;--card:#ffffff;--card2:#eef1f5;--line:#e2e6ec;
  --ink:#17171d;--muted:#63676e;--ok:#178a54;--ok-soft:rgba(23,138,84,.12);
  --warn:#a86a00;--warn-soft:rgba(168,106,0,.12);--err:#d32f2f;--err-soft:rgba(211,47,47,.10);}
:root[data-theme="light"] .brand .brand-dark{display:none}
:root[data-theme="light"] .brand .brand-light{display:block}
:root[data-theme="light"] .sidebar{box-shadow:0 0 0 1px var(--line)}
:root[data-theme="light"] .side-nav a.active{color:var(--red)}
:root[data-theme="light"] .hamburger{color:var(--ink)}
:root[data-theme="light"] .topbar{color:var(--ink)}
:root[data-theme="light"] .pill-off{background:var(--card2)}
:root[data-theme="light"] input[type=datetime-local]::-webkit-calendar-picker-indicator{filter:none}
/* Theme toggle pill */
.theme-toggle{display:inline-flex;gap:3px;background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:3px}
.theme-toggle button{padding:5px 10px;border-radius:7px;font-weight:700;font-size:12px;border:0;cursor:pointer;background:transparent;color:var(--muted);line-height:1}
.theme-toggle button.active{background:var(--red);color:#fff}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
a{color:var(--red)}
/* Top logo bar (auth / non-app pages) */
.topbar{background:var(--panel);color:#fff;position:sticky;top:0;z-index:100;border-bottom:1px solid var(--line)}
.topbar .in{max-width:1000px;margin:0 auto;padding:0 20px;height:58px;display:flex;align-items:center;justify-content:center;gap:18px}
.logo{font-size:21px;line-height:1;text-decoration:none}
/* Left sidebar app shell */
.nav-cb{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.sidebar{position:fixed;left:0;top:0;bottom:0;width:236px;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;z-index:200}
.side-logo{padding:22px 22px 18px;font-size:26px;line-height:1;text-decoration:none}
/* 20FIT ring wordmark (brand logo): white "2", red-ring "0", white "FIT" */
.brand{display:inline-flex;align-items:center;gap:.5em;text-decoration:none;line-height:1;white-space:nowrap}
.brand .brand-img{height:2.8em;width:auto;max-width:100%;display:block;flex:0 0 auto}
.brand .brand-dark{height:1.56em}
.brand .brand-light{display:none}
.brand .b-tag{font-weight:800;font-size:.4em;letter-spacing:.22em;color:var(--red);text-transform:uppercase}
/* Center the brand logo in the sidebar */
.side-logo{display:flex;justify-content:center}
.side-nav{display:flex;flex-direction:column;gap:3px;padding:8px 12px;flex:1;overflow-y:auto}
.side-nav a{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:10px;color:var(--muted);text-decoration:none;font-weight:600;font-size:14.5px}
.side-nav a svg{width:20px;height:20px;flex-shrink:0}
.side-nav a:hover{background:var(--card2);color:var(--ink)}
.side-nav a.active{background:var(--red-soft);color:#fff;box-shadow:inset 3px 0 0 var(--red)}
.side-nav a.active svg{color:var(--red)}
.side-foot{border-top:1px solid var(--line);padding:14px 16px}
.side-user{font-size:12.5px;color:var(--muted);margin-bottom:11px;line-height:1.35}
.side-user b{color:var(--ink);font-size:14px;display:block}
.nav-scrim{display:none}
.app-main{margin-left:236px;min-height:100vh}
.app-top{display:none}
.tab-bar{display:none}
.wrap{max-width:1000px;margin:0 auto;padding:30px 20px 70px}
.wrap.narrow{max-width:640px}
/* Talent pages sit next to the sidebar — left-align the content so narrow
   pages hug the sidebar instead of floating awkwardly centered. */
.talent-app .wrap{margin-left:0;margin-right:auto}
@media(min-width:900px){.talent-app .wrap{padding-left:34px}}
h1{font-size:27px;font-weight:800;letter-spacing:-.01em}
h2{font-size:18px;font-weight:700;margin:0 0 14px}
.sub{color:var(--muted);font-size:15px;margin-top:5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:20px}
.ev-card{overflow:hidden;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}
.ev-card:hover{transform:translateY(-3px);border-color:var(--red);box-shadow:0 10px 26px rgba(0,0,0,.28)}
.ev-cover{position:relative;height:96px;margin:-24px -24px 16px;overflow:hidden}
.ev-cover-tex{position:absolute;inset:0;background:repeating-linear-gradient(-45deg,rgba(255,255,255,.06) 0,rgba(255,255,255,.06) 2px,transparent 2px,transparent 13px)}
.ev-cover-ini{position:absolute;left:20px;top:50%;transform:translateY(-50%);font-size:46px;font-weight:900;color:rgba(255,255,255,.92);letter-spacing:-.03em;text-shadow:0 2px 12px rgba(0,0,0,.28);line-height:1}
.ev-cover-ico{position:absolute;right:-6px;bottom:-20px;font-size:82px;opacity:.2;line-height:1;transform:rotate(-8deg)}
.ev-cover-badge{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.94);font-size:11.5px;font-weight:800;padding:4px 11px;border-radius:100px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.ev-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ev-cover-photo{height:190px;background:rgba(0,0,0,.04)}
.ev-cover-photo-img{display:block;width:100%;height:100%;object-fit:cover}
.ev-detail-hero{display:block;width:100%;height:auto;margin:0 0 18px;border-radius:14px}
.ev-mockup-thumb{width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--line)}
.ev-chip{border:1px solid var(--line);background:transparent;color:var(--ink);font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:100px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.ev-chip:hover{border-color:var(--red)}
.ev-chip.is-on{background:var(--red);border-color:var(--red);color:#fff}
label{display:block;font-weight:600;font-size:14px;margin-bottom:8px}
.hint{color:var(--muted);font-weight:400;font-size:13px}
input[type=text],input[type=url],input[type=password],input[type=datetime-local],input[type=number],select,textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:15px;background:var(--card);font-family:inherit;color:var(--ink)}
input[type=datetime-local]::-webkit-calendar-picker-indicator{filter:invert(.7)}
.sla{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;white-space:nowrap}
.sla-green{color:#3ad29f}.sla-yellow{color:#f0b23a}.sla-red{color:#ff5b66}.sla-gray{color:var(--muted)}
input::placeholder{color:var(--muted)}
input[type=file]{width:100%;font-size:14px;color:var(--muted)}
input:focus,select:focus{outline:2px solid var(--red);border-color:var(--red)}
.field{margin-bottom:22px}
.repeat-row{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.repeat-row>*:first-child{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 22px;border-radius:10px;border:none;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;text-decoration:none;color:#fff;background:var(--red)}
.btn:hover{background:var(--red-hover)}
.btn-ghost{background:var(--card);color:var(--ink);border:1.5px solid var(--line)}
.btn-ghost:hover{background:var(--card2);border-color:#3b3b46}
.btn-block{width:100%}
.btn-sm{padding:8px 13px;font-size:13px}
.add-btn{background:var(--red-soft);color:var(--red);border:1px dashed rgba(228,18,31,.45)}
.add-btn:hover{background:rgba(228,18,31,.22)}
.rm{background:var(--card);border:1px solid var(--line);color:var(--muted);border-radius:9px;width:40px;height:40px;flex-shrink:0;cursor:pointer;font-size:17px;line-height:1}
.rm:hover{border-color:var(--red);color:var(--red)}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.stat .n{font-size:34px;font-weight:800;line-height:1}
.stat .l{color:var(--muted);font-size:13px;margin-top:6px}
/* Dashboard summary widgets */
.wgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:20px}
.wcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:17px;display:flex;flex-direction:column;gap:9px}
.wcard-muted{opacity:.6}
.wc-top{display:flex;align-items:center;gap:9px}
.wc-icon{width:34px;height:34px;border-radius:9px;background:var(--red-soft);display:inline-flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.wc-label{font-size:12.5px;color:var(--muted);font-weight:600;line-height:1.25}
.wc-badge{margin-left:auto;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warn);background:var(--warn-soft);padding:3px 8px;border-radius:100px;white-space:nowrap}
.wc-num{font-size:34px;font-weight:800;line-height:1}
.wc-sub{font-size:12.5px;color:var(--muted);line-height:1.5}
.dl-list{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.dl-item{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:10px 13px;border:1px solid var(--line);border-radius:11px}
.dl-when{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:100px;white-space:nowrap;flex-shrink:0}
.dl-late{background:var(--err-soft);color:var(--err)}
.dl-near{background:var(--warn-soft);color:var(--warn)}
/* Horizontal bar charts (magnitude comparison) */
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px 30px}
.chart-title{font-weight:700;font-size:14px;margin-bottom:16px}
.bar-row{display:grid;grid-template-columns:96px 1fr auto;align-items:center;gap:12px;margin-bottom:12px}
.bar-label{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{background:var(--card2);border-radius:6px;height:14px;overflow:hidden}
.bar-fill{height:100%;background:var(--red);border-radius:0 6px 6px 0;min-width:3px;transition:width .35s ease}
.bar-row:hover .bar-fill{background:var(--red-hover)}
.bar-val{font-size:13px;font-weight:700;text-align:right;min-width:56px;font-variant-numeric:tabular-nums}
th.sort-th{cursor:pointer;user-select:none;white-space:nowrap}
th.sort-th:hover{color:var(--ink)}
.sort-ind{color:var(--red);font-size:11px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;background:var(--red-soft);color:var(--red);font-size:12px;font-weight:600;padding:3px 9px;border-radius:100px}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:100px}
.pill-ok{background:var(--ok-soft);color:var(--ok)}
.pill-off{background:#26262e;color:var(--muted)}
/* Application progress tracker: Applied → Under Review → Approved → Assigned */
.trk{display:flex;margin:16px 0 2px}
.trk-step{flex:1;text-align:center;position:relative;min-width:0}
.trk-step::before{content:"";position:absolute;top:12px;right:50%;width:100%;height:3px;background:var(--line);z-index:0}
.trk-step:first-child::before{display:none}
.trk-step.fill::before{background:var(--red)}
.trk-dot{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--card2);color:var(--muted);border:2px solid var(--line);font-weight:800;font-size:12px}
.trk-step.done .trk-dot{background:var(--red);border-color:var(--red);color:#fff}
.trk-step.active .trk-dot{background:var(--card);border-color:var(--red);color:var(--red);box-shadow:0 0 0 4px var(--red-soft)}
.trk-lbl{display:block;margin-top:7px;font-size:11px;font-weight:700;color:var(--muted);line-height:1.25}
.trk-step.done .trk-lbl,.trk-step.active .trk-lbl{color:var(--ink)}
.rank{font-weight:800;color:var(--muted);width:34px}
.rank-1{color:#e0b53a}.rank-2{color:#b9b9c2}.rank-3{color:#c98a54}
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
.cat-card.soon{opacity:.6}
.cat-card.cat-active{border-color:var(--red);box-shadow:0 6px 24px rgba(228,18,31,.18)}
.cat-tag{width:46px;height:46px;border-radius:12px;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.cat-name{font-size:20px;font-weight:800}
.cat-desc{color:var(--muted);font-size:14px;flex:1;margin:0}
.linklist a{display:block;font-size:13px;word-break:break-all;margin-bottom:2px}
.inline-form{display:inline}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:36px 0 0}
@media(max-width:899px){
  /* Sidebar becomes an off-canvas drawer toggled by the hamburger */
  .sidebar{transform:translateX(-100%);transition:transform .22s ease;box-shadow:0 0 44px rgba(0,0,0,.6);width:252px}
  .nav-cb:checked ~ .sidebar{transform:none}
  .nav-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:150}
  .nav-cb:checked ~ .nav-scrim{display:block}
  .app-main{margin-left:0}
  .app-top{display:flex;align-items:center;justify-content:center;position:sticky;top:0;z-index:100;background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px}
  .hamburger{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:23px;color:#fff;cursor:pointer;line-height:1;user-select:none;padding:2px 4px}
  .app-top-logo{font-size:20px;line-height:1;text-decoration:none}
  /* Talent app: bottom tab bar (mobile-app style) replaces the drawer nav */
  .talent-app .tab-bar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:200;background:var(--panel);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom,0px))}
  .talent-app .tab-bar a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border-radius:10px;color:var(--muted);text-decoration:none;font-weight:600;font-size:11px}
  .talent-app .tab-bar a svg{width:22px;height:22px}
  .talent-app .tab-bar a.active,.talent-app .tab-bar a.active svg{color:var(--red)}
  .talent-app .hamburger{display:none}
  .talent-app .app-main{padding-bottom:74px}
}
@media(max-width:600px){
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
${CARD_CSS}`;

// Head script: apply the saved theme before first paint (no flash), and wire the toggle pills.
// Dark mode removed — every page renders light (data-theme="light" on <html>).
const THEME_HEAD = '';

/** Theme toggle removed — the app is light-only. */
function themeToggle() {
  return '';
}

/** Language + theme toggles grouped together. */
function toggles(lang) {
  return `<div style="display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center">${langToggle(lang)}${themeToggle()}</div>`;
}

/** Plain shell (top logo bar, no sidebar) — landing/auth/picker/error pages. */
function layout({ title, body, brand, home, lang, hideBrand }) {
  const label = brand || 'KOL';
  const homeHref = home || '/';
  const topbar = hideBrand ? '' : `<div class="topbar"><div class="in">
  <a href="${homeHref}" class="logo brand">${brandMark(label)}</a>
</div></div>`;
  return `<!doctype html><html lang="${normLang(lang)}" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<title>${esc(title)}</title><style>${STYLE}</style>${THEME_HEAD}</head>
<body>
${topbar}
${body}
</body></html>`;
}

// Inline stroke icons for the sidebar (no external assets, CSP-safe).
const NAV_ICON = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  proofs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L4.5 21"/></svg>',
  manage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="15" cy="7" r="2.4" fill="var(--panel)"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="17" r="2.4" fill="var(--panel)"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><rect x="5" y="11" width="3.4" height="8" rx="1"/><rect x="10.3" y="6" width="3.4" height="13" rx="1"/><rect x="15.6" y="14" width="3.4" height="5" rx="1"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>',
  applications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  event: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/></svg>',
  hyrox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="5.5"/><path d="M8.5 13L7 22l5-2.7 5 2.7-1.5-9"/></svg>',
};

function navLink(href, key, active, icon, label) {
  return `<a href="${href}"${key === active ? ' class="active"' : ''}>${NAV_ICON[icon]}<span>${esc(label)}</span></a>`;
}

/**
 * Sidebar app shell for authenticated pages. Menu adapts to role:
 *   kol         -> Bukti Post
 *   eo          -> Dashboard, Bukti Post
 *   super_admin -> Dashboard, Bukti Post, Kelola
 * Fixed sidebar on desktop; off-canvas drawer with a hamburger on mobile.
 */
function appLayout({ title, body, role, active, user, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const isEo = role === 'eo';
  const isStaff = role === 'super_admin' || isEo;
  const roleLabel = t('role.' + (role || 'kol'));
  const homeHref = isEo ? '/eo' : isStaff ? '/admin' : '/kol';
  const logoutAction = isEo ? '/eo/logout' : isStaff ? '/admin/logout' : '/kol/logout';
  const items = isEo
    ? navLink('/eo', 'dashboard', active, 'dashboard', t('nav.dashboard'))
      + navLink('/eo/events', 'events', active, 'event', t('nav.events'))
      + navLink('/admin/hyrox', 'hyrox', active, 'hyrox', t('nav.hyrox'))
      + navLink('/eo/profile', 'profile', active, 'profile', t('nav.profile'))
    : isStaff
      ? navLink('/admin', 'dashboard', active, 'dashboard', t('nav.dashboard'))
        + navLink('/admin/overview', 'overview', active, 'overview', t('nav.overview'))
        + navLink('/admin/analytics', 'analytics', active, 'analytics', t('nav.analytics'))
        + navLink('/admin/proofs', 'proofs', active, 'proofs', t('nav.proofs'))
        + navLink('/admin/applications', 'applications', active, 'applications', t('nav.applications'))
        + navLink('/admin/applications?cat=kol', 'applications-kol', active, 'proofs', t('nav.appKol'))
        + navLink('/admin/applications?cat=creative', 'applications-creative', active, 'proofs', t('nav.appCreative'))
        + navLink('/admin/hyrox', 'hyrox', active, 'hyrox', t('nav.hyrox'))
        + navLink('/admin/manage', 'manage', active, 'manage', t('nav.manage'))
        + navLink('/admin/landing', 'landing', active, 'proofs', t('nav.landing'))
      : navLink('/kol/event', 'event', active, 'event', t('nav.events'))
        + navLink('/kol', 'profil', active, 'profile', t('nav.profile'))
        + navLink('/kol/kirim-bukti', 'proofs', active, 'proofs', t('nav.proofs'));

  return `<!doctype html><html lang="${L}" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style>${THEME_HEAD}</head>
<body class="${isStaff ? '' : 'talent-app'}">
<input type="checkbox" id="nav-cb" class="nav-cb" aria-label="Menu">
<aside class="sidebar">
  <a href="${homeHref}" class="side-logo brand">${brandMark('TALENT')}</a>
  <nav class="side-nav">${items}</nav>
  <div class="side-foot">
    ${isStaff ? `<div style="margin-bottom:12px">${toggles(L)}</div>` : ''}
    <div class="side-user"><b>${esc(user || '')}</b>${roleLabel}</div>
    <form method="post" action="${logoutAction}" style="margin:0"><button class="btn btn-ghost btn-sm btn-block">${t('nav.logout')}</button></form>
  </div>
</aside>
<label for="nav-cb" class="nav-scrim"></label>
<div class="app-main">
  <div class="app-top">
    <label for="nav-cb" class="hamburger" role="button" aria-label="Menu">&#9776;</label>
    <a href="${homeHref}" class="app-top-logo brand">${brandMark('TALENT')}</a>
  </div>
  ${body}
</div>
${isStaff ? '' : `<nav class="tab-bar">${items}</nav>`}
</body></html>`;
}

/**
 * Landing page at "/" (dark prototype hero) with an ID/EN language toggle.
 * CTAs lead to the talent-type picker for sign up (/register) and log in (/login).
 */
function landingPage(lang, opts = {}) {
  const L = (lang === 'en') ? 'en' : 'id';
  const t = (k, v) => tr(L, k, v);
  // Optional hero background photos (0-2). With 2 they crossfade; with 1 it's static.
  const bgPhotos = Array.isArray(opts.bg) ? opts.bg.filter(Boolean) : [];
  const hasPhotos = bgPhotos.length > 0;
  const heroPhotos = hasPhotos
    ? `<div class="hero-photos${bgPhotos.length > 1 ? ' cross' : ''}" aria-hidden="true">${bgPhotos.map((u) => `<div class="hp" style="background-image:url('${esc(u)}')"></div>`).join('')}</div>`
    : '';
  // Feature cards: [icon SVG, i18n key base] — title/description resolved from the dictionary.
  // Icons are stroke-based (Lucide), inheriting the red badge color via currentColor.
  const ic = (p) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const FEATS = [
    [ic('<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>'), 'whyChoose.item1'], // income — banknote
    [ic('<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'), 'whyChoose.item2'], // experience — briefcase
    [ic('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'), 'whyChoose.item3'], // portfolio — gallery
    [ic('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>'), 'whyChoose.item4'], // benefits — gift
    [ic('<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>'), 'whyChoose.item5'], // certificate — award
    [ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'), 'whyChoose.item6'], // find project — target
  ];
  // Theme-swapped brand logos: *_DARK shows in dark mode (white artwork), *_LIGHT in light mode (black artwork).
  const SHOP_DARK = 'https://media.20fit.id/wp-content/uploads/2026/07/08-20FIT-SHOP-WHITE-1-scaled.png';
  const SHOP_LIGHT = 'https://media.20fit.id/wp-content/uploads/2026/07/07-20FIT-SHOP-BLACK-1-scaled.png';
  const ARENA_DARK = 'https://media.20fit.id/wp-content/uploads/2026/07/Logo-20FIT-Arena-white-1.png';
  const ARENA_LIGHT = 'https://media.20fit.id/wp-content/uploads/2026/07/Logo-20FIT-Arena-black-3.png';
  const CAFE_DARK = 'https://media.20fit.id/wp-content/uploads/2026/07/20fit-cafe-redwhite-1-scaled.png';
  const CAFE_LIGHT = 'https://media.20fit.id/wp-content/uploads/2026/07/20fit-cafe-2-scaled.png';
  // 20FIT Group ecosystem brands. To add a brand later, drop in one entry:
  //   with logo -> { logoD, logoL, href, name }  (href optional; makes the card a clickable Instagram link)
  //   text only -> { name, accent }              (placeholder until its logo is ready)
  // Per-logo size tweaks for artwork whose built-in padding makes it render
  // off from the rest: `mw` caps width (shrink a tightly-cropped logo), `scale`
  // multiplies the rendered size — >1 enlarges a heavily-padded logo, <1 shrinks
  // one that still comes out too big. Both optional; tuned to match 20FIT Shop.
  const BRANDS = [
    { logoD: SHOP_DARK, logoL: SHOP_LIGHT, href: 'https://www.instagram.com/20fit.shop/', name: '20FIT Shop' },
    { logoD: ARENA_DARK, logoL: ARENA_LIGHT, href: 'https://www.instagram.com/20fit.arena/', name: '20FIT Arena', scale: 1.8 },
    { logoD: CAFE_DARK, logoL: CAFE_LIGHT, href: 'https://www.instagram.com/20fit.cafe/', name: '20FIT Cafe', mw: '56%', scale: 0.8 },
    { name: '20FIT', accent: 'Event' },
    { name: '20FIT', accent: 'Photo' },
    { name: '20FIT', accent: 'Sport Clinic' },
  ];

  const featHtml = FEATS.map(([icon, key]) => benefitCard({ icon, title: esc(t(key + '.title')), desc: esc(t(key + '.description')) })).join('');
  // 20FIT coaches — photo grid. To show a coach, fill in their `photo` URL.
  const COACHES = [
    { name: 'Nando', group: 'arena', photo: 'https://media.20fit.id/wp-content/uploads/2026/07/Coach-Nando.jpg' },
    { name: 'Rheza', group: 'arena', photo: 'https://media.20fit.id/wp-content/uploads/2026/07/Coach-Rheza.jpg' },
    { name: 'Calysta', group: 'arena', photo: 'https://media.20fit.id/wp-content/uploads/2026/07/Coach-Calysta.jpg' },
    { name: 'Elsen', group: 'arena', photo: null },
    { name: 'Gilang', group: 'arena', photo: null },
    { name: 'Mae', group: 'arena', photo: null },
    { name: 'Brian', group: 'arena', photo: null },
    { name: 'Sakha', group: 'arena', photo: null },
    { name: 'Andrew', group: 'arena', photo: null },
    { name: 'Asa', group: 'arena', photo: null },
    { name: 'Ista', group: 'arena', photo: null },
    { name: 'Kiki', group: 'arena', photo: null },
    { name: 'Dhani', group: 'gym', photo: 'https://media.20fit.id/wp-content/uploads/2026/07/Coach-Dhani.jpg' },
    { name: 'Andro', group: 'gym', photo: 'https://media.20fit.id/wp-content/uploads/2026/07/Coach-Andro.jpg' },
  ];
  const COACH_GROUP = { arena: '20FIT Arena', gym: '20FIT Gym' };
  const coachHtml = COACHES.filter((c) => c.photo).map((c) => `<div class="coach-card">
      <div class="coach-photo"><img src="${esc(c.photo)}" alt="Coach ${esc(c.name)}" loading="lazy" decoding="async"></div>
      <div class="coach-body"><div class="coach-name">${esc(c.name)}</div><div class="coach-group">${esc(COACH_GROUP[c.group] || '20FIT')}</div></div>
    </div>`).join('');
  const ecoHtml = BRANDS.map((b) => {
    if (b.logoD) {
      const st = (b.mw || b.scale) ? ` style="${b.mw ? `max-width:${b.mw};` : ''}${b.scale ? `transform:scale(${b.scale});` : ''}"` : '';
      const imgs = `<span class="eco-logo-wrap"><img src="${b.logoD}" alt="${esc(b.name)}" class="eco-logo eco-logo-dark" loading="lazy" decoding="async"${st}><img src="${b.logoL}" alt="${esc(b.name)}" class="eco-logo eco-logo-light" loading="lazy" decoding="async"${st}></span>`;
      return b.href
        ? `<a href="${b.href}" target="_blank" rel="noopener" class="eco-card eco-card-logo" aria-label="${esc(b.name)} · Instagram" title="${esc(b.name)} · Instagram">${imgs}</a>`
        : `<div class="eco-card eco-card-logo">${imgs}</div>`;
    }
    return `<div class="eco-card">${esc(b.name)}<b>${esc(b.accent)}</b></div>`;
  }).join('');
  // Footer: social icons row.
  const SVG_LI = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.2 9h3.6v11.5H3.2zM9.3 9h3.45v1.57h.05c.48-.9 1.66-1.85 3.42-1.85 3.66 0 4.33 2.4 4.33 5.53v6.25h-3.6v-5.54c0-1.32-.02-3.02-1.84-3.02-1.84 0-2.12 1.44-2.12 2.92v5.64H9.3z"/></svg>';
  const SVG_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.6" cy="6.4" r="1.15" fill="currentColor" stroke="none"/></svg>';
  const SVG_YT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23 12s0-3.2-.41-4.73a2.5 2.5 0 0 0-1.76-1.77C19.3 5.1 12 5.1 12 5.1s-7.3 0-8.83.4A2.5 2.5 0 0 0 1.4 7.28C1 8.8 1 12 1 12s0 3.2.41 4.73a2.5 2.5 0 0 0 1.76 1.77c1.53.4 8.83.4 8.83.4s7.3 0 8.83-.4a2.5 2.5 0 0 0 1.76-1.77C23 15.2 23 12 23 12z"/><path d="M9.75 15.5l6.25-3.5-6.25-3.5z" fill="var(--lp-bg)"/></svg>';
  const socialHtml = [
    ['https://www.linkedin.com/company/20fitgroup', SVG_LI, 'LinkedIn'],
    ['https://www.instagram.com/20fit.id/', SVG_IG, 'Instagram'],
    ['https://www.youtube.com/@20fit.indonesia', SVG_YT, 'YouTube'],
  ].map(([href, svg, name]) => `<a href="${href}" target="_blank" rel="noopener" aria-label="${name}" title="${name}">${svg}</a>`).join('');

  // Footer "Ekosistem" column — mirrors the configured BRANDS grid above.
  // Logo brands link to their Instagram; text-only brands render as plain labels.
  const ecoLinksHtml = BRANDS.map((b) => {
    const label = b.logoD ? b.name : `${b.name} ${b.accent}`;
    return b.href
      ? `<a href="${b.href}" target="_blank" rel="noopener">${esc(label)}</a>`
      : `<span>${esc(label)}</span>`;
  }).join('');

  const langBtn = (code, label) => `<a href="/?lang=${code}" class="lp-tog-b${code === L ? ' on' : ''}">${label}</a>`;
  const toggle = `<div class="lp-tog">${langBtn('id', 'ID')}${langBtn('en', 'EN')}</div>`;
  const q = `?lang=${L}`;
  // Sticky top navbar (marketplace-style). Events are login-gated, so the gated
  // actions (search, Event, Tiket Saya, Account) funnel logged-out visitors to login/register.
  const navBar = landingNav(L, 'home', opts.account);

  // Events currently open for registration (live EO data, with their still-open
  // positions). Cards link to the event detail page; the /event/:id gate sends
  // logged-out visitors through login/register and redirects them back.
  const evList = Array.isArray(opts.events) ? opts.events : [];
  const evDate2 = (e) => { const s = e.starts_at ? fmtDay(e.starts_at) : ''; const en = e.ends_at && String(e.ends_at) !== String(e.starts_at) ? fmtDay(e.ends_at) : ''; return en ? s + ' – ' + en : s; };
  const gradCover = (seed, label, big) => { const [c1, c2, icon] = evCoverPick(seed); const txt = big ? label : (String(label || '?').trim().charAt(0).toUpperCase() || '?'); return `<div class="lp-ev-cover lp-ev-grad" style="background:linear-gradient(135deg,${c1},${c2})"><span class="lp-ev-word">${esc(txt)}</span><span class="lp-ev-ico" aria-hidden="true">${icon}</span></div>`; };
  // Group each still-open position into one of three public badge categories.
  const posCatKey = (key) => key === 'kol' ? 'kol' : ((key === 'fotografer' || key === 'videografer') ? 'photo' : 'manpower');
  const cityOf = (loc) => { const parts = String(loc || '').split(','); return (parts[parts.length - 1] || '').trim(); };
  const evCardHtml = evList.map((e) => {
    const cats = Array.from(new Set((e.openPositions || []).map((p) => posCatKey(p.key))));
    const catBadges = cats.map((ck) => `<span class="lp-ev-pos">${esc(t('land.openCat.' + ck))}</span>`).join('');
    const city = cityOf(e.location);
    return `<a href="/event/${esc(e.slug || e.id)}?lang=${L}" class="lp-ev-card" data-city="${esc(city.toLowerCase())}">
      <div class="lp-ev-cw">${e.mockup_url ? `<div class="lp-ev-cover" style="background-image:url('${esc(e.mockup_url)}')"></div>` : gradCover(e.id || e.name, e.name, false)}<span class="lp-ev-badge lp-ev-open">${esc(t('land.openBadge'))}</span></div>
      <div class="lp-ev-body">
        <div class="lp-ev-name">${esc(e.name)}</div>
        ${e.location ? `<div class="lp-ev-meta">📍 ${esc(e.location)}</div>` : ''}
        ${evDate2(e) ? `<div class="lp-ev-meta">📅 ${esc(evDate2(e))}</div>` : ''}
        ${catBadges ? `<div class="lp-ev-pos-row">${catBadges}</div>` : ''}
      </div>
    </a>`;
  }).join('');
  // Client-side city filter over the distinct event cities.
  const cities = Array.from(new Set(evList.map((e) => cityOf(e.location)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));
  const cityFilter = cities.length > 1 ? `<div class="lp-city-filter" role="group" aria-label="${esc(t('land.cityFilter'))}">
    <button type="button" class="lp-city-chip on" data-city="">${esc(t('land.allCities'))}</button>
    ${cities.map((c) => `<button type="button" class="lp-city-chip" data-city="${esc(c.toLowerCase())}">${esc(c)}</button>`).join('')}
  </div>` : '';
  const eventsSection = (evList.length) ? `
  <section style="max-width:1180px;margin:0 auto;padding:60px 28px 8px">
    <h2 style="font:800 clamp(30px,4.5vw,44px)/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 12px;text-align:center">${esc(t('land.eventsTitle'))}</h2>
    <p style="color:var(--lp-tx3);font-size:16px;margin:0 auto 24px;max-width:620px;text-align:center">${esc(t('land.eventsSub'))}</p>
    ${cityFilter}
    <div class="lp-ev-grid">${evCardHtml}</div>
    <script>(function(){var chips=[].slice.call(document.querySelectorAll('.lp-city-chip')),cards=[].slice.call(document.querySelectorAll('.lp-ev-grid .lp-ev-card'));if(!chips.length)return;chips.forEach(function(ch){ch.addEventListener('click',function(){var city=ch.getAttribute('data-city');chips.forEach(function(c){c.classList.toggle('on',c===ch);});cards.forEach(function(cd){cd.style.display=(!city||cd.getAttribute('data-city')===city)?'':'none';});});});})();</script>
  </section>` : '';

  return `<!doctype html><html lang="${L}" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>20FIT Talent</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--red:#E4121F;--ink:#101013;--ok:#178A54;
  --lp-bg:#101013;--lp-bg2:#0b0b0e;--lp-card:#141419;--lp-chip:#1c1c22;
  --lp-line:#2c2c34;--lp-line2:#33333c;
  --lp-tx:#ffffff;--lp-tx2:#b9b8bf;--lp-tx3:#8a8990;--lp-tx4:#66666d;--lp-accent:#ff5b66}
:root[data-theme="light"]{
  --lp-bg:#f4f6f9;--lp-bg2:#e9edf2;--lp-card:#ffffff;--lp-chip:#eef1f5;
  --lp-line:#e3e7ed;--lp-line2:#d7dbe2;
  --lp-tx:#17171d;--lp-tx2:#41454d;--lp-tx3:#63676e;--lp-tx4:#8b8f97;--lp-accent:#d10c17}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--lp-bg);color:var(--lp-tx);line-height:1.5}
a{text-decoration:none}
.lp-logo-box{display:flex;align-items:center;height:96px;flex:0 0 auto}
.lp-logo{display:block;height:96px;width:auto}
.lp-logo-dark{height:72px}
.lp-logo-light{display:none}
:root[data-theme="light"] .lp-logo-dark{display:none}
:root[data-theme="light"] .lp-logo-light{display:block}
.lp-head{max-width:1180px;margin:0 auto;padding:22px 28px 8px;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}
.lp-toggles{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.lp-submit{padding:11px 18px;background:transparent;color:var(--lp-tx);border:1px solid var(--lp-line2);border-radius:10px;font:700 14px/1 Barlow,sans-serif;white-space:nowrap}
.lp-submit:hover{background:var(--lp-chip)}
.theme-toggle{display:inline-flex;gap:4px;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:11px;padding:4px}
.theme-toggle button{padding:8px 13px;border-radius:8px;font:700 18px/1 Barlow,sans-serif;border:0;cursor:pointer;background:transparent;color:var(--lp-tx3);line-height:1}
.theme-toggle button.active{background:var(--red);color:#fff}
@media(max-width:760px){.lp-head{gap:14px}.lp-logo-box{height:76px}.lp-logo{height:76px}.lp-logo-dark{height:56px}.lp-toggles{width:100%;justify-content:flex-start}}
/* Sticky marketplace-style top navbar (sits above the hero so it stays on scroll) */
.lp-nav{position:sticky;top:0;z-index:50;background:var(--lp-card);border-bottom:1px solid var(--lp-line)}
.lp-nav-in{max-width:1180px;margin:0 auto;padding:12px 28px;display:flex;align-items:center;gap:14px}
.lp-nav-logo{display:inline-flex;align-items:center;flex:0 0 auto}
.lp-nav-logo .lp-logo{height:60px}
.lp-tog{margin-left:auto;display:flex;flex:0 0 auto;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:11px;padding:4px;gap:3px}
.lp-tog-b{padding:9px 15px;border-radius:8px;font:700 15px/1 Barlow,sans-serif;color:var(--lp-tx3)}
.lp-tog-b.on{color:#fff;background:var(--red)}
.lp-acct{position:relative;flex:0 0 auto}
.lp-acct>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:var(--red);color:#fff;border-radius:10px;padding:11px 16px;font:700 14px/1 Barlow,sans-serif;box-shadow:0 6px 18px rgba(228,18,31,.3);white-space:nowrap}
.lp-acct>summary::-webkit-details-marker{display:none}
.lp-acct>summary::marker{content:""}
.lp-caret{transition:transform .2s}
.lp-acct[open]>summary .lp-caret{transform:rotate(180deg)}
.lp-acct-menu{position:absolute;right:0;top:calc(100% + 10px);min-width:190px;background:var(--lp-card);border:1px solid var(--lp-line);border-radius:12px;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.14)}
.lp-acct-menu a{display:block;padding:11px 13px;border-radius:8px;font:600 14px/1 Barlow,sans-serif;color:var(--lp-tx)}
.lp-acct-menu a:hover{background:var(--lp-chip)}
@media(max-width:600px){.lp-nav-in{padding:10px 14px;gap:9px}.lp-nav-logo .lp-logo{height:46px}.lp-tog-b{padding:7px 11px;font-size:14px}.lp-acct>summary{padding:10px 13px}.lp-acct>summary span{display:none}}
@media(max-width:380px){.lp-nav-in{padding:9px 11px;gap:7px}.lp-tog-b{padding:6px 9px}}
.hero-stage{position:relative;overflow:hidden;background:var(--lp-bg);min-height:clamp(560px,86vh,900px);display:flex;flex-direction:column;justify-content:center}
.hero-stage>header,.hero-stage>section{position:relative;z-index:2}
/* Optional hero background photos + readability scrim; text goes light over them */
.hero-photos{position:absolute;inset:0;z-index:0;overflow:hidden}
.hero-photos .hp{position:absolute;inset:0;background-size:cover;background-position:center}
.hero-photos.cross .hp{opacity:0;animation:heroCross 16s ease-in-out infinite}
.hero-photos.cross .hp:nth-child(2){animation-delay:8s}
.hero-photos::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(9,9,12,.82) 0%,rgba(9,9,12,.72) 50%,rgba(9,9,12,.62) 100%)}
@keyframes heroCross{0%{opacity:0}4%{opacity:1}46%{opacity:1}50%{opacity:0}100%{opacity:0}}
.hero-stage.has-photos .hero-bg{display:none}
.hero-stage.has-photos{--lp-tx2:#eaecf0;--lp-tx3:#d3d6db}
.hero-stage.has-photos h1{color:#fff}
@media(prefers-reduced-motion:reduce){.hero-photos.cross .hp{animation:none;opacity:0}.hero-photos.cross .hp:first-child{opacity:1}}
.hero-bg{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.hero-bg i{position:absolute;display:block;border-radius:45% 55% 58% 42%;filter:blur(90px);opacity:.5;will-change:transform}
.hero-bg .b1{width:70vw;height:56vw;left:-18%;top:-32%;background:radial-gradient(closest-side,#E4121F,transparent);animation:flow1 48s ease-in-out infinite}
.hero-bg .b2{width:60vw;height:54vw;right:-14%;top:-8%;background:radial-gradient(closest-side,#8f0d15,transparent);animation:flow2 58s ease-in-out infinite}
.hero-bg .b3{width:64vw;height:48vw;left:22%;bottom:-36%;background:radial-gradient(closest-side,#c20e18,transparent);animation:flow3 66s ease-in-out infinite}
.hero-bg .b4{width:24vw;height:24vw;left:52%;top:12%;opacity:.13;background:radial-gradient(closest-side,#fff,transparent);animation:flow2 52s ease-in-out infinite reverse}
.hero-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(130% 100% at 28% 42%,transparent 34%,rgba(9,9,12,.55) 100%)}
:root[data-theme="light"] .hero-bg i{display:none}
:root[data-theme="light"] .hero-bg .b4{opacity:0}
:root[data-theme="light"] .hero-bg::after{background:radial-gradient(130% 100% at 28% 42%,transparent 42%,rgba(244,246,249,.6) 100%)}
@keyframes flow1{0%,100%{transform:translate(0,0) scale(1)}20%{transform:translate(5%,7%) scale(1.06)}40%{transform:translate(11%,4%) scale(1.12)}60%{transform:translate(8%,10%) scale(1.15)}80%{transform:translate(4%,8%) scale(1.06)}}
@keyframes flow2{0%,100%{transform:translate(0,0) scale(1.04)}20%{transform:translate(-6%,5%) scale(1.1)}40%{transform:translate(-10%,11%) scale(1.16)}60%{transform:translate(-7%,16%) scale(1.2)}80%{transform:translate(-9%,7%) scale(1.1)}}
@keyframes flow3{0%,100%{transform:translate(0,0) scale(1)}20%{transform:translate(5%,-5%) scale(1.05)}40%{transform:translate(10%,-3%) scale(1.11)}60%{transform:translate(8%,-8%) scale(1.14)}80%{transform:translate(3%,-6%) scale(1.05)}}
@keyframes riseIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.hero-in{opacity:0;animation:riseIn 1.1s cubic-bezier(.16,.7,.3,1) both}
.hero-in.d1{animation-delay:.1s}
.hero-in.d2{animation-delay:.32s}
.hero-in.d3{animation-delay:.54s}
.accent-shimmer{background:linear-gradient(100deg,#E4121F 0%,#ff7b82 22%,#E4121F 46%,#E4121F 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:shimmer 6.5s linear infinite}
/* Hero headline: "ONE PLATFORM." on line 1, red "ENDLESS EVENT OPPORTUNITIES." on line 2 (one line). */
.hero-title{font-family:'Barlow Condensed',sans-serif;font-weight:800;line-height:.98;text-transform:uppercase;letter-spacing:-.01em;font-size:clamp(42px,calc(6vw - 8px),76px)}
.hero-title .accent-shimmer{display:block}
@media(max-width:860px){.hero-title{font-size:calc(8.2vw - 2px)}}
@keyframes shimmer{to{background-position:-220% 0}}
@media(prefers-reduced-motion:reduce){.hero-bg i{animation:none}.hero-in{animation:none;opacity:1}.accent-shimmer{animation:none;-webkit-text-fill-color:#E4121F;color:#E4121F}}
.stripe{background-image:repeating-linear-gradient(135deg,#eceae5 0 10px,#f4f2ee 10px 20px)}
.resp3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.eco-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.coach-grid{display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
.coach-card{flex:0 1 200px;min-width:148px;background:var(--lp-card);border:1px solid var(--lp-line);border-radius:14px;overflow:hidden}
.coach-photo{aspect-ratio:3/4;background:var(--lp-chip)}
.coach-photo img{width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block}
.coach-body{padding:13px 15px 15px}
.coach-name{font:700 18px/1 'Barlow Condensed',sans-serif;text-transform:uppercase}
.coach-group{font-size:12.5px;color:var(--lp-tx3);margin-top:6px}
.eco-card{background:var(--lp-card);border:1px solid var(--lp-line);border-radius:14px;padding:26px 10px;font:800 18px/1.15 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.01em;color:var(--lp-tx);text-align:center;display:flex;align-items:center;justify-content:center;min-height:92px}
.eco-card b{color:var(--red);margin-left:.32em}
.eco-card-logo{padding:14px 10px}
a.eco-card-logo{text-decoration:none;cursor:pointer;transition:border-color .2s ease,transform .2s ease,box-shadow .2s ease}
a.eco-card-logo:hover{border-color:var(--red);transform:translateY(-4px) scale(1.035);box-shadow:0 12px 28px rgba(228,18,31,.18)}
a.eco-card-logo:active{transform:translateY(-1px) scale(1.01)}
.eco-logo-wrap{display:flex;align-items:center;justify-content:center;height:52px;width:100%}
.eco-logo{max-height:100%;max-width:86%;width:auto;height:auto;display:block;object-fit:contain;transition:opacity .2s ease}
a.eco-card-logo:hover .eco-logo{opacity:.88}
.eco-logo-light{display:none}
:root[data-theme="light"] .eco-logo-dark{display:none}
:root[data-theme="light"] .eco-logo-light{display:block}
.lp-foot{border-top:1px solid var(--lp-line);background:var(--lp-bg);margin-top:8px}
.ft-top{max-width:1180px;margin:0 auto;padding:56px 28px 46px;display:grid;grid-template-columns:2fr 1fr 1fr 1.15fr;gap:30px 26px;align-items:start}
.ft-brand{max-width:430px}
.ft-logo{display:block;margin-top:-14px;margin-bottom:2px}
.ft-logo img{height:42px;width:auto;display:block}
.ft-tag{color:var(--lp-tx3);font-size:14px;line-height:1.6;margin:0 0 20px;text-align:justify}
.ft-social{display:flex;gap:18px}
.ft-social a{color:var(--lp-tx3);display:inline-flex}
.ft-social a:hover{color:var(--red)}
.ft-social svg{width:22px;height:22px;display:block}
.ft-col{display:flex;flex-direction:column;gap:13px;min-width:0}
.ft-h{font:700 12.5px/1 Barlow,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--lp-tx);margin-bottom:4px}
.ft-col a,.ft-col span{color:var(--lp-tx3);font-size:15px;line-height:1.25}
.ft-col a{transition:color .15s ease}
.ft-col a:hover{color:var(--red)}
.ft-bottom{max-width:1180px;margin:0 auto;padding:22px 28px 46px;border-top:1px solid var(--lp-line);color:var(--lp-tx4);font-size:13px;text-align:center}
.ft-bottom a{color:var(--lp-tx3)}
.ft-bottom a:hover{color:var(--red)}
@media(max-width:860px){.ft-top{grid-template-columns:1fr 1fr;gap:34px 24px}.ft-brand{grid-column:1/-1;max-width:none}}
@media(max-width:860px){.resp3{grid-template-columns:1fr 1fr !important}.eco-grid{grid-template-columns:1fr 1fr !important}}
@media(max-width:560px){.resp3{grid-template-columns:1fr !important}}
/* FAQ accordion (shared markup with the auth page via faqSection()) */
.au-faq{max-width:1180px;margin:0 auto;padding:24px 28px 72px}
.au-faq h2{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;font-size:clamp(30px,4.4vw,44px);margin:0 0 8px}
.au-faq-sub{color:var(--lp-tx3);max-width:640px;margin:0 0 26px;font-size:16px}
.au-faq-item{background:var(--lp-card);border:1px solid var(--lp-line);border-radius:14px;margin-bottom:14px;overflow:hidden}
.au-faq-item summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 24px;font:700 16.5px/1.35 Barlow,sans-serif;color:var(--lp-tx)}
.au-faq-item summary::-webkit-details-marker{display:none}
.au-faq-ic{flex:0 0 auto;color:var(--red);font-size:28px;line-height:1;transition:transform .2s ease}
.au-faq-item[open] .au-faq-ic{transform:rotate(45deg)}
.au-faq-a{padding:0 24px 20px;color:var(--lp-tx2);font-size:15px;line-height:1.65}
@media(max-width:560px){.au-faq{padding:16px 18px 56px}.au-faq-item summary{padding:17px 18px;font-size:15.5px}.au-faq-a{padding:0 18px 17px}}
/* Live opportunities grid (events + campaigns) */
.lp-ev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.lp-ev-card{display:block;background:var(--lp-card);border:1px solid var(--lp-line);border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .15s,box-shadow .15s}
.lp-ev-card:hover{transform:translateY(-3px);box-shadow:0 16px 36px rgba(20,20,30,.13)}
.lp-ev-cw{position:relative}
.lp-ev-cover{aspect-ratio:16/10;background-size:cover;background-position:center;background-color:var(--lp-chip)}
.lp-ev-grad{display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;color:#fff}
.lp-ev-word{font:800 clamp(22px,3.2vw,34px)/1.05 'Barlow Condensed',sans-serif;text-transform:uppercase;text-align:center;padding:0 16px;z-index:1;letter-spacing:.01em}
.lp-ev-ico{position:absolute;right:12px;bottom:8px;font-size:34px;opacity:.45}
.lp-ev-badge{position:absolute;top:12px;left:12px;background:rgba(255,255,255,.94);font:700 11.5px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.03em;padding:6px 11px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.12)}
.lp-ev-on{color:#0f9d6a}
.lp-ev-up{color:var(--red)}
.lp-ev-body{padding:14px 16px 16px}
.lp-ev-name{font:800 17px/1.15 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.01em;color:var(--lp-tx);word-break:break-word}
.lp-ev-meta{font-size:12.5px;color:var(--lp-tx3);margin-top:5px}
.lp-ev-open{color:#0f9d6a}
.lp-ev-pos-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.lp-ev-pos{font:700 10.5px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:var(--red);background:rgba(228,18,31,.1);border:1px solid rgba(228,18,31,.22);padding:4px 8px;border-radius:999px}
.lp-city-filter{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 26px}
.lp-city-chip{font:700 13px/1 Barlow,sans-serif;color:var(--lp-tx2);background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:999px;padding:8px 15px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.lp-city-chip:hover{border-color:var(--red)}
.lp-city-chip.on{background:var(--red);border-color:var(--red);color:#fff}
@media(max-width:860px){.lp-ev-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.lp-ev-grid{grid-template-columns:1fr}}
html{scroll-behavior:smooth}
/* Scroll-reveal: sections & cards fade-up as they enter the viewport. Enabled by
   JS (adds .reveal-on + [data-rv]); a no-JS/no-IntersectionObserver visitor and
   anyone with reduced-motion just sees everything, no animation. */
.reveal-on [data-rv]{opacity:0;transform:translateY(26px);transition:opacity .6s cubic-bezier(.16,.84,.44,1),transform .6s cubic-bezier(.16,.84,.44,1)}
.reveal-on [data-rv].rv-in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal-on [data-rv]{opacity:1;transform:none;transition:none}}
#faq{scroll-margin-top:90px}
${CARD_CSS}
/* Account dropdown — logged-in state: initial avatar + name, plus the menu's logout button */
.lp-acct-av{width:24px;height:24px;flex:0 0 auto;border-radius:50%;background:#fff;color:var(--red);font:800 12px/1 Barlow,sans-serif;display:flex;align-items:center;justify-content:center;text-transform:uppercase}
.lp-acct-name{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-acct-menu form{margin:0}
.lp-acct-menu button{display:block;width:100%;text-align:left;padding:11px 13px;margin-top:4px;border:0;border-top:1px solid var(--lp-line);background:none;cursor:pointer;font:600 14px/1 Barlow,sans-serif;color:var(--red);border-radius:0 0 7px 7px}
.lp-acct-menu button:hover{background:var(--lp-chip)}
@media(max-width:600px){.lp-acct-name{display:none}.lp-acct-user>summary .lp-acct-av{display:flex}}
</style>${THEME_HEAD}</head>
<body>
<div id="lp-page" style="min-height:100vh">
  ${navBar}
  <div class="hero-stage${hasPhotos ? ' has-photos' : ''}">
  <div class="hero-bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
  ${heroPhotos}

  <section style="max-width:none;margin:0;padding:clamp(92px,11vw,155px) clamp(28px,4.5vw,88px) clamp(84px,10vw,150px)">
    <div>
      <h1 class="hero-in d1 hero-title" style="margin:0 0 20px">${esc(tr(L, 'hero.headlineLead'))}<span class="accent-shimmer">${esc(tr(L, 'hero.headlineAccent'))}</span></h1>
      <p class="hero-in d2" style="font-size:clamp(19px,2.5vw,30px);line-height:1.5;color:var(--lp-tx2);max-width:640px;margin:0">${esc(tr(L, 'hero.subheadline'))}</p>
    </div>
  </section>
  </div>
  ${eventsSection}
  <section style="background:var(--lp-bg2);padding:56px 0">
    <div style="max-width:1180px;margin:0 auto;padding:0 28px">
      <h2 style="font:800 32px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 34px">${esc(t('whyChoose.title'))}</h2>
      <div class="resp3">${featHtml}</div>
    </div>
  </section>

  <section style="max-width:1180px;margin:0 auto;padding:64px 28px">
    <h2 style="font:800 clamp(30px,4.5vw,44px)/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 12px;text-align:center">${esc(t('coach.title'))}</h2>
    <p style="color:var(--lp-tx3);font-size:16px;margin:0 auto 34px;max-width:640px;text-align:center">${esc(t('coach.sub'))}</p>
    <div class="coach-grid">${coachHtml}</div>
  </section>

  <section style="max-width:1180px;margin:0 auto;padding:64px 28px;text-align:center">
    <h2 style="font:800 clamp(30px,4.5vw,44px)/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 12px">${esc(t('land.ecoTitle'))}</h2>
    <p style="color:var(--lp-tx3);font-size:16px;margin:0 auto 34px;max-width:620px">${esc(t('land.ecoSub'))}</p>
    <div class="eco-grid">${ecoHtml}</div>
  </section>

  <div id="faq">${faqSection(L)}</div>

  <footer class="lp-foot">
    <div class="ft-top">
      <div class="ft-brand">
        <a href="/${q}" class="ft-logo" aria-label="20FIT"><img src="${LOGO_LIGHT}" alt="20FIT"></a>
        <p class="ft-tag">${esc(t('foot.tagline'))}</p>
        <div class="ft-social" role="group" aria-label="Social media">${socialHtml}</div>
      </div>
      <nav class="ft-col" aria-label="${esc(t('foot.eco'))}">
        <div class="ft-h">${esc(t('foot.eco'))}</div>
        ${ecoLinksHtml}
      </nav>
      <nav class="ft-col" aria-label="${esc(t('foot.menu'))}">
        <div class="ft-h">${esc(t('foot.menu'))}</div>
        <a href="/about${q}">${esc(t('nav.about'))}</a>
        <a href="/${q}#faq">FAQ</a>
        <a href="/login${q}">${esc(t('btn.signin'))}</a>
        <a href="/register${q}">${esc(t('auth.account.registerTitle'))}</a>
      </nav>
      <nav class="ft-col" aria-label="${esc(t('foot.contact'))}">
        <div class="ft-h">${esc(t('foot.contact'))}</div>
        <a href="https://www.instagram.com/20fit.id/" target="_blank" rel="noopener">Instagram @20fit.id</a>
      </nav>
    </div>
    <div class="ft-bottom">talent.20fit.id · © 2026 PT Kredo AUM · ${esc(t('land.foot'))} · <a href="/submit${q}">${esc(t('land.submit'))}</a> · <a href="/eo/login">${esc(t('foot.eoLogin'))}</a></div>
  </footer>
</div>
<script>(function(){
  var d=document;
  if(!('IntersectionObserver' in window)||(window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches))return;
  var page=d.getElementById('lp-page');if(!page)return;
  d.documentElement.classList.add('reveal-on');
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){(e.target.__rv||[]).forEach(function(u){u.classList.add('rv-in');});io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px',threshold:0.05});
  function unitsOf(b){
    var grid=b.querySelector('.lp-ev-grid, .resp3, .eco-grid, .coach-grid'),faq=b.querySelector('.au-faq'),u=[],h;
    if(grid){h=b.querySelector('h2');if(h)u.push(h);if(h&&h.nextElementSibling&&h.nextElementSibling.tagName==='P')u.push(h.nextElementSibling);[].push.apply(u,[].slice.call(grid.children));}
    else if(faq){h=faq.querySelector('h2');if(h)u.push(h);var s=faq.querySelector('.au-faq-sub');if(s)u.push(s);[].push.apply(u,[].slice.call(faq.querySelectorAll('.au-faq-item')));}
    else u=[b];
    return u;
  }
  [].forEach.call(page.children,function(b){
    if(b.matches('.lp-nav, .hero-stage'))return;
    var u=unitsOf(b);
    u.forEach(function(el,i){if(el){el.setAttribute('data-rv','');el.style.transitionDelay=Math.min(i*70,520)+'ms';}});
    b.__rv=u;io.observe(b);
  });
})();</script>
</body></html>`;
}

/** Shared sticky top navbar for the public landing + About pages. */
function landingNav(lang, active, account) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const q = `?lang=${L}`;
  const langBtn = (code, label) => `<a href="/?lang=${code}" class="lp-tog-b${code === L ? ' on' : ''}">${label}</a>`;
  const toggle = `<div class="lp-tog">${langBtn('id', 'ID')}${langBtn('en', 'EN')}</div>`;
  const nIc = (p) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const caret = '<svg class="lp-caret" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  // Account control adapts to auth state. Logged-out visitors get Sign in /
  // Create Account; a logged-in talent gets their name + initial avatar, with
  // View Profile / Apply Event / Log out. (Talents have no photo field, so the
  // avatar is always the name initial.) Rendered server-side, so it reflects the
  // current session on every page load — login/logout redirect and re-render it.
  let acct;
  if (account && account.name) {
    const home = account.type === 'main_power' ? '/main-power' : '/kol';
    const initial = esc((String(account.name).trim().charAt(0) || '?').toUpperCase());
    acct = `<details class="lp-acct lp-acct-user">
      <summary><span class="lp-acct-av" aria-hidden="true">${initial}</span><span class="lp-acct-name">${esc(account.name)}</span>${caret}</summary>
      <div class="lp-acct-menu">
        <a href="${home}${q}">${esc(t('nav.viewProfile'))}</a>
        <a href="/events${q}">${esc(t('nav.applyEvent'))}</a>
        <form method="post" action="/kol/logout"><button type="submit" class="lp-acct-out">${esc(t('nav.logout'))}</button></form>
      </div>
    </details>`;
  } else {
    acct = `<details class="lp-acct">
      <summary>${nIc('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')}<span>${esc(t('nav.account'))}</span>${caret}</summary>
      <div class="lp-acct-menu">
        <a href="/login${q}">${esc(t('nav.signin'))}</a>
        <a href="/register${q}">${esc(t('nav.signup'))}</a>
      </div>
    </details>`;
  }
  return `<header class="lp-nav"><div class="lp-nav-in">
    <a href="/${q}" class="lp-nav-logo" aria-label="20FIT">
      <img src="${LOGO_DARK}" alt="20FIT" class="lp-logo lp-logo-dark">
      <img src="${LOGO_LIGHT}" alt="20FIT" class="lp-logo lp-logo-light">
    </a>
    ${toggle}
    ${acct}
  </div></header>`;
}

/** Public "About 20FIT" story page. Bilingual content lives inline (id/en). */
// Bilingual "About 20FIT" story content, shared by the /about page and the
// About section at the bottom of the landing page.
function aboutContent(lang) {
  const L = normLang(lang);
  const CONTENT = {
    en: {
      lede: 'From a 20-minute EMS workout to an integrated life system. This is the story of how we redefined what fitness can be.',
      sections: [
        { eyebrow: 'OUR ORIGIN', h: 'We Started With a Simple Question', p: "What if getting fit didn't have to take hours? In 2014, 20FIT was born from a simple idea: that even the busiest people deserve access to effective fitness. We introduced Indonesia's first micro-gym concept powered by EMS (Electro Muscle Stimulation) — a 20-minute workout designed to deliver real results. It was efficient. It was different. And it worked." },
        { eyebrow: 'THE INSIGHT', h: 'Fitness Was Never the Real Problem', p: "People don't struggle because they don't exercise. They struggle because they don't understand their body, they don't have the right guidance, and they don't have a system they can sustain. And that insight changed everything.", list: ["They don't understand their body", "They don't have the right guidance", "They don't have a system they can sustain"] },
        { eyebrow: 'THE EVOLUTION', h: 'From Gym to System', p: "20FIT began to evolve. From a single-service studio into something much more powerful: a structured system for improving how people live. We expanded beyond workouts — into training, coaching, and community. But we knew we weren't done." },
        { eyebrow: 'THE TURNING POINT', h: 'Gym-as-a-Clinic', p: 'We saw a gap in the industry. Even active individuals get injured, plateau, and train without direction. So we redefined what a fitness company could be. We built Gym-as-a-Clinic — a model that combines fitness training, medical consultation, recovery & rehabilitation, and performance optimization. Because real progress starts with understanding your body.', list: ['Fitness training', 'Medical consultation', 'Recovery & rehabilitation', 'Performance optimization'] },
        { eyebrow: 'THE ECOSYSTEM', h: 'Building an Ecosystem', p: 'Today, 20FIT is more than a gym. We are building an integrated wellness ecosystem where each part strengthens the other. Together, they create something bigger: a complete system for living better.', list: ['20FIT Gym & Sports Clinic — where training meets medical insight', '20FIT Events — where movement becomes culture', '20FIT Shop — where performance tools become accessible', '20FIT Media — where knowledge drives better decisions'] },
        { eyebrow: 'TECHNOLOGY', h: 'Powered by Technology', p: "The future of health is personal. That's why we are building a platform that connects your workouts, your nutrition, your medical data, and your lifestyle habits. Using AI and data, we help you understand your body, make better decisions, and stay consistent — not just for weeks, but for life." },
        { eyebrow: 'WHAT WE BELIEVE', h: 'Our Core Values', list: ['Health should be accessible', 'Progress should be measurable', 'Fitness should be guided, not guessed', 'Consistency beats intensity', 'Everyone deserves the opportunity to live stronger, healthier, and longer'] },
        { eyebrow: 'THE FUTURE', h: "Where We're Going", p: '20FIT is building something beyond fitness. We are building a life system — where fitness, health, and performance come together. From 20-minute workouts to a fully integrated platform for human optimization.' },
      ],
    },
    id: {
      lede: 'Dari latihan EMS 20 menit menjadi sistem hidup yang terintegrasi. Ini kisah bagaimana kami mendefinisikan ulang arti kebugaran.',
      sections: [
        { eyebrow: 'AWAL MULA', h: 'Kami Mulai dari Satu Pertanyaan Sederhana', p: 'Bagaimana kalau menjadi bugar tidak harus makan waktu berjam-jam? Pada 2014, 20FIT lahir dari ide sederhana: bahwa orang tersibuk sekalipun berhak atas kebugaran yang efektif. Kami memperkenalkan konsep micro-gym pertama di Indonesia bertenaga EMS (Electro Muscle Stimulation) — latihan 20 menit yang dirancang memberi hasil nyata. Efisien. Berbeda. Dan terbukti berhasil.' },
        { eyebrow: 'INSIGHT-NYA', h: 'Kebugaran Tidak Pernah Jadi Masalah Sebenarnya', p: 'Orang bukan gagal karena tidak berolahraga. Mereka kesulitan karena tidak memahami tubuhnya, tidak punya panduan yang tepat, dan tidak punya sistem yang bisa dijalankan konsisten. Dan insight itu mengubah segalanya.', list: ['Tidak memahami tubuhnya sendiri', 'Tidak punya panduan yang tepat', 'Tidak punya sistem yang bisa dijalankan konsisten'] },
        { eyebrow: 'EVOLUSI', h: 'Dari Gym Menjadi Sistem', p: '20FIT mulai berkembang. Dari studio satu layanan menjadi sesuatu yang jauh lebih kuat: sistem terstruktur untuk memperbaiki cara orang hidup. Kami berkembang melampaui latihan — ke pelatihan, coaching, dan komunitas. Tapi kami tahu perjalanan belum selesai.' },
        { eyebrow: 'TITIK BALIK', h: 'Gym-as-a-Clinic', p: 'Kami melihat celah di industri ini. Bahkan orang yang aktif pun bisa cedera, stagnan, dan berlatih tanpa arah. Maka kami mendefinisikan ulang apa itu perusahaan kebugaran. Kami membangun Gym-as-a-Clinic — model yang menggabungkan latihan kebugaran, konsultasi medis, pemulihan & rehabilitasi, serta optimasi performa. Karena kemajuan nyata dimulai dari memahami tubuhmu.', list: ['Latihan kebugaran', 'Konsultasi medis', 'Pemulihan & rehabilitasi', 'Optimasi performa'] },
        { eyebrow: 'EKOSISTEM', h: 'Membangun Ekosistem', p: 'Hari ini, 20FIT lebih dari sekadar gym. Kami membangun ekosistem wellness terintegrasi di mana setiap bagian saling menguatkan. Bersama, mereka menciptakan sesuatu yang lebih besar: sistem lengkap untuk hidup lebih baik.', list: ['20FIT Gym & Sports Clinic — tempat latihan bertemu wawasan medis', '20FIT Events — tempat gerak menjadi budaya', '20FIT Shop — tempat perlengkapan performa mudah dijangkau', '20FIT Media — tempat pengetahuan mendorong keputusan lebih baik'] },
        { eyebrow: 'TEKNOLOGI', h: 'Didukung Teknologi', p: 'Masa depan kesehatan itu personal. Karena itu kami membangun platform yang menghubungkan latihan, nutrisi, data medis, dan kebiasaan gaya hidupmu. Dengan AI dan data, kami membantumu memahami tubuh, mengambil keputusan lebih baik, dan tetap konsisten — bukan cuma beberapa minggu, tapi seumur hidup.' },
        { eyebrow: 'YANG KAMI PERCAYA', h: 'Nilai Inti Kami', list: ['Kesehatan harus mudah diakses', 'Kemajuan harus bisa diukur', 'Kebugaran harus dipandu, bukan ditebak', 'Konsistensi mengalahkan intensitas', 'Semua orang berhak hidup lebih kuat, lebih sehat, dan lebih panjang'] },
        { eyebrow: 'MASA DEPAN', h: 'Ke Mana Kami Melangkah', p: '20FIT sedang membangun sesuatu yang melampaui kebugaran. Kami membangun sistem hidup — tempat kebugaran, kesehatan, dan performa menyatu. Dari latihan 20 menit menuju platform terintegrasi penuh untuk optimasi manusia.' },
      ],
    },
  };
  const C = CONTENT[L] || CONTENT.en;
  const sectionsHtml = C.sections.map((s) => `
      <section class="ab-sec">
        <div class="ab-eyebrow">${esc(s.eyebrow)}</div>
        <h2 class="ab-h">${esc(s.h)}</h2>
        ${s.p ? `<p class="ab-p">${esc(s.p)}</p>` : ''}
        ${s.list ? `<ul class="ab-list">${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : ''}
      </section>`).join('');
  return { lede: C.lede, sectionsHtml };
}

function aboutPage(lang) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const q = `?lang=${L}`;
  const { lede, sectionsHtml } = aboutContent(L);
  return `<!doctype html><html lang="${L}" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t('nav.about'))} · 20FIT</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--red:#E4121F;--ink:#101013;--ok:#178A54;--lp-bg:#f4f6f9;--lp-bg2:#e9edf2;--lp-card:#ffffff;--lp-chip:#eef1f5;--lp-line:#e3e7ed;--lp-line2:#d7dbe2;--lp-tx:#17171d;--lp-tx2:#41454d;--lp-tx3:#63676e;--lp-tx4:#8b8f97}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--lp-bg);color:var(--lp-tx);line-height:1.5}
a{text-decoration:none}
.lp-nav{position:sticky;top:0;z-index:50;background:var(--lp-card);border-bottom:1px solid var(--lp-line)}
.lp-nav-in{max-width:1180px;margin:0 auto;padding:12px 28px;display:flex;align-items:center;gap:14px}
.lp-nav-logo{display:inline-flex;align-items:center;flex:0 0 auto}
.lp-logo{display:block;width:auto}
.lp-nav-logo .lp-logo{height:60px}
.lp-logo-light{display:block}.lp-logo-dark{display:none}
.lp-tog{margin-left:auto;display:flex;flex:0 0 auto;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:11px;padding:4px;gap:3px}
.lp-tog-b{padding:9px 15px;border-radius:8px;font:700 15px/1 Barlow,sans-serif;color:var(--lp-tx3)}
.lp-tog-b.on{color:#fff;background:var(--red)}
.lp-acct{position:relative;flex:0 0 auto}
.lp-acct>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:var(--red);color:#fff;border-radius:10px;padding:11px 16px;font:700 14px/1 Barlow,sans-serif;box-shadow:0 6px 18px rgba(228,18,31,.3);white-space:nowrap}
.lp-acct>summary::-webkit-details-marker{display:none}
.lp-acct>summary::marker{content:""}
.lp-caret{transition:transform .2s}
.lp-acct[open]>summary .lp-caret{transform:rotate(180deg)}
.lp-acct-menu{position:absolute;right:0;top:calc(100% + 10px);min-width:190px;background:var(--lp-card);border:1px solid var(--lp-line);border-radius:12px;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.14)}
.lp-acct-menu a{display:block;padding:11px 13px;border-radius:8px;font:600 14px/1 Barlow,sans-serif;color:var(--lp-tx)}
.lp-acct-menu a:hover{background:var(--lp-chip)}
@media(max-width:600px){.lp-nav-in{padding:10px 14px;gap:9px}.lp-nav-logo .lp-logo{height:46px}.lp-tog-b{padding:7px 11px;font-size:14px}.lp-acct>summary{padding:10px 13px}.lp-acct>summary span{display:none}}
@media(max-width:380px){.lp-nav-in{padding:9px 11px;gap:7px}.lp-tog-b{padding:6px 9px}}
.ab-hero{background:var(--ink);color:#fff;padding:66px 28px 58px}
.ab-hero-in{max-width:820px;margin:0 auto}
.ab-kick{color:#ff6b74;font:700 13px/1 Barlow,sans-serif;letter-spacing:.22em;text-transform:uppercase;margin-bottom:14px}
.ab-title{font:800 clamp(52px,10vw,104px)/.88 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin-bottom:20px}
.ab-title span{color:var(--red)}
.ab-lede{font-size:19px;line-height:1.6;color:#c9cace;max-width:640px}
.ab-body{max-width:820px;margin:0 auto;padding:6px 28px 8px}
.ab-sec{padding:40px 0;border-bottom:1px solid var(--lp-line)}
.ab-sec:last-child{border-bottom:0}
.ab-eyebrow{color:var(--red);font:700 12.5px/1 Barlow,sans-serif;letter-spacing:.2em;text-transform:uppercase;margin-bottom:12px}
.ab-h{font:800 clamp(26px,4.2vw,38px)/1.04 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin-bottom:16px}
.ab-p{font-size:17px;line-height:1.7;color:var(--lp-tx2);max-width:660px}
.ab-list{list-style:none;margin:18px 0 0;display:flex;flex-direction:column;gap:11px;max-width:660px}
.ab-list li{position:relative;padding-left:26px;font-size:16px;line-height:1.55}
.ab-list li::before{content:"";position:absolute;left:2px;top:7px;width:9px;height:9px;border-radius:3px;background:var(--red)}
.ab-cta{padding:48px 28px 64px;text-align:center;background:var(--lp-bg2)}
.ab-cta a{display:inline-block;padding:16px 32px;background:var(--red);color:#fff;border-radius:10px;font:700 16px/1 Barlow,sans-serif;box-shadow:0 8px 24px rgba(228,18,31,.35)}
.ab-foot{border-top:1px solid var(--lp-line);padding:26px 28px;text-align:center;color:var(--lp-tx4);font-size:13px}
.ab-foot a{color:var(--lp-tx3)}
</style></head>
<body>
${landingNav(lang, 'about')}
<section class="ab-hero"><div class="ab-hero-in">
  <div class="ab-kick">${esc(t('nav.about'))}</div>
  <h1 class="ab-title">20<span>FIT</span></h1>
  <p class="ab-lede">${esc(lede)}</p>
</div></section>
<div class="ab-body">${sectionsHtml}</div>
<section class="ab-cta"><a href="/register${q}">${esc(t('land.join'))}</a></section>
<footer class="ab-foot">talent.20fit.id · © 2026 PT Kredo AUM · <a href="/${q}">${esc(t('nav.home'))}</a> · <a href="/eo/login">Login EO</a></footer>
</body></html>`;
}

/** Super-admin uploader for the landing hero background photos (1-2, alternating). */
function adminLanding({ staff, lang, urls, saved }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const u = urls || [];
  const slot = (url, label) => `<div class="lbg-card">
        <div class="lbg-cap">${esc(label)}</div>
        <div class="lbg-thumb">${url ? `<img src="${esc(url)}" alt="">` : `<span class="lbg-empty">${esc(t('landing.none'))}</span>`}</div>
      </div>`;
  const body = `<div class="lbg-wrap">
    <h1 class="lbg-h1">${esc(t('landing.title'))}</h1>
    <p class="lbg-intro">${esc(t('landing.intro'))}</p>
    ${saved ? `<div class="lbg-ok">✓ ${esc(t('landing.saved'))}</div>` : ''}
    <div class="lbg-grid">${slot(u[0], t('landing.photo1'))}${slot(u[1], t('landing.photo2'))}</div>
    <form id="lbgForm" class="lbg-form" method="post" action="/admin/landing" enctype="multipart/form-data">
      <label class="lbg-file"><span>${esc(t('landing.photo1'))}</span><input id="lbg1" type="file" name="bg1" accept="image/*"></label>
      <label class="lbg-file"><span>${esc(t('landing.photo2'))}</span><input id="lbg2" type="file" name="bg2" accept="image/*"></label>
      <p class="lbg-hint">${esc(t('landing.hint'))}</p>
      <button id="lbgBtn" type="submit" class="btn">${esc(t('landing.save'))}</button>
    </form>
  </div>
  <style>
    .lbg-wrap{max-width:760px;margin:0 auto}
    .lbg-h1{font-size:24px;font-weight:800;margin:0 0 6px}
    .lbg-intro{color:#5b6069;font-size:14px;line-height:1.55;margin:0 0 16px}
    .lbg-ok{background:#e7f6ee;border:1px solid #b6e2c9;color:#137a49;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:16px}
    .lbg-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
    .lbg-card{border:1px solid #e3e7ed;border-radius:12px;overflow:hidden;background:#fff}
    .lbg-cap{padding:9px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #eef1f5}
    .lbg-thumb{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:#f1f3f6}
    .lbg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .lbg-empty{color:#9aa0a8;font-size:13px}
    .lbg-form{border:1px solid #e3e7ed;border-radius:14px;background:#fff;padding:20px}
    .lbg-file{display:block;margin-bottom:16px}
    .lbg-file span{display:block;font-weight:700;font-size:13px;margin-bottom:6px}
    .lbg-file input{width:100%;font-size:14px}
    .lbg-hint{color:#8b8f97;font-size:12.5px;margin:0 0 16px}
    @media(max-width:560px){.lbg-grid{grid-template-columns:1fr}}
  </style>
  <script>
  (function(){
    var form=document.getElementById('lbgForm'), btn=document.getElementById('lbgBtn');
    var save=${JSON.stringify(t('landing.save'))}, up=${JSON.stringify(t('landing.uploading'))}, pickOne=${JSON.stringify(t('landing.pickOne'))}, failed=${JSON.stringify(t('landing.failed'))};
    function compress(file){
      return createImageBitmap(file,{imageOrientation:'from-image'}).then(function(img){
        var maxW=1920, scale=Math.min(1, maxW/img.width);
        var w=Math.round(img.width*scale), h=Math.round(img.height*scale);
        var c=document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        return new Promise(function(res){ c.toBlob(function(b){res(b);}, 'image/jpeg', 0.82); });
      });
    }
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var f1=document.getElementById('lbg1').files[0], f2=document.getElementById('lbg2').files[0];
      if(!f1 && !f2){ alert(pickOne); return; }
      btn.disabled=true; btn.textContent=up;
      var fd=new FormData(), tasks=[];
      if(f1) tasks.push(compress(f1).then(function(b){ fd.append('bg1', b, 'bg-1.jpg'); }));
      if(f2) tasks.push(compress(f2).then(function(b){ fd.append('bg2', b, 'bg-2.jpg'); }));
      Promise.all(tasks).then(function(){ return fetch('/admin/landing', { method:'POST', body:fd }); })
        .then(function(r){ if(r.ok){ window.location.href='/admin/landing?saved=1'; } else { throw new Error('bad'); } })
        .catch(function(){ alert(failed); btn.disabled=false; btn.textContent=save; });
    });
  })();
  </script>`;
  return appLayout({ title: t('landing.title'), body, role: staff.role, active: 'landing', user: staff.name, lang });
}

/** Talent-type picker shown for sign up (mode='register') and log in (mode='login'). */
function talentPicker(mode, lang) {
  const L = (lang === 'en') ? 'en' : 'id';
  const T = {
    id: { reg: 'Daftar sebagai', log: 'Masuk sebagai', regSub: 'Pilih tipe talent kamu untuk membuat akun.', logSub: 'Pilih tipe talent kamu untuk masuk.', soon: 'Segera hadir', go: mode === 'register' ? 'Daftar' : 'Masuk', back: '← Kembali', adminLink: 'Masuk sebagai Admin / EO', adminNote: 'Untuk staf 20FIT & Event Organizer' },
    en: { reg: 'Sign up as', log: 'Log in as', regSub: 'Choose your talent type to create an account.', logSub: 'Choose your talent type to sign in.', soon: 'Coming soon', go: mode === 'register' ? 'Sign up' : 'Log in', back: '← Back', adminLink: 'Log in as Admin / EO', adminNote: 'For 20FIT staff & Event Organizers' },
  }[L];
  const cats = [
    { type: 'kol', tag: 'KOL', name: 'KOL', id: 'Konten & endorsement campaign.', en: 'Content & campaign endorsement.', active: true },
    { type: 'main_power', tag: 'MP', name: 'Man Power', id: 'Judges, Marshal, Drop Bag, Registrasi — apply sendiri ke event sesuai jobdesk.', en: 'Judges, Marshal, Drop Bag, Registration — apply to events yourself per jobdesk.', active: true },
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
  <div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--line);text-align:center">
    <a href="/admin/login" class="btn btn-ghost">🔑 ${esc(T.adminLink)} →</a>
    <div class="muted" style="font-size:13px;margin-top:8px">${esc(T.adminNote)}</div>
  </div>
</div>`;
  return layout({ title: `${title} — 20FIT Talent`, body, brand: 'TALENT', home: '/' + q, hideBrand: true });
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

const TALENT_LABEL = { kol: 'KOL', main_power: 'Man Power', fotografer: 'Fotografer' };
// The 38 provinces of Indonesia (incl. the four newest Papua provinces).
const PROVINCES = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Jambi', 'Sumatera Selatan',
  'Bengkulu', 'Lampung', 'Kepulauan Bangka Belitung', 'Kepulauan Riau',
  'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur', 'Banten',
  'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Sulawesi Tengah', 'Sulawesi Selatan', 'Sulawesi Tenggara', 'Gorontalo', 'Sulawesi Barat',
  'Maluku', 'Maluku Utara',
  'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya',
];
// Shared required province <select id="city" name="city"> — used by the talent
// profile and both EO forms so the option list stays in one place.
function provinceSelect(selected, lang) {
  const L = normLang(lang);
  const opts = PROVINCES.slice().sort((a, b) => a.localeCompare(b, 'id'));
  return `<select id="province" name="province" required>
    <option value="" disabled${selected ? '' : ' selected'}>${tr(L, 'dd.provincePick')}</option>
    ${opts.map((pr) => `<option value="${esc(pr)}"${selected === pr ? ' selected' : ''}>${esc(pr)}</option>`).join('')}
  </select>`;
}
// Free-text city/regency input paired with the province select above it.
function citySelect(value, lang) {
  const L = normLang(lang);
  return `<input type="text" id="city" name="city" required maxlength="80" placeholder="${esc(tr(L, 'dd.cityPh'))}" value="${esc(value || '')}">`;
}
function talentLabel(lang, type) { return tr(lang, 'talent.' + type, {}) !== 'talent.' + type ? tr(lang, 'talent.' + type) : (TALENT_LABEL[type] || type || ''); }
function talentPath(type) { return type.replace(/_/g, '-'); }

/** EN/ID language switch — links hit /lang/:code (sets cookie, redirects back). */
function langToggle(lang) {
  const L = normLang(lang);
  const item = (code, label) => `<a href="/lang/${code}" style="padding:5px 11px;border-radius:7px;font-weight:700;font-size:12px;text-decoration:none;${code === L ? 'background:var(--red);color:#fff' : 'color:var(--muted)'}">${label}</a>`;
  return `<div style="display:inline-flex;gap:3px;background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:3px">${item('id', 'ID')}${item('en', 'EN')}</div>`;
}

/** onsubmit="confirm(...)" attribute for delete forms (JS-string safe). */
function jsConfirm(msg) {
  const s = String(msg).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\s+/g, ' ');
  return `onsubmit="return confirm('${s}')"`;
}

// Each metric -> its per-day threshold setting keys + safe defaults.
const METRIC_TH = {
  views: { g: 'vpd_green', y: 'vpd_yellow', dg: 3000, dy: 10000 },
  likes: { g: 'lpd_green', y: 'lpd_yellow', dg: 300, dy: 1000 },
  comments: { g: 'cpd_green', y: 'cpd_yellow', dg: 50, dy: 200 },
  saves: { g: 'spd_green', y: 'spd_yellow', dg: 50, dy: 200 },
  shares: { g: 'shpd_green', y: 'shpd_yellow', dg: 30, dy: 100 },
};
const CLS_RANK = { green: 0, yellow: 1, red: 2 };
function slaColor(cls) { return cls === 'green' ? '#3ad29f' : cls === 'yellow' ? '#f0b23a' : cls === 'red' ? '#ff5b66' : ''; }

/** Days a post was live (posted -> submitted), min 1; null if no posting time. */
function daysLive(postedAt, submittedAt) {
  if (!postedAt) return null;
  return Math.max(1, (new Date(submittedAt).getTime() - new Date(postedAt).getTime()) / 86400000);
}

/** Reasonableness class for one metric value over `days`, vs its thresholds. */
function metricClass(metric, value, days, settings) {
  const th = METRIC_TH[metric];
  const v = Number(value);
  if (!th || !days || !isFinite(v) || v <= 0) return null;
  const perDay = v / days;
  const g = Number(settings && settings[th.g]); const y = Number(settings && settings[th.y]);
  const green = isFinite(g) ? g : th.dg; const yellow = isFinite(y) ? y : th.dy;
  return perDay <= green ? 'green' : (perDay <= Math.max(green, yellow) ? 'yellow' : 'red');
}

/**
 * Overall reasonableness badge across ALL metrics: is the engagement plausible
 * for how long the post has been live? The worst metric decides the color and
 * is named in the badge. gray = can't assess (no posting time / no numbers).
 */
function plausibilityBadge(postedAt, submittedAt, extracted, settings, lang) {
  const days = daysLive(postedAt, submittedAt);
  const x = extracted || {};
  let worst = null; let worstMetric = null;
  for (const k of ['views', 'likes', 'comments', 'saves', 'shares']) {
    const cls = metricClass(k, x[k], days, settings);
    if (cls && (worst === null || CLS_RANK[cls] > CLS_RANK[worst])) { worst = cls; worstMetric = k; }
  }
  if (!worst) return `<span class="sla sla-gray" title="${esc(tr(lang, 'time.unknown'))}">● <span class="muted">—</span></span>`;
  const label = worst === 'green' ? 'time.onTime' : worst === 'yellow' ? 'time.near' : 'time.late';
  const suffix = worst === 'green' ? '' : ` <span class="muted">(${tr(lang, 'stats.' + worstMetric)})</span>`;
  return `<span class="sla sla-${worst}">● ${tr(lang, label)}${suffix}</span>`;
}

/** Total engagement of one extracted object: likes + comments + shares + saves. */
function engagementOf(x) {
  x = x || {};
  return (Number(x.likes) || 0) + (Number(x.comments) || 0) + (Number(x.shares) || 0) + (Number(x.saves) || 0);
}

/** Worst reasonableness class of a single proof (green/yellow/red) or null if unassessable. */
function proofQualityClass(p, settings) {
  const days = daysLive(p.posted_at, p.created_at);
  const x = p.extracted || {};
  let worst = null;
  for (const k of ['views', 'likes', 'comments', 'saves', 'shares']) {
    const cls = metricClass(k, x[k], days, settings);
    if (cls && (worst === null || CLS_RANK[cls] > CLS_RANK[worst])) worst = cls;
  }
  return worst;
}

/**
 * KOL eligibility score (0-100) from their proofs, using configurable settings.
 * Blends performance (views & engagement vs target), quality (the reasonableness
 * colour), and consistency (number of campaigns). score=null when no usable data.
 */
function kolScore(proofs, settings) {
  proofs = (proofs || []).filter((p) => p && p.extracted && (p.status === 'extracted' || p.status === 'verified'));
  const s = settings || {};
  const tViews = Number(s.score_target_views) > 0 ? Number(s.score_target_views) : 5000;
  const tEng = Number(s.score_target_eng) > 0 ? Number(s.score_target_eng) : 500;
  const minCamp = Number(s.score_min_campaigns) > 0 ? Number(s.score_min_campaigns) : 3;
  const elig = Number.isFinite(Number(s.score_eligible)) ? Number(s.score_eligible) : 70;
  const cons = Number.isFinite(Number(s.score_consider)) ? Number(s.score_consider) : 45;
  if (!proofs.length) return { score: null, label: 'score.none', cls: 'gray', posts: 0, campaigns: 0, performance: 0, quality: 0, consistency: 0 };

  let sumViews = 0; let sumEng = 0; let qSum = 0; let qN = 0;
  const events = new Set();
  proofs.forEach((p) => {
    const x = p.extracted || {};
    sumViews += Number(x.views) || 0;
    sumEng += engagementOf(x);
    events.add(p.event_id || ('p' + p.id));
    const cls = proofQualityClass(p, settings);
    if (cls) { qSum += cls === 'green' ? 1 : cls === 'yellow' ? 0.6 : 0.2; qN += 1; }
  });
  const n = proofs.length;
  const perf = (Math.min(1, (sumViews / n) / tViews) + Math.min(1, (sumEng / n) / tEng)) / 2 * 100;
  const quality = qN ? (qSum / qN * 100) : 60;
  const campaigns = events.size;
  const consistency = Math.min(1, campaigns / minCamp) * 100;
  const score = Math.round(0.5 * perf + 0.3 * quality + 0.2 * consistency);
  const label = score >= elig ? 'score.good' : score >= cons ? 'score.mid' : 'score.bad';
  const cls = score >= elig ? 'green' : score >= cons ? 'yellow' : 'red';
  return { score, label, cls, posts: n, campaigns, performance: Math.round(perf), quality: Math.round(quality), consistency: Math.round(consistency) };
}

/** Colored eligibility badge (score + label). */
function scoreBadge(sc, lang) {
  const L = normLang(lang);
  if (!sc || sc.score === null) return `<span class="sla sla-gray" title="${esc(tr(L, 'score.none'))}">● <span class="muted">—</span></span>`;
  return `<span class="sla sla-${sc.cls}">● ${sc.score} · ${esc(tr(L, sc.label))}</span>`;
}

function authShell(type, title, sub, formHtml, footHtml, errors, lang, brandOverride) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    ${toggles(L)}
  </div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(sub)}</p>
  ${errorBanner}
  <div class="card">${formHtml}</div>
  <p style="text-align:center;color:var(--muted);font-size:14px;margin-top:18px">${footHtml}</p>
</div>`;
  const brand = brandOverride || talentLabel(L, type) || 'Talent';
  const titleSuffix = brandOverride ? '20FIT' : `20FIT ${talentLabel(L, type)}`;
  return layout({ title: `${title} — ${titleSuffix}`, body, brand, home: '/?lang=' + L, lang: L });
}

/**
 * Reusable FAQ accordion (used on the auth page and the landing page). Items are
 * data-driven: add faq.q<N> / faq.a<N> to the i18n files and they appear
 * automatically. `name="faq"` makes it an exclusive (single-open) accordion.
 * Styling lives in each host page's stylesheet under the `.au-faq*` classes.
 */
function faqSection(lang) {
  const L = normLang(lang);
  let items = '';
  for (let n = 1; n <= 50; n++) {
    const q = tr(L, 'faq.q' + n);
    if (q === 'faq.q' + n) break; // stop at the first undefined question
    items += `<details class="au-faq-item" name="faq"><summary>${esc(q)}<span class="au-faq-ic" aria-hidden="true">+</span></summary><div class="au-faq-a">${esc(tr(L, 'faq.a' + n))}</div></details>`;
  }
  return `<section class="au-faq"><h2>FAQ</h2><p class="au-faq-sub">${esc(tr(L, 'faq.sub'))}</p>${items}</section>`;
}

/**
 * Unified talent auth page: a two-column marketing + tabbed (Sign in / Create
 * account) form, matching the 20FIT app style. Both /register and /login render
 * this; `mode` picks the active tab and which panel a validation error lands on.
 */
function talentAuthPage({ mode, lang, errors, values, next } = {}) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const v = values || {};
  // Carry the post-auth redirect target (?next=/event/…) through both forms so a
  // visitor who clicked an event while logged out lands back on it after auth.
  const nextInput = next ? `<input type="hidden" name="next" value="${esc(next)}">` : '';
  const isLogin = mode === 'login';
  const basePath = isLogin ? '/login' : '/register';
  const langBtn = (code, label) => `<a href="${basePath}?lang=${code}" class="lp-tog-b${code === L ? ' on' : ''}">${label}</a>`;
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const errBanner = (errors && errors.length)
    ? `<div class="au-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const forgotHref = `/kol/forgot-password?lang=${L}`;

  const signup = `<form class="au-panel${isLogin ? '' : ' on'}" data-panel="signup" method="post" action="/register">${nextInput}
    <div class="au-f"><label for="su-name">${t('common.fullname')}</label>
      <input class="au-in" type="text" id="su-name" name="name" required maxlength="120" autocomplete="name" placeholder="${esc(t('authp.namePh'))}" value="${esc(v.name || '')}"></div>
    <div class="au-f"><label for="su-email">${t('common.email')}</label>
      <input class="au-in" type="email" id="su-email" name="login" required autocomplete="email" placeholder="${esc(t('authp.emailPh'))}" value="${esc(v.login || '')}"></div>
    <div class="au-f"><label for="su-phone">${t('dd.phone')}</label>
      <input class="au-in" type="tel" id="su-phone" name="phone" required maxlength="20" autocomplete="tel" placeholder="${esc(t('authp.phonePh'))}" value="${esc(v.phone || '')}"></div>
    <div class="au-f"><label for="su-pass">${t('common.password')}</label>
      <div class="au-pass"><input class="au-in" type="password" id="su-pass" name="password" required minlength="6" autocomplete="new-password" placeholder="••••••••">
        <button type="button" class="au-eye" data-eye="su-pass" aria-label="show/hide password">${EYE}</button></div>
      <div class="au-hint">${t('hint.min6')}</div></div>
    <button type="submit" class="au-submit">${t('auth.account.registerTitle')}</button>
  </form>`;

  const signin = `<form class="au-panel${isLogin ? ' on' : ''}" data-panel="signin" method="post" action="/login">${nextInput}
    <div class="au-f"><label for="si-email">${t('common.email')}</label>
      <input class="au-in" type="email" id="si-email" name="login" required autocomplete="username" placeholder="${esc(t('authp.emailPh'))}" value="${esc(isLogin ? (v.login || '') : '')}"></div>
    <div class="au-f"><label for="si-pass">${t('common.password')}</label>
      <div class="au-pass"><input class="au-in" type="password" id="si-pass" name="password" required autocomplete="current-password" placeholder="••••••••">
        <button type="button" class="au-eye" data-eye="si-pass" aria-label="show/hide password">${EYE}</button></div></div>
    <button type="submit" class="au-submit">${t('btn.signin')}</button>
    <a class="au-forgot" href="${forgotHref}">${t('auth.forgot.link')}</a>
  </form>`;

  const body = `<div class="au-top">
    <div class="au-top-left">
      <a href="/?lang=${L}" class="au-back">${esc(t('common.back'))}</a>
      <a href="/?lang=${L}" class="au-logo" aria-label="20FIT"><img src="${LOGO_LIGHT}" alt="20FIT"></a>
    </div>
    <div class="lp-tog">${langBtn('id', 'ID')}${langBtn('en', 'EN')}</div>
  </div>
  <div class="au-wrap">
    <section class="au-hero">
      <h1 class="au-title">${esc(t('authp.head1'))} ${esc(t('authp.head2'))}</h1>
      <p class="au-sub">${esc(t('authp.sub'))}</p>
      <div class="au-cta">
        <button type="button" class="au-btn au-btn-red" data-goto="signup">${t('authp.cta')}</button>
        <a class="au-btn au-btn-ghost" href="/about?lang=${L}">${t('authp.inside')}</a>
      </div>
      <ul class="au-checks">
        <li><span class="ck">✓</span>${esc(t('authp.check1'))}</li>
        <li><span class="ck">✓</span>${esc(t('authp.check2'))}</li>
        <li><span class="ck">✓</span>${esc(t('authp.check3'))}</li>
      </ul>
    </section>
    <section class="au-card" id="au-form">
      <div class="au-tabs">
        <button type="button" class="au-tab${isLogin ? ' on' : ''}" data-tab="signin">${t('btn.signin')}</button>
        <button type="button" class="au-tab${isLogin ? '' : ' on'}" data-tab="signup">${t('auth.account.registerTitle')}</button>
      </div>
      ${errBanner}
      ${signup}
      ${signin}
    </section>
  </div>
  ${faqSection(L)}
  <script>(function(){
    var tabs=[].slice.call(document.querySelectorAll('.au-tab')),panels=[].slice.call(document.querySelectorAll('.au-panel'));
    function show(w){tabs.forEach(function(t){t.classList.toggle('on',t.getAttribute('data-tab')===w);});panels.forEach(function(p){p.classList.toggle('on',p.getAttribute('data-panel')===w);});}
    tabs.forEach(function(t){t.addEventListener('click',function(){show(t.getAttribute('data-tab'));});});
    [].slice.call(document.querySelectorAll('[data-goto]')).forEach(function(el){el.addEventListener('click',function(){show(el.getAttribute('data-goto'));var c=document.getElementById('au-form');if(c&&window.innerWidth<900)c.scrollIntoView({behavior:'smooth'});});});
    [].slice.call(document.querySelectorAll('[data-eye]')).forEach(function(btn){btn.addEventListener('click',function(){var i=document.getElementById(btn.getAttribute('data-eye'));if(i)i.type=i.type==='password'?'text':'password';});});
  })();</script>`;

  return `<!doctype html><html lang="${L}" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('auth.account.registerTitle')} — 20FIT</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--red:#E4121F;--red-soft:rgba(228,18,31,.10);
  --lp-bg:#f4f6f9;--lp-card:#ffffff;--lp-chip:#eef1f5;--lp-line:#e3e7ed;--lp-line2:#d7dbe2;
  --lp-tx:#17171d;--lp-tx2:#41454d;--lp-tx3:#63676e;--lp-tx4:#8b8f97}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--lp-bg);color:var(--lp-tx);line-height:1.5;min-height:100vh}
a{text-decoration:none;color:inherit}
.au-top{display:flex;align-items:center;justify-content:space-between;gap:14px;max-width:1240px;margin:0 auto;padding:18px 28px}
.au-top-left{display:flex;align-items:center;gap:16px;min-width:0}
.au-back{display:inline-flex;align-items:center;padding:9px 16px;border-radius:999px;font:700 14px/1 Barlow,sans-serif;color:var(--lp-tx2);background:var(--lp-chip);border:1px solid var(--lp-line);white-space:nowrap}
.au-back:hover{background:var(--lp-line);color:var(--lp-tx)}
.au-logo img{height:60px;width:auto;display:block}
.lp-tog{display:flex;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:11px;padding:4px;gap:3px}
.lp-tog-b{padding:8px 15px;border-radius:8px;font:700 14px/1 Barlow,sans-serif;color:var(--lp-tx3)}
.lp-tog-b.on{color:#fff;background:var(--red)}
.au-wrap{max-width:1240px;margin:0 auto;padding:24px 28px 40px;display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:start}
.au-title{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;line-height:.94;letter-spacing:-.01em;font-size:clamp(40px,6.4vw,74px)}
.au-sub{margin:22px 0 26px;font-size:clamp(16px,1.6vw,19px);color:var(--lp-tx3);max-width:480px}
.au-cta{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:30px}
.au-btn{display:inline-flex;align-items:center;justify-content:center;padding:15px 26px;border-radius:999px;font:800 14px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.02em;cursor:pointer;border:1px solid transparent;white-space:nowrap}
.au-btn-red{background:var(--red);color:#fff;box-shadow:0 10px 24px rgba(228,18,31,.28)}
.au-btn-ghost{background:#fff;color:var(--lp-tx);border-color:var(--lp-line2)}
.au-checks{list-style:none;display:flex;flex-direction:column;gap:13px}
.au-checks li{display:flex;align-items:center;gap:12px;font-weight:600;font-size:15.5px;color:var(--lp-tx2)}
.au-checks .ck{flex:0 0 auto;color:var(--red);font-weight:900;font-size:16px}
.au-card{background:var(--lp-card);border:1px solid var(--lp-line);border-radius:20px;padding:30px;box-shadow:0 18px 50px rgba(20,20,30,.10)}
.au-tabs{display:flex;gap:28px;border-bottom:1px solid var(--lp-line);margin-bottom:22px}
.au-tab{background:none;border:0;cursor:pointer;padding:0 0 14px;font:800 15px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.03em;color:var(--lp-tx4);position:relative}
.au-tab.on{color:var(--lp-tx)}
.au-tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:3px;background:var(--red);border-radius:3px}
.au-panel{display:none}
.au-panel.on{display:block}
.au-f{margin-bottom:16px}
.au-f>label{display:block;font:800 11.5px/1.3 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--lp-tx3);margin-bottom:8px}
.au-in{width:100%;background:var(--lp-chip);border:1px solid transparent;border-radius:12px;padding:14px 15px;font:500 15px/1.2 Barlow,sans-serif;color:var(--lp-tx)}
.au-in:focus{outline:none;border-color:var(--red);background:#fff}
.au-in::placeholder{color:var(--lp-tx4)}
.au-hint{margin-top:6px;font-size:12.5px;color:var(--lp-tx4)}
.au-pass{position:relative}
.au-pass .au-in{padding-right:46px}
.au-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;color:var(--lp-tx3);padding:5px;display:flex}
.au-gender{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.au-gseg{display:flex;margin:0;position:relative}
.au-gseg input{position:absolute;opacity:0;width:0;height:0;margin:0}
.au-gseg>span{flex:1;text-align:center;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:12px;padding:14px;font:700 15px/1 Barlow,sans-serif;color:var(--lp-tx2);cursor:pointer}
.au-gseg input:checked+span{background:var(--red-soft);border-color:var(--red);color:var(--red)}
.au-gseg input:focus-visible+span{outline:2px solid var(--red);outline-offset:1px}
.au-submit{width:100%;margin-top:6px;padding:16px;border-radius:12px;background:var(--red);color:#fff;border:0;cursor:pointer;font:800 14px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.03em;box-shadow:0 10px 24px rgba(228,18,31,.28)}
.au-forgot{display:block;text-align:right;margin-top:14px;color:var(--lp-tx3);font-size:13.5px}
.au-err{background:rgba(228,18,31,.08);border:1px solid rgba(228,18,31,.28);color:#b3121c;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:14px}
.au-err ul{margin:6px 0 0 18px}
.au-faq{max-width:1240px;margin:0 auto;padding:8px 28px 60px}
.au-faq h2{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;font-size:clamp(30px,4.4vw,46px);margin:0 0 8px}
.au-faq-sub{color:var(--lp-tx3);max-width:640px;margin:0 0 26px;font-size:16px}
.au-faq-item{background:var(--lp-card);border:1px solid var(--lp-line);border-radius:14px;margin-bottom:14px;overflow:hidden}
.au-faq-item summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 24px;font:700 16.5px/1.35 Barlow,sans-serif;color:var(--lp-tx)}
.au-faq-item summary::-webkit-details-marker{display:none}
.au-faq-ic{flex:0 0 auto;color:var(--red);font-size:28px;line-height:1;transition:transform .2s ease}
.au-faq-item[open] .au-faq-ic{transform:rotate(45deg)}
.au-faq-a{padding:0 24px 20px;color:var(--lp-tx2);font-size:15px;line-height:1.65}
@media(max-width:900px){.au-wrap{grid-template-columns:1fr;gap:30px;padding:8px 22px 24px}.au-card{padding:24px}.au-hero{order:0}}
@media(max-width:560px){.au-faq{padding:8px 18px 60px}.au-faq-item summary{padding:17px 18px;font-size:15.5px}.au-faq-a{padding:0 18px 17px}}
@media(max-width:560px){.au-top{padding:14px 16px;gap:10px}.au-top-left{gap:11px}.au-logo img{height:46px}.au-back{padding:8px 13px;font-size:13px}}
</style>
</head><body>${body}</body></html>`;
}

function talentLogin(type, opts = {}) {
  const L = normLang(opts.lang);
  if (opts.unified) return talentAuthPage({ mode: 'login', lang: L, errors: opts.errors, values: opts.values, next: opts.next });
  const t = (k, v) => tr(L, k, v);
  const unified = !!opts.unified;
  const p = talentPath(type);
  const v = opts.values || {};
  const action = unified ? '/login' : `/${p}/login`;
  const forgotHref = unified ? `/kol/forgot-password?lang=${L}` : `/${p}/forgot-password?lang=${L}`;
  const registerHref = unified ? `/register?lang=${L}` : `/${p}/register?lang=${L}`;
  const form = `<form method="post" action="${action}">
    <div class="field">
      <label for="login">${unified ? t('common.email') : t('common.emailphone')}</label>
      <input type="${unified ? 'email' : 'text'}" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
    </div>
    <div class="field">
      <label for="password">${t('common.password')}</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
    </div>
    <button type="submit" class="btn btn-block">${t('btn.signin')}</button>
    <div style="text-align:center;margin-top:14px"><a href="${forgotHref}" style="color:var(--muted);font-size:14px">${t('auth.forgot.link')}</a></div>
  </form>`;
  const foot = unified
    ? `${t('auth.foot.toRegister', { href: registerHref })}<br><a href="/admin/login" style="color:var(--muted);font-size:13px">🔑 ${t('auth.account.adminLink')}</a>`
    : t('auth.foot.toRegister', { href: registerHref });
  const title = unified ? t('auth.account.loginTitle') : t('auth.login.title', { role: talentLabel(L, type) });
  const sub = unified ? t('auth.account.loginSub') : t('auth.login.sub');
  return authShell(type, title, sub, form, foot, opts.errors, L, unified ? 'Talent' : undefined);
}

function talentRegister(type, opts = {}) {
  const L = normLang(opts.lang);
  if (opts.unified) return talentAuthPage({ mode: 'register', lang: L, errors: opts.errors, values: opts.values, next: opts.next });
  const t = (k, v) => tr(L, k, v);
  const unified = !!opts.unified;
  const p = talentPath(type);
  const v = opts.values || {};
  const action = unified ? '/register' : `/${p}/register`;
  const isCreator = (type === 'kol');
  const req = ' <span style="color:var(--red)">*</span>';
  const optH = ` <span class="hint">${t('dd.optional')}</span>`;
  // Optional supporting documents, captured right at signup. CV + portfolio are
  // shown to creators (they're required later to apply as KOL/photog/videog).
  const docsSection = isCreator ? `
    <div class="field" style="border-top:1px solid var(--line);margin-top:22px;padding-top:18px">
      <div style="font-weight:800;font-size:15px">${t('reg.docs.title')}</div>
      <div class="hint" style="margin-top:4px">${t('reg.docs.creatorNote')}</div>
    </div>
    <div class="field">
      <label>${t('doc.cv')}${optH}</label>
      <input type="file" name="cv" accept=".pdf,image/*">
      <div class="hint" style="margin-top:6px">${t('doc.fileHint')}</div>
    </div>
    <div class="field">
      <label for="portfolio_url">${t('doc.portfolio')}${optH}</label>
      <input type="url" id="portfolio_url" name="portfolio_url" maxlength="500" placeholder="https://…" value="${esc(v.portfolio_url || '')}">
      <div class="hint" style="margin-top:6px">${t('doc.portfolioHint')}</div>
    </div>
    <div class="field">
      <label>${t('doc.hyrox')}${optH}</label>
      <input type="file" name="hyrox_cert" accept=".pdf,image/*">
      <div class="hint" style="margin-top:6px">${t('doc.hyroxHint')}</div>
    </div>` : '';
  const form = `<form method="post" action="${action}"${isCreator ? ' enctype="multipart/form-data"' : ''}>
    <div class="field">
      <label for="name">${t('common.fullname')}${req}</label>
      <input type="text" id="name" name="name" required maxlength="120" autocomplete="name" value="${esc(v.name || '')}">
    </div>
    <div class="field">
      <label for="login">${t('common.email')}${req}</label>
      <input type="email" id="login" name="login" required autocomplete="email" value="${esc(v.login || '')}">
      <div class="hint" style="margin-top:6px">${t('hint.usedForLogin')}</div>
    </div>
    <div class="field">
      <label for="phone">${t('dd.phone')}${req}</label>
      <input type="tel" id="phone" name="phone" required maxlength="20" autocomplete="tel" placeholder="08xxxxxxxxxx" value="${esc(v.phone || '')}">
      <div class="hint" style="margin-top:6px">${t('dd.phoneHint')}</div>
    </div>
    <div class="field">
      <label for="password">${t('common.password')}${req}</label>
      <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
      <div class="hint" style="margin-top:6px">${t('hint.min6')}</div>
    </div>
    <div class="field">
      <label for="password2">${t('common.passwordConfirm')}${req}</label>
      <input type="password" id="password2" name="password2" required minlength="6" autocomplete="new-password">
    </div>
    ${docsSection}
    <button type="submit" class="btn btn-block">${t('btn.register')}</button>
  </form>`;
  const loginHref = unified ? `/login?lang=${L}` : `/${p}/login?lang=${L}`;
  const foot = t('auth.foot.toLogin', { href: loginHref });
  const title = unified ? t('auth.account.registerTitle') : t('auth.register.title', { role: talentLabel(L, type) });
  const sub = unified ? t('auth.account.registerSub') : t('auth.register.sub');
  return authShell(type, title, sub, form, foot, opts.errors, L, unified ? 'Talent' : undefined);
}

/** Forgot-password request form (per talent type). */
function forgotPassword(type, opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type);
  const v = opts.values || {};
  const form = `<form method="post" action="/${p}/forgot-password">
    <div class="field">
      <label for="login">${t('common.emailphone')}</label>
      <input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
    </div>
    <button type="submit" class="btn btn-block">${t('auth.forgot.btn')}</button>
  </form>`;
  const foot = `<a href="/${p}/login?lang=${L}">${t('auth.forgot.backToLogin')}</a>`;
  return authShell(type, t('auth.forgot.title'), t('auth.forgot.sub'), form, foot, opts.errors, L);
}

/** Neutral "we sent you an email" confirmation (no account enumeration). */
function forgotPasswordSent({ type, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type || 'kol');
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check" style="background:var(--red-soft);color:var(--red)">✉</div>
    <h1>${t('auth.forgot.sentTitle')}</h1>
    <p class="sub" style="margin:10px auto 24px;max-width:400px">${t('auth.forgot.sentBody')}</p>
    <a href="/${p}/login?lang=${L}" class="btn btn-ghost">${t('auth.forgot.backToLogin')}</a>
  </div></div>`;
  return layout({ title: t('auth.forgot.sentTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// Deterministic cover palette + accent icon for an event, keyed off a stable
// seed (event id/name) so a given event always gets the same look. Keeps the
// brand red first, with a few energetic sport-themed gradients for variety.
const EV_COVERS = [
  ['#E4121F', '#7a0a12', '🔥'],
  ['#ff7a18', '#af002d', '⚡'],
  ['#f59e0b', '#b45309', '🏆'],
  ['#10b981', '#065f46', '🏅'],
  ['#0ea5e9', '#1e3a8a', '🎯'],
  ['#7c3aed', '#4c1d95', '🎪'],
];
function evCoverPick(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return EV_COVERS[h % EV_COVERS.length];
}
/** Full-bleed gradient "cover" for an event card, with initial, icon & status badge. */
function eventCover(e, lang) {
  const L = normLang(lang);
  const ongoing = e.status === 'ongoing';
  const badgeColor = ongoing ? '#0f9d6a' : '#E4121F';
  const badgeText = tr(L, ongoing ? 'ev.status.ongoing' : 'ev.status.upcoming');
  const badge = `<span class="ev-cover-badge" style="color:${badgeColor}">● ${esc(badgeText)}</span>`;
  // With a poster, show the full image at its natural aspect ratio (no crop);
  // otherwise fall back to the generated gradient cover.
  if (e.mockup_url) {
    return `<div class="ev-cover ev-cover-photo">
      <img src="${esc(e.mockup_url)}" alt="" class="ev-cover-photo-img" loading="lazy" onerror="this.closest('.ev-cover').style.display='none'">
      ${badge}
    </div>`;
  }
  const [c1, c2, icon] = evCoverPick(e.id || e.name);
  const initial = esc(String(e.name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<div class="ev-cover" style="background:linear-gradient(135deg,${c1},${c2})">
      <div class="ev-cover-tex"></div>
      <div class="ev-cover-ini">${initial}</div>
      <div class="ev-cover-ico">${icon}</div>
      ${badge}
    </div>`;
}

/** Small status badge for an event teaser: ongoing (ok) / coming soon (warn). */
function eventStatusBadge(status, lang) {
  const L = normLang(lang);
  if (status === 'ongoing') return `<span class="dl-when" style="background:var(--ok-soft);color:var(--ok)">${tr(L, 'ev.status.ongoing')}</span>`;
  return `<span class="dl-when" style="background:var(--red-soft);color:var(--red)">${tr(L, 'ev.status.upcoming')}</span>`;
}

/**
 * Compact read-only view of a talent's "Data Diri" for staff (applications
 * review + KOL detail). WhatsApp and Instagram become click-through links.
 * Returns a short "not completed yet" note if the profile is still empty.
 */
function talentProfileBlock(profile, lang) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  if (!profile || !profile.profile_completed_at) {
    return `<div class="muted" style="font-size:13px">${t('adm.profile.incomplete')}</div>`;
  }
  const genderLabel = profile.gender === 'male' ? t('dd.gender.male') : profile.gender === 'female' ? t('dd.gender.female') : '—';
  const waDigits = String(profile.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '62');
  const wa = profile.phone ? `<a href="https://wa.me/${esc(waDigits)}" target="_blank" rel="noopener">${esc(profile.phone)}</a>` : '—';
  const ig = profile.instagram ? `<a href="https://instagram.com/${encodeURIComponent(profile.instagram)}" target="_blank" rel="noopener">@${esc(profile.instagram)}</a>` : '—';
  const rows = [
    [t('adm.profile.phone'), wa],
    [t('adm.profile.city'), esc(profile.city || '—')],
    [t('adm.profile.ktp'), esc(profile.ktp || '—')],
    [t('adm.profile.birthdate'), profile.birthdate ? esc(fmtDay(profile.birthdate)) : '—'],
    [t('adm.profile.gender'), esc(genderLabel)],
    [t('adm.profile.instagram'), ig],
    [t('adm.profile.followers'), profile.instagram_followers != null ? fmtNum(profile.instagram_followers) : '—'],
  ];
  const grid = rows.map(([k, v]) => `<div style="min-width:110px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${esc(k)}</div>
    <div style="font-size:14px;margin-top:2px">${v}</div></div>`).join('');
  const exp = profile.experience
    ? `<div style="margin-top:11px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('adm.profile.experience')}</div><div style="font-size:14px;margin-top:2px;white-space:pre-wrap">${esc(profile.experience)}</div></div>`
    : '';
  return `<div style="display:flex;flex-wrap:wrap;gap:14px 22px">${grid}</div>${exp}`;
}

/**
 * "Data Diri" (profile) form shown right after registering — the account is not
 * active until it is submitted. Also lists available events (ongoing / coming
 * soon) so a new talent can see what they can join once their profile is done.
 * `type` is 'kol' or 'main_power'; Instagram is required for KOL only.
 */
function talentDataDiri(type, opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type);
  const v = opts.values || {};
  const account = opts.account || {};
  const editing = !!(account.profile_completed_at);
  const igRequired = type === 'kol';
  const errorBanner = (opts.errors && opts.errors.length)
    ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${opts.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';

  const req = ' <span style="color:var(--red)">*</span>';
  const opt = ` <span class="hint">${t('dd.optional')}</span>`;
  const genderOpts = [['', t('dd.gender.pick')], ['male', t('dd.gender.male')], ['female', t('dd.gender.female')]]
    .map(([val, label]) => `<option value="${val}"${v.gender === val ? ' selected' : ''}${val === '' ? ' disabled' : ''}>${esc(label)}</option>`).join('');

  const events = opts.events || [];
  const eventList = events.length
    ? `<div class="dl-list">${events.map((e) => {
        const dateLine = e.starts_at ? `<div class="muted" style="font-size:12.5px;margin-top:3px">${fmtDay(e.starts_at)}${e.ends_at ? ' – ' + fmtDay(e.ends_at) : ''}</div>` : '';
        return `<div class="dl-item" style="align-items:flex-start">
          <div style="min-width:0"><b>${esc(e.name)}</b>${dateLine}</div>
          ${eventStatusBadge(e.status, L)}
        </div>`;
      }).join('')}</div>`
    : `<p class="muted" style="margin-top:12px">${t('dd.noEvents')}</p>`;

  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/kol?lang=${L}" class="btn btn-ghost btn-sm" onclick="if(history.length>1){history.back();return false}">${t('common.back')}</a>
  </div>
  <h1>${editing ? t('dd.editTitle') : t('dd.title')}</h1>
  <p class="sub">${editing ? t('dd.editSub') : t('dd.sub', { name: esc(account.name || '') })}</p>
  ${errorBanner}
  <form class="card" method="post" action="/${p}/data-diri?lang=${L}">
    <div class="field">
      <label for="province">${t('dd.province')}${req}</label>
      ${provinceSelect(v.province, L)}
    </div>
    <div class="field">
      <label for="city">${t('dd.city')}${req}</label>
      ${citySelect(v.city, L)}
    </div>
    <div class="field">
      <label for="birthdate">${t('dd.birthdate')}${req}</label>
      <input type="date" id="birthdate" name="birthdate" required value="${esc(v.birthdate || '')}">
    </div>
    <div class="field">
      <label for="gender">${t('dd.gender')}${req}</label>
      <select id="gender" name="gender" required>${genderOpts}</select>
    </div>
    <div class="field">
      <label for="ktp">${t('dd.ktp')}${req}</label>
      <input type="text" id="ktp" name="ktp" required inputmode="numeric" maxlength="20" placeholder="${esc(t('dd.ktpPh'))}" value="${esc(v.ktp || '')}">
      <div class="hint" style="margin-top:6px">${t('dd.ktpHint')}</div>
    </div>
    <div class="field">
      <label for="instagram">${t('dd.instagram')}${opt}</label>
      <input type="text" id="instagram" name="instagram" maxlength="60" placeholder="username" value="${esc(v.instagram || '')}">
      <div class="hint" style="margin-top:6px">${t('dd.instagramHint')}</div>
    </div>
    <div class="field">
      <label for="instagram_followers">${t('dd.followers')}${opt}</label>
      <input type="number" id="instagram_followers" name="instagram_followers" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(v.instagram_followers || '')}">
    </div>
    <div class="field">
      <label for="experience">${t('dd.experience')}${req}</label>
      <textarea id="experience" name="experience" rows="3" maxlength="1000" required placeholder="${esc(t('dd.experiencePh'))}">${esc(v.experience || '')}</textarea>
    </div>
    <button type="submit" class="btn btn-block">${editing ? t('dd.save') : t('dd.submit')}</button>
  </form>

  <div class="section-head"><h2 style="margin:0">${t('dd.eventsTitle')}</h2></div>
  <p class="muted" style="font-size:13px;margin:6px 0 0">${t('dd.eventsSub')}</p>
  ${eventList}
</div>`;
  return layout({ title: (editing ? t('dd.editTitle') : t('dd.title')) + ' — 20FIT ' + (talentLabel(L, type) || ''), body, home: '/?lang=' + L, lang: L });
}

/** New-password form reached from the email link (token in a hidden field). */
function resetPassword({ token, valid, errors, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  if (!valid) {
    const body = `<div class="wrap narrow"><div class="card success">
      <div class="check" style="background:var(--err-soft);color:var(--err)">!</div>
      <h1>${t('auth.reset.invalidTitle')}</h1>
      <p class="sub" style="margin:10px auto 24px;max-width:420px">${t('auth.reset.invalidBody')}</p>
      <a href="/kol/forgot-password?lang=${L}" class="btn btn-ghost">${t('auth.reset.requestAgain')}</a>
    </div></div>`;
    return layout({ title: t('auth.reset.invalidTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
  }
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <h1 style="margin-top:22px">${t('auth.reset.title')}</h1>
  <p class="sub">${t('auth.reset.sub')}</p>
  ${errorBanner}
  <div class="card">
    <form method="post" action="/reset-password">
      <input type="hidden" name="token" value="${esc(token)}">
      <div class="field">
        <label for="password">${t('auth.reset.newPassword')}</label>
        <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
        <div class="hint" style="margin-top:6px">${t('hint.min6')}</div>
      </div>
      <div class="field">
        <label for="confirm">${t('auth.reset.confirm')}</label>
        <input type="password" id="confirm" name="confirm" required minlength="6" autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-block">${t('auth.reset.btn')}</button>
    </form>
  </div>
</div>`;
  return layout({ title: t('auth.reset.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

/** Success after the password is changed. */
function resetPasswordDone({ type, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type || 'kol');
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check">✓</div>
    <h1>${t('auth.reset.doneTitle')}</h1>
    <p class="sub" style="margin:10px auto 24px;max-width:400px">${t('auth.reset.doneBody')}</p>
    <a href="/${p}/login?lang=${L}" class="btn">${t('auth.reset.toLogin')} →</a>
  </div></div>`;
  return layout({ title: t('auth.reset.doneTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
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
// Staff login. Two separate entry points (variant 'admin' -> /admin/login,
// 'eo' -> /eo/login) that authenticate against the same staff_accounts.
function staffLogin(opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const v = opts.values || {};
  const isEo = opts.variant === 'eo';
  const action = isEo ? '/eo/login' : '/admin/login';
  const title = isEo ? t('staffLogin.titleEo') : t('staffLogin.titleAdmin');
  const sub = isEo ? t('staffLogin.subEo') : t('staffLogin.subAdmin');
  const otherHref = (isEo ? '/admin/login' : '/eo/login') + '?lang=' + L;
  const otherText = isEo ? t('staffLogin.toAdmin') : t('staffLogin.toEo');
  const errorBanner = (opts.errors && opts.errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${opts.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    ${toggles(L)}
  </div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(sub)}</p>
  ${errorBanner}
  <div class="card">
    <form method="post" action="${action}">
      <div class="field"><label for="login">${t('common.email')}</label><input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}"></div>
      <div class="field"><label for="password">${t('common.password')}</label><input type="password" id="password" name="password" required autocomplete="current-password"></div>
      <button type="submit" class="btn btn-block">${t('btn.signin')}</button>
    </form>
    <p style="text-align:center;margin:14px 0 0;font-size:14px"><a href="${isEo ? '/eo' : '/admin'}/forgot-password?lang=${L}">${t('auth.forgot.link')}</a></p>
    ${isEo ? `<p style="text-align:center;margin:10px 0 0;font-size:14px">${t('eo.login.noAccount')} <a href="/eo/register?lang=${L}">${t('eo.login.registerLink')}</a></p>` : ''}
  </div>
  <p style="text-align:center;margin-top:18px;font-size:14px"><a href="${otherHref}" style="color:var(--muted)">${esc(otherText)}</a></p>
</div>`;
  return layout({ title: title + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// --- EO: forgot / reset password (staff_accounts) ---------------------------
function staffForgot({ variant, lang, errors, values }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const base = variant === 'eo' ? '/eo' : '/admin';
  const eb = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="${base}/login?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>${toggles(L)}
  </div>
  <h1>${t('auth.forgot.title')}</h1>
  <p class="sub">${t('auth.forgot.subStaff')}</p>
  ${eb}
  <div class="card">
    <form method="post" action="${base}/forgot-password">
      <div class="field"><label for="login">${t('common.email')}</label><input type="text" id="login" name="login" required autocomplete="username" value="${esc((values && values.login) || '')}"></div>
      <button type="submit" class="btn btn-block">${t('auth.forgot.btn')}</button>
    </form>
    <p style="text-align:center;margin:14px 0 0;font-size:14px"><a href="${base}/login?lang=${L}">${t('auth.forgot.backToLogin')}</a></p>
  </div>
</div>`;
  return layout({ title: t('auth.forgot.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function staffForgotSent({ lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check" style="background:var(--red-soft);color:var(--red)">✉</div>
    <h1>${t('auth.forgot.sentTitle')}</h1>
    <p class="sub" style="margin:10px auto 24px;max-width:400px">${t('auth.forgot.sentBody')}</p>
    <a href="/eo/login?lang=${L}" class="btn btn-ghost">${t('auth.forgot.backToLogin')}</a>
  </div></div>`;
  return layout({ title: t('auth.forgot.sentTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function staffReset({ token, valid, errors, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  if (!valid) {
    const body = `<div class="wrap narrow"><div class="card success">
      <div class="check" style="background:var(--err-soft);color:var(--err)">!</div>
      <h1>${t('auth.reset.invalidTitle')}</h1>
      <p class="sub" style="margin:10px auto 24px;max-width:420px">${t('auth.reset.invalidBody')}</p>
      <a href="/eo/forgot-password?lang=${L}" class="btn btn-ghost">${t('auth.reset.requestAgain')}</a>
    </div></div>`;
    return layout({ title: t('auth.reset.invalidTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
  }
  const eb = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <h1 style="margin-top:22px">${t('auth.reset.title')}</h1>
  <p class="sub">${t('auth.reset.sub')}</p>
  ${eb}
  <div class="card">
    <form method="post" action="/staff/reset-password">
      <input type="hidden" name="token" value="${esc(token)}">
      <div class="field"><label for="password">${t('auth.reset.newPassword')}</label><input type="password" id="password" name="password" required minlength="6" autocomplete="new-password"><div class="hint" style="margin-top:6px">${t('hint.min6')}</div></div>
      <div class="field"><label for="confirm">${t('auth.reset.confirm')}</label><input type="password" id="confirm" name="confirm" required minlength="6" autocomplete="new-password"></div>
      <button type="submit" class="btn btn-block">${t('auth.reset.btn')}</button>
    </form>
  </div>
</div>`;
  return layout({ title: t('auth.reset.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function staffResetDone({ lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check" style="background:var(--ok-soft);color:var(--ok)">✓</div>
    <h1>${t('auth.reset.doneTitle')}</h1>
    <p class="sub" style="margin:10px auto 24px;max-width:400px">${t('auth.reset.doneBody')}</p>
    <a href="/eo/login?lang=${L}" class="btn">${t('btn.signin')}</a>
  </div></div>`;
  return layout({ title: t('auth.reset.doneTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// --- EO: dashboard + profile ------------------------------------------------
function eoDashboard({ staff, stats, profileComplete, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const card = (label, val, icon) => `<div class="card" style="margin:0">
    <div style="font-size:24px;line-height:1">${icon}</div>
    <div style="font-size:30px;font-weight:800;margin-top:8px;line-height:1">${fmtNum(val)}</div>
    <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(label)}</div>
  </div>`;
  const reminder = profileComplete ? '' : `<div class="banner banner-warn" style="margin-top:14px">⚠️ ${t('eo.profileIncomplete')} <a href="/eo/profile?lang=${L}" style="font-weight:700;text-decoration:underline">${t('eo.completeNow')}</a></div>`;
  const body = `<div class="wrap">
  ${staffHead(staff, t('eo.dashTitle'), L)}
  <p class="sub">${t('eo.dashSub')}</p>
  ${reminder}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:14px;margin-top:16px">
    ${card(t('eo.stat.totalEvents'), stats.totalEvents, '📅')}
    ${card(t('eo.stat.activeEvents'), stats.activeEvents, '🟢')}
    ${card(t('eo.stat.totalApplies'), stats.totalApplies, '📝')}
    ${card(t('eo.stat.accepted'), stats.accepted, '✅')}
    ${card(t('eo.stat.doneEvents'), stats.doneEvents, '🏁')}
  </div>
</div>`;
  return appLayout({ title: t('eo.dashTitle') + ' — 20FIT', body, role: 'eo', active: 'dashboard', user: staff.name, lang: L });
}

function eoProfile({ staff, profile, saved, errors, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const p = profile || {};
  const req = ' <span style="color:var(--red)">*</span>';
  const eb = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const savedBanner = saved ? `<div class="banner banner-ok">✓ ${t('eo.profileSaved')}</div>` : '';
  const body = `<div class="wrap">
  ${staffHead(staff, t('eo.profileTitle'), L)}
  <p class="sub">${t('eo.profileSub')}</p>
  ${savedBanner}${eb}
  <form method="post" action="/eo/profile" class="card" style="margin-top:14px;max-width:640px">
    <div class="field"><label for="org_type">${t('eo.f.orgType')}${req}</label>
      <select id="org_type" name="org_type" required>
        <option value="">${t('eo.f.orgTypePick')}</option>
        ${['company', 'community', 'individual'].map((x) => `<option value="${x}"${p.org_type === x ? ' selected' : ''}>${esc(t('eo.type.' + x))}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label for="org_name">${t('eo.f.company')}${req}</label><input type="text" id="org_name" name="org_name" required maxlength="140" value="${esc(p.org_name || '')}"></div>
    <div class="field"><label for="pic_name">${t('eo.f.pic')}${req}</label><input type="text" id="pic_name" name="pic_name" required maxlength="140" value="${esc(p.pic_name || '')}"></div>
    <div class="field"><label for="email">${t('eo.f.emailLogin')}</label><input type="email" id="email" value="${esc(p.email || '')}" readonly disabled style="opacity:.7;cursor:not-allowed"></div>
    <div class="field"><label for="phone">${t('eo.f.phone')}${req}</label><input type="text" id="phone" name="phone" required maxlength="40" value="${esc(p.phone || '')}"></div>
    <div class="field"><label for="province">${t('dd.province')}${req}</label>${provinceSelect(p.province, L)}</div>
    <div class="field"><label for="city">${t('dd.city')}${req}</label>${citySelect(p.city, L)}</div>
    <div class="field"><label for="description"><span id="descLabelText" data-tpl="${esc(t('eo.f.descOf'))}" data-base="${esc(t('eo.f.desc'))}">${t('eo.f.desc')}</span>${req}</label><textarea id="description" name="description" required rows="4" maxlength="1000">${esc(p.description || '')}</textarea><div class="hint" style="margin-top:6px"><span id="descCount">0</span>/1000</div></div>
    <button type="submit" class="btn btn-block">${t('eo.f.save')}</button>
  </form>
  <script>(function(){
    var d=document.getElementById('description'),c=document.getElementById('descCount');
    if(d&&c){var u=function(){c.textContent=d.value.length;};d.addEventListener('input',u);u();}
    var sel=document.getElementById('org_type'),lt=document.getElementById('descLabelText');
    if(sel&&lt){var tpl=lt.getAttribute('data-tpl'),base=lt.getAttribute('data-base');
      var up=function(){var o=sel.options[sel.selectedIndex];lt.textContent=(sel.value&&o)?tpl.replace('{type}',o.text):base;};
      sel.addEventListener('change',up);up();}
  })();</script>
</div>`;
  return appLayout({ title: t('eo.profileTitle') + ' — 20FIT', body, role: 'eo', active: 'profile', user: staff.name, lang: L });
}

// EO self-registration form.
function eoRegister({ lang, errors, values }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const v = values || {};
  const eb = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const body = `<div class="wrap narrow" style="max-width:440px">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/eo/login?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>${toggles(L)}
  </div>
  <h1>${t('eo.reg.title')}</h1>
  <p class="sub">${t('eo.reg.sub')}</p>
  ${eb}
  <div class="card">
    <form method="post" action="/eo/register">
      <div class="field"><label for="org_type">${t('eo.f.orgType')}</label>
        <select id="org_type" name="org_type" required>
          <option value="">${t('eo.f.orgTypePick')}</option>
          ${['company', 'community', 'individual'].map((x) => `<option value="${x}"${v.org_type === x ? ' selected' : ''}>${esc(t('eo.type.' + x))}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label for="org_name">${t('eo.f.company')}</label><input type="text" id="org_name" name="org_name" required maxlength="140" value="${esc(v.org_name || '')}"></div>
      <div class="field"><label for="pic_name">${t('eo.f.pic')}</label><input type="text" id="pic_name" name="pic_name" required maxlength="140" value="${esc(v.pic_name || '')}"></div>
      <div class="field"><label for="login">${t('common.email')}</label><input type="email" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}"></div>
      <div class="field"><label for="phone">${t('eo.f.phone')}</label><input type="text" id="phone" name="phone" required maxlength="40" value="${esc(v.phone || '')}"></div>
      <div class="field"><label for="province">${t('dd.province')}</label>${provinceSelect(v.province, L)}</div>
      <div class="field"><label for="city">${t('dd.city')}</label>${citySelect(v.city, L)}</div>
      <div class="field"><label for="description"><span id="descLabelText" data-tpl="${esc(t('eo.f.descOf'))}" data-base="${esc(t('eo.f.desc'))}">${t('eo.f.desc')}</span></label><textarea id="description" name="description" required rows="3" maxlength="1000">${esc(v.description || '')}</textarea><div class="hint" style="margin-top:6px"><span id="descCount">0</span>/1000</div></div>
      <div class="field"><label for="password">${t('common.password')}</label><input type="password" id="password" name="password" required minlength="6" autocomplete="new-password"><div class="hint" style="margin-top:6px">${t('hint.min6')}</div></div>
      <div class="field"><label for="password2">${t('auth.reset.confirm')}</label><input type="password" id="password2" name="password2" required minlength="6" autocomplete="new-password"></div>
      <button type="submit" class="btn btn-block">${t('eo.reg.submit')}</button>
    </form>
    <p style="text-align:center;margin:14px 0 0;font-size:14px">${t('eo.reg.haveAccount')} <a href="/eo/login?lang=${L}">${t('btn.signin')}</a></p>
  </div>
</div>
<script>(function(){
  var d=document.getElementById('description'),c=document.getElementById('descCount');
  if(d&&c){var u=function(){c.textContent=d.value.length;};d.addEventListener('input',u);u();}
  var sel=document.getElementById('org_type'),lt=document.getElementById('descLabelText');
  if(sel&&lt){var tpl=lt.getAttribute('data-tpl'),base=lt.getAttribute('data-base');
    var up=function(){var o=sel.options[sel.selectedIndex];lt.textContent=(sel.value&&o)?tpl.replace('{type}',o.text):base;};
    sel.addEventListener('change',up);up();}
})();</script>`;
  return layout({ title: t('eo.reg.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// Shared "resend verification email" mini-form.
function eoResendForm(email, L, t) {
  return `<form method="post" action="/eo/verify/resend" style="margin-top:14px">
    ${email ? `<input type="hidden" name="login" value="${esc(email)}">`
      : `<div class="field"><label for="login">${t('eo.verify.emailLabel')}</label><input type="email" id="login" name="login" required></div>`}
    <button type="submit" class="btn btn-ghost btn-block">${t('eo.verify.resend')}</button>
  </form>`;
}

function eoVerifySent({ email, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow" style="max-width:460px"><div class="card success" style="margin-top:40px">
    <div class="check" style="background:var(--red-soft);color:var(--red)">✉</div>
    <h1>${t('eo.verify.sentTitle')}</h1>
    <p class="sub" style="margin:10px auto 6px;max-width:400px">${t('eo.verify.sentBody', { email: esc(email || '') })}</p>
    ${eoResendForm(email, L, t)}
    <p style="margin:16px 0 0"><a href="/eo/login?lang=${L}" style="font-size:14px">${t('eo.verify.backLogin')}</a></p>
  </div></div>`;
  return layout({ title: t('eo.verify.sentTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function eoVerifyResult({ ok, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow" style="max-width:460px"><div class="card" style="margin-top:40px">
    <div class="check" style="background:var(--err-soft);color:var(--err)">!</div>
    <h1 style="text-align:center">${t('eo.verify.failTitle')}</h1>
    <p class="sub" style="margin:10px auto 6px;max-width:400px;text-align:center">${t('eo.verify.failBody')}</p>
    ${eoResendForm('', L, t)}
    <p style="text-align:center;margin:16px 0 0"><a href="/eo/login?lang=${L}" style="font-size:14px">${t('eo.verify.backLogin')}</a></p>
  </div></div>`;
  return layout({ title: t('eo.verify.failTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function eoVerifyNeeded({ email, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow" style="max-width:460px"><div class="card" style="margin-top:40px">
    <div class="check" style="background:var(--warn-soft, var(--red-soft));color:var(--warn, var(--red))">✉</div>
    <h1 style="text-align:center">${t('eo.verify.neededTitle')}</h1>
    <p class="sub" style="margin:10px auto 6px;max-width:400px;text-align:center">${t('eo.verify.neededBody', { email: esc(email || '') })}</p>
    ${eoResendForm(email, L, t)}
    <p style="text-align:center;margin:16px 0 0"><a href="/eo/login?lang=${L}" style="font-size:14px">${t('eo.verify.backLogin')}</a></p>
  </div></div>`;
  return layout({ title: t('eo.verify.neededTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// Registration-status badge for an EO event.
// Localized label for a master/event position.
function posLabel(p, lang) { return normLang(lang) !== 'en' ? (p.label_id || p.key || '') : (p.label_en || p.key || ''); }

function eoRegBadge(status, lang) {
  const L = normLang(lang);
  const t = (k) => tr(L, k);
  if (status === 'done') return `<span class="pill pill-off">${t('eo.ev.status.done')}</span>`;
  if (status === 'draft') return `<span class="pill pill-off">${t('eo.ev.status.draft')}</span>`;
  if (status === 'closed') return `<span class="pill" style="background:var(--err-soft);color:var(--err)">${t('eo.ev.status.closed')}</span>`;
  return `<span class="pill pill-ok">${t('eo.ev.status.published')}</span>`;
}

function eoEvents({ staff, events, profileComplete, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const rows = (events && events.length) ? events.map((e) => {
    const v = e.view;
    const date = e.starts_at ? fmtDay(e.starts_at) + (e.ends_at && e.ends_at !== e.starts_at ? ' – ' + fmtDay(e.ends_at) : '') : '—';
    let closeBtn = '';
    if (v.status === 'closed') closeBtn = `<form class="inline-form" method="post" action="/eo/events/${esc(e.id)}/close"><input type="hidden" name="reopen" value="1"><button class="btn btn-ghost btn-sm">${t('eo.ev.reopen')}</button></form>`;
    else if (v.status === 'published') closeBtn = `<form class="inline-form" method="post" action="/eo/events/${esc(e.id)}/close" ${jsConfirm(t('eo.ev.closeConfirm'))}><button class="btn btn-ghost btn-sm">${t('eo.ev.close')}</button></form>`;
    const delBtn = `<form class="inline-form" method="post" action="/eo/events/${esc(e.id)}/delete" ${jsConfirm(t('eo.ev.deleteConfirm'))}><button class="btn btn-ghost btn-sm" title="${t('eo.ev.delete')}">🗑</button></form>`;
    return `<tr>
      <td data-label="${t('eo.ev.th.name')}"><div style="display:flex;align-items:center;gap:10px">${e.mockup_url ? `<img src="${esc(e.mockup_url)}" alt="" class="ev-mockup-thumb" onerror="this.style.display='none'">` : ''}<div style="min-width:0"><b>${esc(e.name)}</b>${e.category ? `<div class="muted" style="font-size:12px">${esc(e.category)}</div>` : ''}</div></div></td>
      <td data-label="${t('eo.ev.th.date')}" class="muted" style="font-size:13px;white-space:nowrap">${date}${e.start_time ? `<div style="font-size:12px">${esc(e.start_time)}${e.end_time ? '–' + esc(e.end_time) : ''}</div>` : ''}</td>
      <td data-label="${t('eo.ev.th.loc')}">${e.location ? esc(e.location) : '<span class="muted">—</span>'}</td>
      <td data-label="${t('eo.ev.th.status')}">${eoRegBadge(v.status, L)}</td>
      <td data-label="${t('eo.ev.th.applies')}"><b style="font-size:15px">${v.applyCount}</b></td>
      <td style="text-align:right;white-space:nowrap">
        <a href="/eo/events/${esc(e.id)}?lang=${L}" class="btn btn-ghost btn-sm">${t('eo.ev.detail')}</a>
        <a href="/eo/events/${esc(e.id)}/edit?lang=${L}" class="btn btn-ghost btn-sm">✎ ${t('btn.edit')}</a>
        ${closeBtn}${delBtn}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="muted">${t('eo.ev.empty')}</td></tr>`;
  const blocker = profileComplete ? '' : `<div class="banner banner-warn" style="margin-top:12px">⚠️ ${t('eo.profileIncomplete')} <a href="/eo/profile?lang=${L}" style="font-weight:700;text-decoration:underline">${t('eo.completeNow')}</a></div>`;
  const createBtn = profileComplete ? `<a href="/eo/events/new?lang=${L}" class="btn btn-sm">+ ${t('eo.ev.create')}</a>` : '';
  const body = `<div class="wrap">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    ${staffHead(staff, t('eo.ev.title'), L)}
    ${createBtn}
  </div>
  <p class="sub">${t('eo.ev.sub')}</p>
  ${blocker}
  <div class="card" style="margin-top:14px"><div class="table-wrap"><table>
    <thead><tr><th>${t('eo.ev.th.name')}</th><th>${t('eo.ev.th.date')}</th><th>${t('eo.ev.th.loc')}</th><th>${t('eo.ev.th.status')}</th><th>${t('eo.ev.th.applies')}</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>
</div>`;
  return appLayout({ title: t('eo.ev.title') + ' — 20FIT', body, role: 'eo', active: 'events', user: staff.name, lang: L });
}

function eoEventForm({ staff, event, positionsMaster, selected, errors, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const e = event || {};
  const sel = selected || {};
  const editing = !!e.id;
  const rq = ' <span style="color:var(--red)">*</span>';
  const eb = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('err.header')}</b><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const action = editing ? `/eo/events/${esc(e.id)}/edit` : '/eo/events';
  const dval = (v) => esc(String(v || '').slice(0, 10));
  const field = (name, label, val, type, required, extra) => `<div class="field"><label for="${name}">${label}${required ? rq : ''}</label><input type="${type || 'text'}" id="${name}" name="${name}" ${required ? 'required' : ''} value="${esc(val || '')}" ${extra || ''}></div>`;
  const status = e.status || 'draft';
  const posRows = (positionsMaster || []).map((p) => {
    const on = Object.prototype.hasOwnProperty.call(sel, p.id);
    const cur = on ? sel[p.id] : null;
    const q = cur ? (typeof cur === 'object' ? cur.quota : cur) : '';
    const jd = cur && typeof cur === 'object' ? (cur.jobdesk || '') : '';
    const reqv = cur && typeof cur === 'object' ? (cur.requirement || '') : '';
    const feev = cur && typeof cur === 'object' ? (cur.fee || '') : '';
    return `<div class="posm-row" style="padding:12px 0;border-top:1px solid var(--line)">
      <label style="display:flex;gap:10px;align-items:center">
        <input type="checkbox" name="pos" value="${esc(p.id)}" ${on ? 'checked' : ''} class="posm-cb">
        <span style="flex:1;font-size:14px">${esc(posLabel(p, L))}</span>
        <input type="number" name="quota_${esc(p.id)}" min="1" value="${q ? esc(q) : ''}" placeholder="${t('eo.ev.quota')}" style="width:110px" class="posm-q">
      </label>
      <div class="posm-extra" style="margin-top:8px${on ? '' : ';display:none'}">
        <textarea name="jobdesk_${esc(p.id)}" rows="2" maxlength="1000" placeholder="${t('eo.ev.jobdeskPh')}" style="width:100%;box-sizing:border-box;font-size:13px">${esc(jd)}</textarea>
        <textarea name="requirement_${esc(p.id)}" rows="2" maxlength="1000" placeholder="${t('eo.ev.requirementPh')}" style="width:100%;box-sizing:border-box;margin-top:6px;font-size:13px">${esc(reqv)}</textarea>
        <input type="text" name="fee_${esc(p.id)}" maxlength="200" value="${esc(feev)}" placeholder="${t('eo.ev.feePh')}" style="width:100%;box-sizing:border-box;margin-top:6px;font-size:13px">
      </div>
    </div>`;
  }).join('');
  const body = `<div class="wrap">
  <a href="/eo/events?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
  ${staffHead(staff, editing ? t('eo.ev.editTitle') : t('eo.ev.createTitle'), L)}
  <p class="sub">${t('eo.ev.formSub')}</p>
  ${eb}
  <form method="post" action="${action}" enctype="multipart/form-data" class="card" style="margin-top:14px;max-width:720px">
    <div style="font-weight:700;margin-bottom:6px">${t('eo.ev.sec.info')}</div>
    ${field('name', t('eo.ev.f.name'), e.name, 'text', true, 'maxlength="140"')}
    <div class="field"><label for="category">${t('eo.ev.f.category')}${rq}</label>
      <input type="text" id="category" name="category" required maxlength="80" list="evcats" value="${esc(e.category || '')}" placeholder="${t('eo.ev.f.categoryPh')}">
      <datalist id="evcats"><option value="Marathon"><option value="Fun Run"><option value="Trail Run"><option value="HYROX / Fungsional"><option value="Triathlon"><option value="Turnamen"><option value="Konser"><option value="Expo"></datalist>
    </div>
    <div class="field"><label for="description">${t('eo.ev.f.desc')}</label><textarea id="description" name="description" rows="4" maxlength="4000">${esc(e.description || '')}</textarea></div>
    ${field('location', t('eo.ev.f.location'), e.location, 'text', true, 'maxlength="200"')}
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px">${field('starts_at', t('eo.ev.f.startDate'), dval(e.starts_at), 'date', true, '')}</div>
      <div style="flex:1;min-width:150px">${field('ends_at', t('eo.ev.f.endDate'), dval(e.ends_at), 'date', false, '')}</div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px">${field('start_time', t('eo.ev.f.startTime'), e.start_time, 'time', false, '')}</div>
      <div style="flex:1;min-width:150px">${field('end_time', t('eo.ev.f.endTime'), e.end_time, 'time', false, '')}</div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px">${field('reg_open', t('eo.ev.f.regOpen'), dval(e.reg_open), 'date', false, '')}</div>
      <div style="flex:1;min-width:150px">${field('reg_deadline', t('eo.ev.f.deadline'), dval(e.reg_deadline), 'date', false, '')}</div>
    </div>
    <div class="field"><label for="status">${t('eo.ev.f.status')}</label>
      <select id="status" name="status">
        <option value="draft"${status === 'draft' ? ' selected' : ''}>${t('eo.ev.status.draft')}</option>
        <option value="published"${status === 'published' ? ' selected' : ''}>${t('eo.ev.status.published')}</option>
      </select>
      <p class="muted" style="font-size:12px;margin:6px 0 0">${t('eo.ev.statusHint')}</p>
    </div>
    <div class="field">
      <label>${t('eo.ev.f.poster')}</label>
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        ${e.mockup_url ? `<img src="${esc(e.mockup_url)}" alt="" style="width:120px;height:80px;object-fit:cover;border-radius:10px;border:1px solid var(--line);flex-shrink:0" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;min-width:180px"><input type="file" name="poster" accept="image/*"><p class="muted" style="font-size:12px;margin:6px 0 0">${t('eo.ev.f.posterHint')}</p></div>
      </div>
    </div>
    <div style="font-weight:700;margin:20px 0 2px">${t('eo.ev.sec.positions')}${rq}</div>
    <p class="muted" style="font-size:12.5px;margin:2px 0 4px">${t('eo.ev.positionsHint')}</p>
    <div id="posmList">${posRows}</div>
    <button type="submit" class="btn btn-block" style="margin-top:22px">${editing ? t('btn.save') : t('eo.ev.saveEvent')}</button>
  </form>
</div>
<script>
(function(){
  var list=document.getElementById('posmList'); if(!list) return;
  [].slice.call(list.querySelectorAll('.posm-row')).forEach(function(r){
    var cb=r.querySelector('.posm-cb'), q=r.querySelector('.posm-q'), ex=r.querySelector('.posm-extra');
    if(!cb||!q) return;
    function sync(){ if(ex) ex.style.display = cb.checked ? '' : 'none'; }
    cb.addEventListener('change',function(){ if(!cb.checked){ q.value=''; } else if(!q.value){ q.value='1'; q.focus(); } sync(); });
    q.addEventListener('input',function(){ cb.checked = (parseInt(q.value,10)||0)>0; sync(); });
  });
})();
</script>`;
  return appLayout({ title: (editing ? t('eo.ev.editTitle') : t('eo.ev.createTitle')) + ' — 20FIT', body, role: 'eo', active: 'events', user: staff.name, lang: L });
}

function eoEventDetail({ staff, event, view, applicants, flash, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const e = event || {};
  const aps = applicants || [];
  const f = flash || {};
  const flashBanner = f.ok === 'accepted' ? `<div class="banner banner-ok">${t('eo.ap.okAccepted')}</div>`
    : f.ok === 'rejected' ? `<div class="banner banner-ok">${t('eo.ap.okRejected')}</div>`
    : f.err === 'full' ? `<div class="banner banner-err">${t('eo.ap.errFull')}</div>` : '';
  const date = e.starts_at ? fmtDay(e.starts_at) + (e.ends_at && e.ends_at !== e.starts_at ? ' – ' + fmtDay(e.ends_at) : '') : '—';
  const timeLine = e.start_time ? ` · ${esc(e.start_time)}${e.end_time ? '–' + esc(e.end_time) : ''}` : '';
  const posCards = view.positions.length ? view.positions.map((p) => `<div class="card" style="margin:0;padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b>${esc(posLabel(p, L))}</b>${p.full ? `<span class="pill" style="background:var(--err-soft);color:var(--err)">${t('eo.ev.full')}</span>` : `<span class="pill pill-ok">${t('eo.ev.openPos')}</span>`}
    </div>
    <div style="font-size:26px;font-weight:800;margin-top:8px">${p.filled}<span class="muted" style="font-size:15px;font-weight:600"> / ${p.quota}</span></div>
    <div class="muted" style="font-size:12px">${t('eo.ev.filledNeeded')}</div>
  </div>`).join('') : `<p class="muted">${t('eo.ev.noPositions')}</p>`;
  let closeBtn = '';
  if (view.status === 'closed') closeBtn = `<form class="inline-form" method="post" action="/eo/events/${esc(e.id)}/close"><input type="hidden" name="reopen" value="1"><button class="btn btn-ghost btn-sm">${t('eo.ev.reopen')}</button></form>`;
  else if (view.status === 'published') closeBtn = `<form class="inline-form" method="post" action="/eo/events/${esc(e.id)}/close" ${jsConfirm(t('eo.ev.closeConfirm'))}><button class="btn btn-ghost btn-sm">${t('eo.ev.close')}</button></form>`;
  const body = `<div class="wrap">
  <a href="/eo/events?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
  ${flashBanner}
  ${e.mockup_url ? `<img src="${esc(e.mockup_url)}" alt="" class="ev-detail-hero" onerror="this.style.display='none'">` : ''}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
    <div><h1 style="margin:0">${esc(e.name)}</h1><p class="sub" style="margin:4px 0 0">${e.category ? esc(e.category) + ' · ' : ''}${date}${timeLine}</p></div>
    <div style="display:flex;gap:8px;align-items:center">${eoRegBadge(view.status, L)}<a href="/eo/events/${esc(e.id)}/edit?lang=${L}" class="btn btn-ghost btn-sm">✎ ${t('btn.edit')}</a>${closeBtn}</div>
  </div>
  ${e.location ? `<div class="muted" style="margin-top:8px">📍 ${esc(e.location)}</div>` : ''}
  ${e.reg_deadline ? `<div class="muted" style="margin-top:4px">⏳ ${t('eo.ev.deadlineLabel')}: ${fmtDay(e.reg_deadline)}</div>` : ''}
  ${e.description ? `<p style="white-space:pre-wrap;margin-top:14px">${esc(e.description)}</p>` : ''}
  <div style="display:flex;gap:12px;align-items:center;margin-top:20px">
    <div style="font-weight:700">${t('eo.ev.positionsQuota')}</div>
    <span class="muted" style="font-size:13px">${t('eo.ev.th.applies')}: <b style="color:var(--ink)">${view.applyCount}</b></span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:10px">${posCards}</div>
  ${eoApplicantsSection(e, view, aps, L)}
</div>${eoApplicantsScript()}`;
  return appLayout({ title: e.name + ' — 20FIT', body, role: 'eo', active: 'events', user: staff.name, lang: L });
}

// Tahap 6: applicants for one EO event — per-talent and per-position, with a
// name search + status filter (all client-side). Contact is shown so the EO
// can coordinate with talents who applied.
function eoApplicantsSection(e, view, aps, L) {
  const t = (k, v) => tr(L, k, v);
  const posById = new Map((view.positions || []).map((p) => [p.position_id, p]));
  const posLbl = (pid) => { const p = posById.get(pid); return p ? posLabel(p, L) : pid; };
  const header = `<div class="section-head" style="margin-top:26px"><h2 style="margin:0">${t('eo.ap.title')}</h2>
    <span class="muted" style="font-size:13px">${t('eo.ap.count', { n: aps.length })}</span></div>`;
  if (!aps.length) return `${header}<p class="muted" style="margin-top:12px">${t('eo.ap.none')}</p>`;

  const choiceChips = (choices, status) => choices.map((c) => {
    const on = c.accepted;
    // Once the talent is accepted somewhere, their other (lower-priority) choices
    // are auto-closed — show them dimmed/struck so the EO sees they're not needed.
    const closed = !on && status === 'approved';
    const style = on ? ';background:var(--ok-soft);color:var(--ok);font-weight:700' : (closed ? ';opacity:.5;text-decoration:line-through' : '');
    const title = on ? esc(t('eo.ap.acceptedHere')) : (closed ? esc(t('ta.autoClosed')) : '');
    return `<span class="tag" style="margin:0 6px 6px 0;display:inline-block${style}" title="${title}">P${c.priority} · ${esc(posLbl(c.position_id))}${on ? ' ✓' : ''}</span>`;
  }).join('');
  const contactLine = (a) => {
    const bits = [];
    if (a.phone) bits.push(`📱 ${esc(a.phone)}`);
    if (a.instagram) bits.push(`📷 @${esc(a.instagram)}`);
    if (a.city) bits.push(`📍 ${esc(a.city)}`);
    if (a.login) bits.push(`✉️ ${esc(a.login)}`);
    return bits.length ? `<div class="muted" style="font-size:12.5px;margin-top:6px">${bits.join(' · ')}</div>` : '';
  };
  // HYROX certification signal for the EO's decision (Tahap 4). Only a verified
  // cert is a positive signal; "pending" tells the EO one is awaiting review.
  const hyroxBadge = (a) => {
    if (a.hyroxStatus === 'verified') return `<div style="margin-top:8px"><span class="pill pill-ok">🏅 ${t('eo.ap.hyroxOk')}</span></div>`;
    if (a.hyroxStatus === 'pending') return `<div style="margin-top:8px"><span class="pill pill-off">🏅 ${t('eo.ap.hyroxPending')}</span></div>`;
    return '';
  };

  // Accept / reject controls per applicant. Accept is offered per chosen
  // position that still has quota; a full position is shown disabled.
  const decisionControls = (a) => {
    const base = `/eo/events/${esc(e.id)}/applicants/${esc(a.id)}`;
    const acceptedChoice = a.choices.find((c) => c.accepted);
    if (a.status === 'approved' && acceptedChoice) {
      return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <span class="pill pill-ok">✓ ${esc(t('eo.ap.acceptedAs', { pos: posLbl(acceptedChoice.position_id) }))}</span>
        <form class="inline-form" method="post" action="${base}/reset"><button class="btn btn-ghost btn-sm">${t('eo.ap.undo')}</button></form>
      </div>`;
    }
    if (a.status === 'rejected') {
      return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <form class="inline-form" method="post" action="${base}/reset"><button class="btn btn-ghost btn-sm">${t('eo.ap.undo')}</button></form>
      </div>`;
    }
    const acceptBtns = a.choices.map((c) => {
      const p = posById.get(c.position_id) || {};
      if (p.full) return `<button type="button" class="btn btn-ghost btn-sm" disabled style="opacity:.55">P${c.priority} ${esc(posLbl(c.position_id))} · ${t('eo.ap.posFull')}</button>`;
      return `<form class="inline-form" method="post" action="${base}/accept"><input type="hidden" name="position_id" value="${esc(c.position_id)}"><button class="btn btn-sm">${t('eo.ap.accept')}: P${c.priority} ${esc(posLbl(c.position_id))}</button></form>`;
    }).join('');
    return `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">${t('eo.ap.decide')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${acceptBtns}
        <form class="inline-form" method="post" action="${base}/reject" ${jsConfirm(t('eo.ap.rejectConfirm'))}><button class="btn btn-ghost btn-sm" style="color:var(--red)">${t('eo.ap.reject')}</button></form>
      </div>
    </div>`;
  };

  // Per-talent cards
  const talentCards = aps.map((a) => `<div class="card ap-item" data-status="${esc(a.status)}" data-search="${esc((a.name || '').toLowerCase())}" style="margin-top:12px;padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="min-width:0"><b style="font-size:15px">${esc(a.name)}</b>${a.type ? ` <span class="muted" style="font-size:12.5px">· ${esc(talentLabel(L, a.type))}</span>` : ''}</div>
      ${talentStatusBadge(a.status, L)}
    </div>
    ${contactLine(a)}
    ${hyroxBadge(a)}
    <div style="margin-top:10px">${choiceChips(a.choices, a.status)}</div>
    ${decisionControls(a)}
  </div>`).join('');

  // Per-position groups
  const posGroups = (view.positions || []).map((p) => {
    const rows = aps.map((a) => { const c = a.choices.find((x) => x.position_id === p.position_id); return c ? { a, c } : null; })
      .filter(Boolean).sort((x, y) => x.c.priority - y.c.priority);
    const list = rows.length ? rows.map(({ a, c }) => `<div class="dl-item ap-item" data-status="${esc(a.status)}" data-search="${esc((a.name || '').toLowerCase())}" style="align-items:center">
      <div style="min-width:0"><span class="tag" style="margin-right:8px">P${c.priority}</span><b>${esc(a.name)}</b>${a.type ? ` <span class="muted" style="font-size:12px">· ${esc(talentLabel(L, a.type))}</span>` : ''}${c.accepted ? ` <span class="pill pill-ok">${t('eo.ap.acceptedHere')}</span>` : ''}</div>
      ${talentStatusBadge(a.status, L)}
    </div>`).join('') : `<p class="muted" style="font-size:12.5px;margin:8px 0 0">${t('eo.ap.noApplicantsPos')}</p>`;
    return `<div class="card" style="margin-top:12px;padding:14px 16px">
      <div style="font-weight:700">${esc(posLabel(p, L))} <span class="muted" style="font-weight:600;font-size:12.5px">(${p.filled} / ${p.quota})</span></div>
      <div class="dl-list" style="margin-top:8px">${list}</div>
    </div>`;
  }).join('');

  // Status filter chips (all + distinct statuses present)
  const statuses = Array.from(new Set(aps.map((a) => a.status)));
  const sChip = (v, label, on) => `<button type="button" class="ev-chip${on ? ' is-on' : ''}" data-apstatus="${esc(v)}">${esc(label)}</button>`;
  const statusChips = sChip('all', t('eo.ap.filterAll'), true) + statuses.map((s) => sChip(s, t('ta.status.' + s), false)).join('');

  return `${header}
  <div class="card" style="margin-top:14px;padding:12px 14px">
    <input type="text" id="apSearch" placeholder="${esc(t('eo.ap.searchPh'))}" autocomplete="off" inputmode="search" style="width:100%;box-sizing:border-box">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${statusChips}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button type="button" class="ev-chip is-on" data-aptab="talent">${t('eo.ap.byTalent')}</button>
      <button type="button" class="ev-chip" data-aptab="position">${t('eo.ap.byPosition')}</button>
    </div>
  </div>
  <div id="apTalent">${talentCards}</div>
  <div id="apPosition" style="display:none">${posGroups}</div>
  <p class="muted" id="apNoMatch" style="margin-top:16px;display:none">${t('eo.ap.noMatch')}</p>`;
}

function eoApplicantsScript() {
  return `<script>
(function(){
  var search=document.getElementById('apSearch'); if(!search) return;
  var noMatch=document.getElementById('apNoMatch');
  var talentBox=document.getElementById('apTalent'), posBox=document.getElementById('apPosition');
  var statusChips=[].slice.call(document.querySelectorAll('[data-apstatus]'));
  var tabChips=[].slice.call(document.querySelectorAll('[data-aptab]'));
  var flt='all', tab='talent';
  function apply(){
    var q=search.value.trim().toLowerCase();
    var box=tab==='talent'?talentBox:posBox;
    var items=[].slice.call(box.querySelectorAll('.ap-item'));
    var shown=0;
    items.forEach(function(it){
      var okS=(flt==='all')||(it.getAttribute('data-status')===flt);
      var okQ=!q||(it.getAttribute('data-search')||'').indexOf(q)>=0;
      var vis=okS&&okQ; it.style.display=vis?'':'none'; if(vis)shown++;
    });
    if(noMatch)noMatch.style.display=(tab==='talent'&&shown===0)?'':'none';
  }
  search.addEventListener('input',apply);
  statusChips.forEach(function(c){c.addEventListener('click',function(){statusChips.forEach(function(x){x.classList.remove('is-on');});c.classList.add('is-on');flt=c.getAttribute('data-apstatus');apply();});});
  tabChips.forEach(function(c){c.addEventListener('click',function(){tabChips.forEach(function(x){x.classList.remove('is-on');});c.classList.add('is-on');tab=c.getAttribute('data-aptab');talentBox.style.display=tab==='talent'?'':'none';posBox.style.display=tab==='position'?'':'none';apply();});});
})();
</script>`;
}

/**
 * Staff dashboard, role-aware.
 *   super_admin: EO management + campaign management + all talent submissions.
 *   eo:          read-only view of talent submissions (no EO/super-admin visibility).
 */
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '–';
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function statusBadge(status, lang) {
  const cls = { extracted: 'pill-ok', verified: 'pill-ok' }[status] || 'pill-off';
  const label = tr(lang, 'status.' + status, {}) !== 'status.' + status ? tr(lang, 'status.' + status) : (status || '—');
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}
function statsLine(x, lang, days, settings) {
  if (!x) return '<span class="muted">—</span>';
  const metrics = [
    ['views', '👁'], ['likes', '❤️'], ['comments', '💬'], ['saves', '🔖'], ['shares', '📤'],
  ];
  const rows = metrics
    .filter(([k]) => x[k] !== null && x[k] !== undefined && x[k] !== '')
    .map(([k, icon]) => {
      const c = slaColor(metricClass(k, x[k], days, settings));
      return `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span class="muted">${icon} ${tr(lang, 'stats.' + k)}</span><b${c ? ` style="color:${c}"` : ''}>${fmtNum(x[k])}</b></div>`;
    });
  const plat = x.platform
    ? `<div style="text-transform:capitalize;font-weight:700;margin-bottom:2px">${esc(x.platform)}</div>` : '';
  if (!rows.length) return `${plat || ''}<span class="muted">—</span>`;
  return `<div style="min-width:160px;max-width:230px">${plat}${rows.join('')}</div>`;
}

/** Days from today (UTC) to a "YYYY-MM-DD" date; negative = past. null if unparseable. */
function daysToDate(dateStr) {
  if (!dateStr) return null;
  const p = String(dateStr).slice(0, 10).split('-');
  if (p.length !== 3) return null;
  const target = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(target)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

/** KOL's assigned campaigns as a notification-style list (deadline + upload status). */
function assignmentCards(assignments, lang) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  if (!assignments || !assignments.length) return '';
  const neutral = 'background:var(--card2);color:var(--muted)';
  const cards = assignments.map((a) => {
    let badge;
    if (a.hasProof) {
      badge = `<span class="dl-when" style="background:var(--ok-soft);color:var(--ok)">✓ ${t('kol.uploaded')}</span>`;
    } else {
      const diff = daysToDate(a.ends_at);
      if (diff !== null && diff < 0) badge = `<span class="dl-when dl-late">${t('dash.overdueBy', { n: -diff })}</span>`;
      else if (diff === 0) badge = `<span class="dl-when dl-near">${t('dash.dueToday')}</span>`;
      else if (diff !== null && diff <= 3) badge = `<span class="dl-when dl-near">${t('dash.dueIn', { n: diff })}</span>`;
      else badge = `<span class="dl-when" style="${neutral}">${t('kol.notUploaded')}</span>`;
    }
    const deadline = a.ends_at ? `<div class="muted" style="font-size:12px;margin-top:3px">${t('kol.deadlineLabel', { date: fmtDay(a.ends_at) })}</div>` : '';
    return `<div class="dl-item"><div><b>${esc(a.event_name)}</b>${deadline}</div>${badge}</div>`;
  }).join('');
  return `<div class="section-head" style="margin-top:22px"><h2 style="margin:0">📋 ${t('kol.myCampaigns')}</h2></div>
  <p class="muted" style="font-size:13px;margin-top:6px">${t('kol.assignedNote')}</p>
  <div class="card" style="margin-top:12px"><div class="dl-list" style="margin-top:0">${cards}</div></div>`;
}

/** KOL proof-upload page: upload a post screenshot to be auto-extracted, and list own proofs. */
function kolProofPage({ talent, events, proofs, assignments, errors, lang, settings }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const noEvents = !events || events.length === 0;
  const eventOpts = (events || []).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  const proofCards = (proofs && proofs.length) ? proofs.map((p) => {
    const days = daysLive(p.posted_at, p.created_at);
    return `
    <div class="card" style="display:flex;gap:14px;align-items:flex-start;margin-top:12px">
      ${p.thumb ? `<a href="${esc(p.thumb)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid var(--line);flex-shrink:0"></a>` : ''}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(p.event_name || t('kol.noEvent'))}</b>${statusBadge(p.status, L)}</div>
        <div style="font-size:14px;margin-top:6px">${statsLine(p.extracted, L, days, settings)}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">${fmtDate(p.created_at)}${p.post_link ? ` · <a href="${esc(p.post_link)}" target="_blank" rel="noopener">${t('kol.postLink')}</a>` : ''}</div>
        <div style="margin-top:6px">${plausibilityBadge(p.posted_at, p.created_at, p.extracted, settings, L)}</div>
      </div>
    </div>`;
  }).join('') : `<p class="muted" style="margin-top:12px">${t('kol.empty')}</p>`;

  const body = `<div class="wrap narrow">
  <h1 style="margin-top:0">${t('kol.title')}</h1>
  <p class="sub">${t('kol.greeting', { name: esc((talent && talent.name) || '') })}</p>
  ${errorBanner}
  ${assignmentCards(assignments, L)}
  ${noEvents ? `<div class="banner banner-warn">${t('kol.noEvents')}</div>` : ''}
  <form class="card" method="post" action="/kol/proofs" enctype="multipart/form-data">
    <div class="field">
      <label for="event_id">${t('kol.eventLabel')}</label>
      <select id="event_id" name="event_id" required ${noEvents ? 'disabled' : ''}>
        <option value="" disabled selected>${t('kol.pickEvent')}</option>${eventOpts}
      </select>
    </div>
    <div class="field">
      <label>${t('kol.ssLabel')} <span class="hint">${t('kol.ssHint')}</span></label>
      <input type="file" name="screenshot" accept="image/*" required>
    </div>
    <div class="field">
      <label for="post_link">${t('kol.linkLabel')} <span class="hint">${t('kol.linkHint')}</span></label>
      <input type="url" id="post_link" name="post_link" placeholder="https://instagram.com/p/…">
    </div>
    <div class="field">
      <label for="posted_at">${t('kol.postedLabel')} <span class="hint">${t('kol.postedHint')}</span></label>
      <input type="datetime-local" id="posted_at" name="posted_at">
    </div>
    <button type="submit" class="btn btn-block" ${noEvents ? 'disabled' : ''}>${t('kol.uploadBtn')}</button>
  </form>

  <div class="section-head"><h2 style="margin:0">${t('kol.myProofs')}</h2></div>
  ${proofCards}
</div>`;
  return appLayout({ title: t('kol.title') + ' — 20FIT', body, role: 'kol', active: 'proofs', user: (talent && talent.name) || '', lang: L });
}

/** Talent's own profile (Data Diri) + earned certificates, in the app shell. */
function kolProfilePage({ account, certs, events, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const acc = account || {};
  // Modern profile header bits: initial avatar (personalised colour), @handle, role, bio.
  const initial = ((acc.name || '?').trim()[0] || '?').toUpperCase();
  let hsum = 0; const nm = acc.name || '?'; for (let i = 0; i < nm.length; i++) hsum += nm.charCodeAt(i);
  const hue = hsum % 360;
  const avatarBg = `linear-gradient(135deg,hsl(${hue},70%,56%),hsl(${(hue + 30) % 360},68%,44%))`;
  const handle = acc.instagram ? '@' + esc(acc.instagram) : (acc.login ? '@' + esc(String(acc.login).split('@')[0]) : '');
  const roleLabel = talentLabel(L, acc.talent_type);
  const bio = acc.experience || '';
  const certList = (certs && certs.length)
    ? `<div class="dl-list">${certs.map((c) => `<div class="dl-item" style="align-items:center">
        <div style="min-width:0"><b>${esc(c.event_name)}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${esc(c.role || '')}${c.event_date ? ' · ' + esc(c.event_date) : ''}</div><div class="muted" style="font-size:11.5px;margin-top:2px">${esc(c.cert_no)}</div></div>
        <a href="/kol/sertifikat/${esc(c.id)}" class="btn btn-sm" style="flex-shrink:0">⬇ ${t('cert.download')}</a>
      </div>`).join('')}</div>`
    : `<p class="muted" style="margin-top:12px">${t('cert.empty')}</p>`;
  const evDate = (e) => { const s = e.starts_at ? fmtDay(e.starts_at) : ''; const en = e.ends_at && String(e.ends_at) !== String(e.starts_at) ? fmtDay(e.ends_at) : ''; return en ? s + ' – ' + en : s; };
  const evList = (events && events.length)
    ? `<div class="dl-list">${events.map((e) => `<div class="dl-item" style="display:block">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="min-width:0"><b>${esc(e.name)}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${esc(evDate(e))}${e.station ? ' · ' + esc(e.station) : ''}</div></div>
          ${mpStatusBadge(e.status, L)}
        </div>
        ${applicationTracker(e.status, L)}
      </div>`).join('')}</div>`
    : `<p class="muted" style="margin-top:12px">${t('prof.eventsEmpty')}</p>`;
  const ddPath = '/' + (acc.talent_type || 'kol').replace(/_/g, '-') + '/data-diri?lang=' + L;
  const body = `<div class="wrap narrow">
  <style>.prof-details>summary{list-style:none}.prof-details>summary::-webkit-details-marker{display:none}.prof-caret::after{content:' ⌄';display:inline-block;transition:transform .2s}.prof-details[open] .prof-caret::after{transform:rotate(180deg)}
  .pc-card{display:flex;align-items:center;gap:15px;background:linear-gradient(135deg,#ff2a37,#c00c17);color:#fff;border-radius:16px;padding:16px 18px;text-decoration:none;margin:0 0 16px;box-shadow:0 12px 28px rgba(228,18,31,.30);transition:transform .15s,box-shadow .15s}
  .pc-card:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(228,18,31,.36)}
  .pc-ic{flex:0 0 auto;width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;color:#fff}
  .pc-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .pc-title{font-weight:800;font-size:16px;line-height:1.2}
  .pc-sub{font-size:12.5px;line-height:1.4;color:rgba(255,255,255,.92)}
  .pc-cta{flex:0 0 auto;background:#fff;color:var(--red);font-weight:800;font-size:13px;padding:11px 16px;border-radius:999px;white-space:nowrap}
  @media(max-width:560px){.pc-card{flex-wrap:wrap;gap:12px}.pc-cta{width:100%;text-align:center;order:3}}</style>
  ${!acc.profile_completed_at ? `<a href="${ddPath}" class="pc-card">
    <span class="pc-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M19 8v4M17 10h4"/></svg></span>
    <span class="pc-body"><span class="pc-title">${esc(t('prof.completeTitle'))}</span><span class="pc-sub">${esc(t('prof.completePrompt'))}</span></span>
    <span class="pc-cta">${esc(t('prof.completeCta'))} →</span>
  </a>` : ''}
  <div class="card" style="margin-top:0;padding:22px 20px">
    <div style="display:flex;gap:18px;align-items:center">
      <div style="width:84px;height:84px;border-radius:50%;background:${avatarBg};color:#fff;font:800 36px/1 Barlow,sans-serif;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 14px rgba(0,0,0,.14)">${esc(initial)}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:22px;font-weight:800;line-height:1.15;word-break:break-word">${esc(acc.name || '—')}</div>
        <div class="muted" style="font-size:14px;margin-top:3px;word-break:break-word">${handle}</div>
      </div>
    </div>
    ${bio ? `<p style="font-size:14px;line-height:1.6;margin:16px 0 0;color:var(--muted);white-space:pre-wrap">${esc(bio)}</p>` : ''}
    <a href="/kol/data-diri?edit=1&lang=${L}" class="btn btn-block" style="margin-top:18px">✎ ${t('prof.edit')}</a>
  </div>

  <details class="prof-details" style="margin-top:24px">
    <summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:800;font-size:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 18px">
      <span>${t('prof.dataTitle')}</span>
      <span class="muted prof-caret" style="font-weight:600;font-size:13px">${t('prof.showDetail')}</span>
    </summary>
    <div class="card" style="margin-top:10px">${talentProfileBlock(acc, L)}</div>
  </details>

  <div class="section-head" style="margin-top:24px"><h2 style="margin:0;font-size:16px">📅 ${t('prof.eventsTitle')}</h2></div>
  ${evList}

  <div class="section-head" style="margin-top:24px"><h2 style="margin:0;font-size:16px">🎖️ ${t('cert.myTitle')}</h2></div>
  ${certList}

  <div class="section-head" style="margin-top:24px"><h2 style="margin:0;font-size:16px">📄 ${t('doc.title')}</h2></div>
  <a href="/kol/dokumen?lang=${L}" class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;text-decoration:none;color:inherit">
    <span style="min-width:0"><b>${t('doc.manage')}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${t('doc.manageSub')}</div></span>
    <span style="font-size:22px;flex-shrink:0">›</span>
  </a>

  <form method="post" action="/kol/logout" style="margin-top:26px"><button class="btn btn-ghost btn-block">${t('nav.logout')}</button></form>
</div>`;
  return appLayout({ title: t('nav.profile') + ' — 20FIT', body, role: 'kol', active: 'profil', user: acc.name, lang: L });
}

/**
 * Talent "Dokumen Saya" page: optional CV + portfolio link (content creators)
 * and an optional HYROX-360 certificate (all types) that the team verifies.
 * Files go to Supabase Storage via the same mechanism as post-proofs; the
 * portfolio is a plain URL. Reused by KOL (appLayout) and Main Power (layout).
 */
function talentDocuments(type, opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type);
  const acc = opts.account || {};
  const v = opts.values || acc;
  const isCreator = (type === 'kol');
  const opt = ` <span class="hint">${t('dd.optional')}</span>`;
  const reqCreator = ` <span class="hint" style="color:var(--red);font-weight:600">${t('doc.reqCreator')}</span>`;
  const errorBanner = (opts.errors && opts.errors.length)
    ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${opts.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const flashBanner = opts.flash === '1' ? `<div class="banner banner-ok">${t('doc.saved')}</div>` : '';
  const needBanner = opts.need ? `<div class="banner banner-warn">${t('doc.needBanner')}</div>` : '';

  const fileRow = (kind, stored) => stored
    ? `<div style="font-size:13px;margin:6px 0"><a href="/${p}/dokumen/file/${kind}?lang=${L}" target="_blank" rel="noopener">📎 ${t('doc.view')}</a> <span class="muted">· ${t('doc.replaceHint')}</span></div>`
    : '';

  const hxStatus = acc.hyrox_cert_status || 'none';
  const hxBadge = {
    pending:  `<span class="pill pill-off">⏳ ${t('doc.hx.pending')}</span>`,
    verified: `<span class="pill pill-ok">✓ ${t('doc.hx.verified')}</span>`,
    rejected: `<span class="pill" style="background:var(--err-soft);color:var(--err)">✕ ${t('doc.hx.rejected')}</span>`,
  }[hxStatus] || '';
  const hxNote = (hxStatus === 'rejected' && acc.hyrox_cert_note)
    ? `<div class="muted" style="font-size:12.5px;margin-top:4px">${esc(acc.hyrox_cert_note)}</div>` : '';

  const creatorFields = isCreator ? `
    <div class="field">
      <label>${t('doc.cv')}${reqCreator}</label>
      ${fileRow('cv', acc.cv_path)}
      <input type="file" name="cv" accept=".pdf,image/*">
      <div class="hint" style="margin-top:6px">${t('doc.fileHint')}</div>
    </div>
    <div class="field">
      <label for="portfolio_url">${t('doc.portfolio')}${reqCreator}</label>
      <input type="url" id="portfolio_url" name="portfolio_url" maxlength="500" placeholder="https://…" value="${esc(v.portfolio_url || '')}">
      <div class="hint" style="margin-top:6px">${t('doc.portfolioHint')}</div>
    </div>` : '';

  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/${p}?lang=${L}" class="btn btn-ghost btn-sm" onclick="if(history.length>1){history.back();return false}">${t('common.back')}</a>
  </div>
  <h1>${t('doc.title')}</h1>
  <p class="sub">${t('doc.sub')}</p>
  ${needBanner}
  ${flashBanner}
  ${errorBanner}
  <form class="card" method="post" action="/${p}/dokumen?lang=${L}" enctype="multipart/form-data">
    ${creatorFields}
    <div class="field">
      <label>${t('doc.hyrox')}${opt} ${hxBadge}</label>
      ${hxNote}
      ${fileRow('hyrox', acc.hyrox_cert_path)}
      <input type="file" name="hyrox_cert" accept=".pdf,image/*">
      <div class="hint" style="margin-top:6px">${t('doc.hyroxHint')}</div>
    </div>
    <button class="btn btn-block" style="margin-top:8px">${t('doc.save')}</button>
  </form>
</div>`;

  return type === 'kol'
    ? appLayout({ title: t('doc.title') + ' — 20FIT', body, role: 'kol', active: 'profil', user: acc.name, lang: L })
    : layout({ title: t('doc.title') + ' — 20FIT', body, brand: 'Main Power', home: '/main-power?lang=' + L, lang: L });
}

/** Public certificate verification page (reached from the cert's QR/number). */
function certVerifyPage({ cert, certNo, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const inner = cert
    ? `<div class="card success">
        <div class="check">✓</div>
        <h1>${t('cert.validTitle')}</h1>
        <p class="sub" style="margin:8px 0 20px">${t('cert.validSub')}</p>
        <div style="text-align:left;max-width:420px;margin:0 auto">
          ${[[t('cert.fName'), esc(cert.talent_name)], [t('cert.fRole'), esc(cert.role || '—')], [t('cert.fEvent'), esc(cert.event_name)], [t('cert.fDate'), esc(cert.event_date || '—')], [t('cert.fNo'), esc(cert.cert_no)]]
            .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)"><span class="muted" style="font-size:13px">${k}</span><b style="font-size:14px;text-align:right">${v}</b></div>`).join('')}
        </div>
      </div>`
    : `<div class="card success">
        <div class="check" style="background:var(--err-soft);color:var(--err)">!</div>
        <h1>${t('cert.invalidTitle')}</h1>
        <p class="sub" style="margin:8px auto 8px;max-width:420px">${t('cert.invalidSub', { no: esc(certNo || '') })}</p>
      </div>`;
  const body = `<div class="wrap narrow">
    <div style="text-align:center;margin-bottom:18px"><span style="font:800 22px/1 Barlow,sans-serif;color:var(--red)">20FIT</span> <span class="muted" style="font-size:13px">${t('cert.verifyBrand')}</span></div>
    ${inner}
  </div>`;
  return layout({ title: t('cert.verifyTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// Talent categories a person can apply as, per event (matches talent_event_needs).
const CAT_LABEL = { kol: 'KOL', fotografer: 'Photographer', main_power: 'Man Power' };
// Content-creator roles that must have a CV + portfolio on file before applying.
const CREATOR_ROLES = ['kol', 'fotografer', 'videografer'];
const hasCreatorDocs = (acc) => !!(acc && acc.cv_path && acc.portfolio_url && String(acc.portfolio_url).trim());
// Per-category application fields (beyond name + phone, which prefill from the
// profile). label/ph/hint are i18n keys. type: text|number|url. req: required.
const CAT_FIELDS = {
  kol: [
    { k: 'ig_username', label: 'apply.igUser', req: true, ph: 'apply.igUserPh' },
    { k: 'ig_link', label: 'apply.igLink', req: true, type: 'url', ph: 'apply.igLinkPh' },
    { k: 'followers', label: 'apply.followers', type: 'number' },
    { k: 'tiktok', label: 'apply.tiktok', ph: 'apply.tiktokPh' },
  ],
  fotografer: [
    { k: 'ig_username', label: 'apply.igUser', req: true, ph: 'apply.igUserPh' },
    { k: 'ig_link', label: 'apply.igLink', req: true, type: 'url', ph: 'apply.igLinkPh' },
    { k: 'portfolio_link', label: 'apply.portfolio', req: true, type: 'url', ph: 'apply.portfolioPh' },
    { k: 'camera', label: 'apply.camera', ph: 'apply.cameraPh' },
  ],
  main_power: [
    { k: 'bank_name', label: 'apply.bankName', req: true, ph: 'apply.bankNamePh' },
    { k: 'bank_account', label: 'apply.bankAccount', req: true, ph: 'apply.bankAccountPh' },
    { k: 'bank_holder', label: 'apply.bankHolder', req: true, ph: 'apply.bankHolderPh' },
  ],
};

/** Talent Home: available events + which talent categories each one needs. */
function kolEventsPage({ account, events, eoEvents, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const evs = events || [];
  const eoEvs = eoEvents || [];
  // EO position-based events show inline in the same list (newest reg-deadline first).
  const eoCards = eoEvs.map((e) => talentPositionCard(e, L, true)).join('');
  const cards = evs.map((e) => {
    const dateLine = e.starts_at ? `<div class="muted" style="font-size:12.5px;margin-top:3px">${fmtDay(e.starts_at)}${e.ends_at ? ' – ' + fmtDay(e.ends_at) : ''}</div>` : '';
    const locLine = e.location ? `<div class="muted" style="font-size:12.5px;margin-top:3px">📍 ${esc(e.location)}</div>` : '';
    const catBadges = (e.cats || []).map((c) => `<span class="tag" style="margin:0 6px 6px 0;display:inline-block">${esc(c.label)}${c.headcount ? ` ×${c.headcount}` : ''}</span>`).join('');
    let applied = '';
    if (e.applied) {
      const ap = e.applied;
      const stn = (ap.status === 'approved' && ap.station)
        ? `<div class="muted" style="font-size:12.5px;margin-top:6px">🎯 ${t('apply.station')}: <b style="color:var(--ink)">${esc(ap.station)}${ap.station_loc ? ' · ' + esc(ap.station_loc) : ''}</b></div>` : '';
      applied = `<div style="margin-top:10px">${mpStatusBadge(ap.status, L)} <span class="muted" style="font-size:12.5px">${t('apply.appliedAs', { cat: esc(CAT_LABEL[ap.category] || ap.category) })}</span>${stn}</div>`;
    }
    const hay = [e.name, e.location].filter(Boolean).join(' ').toLowerCase();
    return `<a href="/kol/event/${esc(e.id)}?lang=${L}" class="card ev-card ev-item" data-status="${esc(e.status || '')}" data-search="${esc(hay)}" style="display:block;text-decoration:none;color:inherit;margin-top:12px">
      ${eventCover(e, L)}
      <div style="min-width:0"><b style="font-size:16px">${esc(e.name)}</b>${dateLine}${locLine}</div>
      <div style="margin-top:10px">${catBadges || `<span class="muted" style="font-size:12.5px">${t('apply.noNeeds')}</span>`}</div>
      ${applied}
    </a>`;
  }).join('');

  const hasAny = evs.length || eoEvs.length;
  const chip = (f, label) => `<button type="button" class="ev-chip${f === 'all' ? ' is-on' : ''}" data-filter="${f}">${esc(label)}</button>`;
  const controls = hasAny ? `
  <div class="card" style="margin-top:14px;padding:12px 14px">
    <input type="text" id="evSearch" placeholder="${esc(t('ev.searchPh'))}" autocomplete="off" inputmode="search" style="width:100%;box-sizing:border-box">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${chip('all', t('ev.filterAll'))}${chip('ongoing', t('ev.status.ongoing'))}${chip('upcoming', t('ev.status.upcoming'))}
    </div>
  </div>` : '';

  const listBlock = hasAny
    ? `<div id="evList">${eoCards}${cards}</div><p class="muted" id="evNoMatch" style="margin-top:16px;display:none">${t('ev.noMatch')}</p>`
    : `<p class="muted" style="margin-top:12px">${t('dd.noEvents')}</p>`;

  const body = `<div class="wrap">
  <h1 style="margin-top:0">${t('ev.findTitle')}</h1>
  <p class="sub">${t('apply.homeSub')}</p>
  ${controls}
  ${listBlock}
</div>
<script>
(function(){
  var q=document.getElementById('evSearch'); if(!q) return;
  var items=[].slice.call(document.querySelectorAll('.ev-item'));
  var chips=[].slice.call(document.querySelectorAll('.ev-chip'));
  var noMatch=document.getElementById('evNoMatch');
  var flt='all';
  function apply(){
    var v=q.value.trim().toLowerCase(); var shown=0;
    items.forEach(function(it){
      var okS=(flt==='all')||(it.getAttribute('data-status')===flt);
      var okQ=!v||it.getAttribute('data-search').indexOf(v)>=0;
      var vis=okS&&okQ; it.style.display=vis?'':'none'; if(vis)shown++;
    });
    if(noMatch)noMatch.style.display=shown?'none':'';
  }
  q.addEventListener('input',apply);
  chips.forEach(function(c){c.addEventListener('click',function(){flt=c.getAttribute('data-filter');chips.forEach(function(x){x.classList.toggle('is-on',x===c);});apply();});});
})();
</script>`;
  return appLayout({ title: t('ev.findTitle') + ' — 20FIT', body, role: 'kol', active: 'event', user: (account && account.name) || '', lang: L });
}

/** Event detail: description + category the talent can register for (or their status). */
function kolEventDetail({ account, event, cats, myApplication, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const dateLine = event.starts_at ? `${fmtDay(event.starts_at)}${event.ends_at ? ' – ' + fmtDay(event.ends_at) : ''}` : '';
  const locLine = event.location ? `<div class="muted" style="font-size:13.5px;margin-top:6px">📍 ${esc(event.location)}</div>` : '';
  let action;
  if (myApplication && myApplication.status === 'approved') {
    const detailRow = (icon, label, value) => `<div style="margin-top:10px;font-size:14px">${icon} <span class="muted">${esc(label)}:</span> <b>${value}</b></div>`;
    const locRow = event.location ? detailRow('📍', t('apply.eventLoc'), esc(event.location)) : '';
    const stationRow = myApplication.station
      ? detailRow('🎯', t('apply.station'), esc(myApplication.station) + (myApplication.station_loc ? ' · ' + esc(myApplication.station_loc) : ''))
      : `<div class="muted" style="font-size:13px;margin-top:10px">🎯 ${t('apply.stationPending')}</div>`;
    action = `<div class="card" style="margin-top:16px;border:1px solid var(--ok);background:var(--ok-soft)">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${mpStatusBadge('approved', L)} <b style="font-size:16px">${t('apply.acceptedTitle')}</b></div>
      ${detailRow('🏷️', t('apply.category'), esc(CAT_LABEL[myApplication.talent_type] || myApplication.talent_type))}
      ${locRow}
      ${stationRow}
    </div>`;
  } else if (myApplication) {
    action = `<div class="card" style="margin-top:16px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('apply.yourApp')}</div>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${mpStatusBadge(myApplication.status, L)} <b>${esc(CAT_LABEL[myApplication.talent_type] || myApplication.talent_type)}</b></div>
      ${myApplication.status === 'rejected' && myApplication.note ? `<div class="muted" style="font-size:13px;margin-top:8px">${esc(myApplication.note)}</div>` : ''}
    </div>`;
  } else if (cats && cats.length) {
    const needDocs = !hasCreatorDocs(account) && cats.some((c) => CREATOR_ROLES.includes(c.type));
    const warn = needDocs ? `<div class="banner banner-warn" style="margin-bottom:12px">${t('doc.eventWarn')} <a href="/kol/dokumen?need=1&lang=${L}" style="font-weight:700;white-space:nowrap">${t('doc.completeNow')}</a></div>` : '';
    const btns = cats.map((c) => `<a href="/kol/event/${esc(event.id)}/apply?cat=${esc(c.type)}&lang=${L}" class="btn" style="margin:0 8px 8px 0">${t('apply.applyAs', { cat: esc(c.label) })}</a>`).join('');
    action = `<div class="card" style="margin-top:16px"><div style="font-weight:700;margin-bottom:12px">${t('apply.pickCat')}</div>${warn}${btns}</div>`;
  } else {
    action = `<div class="banner banner-warn" style="margin-top:16px">${t('apply.noNeeds')}</div>`;
  }
  const body = `<div class="wrap narrow">
  <a href="/kol/event?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
  ${event.mockup_url ? `<img src="${esc(event.mockup_url)}" alt="${esc(event.name)}" class="ev-detail-hero" onerror="this.style.display='none'">` : ''}
  <h1 style="margin-top:0">${esc(event.name)}</h1>
  ${dateLine ? `<p class="sub" style="margin-bottom:2px">${esc(dateLine)}</p>` : ''}
  ${locLine}
  <div style="margin-top:10px">${eventStatusBadge(event.status, L)}</div>
  ${event.description ? `<p style="white-space:pre-wrap;margin-top:14px">${esc(event.description)}</p>` : ''}
  ${action}
</div>`;
  return appLayout({ title: event.name + ' — 20FIT', body, role: 'kol', active: 'event', user: (account && account.name) || '', lang: L });
}

/** Dynamic registration form for one category (fields vary by category). */
function kolApplyForm({ account, event, cat, values, errors, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const v = values || {};
  const acc = account || {};
  const fields = CAT_FIELDS[cat] || [];
  const req = ' <span style="color:var(--red)">*</span>';
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const pf = (k, fallback) => esc(v[k] != null ? v[k] : (fallback || ''));
  const catFieldsHtml = fields.map((f) => `<div class="field">
      <label for="f_${f.k}">${t(f.label)}${f.req ? req : ` <span class="hint">${t('dd.optional')}</span>`}</label>
      <input type="${f.type || 'text'}" id="f_${f.k}" name="${f.k}"${f.req ? ' required' : ''}${f.type === 'number' ? ' min="0" inputmode="numeric"' : ''} maxlength="200"${f.ph ? ` placeholder="${esc(t(f.ph))}"` : ''} value="${esc(v[f.k] || '')}">
    </div>`).join('');
  const body = `<div class="wrap narrow">
  <a href="/kol/event/${esc(event.id)}?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
  <h1 style="margin-top:0">${t('apply.formTitle', { cat: esc(CAT_LABEL[cat] || cat) })}</h1>
  <p class="sub">${esc(event.name)}</p>
  ${errorBanner}
  <form class="card" method="post" action="/kol/event/${esc(event.id)}/apply">
    <input type="hidden" name="cat" value="${esc(cat)}">
    <div class="field"><label for="f_name">${t('common.fullname')}${req}</label>
      <input type="text" id="f_name" name="name" required maxlength="120" value="${pf('name', acc.name)}"></div>
    <div class="field"><label for="f_phone">${t('dd.phone')}${req}</label>
      <input type="tel" id="f_phone" name="phone" required maxlength="20" value="${pf('phone', acc.phone)}"></div>
    ${cat === 'main_power' ? `<div class="field"><label for="f_city">${t('dd.city')}${req}</label>
      <input type="text" id="f_city" name="city" required maxlength="80" value="${pf('city', acc.city)}"></div>` : ''}
    ${catFieldsHtml}
    <button type="submit" class="btn btn-block">${t('apply.submit')}</button>
  </form>
</div>`;
  return appLayout({ title: t('apply.formTitle', { cat: CAT_LABEL[cat] || cat }) + ' — 20FIT', body, role: 'kol', active: 'event', user: acc.name, lang: L });
}

/** Confirmation after a talent submits an event registration. */
function kolApplyDone({ account, event, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check">✓</div>
    <h1>${t('apply.doneTitle')}</h1>
    <p class="sub" style="margin:10px 0 24px">${t('apply.doneSub')}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a href="/kol/event/${esc(event.id)}?lang=${L}" class="btn btn-ghost">${esc(event.name)}</a>
      <a href="/kol/event?lang=${L}" class="btn">${t('nav.events')} →</a>
    </div>
  </div></div>`;
  return appLayout({ title: t('apply.doneTitle') + ' — 20FIT', body, role: 'kol', active: 'event', user: (account && account.name) || '', lang: L });
}

// ------------------------------------------------------------ Man Power ----

// The four on-ground jobdesks a Man Power talent can apply for.
const MP_JOBDESKS = ['Judges', 'Marshal', 'Drop Bag', 'Registrasi'];

// Stations an admin can assign an approved Man Power talent to.
const MP_STATIONS = [
  'Skierg', 'Rowing', 'Sled Push', 'Sled Pull', 'Wallball', 'Sandbag',
  'Farmers Carry', 'Burpee Broad Jump', 'Marshal In Station', 'Marshal Out Station',
  'Trafic Control', 'Time Keeper', 'Start Crew', 'Finish Crew', 'Bag Deposit',
  'Registrasi', 'Refreshment Crew', 'Water Station', 'Runner Crew',
];
/** <option> list for the station picker; keeps a legacy/free-text value selectable. */
function stationOptions(current, placeholder) {
  const cur = current == null ? '' : String(current);
  const inList = MP_STATIONS.some((s) => s === cur);
  const opts = [`<option value=""${cur === '' ? ' selected' : ''}>${esc(placeholder)}</option>`];
  if (cur !== '' && !inList) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
  for (const s of MP_STATIONS) opts.push(`<option value="${esc(s)}"${s === cur ? ' selected' : ''}>${esc(s)}</option>`);
  return opts.join('');
}

/** Application status badge: pending (warn) / approved (ok) / rejected (err). */
function mpStatusBadge(status, lang) {
  const L = normLang(lang);
  const style = status === 'approved' ? 'background:var(--ok-soft);color:var(--ok)'
    : status === 'rejected' ? 'background:var(--err-soft);color:var(--err)'
      : 'background:var(--warn-soft);color:var(--warn)';
  return `<span class="pill" style="${style}">${esc(tr(L, 'mp.status.' + (status || 'pending')))}</span>`;
}

/** Render a stored answer value (yes/no/partly/depends) as a localized label. */
function mpAnswerLabel(val, lang) {
  const L = normLang(lang);
  const map = { yes: 'mp.opt.yes', no: 'mp.opt.no', partly: 'mp.opt.partly', depends: 'mp.opt.depends' };
  return map[val] ? tr(L, map[val]) : (val || '—');
}

/**
 * Man Power dashboard: "Event Baru Untukmu" (events opening MP slots the talent
 * hasn't applied to) + "Aplikasi Saya" (their applications with live status).
 */
function mainPowerDashboard({ talent, openEvents, eoEvents, myApps, lang, applied }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const eoEvs = eoEvents || [];
  const eoCards = eoEvs.map((e) => talentPositionCard(e, L, false)).join('');
  const mpRows = (openEvents && openEvents.length) ? openEvents.map((e) => {
    const full = e.slotsLeft <= 0;
    // Slot counts are hidden from talents; only mark when registration is full.
    const slot = full ? `<div style="margin-top:8px"><span class="dl-when dl-late">${t('mp.slotFull')}</span></div>` : '';
    const dateLine = e.starts_at ? `<div class="muted" style="font-size:12.5px;margin-top:3px">${fmtDay(e.starts_at)}${e.ends_at ? ' – ' + fmtDay(e.ends_at) : ''}</div>` : '';
    return `<div class="dl-item" style="align-items:flex-start">
      <div style="min-width:0"><b>${esc(e.name)}</b>${dateLine}${slot}</div>
      ${full ? '' : `<a href="/main-power/apply/${esc(e.id)}?lang=${L}" class="btn btn-sm" style="flex-shrink:0">${t('mp.viewSow')}</a>`}
    </div>`;
  }).join('') : '';
  const openCards = (eoCards || mpRows)
    ? `${eoCards}${mpRows ? `<div class="dl-list">${mpRows}</div>` : ''}`
    : `<p class="muted" style="margin-top:12px">${t('mp.noOpenEvents')}</p>`;

  const appCards = (myApps && myApps.length) ? myApps.map((a) => {
    const station = (a.status === 'approved' && a.station)
      ? `<div class="muted" style="font-size:12.5px;margin-top:4px">${t('mp.station')}: <b style="color:var(--ink)">${esc(a.station)}${a.station_loc ? ' · ' + esc(a.station_loc) : ''}</b></div>` : '';
    const note = (a.status === 'rejected' && a.note) ? `<div class="muted" style="font-size:12.5px;margin-top:4px">${esc(a.note)}</div>` : '';
    return `<div class="dl-item" style="align-items:flex-start">
      <div style="min-width:0"><b>${esc(a.event_name || '—')}</b>
        <div class="muted" style="font-size:12.5px;margin-top:3px">${t('mp.role')}: ${esc(a.role || '—')}</div>${station}${note}</div>
      ${mpStatusBadge(a.status, L)}
    </div>`;
  }).join('') : `<p class="muted" style="margin-top:12px">${t('mp.noApps')}</p>`;

  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
  </div>
  <h1>${t('mp.dash.title')}</h1>
  <p class="sub">${t('mp.dash.greeting', { name: esc((talent && talent.name) || '') })}</p>
  ${applied ? `<div class="banner banner-ok">${t('mp.applied')}</div>` : ''}

  <a href="/main-power/dokumen?lang=${L}" class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;text-decoration:none;color:inherit">
    <span style="min-width:0"><b>📄 ${t('doc.title')}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${t('doc.manageHyrox')}</div></span>
    <span style="font-size:22px;flex-shrink:0">›</span>
  </a>

  <div class="section-head"><h2 style="margin:0">${t('mp.newEvents')}</h2></div>
  <p class="muted" style="font-size:13px;margin:6px 0 0">${t('mp.newEventsSub')}</p>
  ${openCards}

  <div class="section-head"><h2 style="margin:0">${t('mp.myApps')}</h2></div>
  <div class="dl-list">${appCards}</div>
</div>`;
  return layout({ title: t('mp.dash.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

/**
 * Man Power apply page: a 2-step form (SOW + jobdesk + agree, then the four
 * application questions). A small script reveals step 2; with JS off both steps
 * are visible and still submit. Step 3 ("Selesai") is the server-rendered
 * confirmation after POST.
 */
function mainPowerApply({ talent, event, customSow, jobdesks, lang, errors, values }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const v = values || {};
  jobdesks = jobdesks || MP_JOBDESKS;
  const errorBanner = (errors && errors.length)
    ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';

  const stepDot = (n, label, active, id) => `<div style="display:flex;align-items:center;gap:8px">
      <span ${id ? `id="${id}c"` : ''} style="width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;background:${active ? 'var(--red)' : 'var(--card2)'};color:${active ? '#fff' : 'var(--muted)'}">${n}</span>
      <span ${id ? `id="${id}l"` : ''} style="font-size:13px;font-weight:700;color:${active ? 'var(--ink)' : 'var(--muted)'}">${esc(label)}</span></div>`;
  const stepBar = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 20px">
      ${stepDot(1, t('mp.apply.step1'), true)}<span style="color:var(--line)">—</span>
      ${stepDot(2, t('mp.apply.step2'), false, 'mpDot2')}<span style="color:var(--line)">—</span>
      ${stepDot(3, t('mp.apply.step3'), false)}</div>`;

  const sowRows = [
    { k: t('mp.sow.taskK'), v: t('mp.sow.taskV') },
    { k: t('mp.sow.durK'), v: t('mp.sow.durV') },
    { k: t('mp.sow.benK'), v: t('mp.sow.benV') },
    { k: t('mp.sow.locK'), v: t('mp.sow.locV') },
    { k: t('mp.sow.dressK'), v: t('mp.sow.dressV') },
  ];
  const sowHtml = sowRows.map((r) => `<div style="padding:11px 0;border-bottom:1px solid var(--line)">
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${esc(r.k)}</div>
      <div style="margin-top:4px;font-size:14px">${esc(r.v)}</div></div>`).join('');
  const customSowHtml = customSow
    ? `<div class="banner banner-warn" style="margin:0 0 14px"><b>${t('mp.apply.customSowTitle')}</b><div style="margin-top:6px;white-space:pre-wrap">${esc(customSow)}</div></div>`
    : '';
  const roleOpts = `<option value="" disabled ${v.role ? '' : 'selected'}>${t('mp.apply.rolePick')}</option>`
    + jobdesks.map((j) => `<option value="${esc(j)}"${v.role === j ? ' selected' : ''}>${esc(j)}</option>`).join('');

  const OPT = {
    yn: [['yes', 'mp.opt.yes'], ['no', 'mp.opt.no']],
    yns: [['yes', 'mp.opt.yes'], ['no', 'mp.opt.no'], ['partly', 'mp.opt.partly']],
    ynd: [['yes', 'mp.opt.yes'], ['no', 'mp.opt.no'], ['depends', 'mp.opt.depends']],
  };
  const radios = (name, pairs) => `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">`
    + pairs.map(([val, key], i) => `<label style="flex:1;min-width:110px;display:flex;align-items:center;gap:8px;padding:11px 13px;border:1px solid var(--line);border-radius:11px;cursor:pointer;font-size:14px">
      <input type="radio" name="${name}" value="${val}" ${v[name] === val || (!v[name] && i === 0) ? 'checked' : ''} style="width:auto"> ${esc(t(key))}</label>`).join('')
    + `</div>`;

  const dateLine = event.starts_at ? `${fmtDay(event.starts_at)}${event.ends_at ? ' – ' + fmtDay(event.ends_at) : ''}` : '';

  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/main-power?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
  </div>
  <h1>${esc(event.name)}</h1>
  ${dateLine ? `<p class="sub">${esc(dateLine)}</p>` : ''}
  ${stepBar}
  ${errorBanner}
  <form method="post" action="/main-power/apply/${esc(event.id)}" id="mpForm">
    <div class="card" id="mpStep1">
      <div class="field">
        <label for="role">${t('mp.apply.roleLabel')}</label>
        <select id="role" name="role" required>${roleOpts}</select>
      </div>
      <h2 style="font-size:17px;margin:10px 0 6px">${t('mp.apply.sowTitle')}</h2>
      ${customSowHtml}
      <div>${sowHtml}</div>
      <label style="display:flex;align-items:flex-start;gap:10px;margin-top:16px;cursor:pointer;font-size:14px">
        <input type="checkbox" name="agree" id="mpAgree" value="1" ${v.agree ? 'checked' : ''} style="width:auto;margin-top:3px">
        <span>${t('mp.apply.sowAgree')}</span>
      </label>
      <button type="button" class="btn btn-block" id="mpNext" style="margin-top:18px">${t('mp.apply.continue')} →</button>
    </div>

    <div class="card" id="mpStep2" style="display:none;margin-top:14px">
      <h2 style="font-size:17px;margin:0 0 6px">${t('mp.apply.questions')}</h2>
      <div class="field"><label>${t('mp.apply.q1')}</label>${radios('q1', OPT.yn)}</div>
      <div class="field"><label>${t('mp.apply.q2')}</label>${radios('q2', OPT.yns)}</div>
      <div class="field"><label for="q3">${t('mp.apply.q3')}</label><textarea id="q3" name="q3" rows="3" placeholder="${esc(t('mp.apply.q3ph'))}">${esc(v.q3 || '')}</textarea></div>
      <div class="field"><label>${t('mp.apply.q4')}</label>${radios('q4', OPT.ynd)}</div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button type="button" class="btn btn-ghost" id="mpBack">← ${t('mp.apply.back')}</button>
        <button type="submit" class="btn" style="flex:1">${t('mp.apply.submit')}</button>
      </div>
    </div>
  </form>
</div>
<script>
(function(){
  var s1=document.getElementById('mpStep1'), s2=document.getElementById('mpStep2');
  var next=document.getElementById('mpNext'), back=document.getElementById('mpBack');
  var role=document.getElementById('role'), agree=document.getElementById('mpAgree');
  if(!next||!s1||!s2) return;
  function dot2(on){ var c=document.getElementById('mpDot2c'), l=document.getElementById('mpDot2l');
    if(c){c.style.background=on?'var(--red)':'var(--card2)';c.style.color=on?'#fff':'var(--muted)';}
    if(l){l.style.color=on?'var(--ink)':'var(--muted)';} }
  next.onclick=function(){
    if(!role.value){ role.focus(); alert(${JSON.stringify(t('mp.err.roleRequired'))}); return; }
    if(!agree.checked){ alert(${JSON.stringify(t('mp.err.sowRequired'))}); return; }
    s1.style.display='none'; s2.style.display=''; dot2(true); window.scrollTo(0,0);
  };
  if(back) back.onclick=function(){ s2.style.display='none'; s1.style.display=''; dot2(false); window.scrollTo(0,0); };
})();
</script>`;
  return layout({ title: t('mp.apply.title', { event: esc(event.name) }) + ' — 20FIT', body, home: '/main-power?lang=' + L, lang: L });
}

/** Confirmation after a Man Power application is submitted. */
function mainPowerApplyDone({ event, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card success">
    <div class="check">✓</div>
    <h1>${t('mp.apply.doneTitle')}</h1>
    <p class="sub" style="margin:10px 0 24px">${t('mp.apply.doneSub')}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a href="/main-power?lang=${L}" class="btn">${t('mp.dash.title')} →</a>
    </div>
  </div></div>`;
  return layout({ title: t('mp.apply.doneTitle') + ' — 20FIT', body, home: '/main-power?lang=' + L, lang: L });
}

/** Small badge for a proof's content type (feed / reels / story). */
function contentBadge(ctype) {
  const label = ctype === 'reels' ? 'Reels' : ctype === 'story' ? 'Story' : ctype === 'feed' ? 'Feed' : null;
  if (!label) return '';
  const icon = ctype === 'reels' ? '🎬' : ctype === 'story' ? '📖' : '📷';
  return `<span class="pill pill-off" style="font-size:11px">${icon} ${label}</span>`;
}

/**
 * PUBLIC (no login) submission page: name + social username + event, with
 * multiple feed screenshots plus separate Reels and Story uploads. Every image
 * is analysed by the LLM.
 */
function publicSubmitPage(opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const events = opts.events || [];
  const v = opts.values || {};
  const errors = opts.errors || [];
  const noEvents = events.length === 0;
  const eventOpts = events.map((e) => `<option value="${esc(e.id)}"${v.event_id === e.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
  const errorBanner = errors.length ? `<div class="banner banner-err"><b>${t('check.header')}</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const fileField = (name, icon, label, hint) => `<div class="field">
    <label>${icon} ${label} <span class="hint">${hint}</span></label>
    <input type="file" name="${name}" accept="image/*" multiple>
  </div>`;
  const body = `<div class="wrap narrow">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    ${toggles(L)}
  </div>
  <h1>${t('pub.title')}</h1>
  <p class="sub">${t('pub.sub')}</p>
  ${errorBanner}
  ${noEvents ? `<div class="banner banner-warn">${t('kol.noEvents')}</div>` : ''}
  <form class="card" method="post" action="/submit" enctype="multipart/form-data">
    <div class="field"><label for="name">${t('pub.name')}</label><input type="text" id="name" name="name" required maxlength="120" value="${esc(v.name || '')}"></div>
    <div class="field"><label for="username">${t('pub.username')} <span class="hint">${t('pub.usernameHint')}</span></label><input type="text" id="username" name="username" required maxlength="120" placeholder="@username" value="${esc(v.username || '')}"></div>
    <div class="field">
      <label for="event_id">${t('kol.eventLabel')}</label>
      <select id="event_id" name="event_id" required ${noEvents ? 'disabled' : ''}><option value="" disabled ${v.event_id ? '' : 'selected'}>${t('kol.pickEvent')}</option>${eventOpts}</select>
    </div>
    ${fileField('feed_images', '📷', t('pub.feed'), t('pub.feedHint'))}
    ${fileField('reels_images', '🎬', t('pub.reels'), t('pub.reelsHint'))}
    ${fileField('story_images', '📖', t('pub.story'), t('pub.storyHint'))}
    <div class="field"><label for="post_link">${t('kol.linkLabel')} <span class="hint">${t('kol.linkHint')}</span></label><input type="url" id="post_link" name="post_link" placeholder="https://instagram.com/p/…" value="${esc(v.post_link || '')}"></div>
    <div class="field"><label for="posted_at">${t('kol.postedLabel')} <span class="hint">${t('kol.postedHint')}</span></label><input type="datetime-local" id="posted_at" name="posted_at"></div>
    <button type="submit" class="btn btn-block" ${noEvents ? 'disabled' : ''}>${t('pub.submit')}</button>
  </form>
  <p class="muted" style="text-align:center;font-size:13px;margin-top:16px">${t('pub.foot')}</p>
</div>`;
  return layout({ title: t('pub.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

function publicSubmitSuccess(opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card success" style="text-align:center">
    <div class="check">✓</div>
    <h1>${t('pub.thanksTitle')}</h1>
    <p class="sub" style="margin:10px 0 24px">${t('pub.thanksBody', { name: esc(opts.name || ''), count: opts.count || 0 })}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a href="/submit?lang=${L}" class="btn btn-ghost">${t('pub.again')}</a>
      <a href="/?lang=${L}" class="btn btn-ghost">${t('common.back')}</a>
    </div>
  </div></div>`;
  return layout({ title: t('pub.thanksTitle') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

/** Horizontal bar chart, single hue (length = magnitude, label = identity). items: [{name, value}]. */
function hBar(title, items, lang) {
  const L = normLang(lang);
  const rows = (items || []).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);
  const max = rows.length ? rows[0].value : 0;
  const inner = rows.length ? rows.map((x) => `<div class="bar-row" title="${esc(x.name)}: ${fmtNum(x.value)}">
      <div class="bar-label">${esc(x.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, Math.round(x.value / max * 100))}%"></div></div>
      <div class="bar-val">${fmtNum(x.value)}</div>
    </div>`).join('') : `<p class="muted" style="font-size:13px">${tr(L, 'an.noData')}</p>`;
  return `<div class="chart"><div class="chart-title">${esc(title)}</div>${inner}</div>`;
}

/** Staff dashboard: post proofs (both roles) + events/assignments/EO management (super admin only). */
// Shared header for every staff page: title + who's logged in + logout.
function staffHead(staff, title) {
  return `<h1>${esc(title)}</h1>`;
}

// Shared proof table. Super admin gets an actions column (verify/reject/re-extract).
function proofTable(proofs, isSuper, lang, settings) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  proofs = proofs || [];
  const rows = proofs.length ? proofs.map((p) => { const days = daysLive(p.posted_at, p.created_at); return `<tr>
    <td data-label="${t('th.talent')}"><b>${esc(p.talent_name || '—')}</b>${p.submitter_username ? ` <span class="muted" style="font-size:12px">@${esc(p.submitter_username)}</span>` : ''}<div class="muted" style="font-size:12px">${esc(talentLabel(L, p.talent_type))} · ${fmtDate(p.created_at)}</div><div style="margin-top:5px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${contentBadge(p.content_type, L)}${plausibilityBadge(p.posted_at, p.created_at, p.extracted, settings, L)}</div></td>
    <td data-label="${t('th.event')}">${esc(p.event_name || '—')}</td>
    <td data-label="${t('th.ss')}">${p.thumb ? `<a href="${esc(p.thumb)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:7px;border:1px solid var(--line)"></a>` : '<span class="muted">—</span>'}</td>
    <td data-label="${t('th.extraction')}">${statsLine(p.extracted, L, days, settings)}${p.post_link ? `<div class="linklist"><a href="${esc(p.post_link)}" target="_blank" rel="noopener">${t('kol.postLink')}</a></div>` : ''}</td>
    <td data-label="${t('th.status')}">${statusBadge(p.status, L)}</td>
    ${isSuper ? `<td style="text-align:right;white-space:nowrap">
      ${p.status !== 'processing' ? `<form class="inline-form" method="post" action="/admin/proofs/${esc(p.id)}/reextract"><button class="btn btn-ghost btn-sm" title="${t('title.reextract')}">↻</button></form> ` : ''}
      ${p.status !== 'verified' ? `<form class="inline-form" method="post" action="/admin/proofs/${esc(p.id)}/verify"><button class="btn btn-ghost btn-sm" title="${t('title.verify')}">✓</button></form> ` : ''}
      ${p.status !== 'rejected' ? `<form class="inline-form" method="post" action="/admin/proofs/${esc(p.id)}/reject"><button class="btn btn-ghost btn-sm" title="${t('title.reject')}">✕</button></form> ` : ''}
      <form class="inline-form" method="post" action="/admin/proofs/${esc(p.id)}/delete" ${jsConfirm(t('confirm.deleteProof'))}><button class="btn btn-ghost btn-sm" title="${t('title.delete')}">🗑</button></form>
    </td>` : ''}
  </tr>`; }).join('') : `<tr><td colspan="${isSuper ? 6 : 5}" class="muted" style="padding:22px;text-align:center">${t('proofs.empty')}</td></tr>`;
  return `<div class="card" style="margin-top:14px"><div class="table-wrap"><table>
    <thead><tr><th>${t('th.talent')}</th><th>${t('th.event')}</th><th>${t('th.ss')}</th><th>${t('th.extraction')}</th><th>${t('th.status')}</th>${isSuper ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
}

// Tab 1 — Dashboard: role-aware activity summary + engagement overview.
function adminDashboard({ staff, proofs, events, talents, assignments, settings, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  proofs = proofs || []; events = events || []; talents = talents || []; assignments = assignments || [];
  const isSuper = staff && staff.role === 'super_admin';

  // Date-only comparisons at UTC midnight (talent_events.starts_at/ends_at are DATE).
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 86400000;
  const dateMs = (d) => { if (!d) return null; const p = String(d).slice(0, 10).split('-'); if (p.length !== 3) return null; const v = Date.UTC(+p[0], +p[1] - 1, +p[2]); return isNaN(v) ? null : v; };

  // Widget 1 — active talents by type (all registered talents; no deactivation exists yet).
  const byType = {};
  talents.forEach((tt) => { byType[tt.talent_type] = (byType[tt.talent_type] || 0) + 1; });
  const talentSub = ['kol', 'main_power', 'fotografer'].map((k) => `${talentLabel(L, k)} ${byType[k] || 0}`).join(' · ');

  // Widgets 2 & 3 — running vs upcoming campaigns.
  const running = []; const upcoming = [];
  events.forEach((e) => {
    const s = dateMs(e.starts_at); const en = dateMs(e.ends_at);
    if (s !== null && s > todayMs) { upcoming.push(e); return; }
    if (e.is_active && (s === null || s <= todayMs) && (en === null || en >= todayMs)) running.push(e);
  });
  const listNames = (arr) => arr.slice(0, 3).map((e) => esc(e.name)).join(', ') + (arr.length > 3 ? ` +${arr.length - 3}` : '');

  // Widget 6 — upload-deadline follow-ups: assigned talents with no proof yet, whose event
  // ends within 3 days or is already overdue. Colour: overdue = red, approaching = yellow.
  const submitted = new Set(proofs.filter((p) => p.status !== 'rejected').map((p) => `${p.talent_id}|${p.event_id}`));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const talentNameById = new Map(talents.map((tt) => [tt.id, tt.name]));
  const deadlines = [];
  assignments.forEach((a) => {
    const e = eventById.get(a.event_id); if (!e) return;
    const en = dateMs(e.ends_at); if (en === null) return;
    if (submitted.has(`${a.talent_id}|${a.event_id}`)) return;
    const diff = Math.round((en - todayMs) / dayMs);
    if (diff > 3) return;
    deadlines.push({ talent: talentNameById.get(a.talent_id) || '—', type: a.talent_type, event: e.name, diff });
  });
  deadlines.sort((a, b) => a.diff - b.diff);
  const dlText = (diff) => diff < 0 ? t('dash.overdueBy', { n: -diff }) : (diff === 0 ? t('dash.dueToday') : t('dash.dueIn', { n: diff }));

  const per = new Map();
  const tot = { likes: 0, comments: 0, saves: 0, shares: 0, views: 0, verified: 0 };
  proofs.forEach((p) => {
    const key = p.talent_id || p.talent_name || '—';
    const e = per.get(key) || { id: p.talent_id, name: p.talent_name || '—', type: p.talent_type, proofs: 0, likes: 0, comments: 0, saves: 0, shares: 0, views: 0, list: [] };
    e.proofs += 1; e.list.push(p);
    if (p.status === 'verified') tot.verified += 1;
    const x = p.extracted || {};
    ['likes', 'comments', 'saves', 'shares', 'views'].forEach((k) => { const v = Number(x[k]) || 0; e[k] += v; tot[k] += v; });
    per.set(key, e);
  });
  const board = [...per.values()].map((e) => Object.assign(e, { sc: kolScore(e.list, settings) }));
  board.sort((a, b) => (b.sc.score == null ? -1 : b.sc.score) - (a.sc.score == null ? -1 : a.sc.score)
    || (b.likes + b.comments + b.saves + b.shares) - (a.likes + a.comments + a.saves + a.shares));

  // Per-event AI-analysis summary (engagement rolled up per campaign).
  const eventNameById = new Map(events.map((e) => [e.id, e.name]));
  const evAgg = new Map();
  proofs.forEach((p) => {
    const key = eventNameById.get(p.event_id) || t('kol.noEvent');
    const e = evAgg.get(key) || { name: key, posts: 0, kols: new Set(), views: 0, eng: 0 };
    e.posts += 1; e.kols.add(p.talent_id || p.talent_name || '—');
    const x = p.extracted || {};
    e.views += Number(x.views) || 0;
    e.eng += (Number(x.likes) || 0) + (Number(x.comments) || 0) + (Number(x.shares) || 0) + (Number(x.saves) || 0);
    evAgg.set(key, e);
  });
  const evList = [...evAgg.values()].sort((a, b) => b.eng - a.eng);
  const evRows = evList.length ? evList.map((e) => `<tr>
    <td data-label="${t('th.event')}"><b>${esc(e.name)}</b></td>
    <td data-label="${t('dash.kolCount')}" style="text-align:right">${e.kols.size}</td>
    <td data-label="${t('th.proofs')}" style="text-align:right">${e.posts}</td>
    <td data-label="${t('stats.views')}" style="text-align:right">${fmtNum(e.views)}</td>
    <td data-label="${t('ov.engagement')}" style="text-align:right">${fmtNum(e.eng)}</td>
  </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:22px">${t('an.noData')}</td></tr>`;

  const boardRows = board.length ? board.map((e, i) => `<tr>
    <td data-label="${t('th.rank')}">${i + 1}</td>
    <td data-label="${t('th.kol')}">${e.id ? `<a href="/admin/kol/${esc(e.id)}?lang=${L}" style="color:var(--ink);font-weight:700;text-decoration:underline">${esc(e.name)}</a>` : `<b>${esc(e.name)}</b>`}<div class="muted" style="font-size:12px">${esc(talentLabel(L, e.type))}</div></td>
    <td data-label="${t('score.col')}">${scoreBadge(e.sc, L)}</td>
    <td data-label="${t('th.proofs')}" style="text-align:right">${e.proofs}</td>
    <td data-label="${t('stats.views')}" style="text-align:right">${fmtNum(e.views)}</td>
    <td data-label="${t('stats.likes')}" style="text-align:right">${fmtNum(e.likes)}</td>
    <td data-label="${t('stats.comments')}" style="text-align:right">${fmtNum(e.comments)}</td>
    <td data-label="${t('stats.saves')}" style="text-align:right">${fmtNum(e.saves)}</td>
    <td data-label="${t('stats.shares')}" style="text-align:right">${fmtNum(e.shares)}</td>
  </tr>`).join('') : `<tr><td colspan="9" class="muted" style="padding:22px;text-align:center">${t('dash.emptyKol')}</td></tr>`;

  const widget = (icon, label, num, sub, extra = '') => `<div class="wcard${extra ? ' wcard-muted' : ''}">
    <div class="wc-top"><span class="wc-icon">${icon}</span><span class="wc-label">${label}</span>${extra}</div>
    <div class="wc-num${extra ? ' muted' : ''}">${num}</div>
    <div class="wc-sub">${sub}</div>
  </div>`;
  const soonBadge = `<span class="wc-badge">${t('dash.soon')}</span>`;
  const financeWidgets = isSuper
    ? widget('💸', t('dash.wUnpaid'), '—', t('dash.financeOff'), soonBadge)
      + widget('💰', t('dash.wRevenue'), '—', t('dash.financeOff'), soonBadge)
    : '';

  const deadlineBody = deadlines.length
    ? `<div class="dl-list">${deadlines.map((d) => `<div class="dl-item">
        <div><b>${esc(d.talent)}</b> <span class="muted" style="font-size:12px">(${talentLabel(L, d.type)})</span><div class="muted" style="font-size:12px">${esc(d.event)}</div></div>
        <span class="dl-when ${d.diff < 0 ? 'dl-late' : 'dl-near'}">${dlText(d.diff)}</span>
      </div>`).join('')}</div>`
    : `<p class="muted" style="margin:2px 0">${t('dash.noDeadlines')}</p>`;

  const body = `<div class="wrap">
  ${staffHead(staff, t('dash.title'), L)}
  <div class="wgrid">
    ${widget('👥', t('dash.wActiveTalent'), talents.length, talentSub)}
    ${widget('🟢', t('dash.wRunning'), running.length, running.length ? listNames(running) : t('dash.none'))}
    ${widget('📅', t('dash.wUpcoming'), upcoming.length, upcoming.length ? listNames(upcoming) : t('dash.none'))}
    ${financeWidgets}
  </div>

  <div class="section-head"><h2 style="margin:0">🔔 ${t('dash.wDeadline')}</h2></div>
  <div class="card" style="margin-top:14px">${deadlineBody}</div>

  <div class="section-head"><h2 style="margin:0">${t('dash.totalEngagement')}</h2></div>
  <div class="stat-grid">
    <div class="stat"><div class="n">${fmtNum(tot.views)}</div><div class="l">👁 ${t('stats.views')}</div></div>
    <div class="stat"><div class="n">${fmtNum(tot.likes)}</div><div class="l">❤️ ${t('stats.likes')}</div></div>
    <div class="stat"><div class="n">${fmtNum(tot.comments)}</div><div class="l">💬 ${t('stats.comments')}</div></div>
    <div class="stat"><div class="n">${fmtNum(tot.saves)}</div><div class="l">🔖 ${t('stats.saves')}</div></div>
    <div class="stat"><div class="n">${fmtNum(tot.shares)}</div><div class="l">📤 ${t('stats.shares')}</div></div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('dash.perEvent')}</h2></div>
  <div class="card" style="margin-top:14px">
    <div class="chart-grid">
      ${hBar(t('stats.views'), evList.map((e) => ({ name: e.name, value: e.views })), L)}
      ${hBar(t('ov.engagement'), evList.map((e) => ({ name: e.name, value: e.eng })), L)}
    </div>
  </div>
  <div class="card" style="margin-top:14px"><div class="table-wrap"><table>
    <thead><tr><th>${t('th.event')}</th><th style="text-align:right">${t('dash.kolCount')}</th><th style="text-align:right">${t('th.proofs')}</th><th style="text-align:right">${t('stats.views')}</th><th style="text-align:right">${t('ov.engagement')}</th></tr></thead>
    <tbody>${evRows}</tbody>
  </table></div></div>

  <div class="section-head"><h2 style="margin:0">${t('dash.perKol')}</h2></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>${t('th.rank')}</th><th>${t('th.kol')}</th><th>${t('score.col')}</th><th style="text-align:right">${t('th.proofs')}</th><th style="text-align:right">${t('stats.views')}</th><th style="text-align:right">${t('stats.likes')}</th><th style="text-align:right">${t('stats.comments')}</th><th style="text-align:right">${t('stats.saves')}</th><th style="text-align:right">${t('stats.shares')}</th></tr></thead>
      <tbody>${boardRows}</tbody>
    </table></div>
  </div>
</div>`;
  return appLayout({ title: t('dash.title') + ' — 20FIT', body, role: staff && staff.role, active: 'dashboard', user: staff && staff.name, lang: L });
}

// Per-KOL eligibility detail: overall score + factor breakdown + per-campaign history.
function adminKolDetail({ staff, talent, proofs, settings, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  proofs = proofs || [];
  const overall = kolScore(proofs, settings);

  const evMap = new Map();
  proofs.forEach((p) => {
    const key = p.event_id || p.event_name || '—';
    let e = evMap.get(key);
    if (!e) { e = { name: p.event_name || t('kol.noEvent'), list: [], when: p.created_at }; evMap.set(key, e); }
    e.list.push(p);
    if (p.created_at && (!e.when || new Date(p.created_at) < new Date(e.when))) e.when = p.created_at;
  });
  const history = [...evMap.values()].map((e) => Object.assign(e, {
    sc: kolScore(e.list, settings),
    views: e.list.reduce((a, p) => a + (Number((p.extracted || {}).views) || 0), 0),
    eng: e.list.reduce((a, p) => a + engagementOf(p.extracted), 0),
  })).sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

  const factorBar = (label, val) => `<div style="margin-bottom:11px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span class="muted">${label}</span><b>${val}</b></div>
    <div style="background:var(--card2);border-radius:6px;height:9px;overflow:hidden"><div style="background:var(--red);height:100%;width:${Math.max(2, val)}%"></div></div>
  </div>`;

  const histRows = history.length ? history.map((h) => `<tr>
    <td data-label="${t('th.event')}"><b>${esc(h.name)}</b><div class="muted" style="font-size:12px">${fmtDate(h.when)}</div></td>
    <td data-label="${t('th.proofs')}" style="text-align:right">${h.list.length}</td>
    <td data-label="${t('stats.views')}" style="text-align:right">${fmtNum(h.views)}</td>
    <td data-label="${t('ov.engagement')}" style="text-align:right">${fmtNum(h.eng)}</td>
    <td data-label="${t('score.col')}">${scoreBadge(h.sc, L)}</td>
  </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:22px">${t('score.noHistory')}</td></tr>`;

  const body = `<div class="wrap">
  <a href="/admin?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
  <h1 style="margin-bottom:2px">${esc(talent ? talent.name : '—')}</h1>
  <p class="sub">${esc(talentLabel(L, talent && talent.talent_type))}</p>

  <div class="card" style="margin-top:14px;display:flex;gap:28px;flex-wrap:wrap;align-items:center">
    <div style="text-align:center;min-width:130px">
      <div style="font-size:48px;font-weight:800;line-height:1;color:${slaColor(overall.cls) || 'var(--ink)'}">${overall.score == null ? '–' : overall.score}</div>
      <div class="muted" style="font-size:12px;margin:4px 0 8px">${t('score.outOf')}</div>
      <div>${scoreBadge(overall, L)}</div>
    </div>
    <div style="flex:1;min-width:230px">
      ${factorBar('📊 ' + t('score.performance'), overall.performance)}
      ${factorBar('✅ ' + t('score.quality'), overall.quality)}
      ${factorBar('🔁 ' + t('score.consistency'), overall.consistency)}
      <div class="muted" style="font-size:12px;margin-top:8px">${overall.posts} ${t('th.proofs').toLowerCase()} · ${overall.campaigns} campaign</div>
    </div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('adm.profile.title')}</h2></div>
  <div class="card" style="margin-top:14px">${talentProfileBlock(talent, L)}</div>

  <div class="section-head"><h2 style="margin:0">${t('score.history')}</h2></div>
  <div class="card" style="margin-top:14px"><div class="table-wrap"><table>
    <thead><tr><th>${t('th.event')}</th><th style="text-align:right">${t('th.proofs')}</th><th style="text-align:right">${t('stats.views')}</th><th style="text-align:right">${t('ov.engagement')}</th><th>${t('score.col')}</th></tr></thead>
    <tbody>${histRows}</tbody>
  </table></div></div>
  <p class="muted" style="font-size:13px;margin-top:14px">${t('score.formula')}</p>
</div>`;
  return appLayout({ title: (talent ? talent.name : 'KOL') + ' — 20FIT', body, role: staff && staff.role, active: 'dashboard', user: staff && staff.name, lang: L });
}

// Tab — Analisis: deeper breakdown of the engagement metrics.
function adminAnalysis({ staff, proofs, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  proofs = proofs || [];
  const METRICS = ['views', 'likes', 'comments', 'saves', 'shares'];
  const ICON = { views: '👁', likes: '❤️', comments: '💬', saves: '🔖', shares: '📤' };

  const m = {};
  METRICS.forEach((k) => { m[k] = { total: 0, count: 0, max: 0 }; });
  const byEvent = new Map(); const byPlatform = new Map(); const byKol = new Map();
  const acc = (map, key, x) => {
    const e = map.get(key) || { name: key, posts: 0, views: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
    e.posts += 1;
    METRICS.forEach((k) => { e[k] += Number(x[k]) || 0; });
    map.set(key, e);
  };
  proofs.forEach((p) => {
    const x = p.extracted || {};
    METRICS.forEach((k) => {
      const v = x[k];
      if (v !== null && v !== undefined && v !== '') {
        const n = Number(v) || 0;
        m[k].total += n; m[k].count += 1; if (n > m[k].max) m[k].max = n;
      }
    });
    acc(byEvent, p.event_name || t('kol.noEvent'), x);
    acc(byPlatform, x.platform || p.platform || '—', x);
    acc(byKol, p.talent_name || '—', x);
  });

  const interactions = m.likes.total + m.comments.total + m.saves.total + m.shares.total;
  const engRate = m.views.total > 0 ? (interactions / m.views.total * 100) : null;

  const metricRows = METRICS.map((k) => `<tr>
    <td data-label="${t('an.metric')}">${ICON[k]} ${t('stats.' + k)}</td>
    <td data-label="${t('an.total')}" style="text-align:right"><b>${fmtNum(m[k].total)}</b></td>
    <td data-label="${t('an.avg')}" style="text-align:right">${m[k].count ? fmtNum(Math.round(m[k].total / m[k].count)) : '–'}</td>
    <td data-label="${t('an.max')}" style="text-align:right">${fmtNum(m[k].max)}</td>
  </tr>`).join('');

  const bars = (list, key) => {
    const rows = list.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 8);
    if (!rows.length) return `<p class="muted">${t('an.noData')}</p>`;
    const max = rows[0][key];
    return rows.map((r) => `<div style="margin-bottom:13px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;gap:10px"><span>${esc(r.name)}</span><b>${fmtNum(r[key])}</b></div>
      <div style="background:var(--card2);border-radius:6px;height:10px;overflow:hidden"><div style="background:var(--red);height:100%;border-radius:6px;width:${Math.max(4, Math.round(r[key] / max * 100))}%"></div></div>
    </div>`).join('');
  };

  const kolList = [...byKol.values()].map((e) => ({ ...e, eng: e.likes + e.comments + e.saves + e.shares }));
  const eventList = [...byEvent.values()].sort((a, b) => b.views - a.views);
  const platformList = [...byPlatform.values()].sort((a, b) => (b.views + b.likes) - (a.views + a.likes));

  const engTd = (e) => fmtNum(e.likes + e.comments + e.saves + e.shares);

  const body = `<div class="wrap">
  ${staffHead(staff, t('an.title'))}

  <div class="section-head"><h2 style="margin:0">${t('an.perMetric')}</h2></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>${t('an.metric')}</th><th style="text-align:right">${t('an.total')}</th><th style="text-align:right">${t('an.avg')}</th><th style="text-align:right">${t('an.max')}</th></tr></thead>
      <tbody>${metricRows}</tbody>
    </table></div>
    <p class="muted" style="margin-top:16px;font-size:13px">${t('an.engRate')}: <b style="color:var(--ink);font-size:15px">${engRate === null ? '–' : engRate.toFixed(1) + '%'}</b> <span style="font-size:12px">(${t('an.engRateHint')})</span></p>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('an.byViews')}</h2></div>
  <div class="card" style="margin-top:14px">${bars(kolList, 'views')}</div>

  <div class="section-head"><h2 style="margin:0">${t('an.byEng')}</h2></div>
  <div class="card" style="margin-top:14px">${bars(kolList, 'eng')}</div>

  <div class="section-head"><h2 style="margin:0">${t('an.byEvent')}</h2></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>${t('th.event')}</th><th style="text-align:right">${t('th.proofs')}</th><th style="text-align:right">${t('stats.views')}</th><th style="text-align:right">${t('stats.likes')}</th><th style="text-align:right">${t('stats.comments')}</th><th style="text-align:right">${t('stats.saves')}</th><th style="text-align:right">${t('stats.shares')}</th></tr></thead>
      <tbody>${eventList.length ? eventList.map((e) => `<tr>
        <td data-label="${t('th.event')}"><b>${esc(e.name)}</b></td>
        <td data-label="${t('th.proofs')}" style="text-align:right">${e.posts}</td>
        <td data-label="${t('stats.views')}" style="text-align:right">${fmtNum(e.views)}</td>
        <td data-label="${t('stats.likes')}" style="text-align:right">${fmtNum(e.likes)}</td>
        <td data-label="${t('stats.comments')}" style="text-align:right">${fmtNum(e.comments)}</td>
        <td data-label="${t('stats.saves')}" style="text-align:right">${fmtNum(e.saves)}</td>
        <td data-label="${t('stats.shares')}" style="text-align:right">${fmtNum(e.shares)}</td>
      </tr>`).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:22px">${t('an.noData')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('an.byPlatform')}</h2></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>${t('an.platform')}</th><th style="text-align:right">${t('th.proofs')}</th><th style="text-align:right">${t('stats.views')}</th><th style="text-align:right">${t('an.engTotal')}</th></tr></thead>
      <tbody>${platformList.length ? platformList.map((e) => `<tr>
        <td data-label="${t('an.platform')}" style="text-transform:capitalize"><b>${esc(e.name)}</b></td>
        <td data-label="${t('th.proofs')}" style="text-align:right">${e.posts}</td>
        <td data-label="${t('stats.views')}" style="text-align:right">${fmtNum(e.views)}</td>
        <td data-label="${t('an.engTotal')}" style="text-align:right">${engTd(e)}</td>
      </tr>`).join('') : `<tr><td colspan="4" class="muted" style="text-align:center;padding:22px">${t('an.noData')}</td></tr>`}</tbody>
    </table></div>
  </div>
</div>`;
  return appLayout({ title: t('an.title') + ' — 20FIT', body, role: staff && staff.role, active: 'analytics', user: staff && staff.name, lang: L });
}

// Tab — Ringkasan Performa: per-event performance, with an all-KOL total and a per-KOL breakdown.
function adminOverview({ staff, proofs, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  proofs = proofs || [];
  const FIELDS = ['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'link_clicks'];
  const blank = () => { const o = { posts: 0 }; FIELDS.forEach((f) => { o[f] = 0; }); return o; };
  const eng = (o) => o.likes + o.comments + o.shares + o.saves;
  const erate = (o) => { const base = o.reach || o.views; return base > 0 ? (eng(o) / base * 100) : null; };
  const pct = (o) => { const r = erate(o); return r === null ? '–' : r.toFixed(1).replace('.', ',') + '%'; };

  // Group by event -> by KOL.
  const evMap = new Map();
  proofs.forEach((p) => {
    const evName = p.event_name || t('kol.noEvent');
    const kolName = p.talent_name || '—';
    let ev = evMap.get(evName);
    if (!ev) { ev = { name: evName, kols: new Map(), totals: blank() }; evMap.set(evName, ev); }
    let k = ev.kols.get(kolName);
    if (!k) { k = Object.assign({ name: kolName }, blank()); ev.kols.set(kolName, k); }
    const x = p.extracted || {};
    k.posts += 1; ev.totals.posts += 1;
    FIELDS.forEach((f) => { const v = Number(x[f]) || 0; k[f] += v; ev.totals[f] += v; });
  });

  // KPI stat tiles for the event headline totals.
  const kpiTiles = (o) => {
    const tiles = [
      ['👁', t('stats.views'), fmtNum(o.views)],
      ['📡', t('stats.reach'), fmtNum(o.reach)],
      ['📊', t('stats.impressions'), fmtNum(o.impressions)],
      ['🔥', t('ov.engagement'), fmtNum(eng(o))],
      ['📈', t('ov.engRate'), pct(o)],
      ['🔗', t('stats.linkClicks'), fmtNum(o.link_clicks)],
    ];
    return `<div class="stat-grid" style="margin-top:14px">${tiles.map(([ic, lab, val]) => `<div class="stat"><div class="n">${val}</div><div class="l">${ic} ${lab}</div></div>`).join('')}</div>`;
  };

  const barChart = (title, items) => hBar(title, items, L);

  // Horizontal per-KOL table.
  const cols = [
    ['stats.views', 'views'], ['stats.reach', 'reach'], ['stats.impressions', 'impressions'],
    ['ov.engagement', '_eng'], ['ov.engRate', '_er'], ['stats.likes', 'likes'],
    ['stats.comments', 'comments'], ['stats.shares', 'shares'], ['stats.saves', 'saves'], ['stats.linkClicks', 'link_clicks'],
  ];
  const cell = (o, key) => key === '_eng' ? fmtNum(eng(o)) : key === '_er' ? pct(o) : fmtNum(o[key]);
  const rawCell = (o, key) => key === '_eng' ? eng(o) : key === '_er' ? (erate(o) || 0) : (o[key] || 0);
  const kolTable = (ev) => {
    const list = [...ev.kols.values()].sort((a, b) => eng(b) - eng(a));
    const head = `<th>${t('th.kol')}</th>` + cols.map(([lab]) => `<th class="sort-th" style="text-align:right">${t(lab)}<span class="sort-ind"></span></th>`).join('');
    const rows = list.map((k) => `<tr><td data-label="${t('th.kol')}"><b>${esc(k.name)}</b></td>${cols.map(([lab, key]) => `<td data-label="${t(lab)}" data-v="${rawCell(k, key)}" style="text-align:right">${cell(k, key)}</td>`).join('')}</tr>`).join('');
    const totalRow = `<tr data-total="1" style="border-top:2px solid var(--line)"><td data-label="${t('th.kol')}"><b>${t('ov.totalAllKol')}</b></td>${cols.map(([lab, key]) => `<td data-label="${t(lab)}" style="text-align:right"><b>${cell(ev.totals, key)}</b></td>`).join('')}</tr>`;
    return `<div class="table-wrap"><table class="sortable"><thead><tr>${head}</tr></thead><tbody>${rows}${totalRow}</tbody></table></div>`;
  };

  const events = [...evMap.values()].sort((a, b) => b.totals.views - a.totals.views);
  const submitters = new Set(proofs.map((p) => p.talent_id || p.talent_name || '—'));
  const sections = events.length ? events.map((ev) => {
    const kolList = [...ev.kols.values()];
    return `
  <div class="section-head"><h2 style="margin:0">📈 ${esc(ev.name)}</h2></div>
  ${kpiTiles(ev.totals)}
  <div class="card" style="margin-top:14px">
    <div class="chart-grid">
      ${barChart(t('ov.chartEng'), kolList.map((k) => ({ name: k.name, value: eng(k) })))}
      ${barChart(t('ov.chartViews'), kolList.map((k) => ({ name: k.name, value: k.views })))}
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div style="font-weight:700">${t('ov.perKol')} <span class="muted" style="font-weight:400;font-size:13px">· ${ev.kols.size} KOL · ${ev.totals.posts} ${t('th.proofs').toLowerCase()}</span></div>
      <span class="muted" style="font-size:12px">${t('ov.sortHint')}</span>
    </div>
    ${kolTable(ev)}
  </div>`;
  }).join('') : `<div class="card" style="margin-top:14px"><p class="muted" style="text-align:center;padding:22px">${t('ov.empty')}</p></div>`;

  const summaryBar = events.length ? `<div class="stat-grid" style="margin-top:16px">
    <div class="stat"><div class="n">${submitters.size}</div><div class="l">👥 ${t('ov.kolSubmitted')}</div></div>
    <div class="stat"><div class="n">${proofs.length}</div><div class="l">📄 ${t('th.proofs')}</div></div>
    <div class="stat"><div class="n">${events.length}</div><div class="l">📈 Campaign</div></div>
  </div>` : '';

  const insightCard = events.length ? `<div class="card" style="margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-weight:700">🧠 ${t('ins.title')}</div>
      <button id="ins-btn" class="btn btn-sm">${t('ins.btn')}</button>
    </div>
    <div id="ins-out" class="muted" style="margin-top:12px;font-size:14px;line-height:1.65;white-space:pre-wrap">${t('ins.hint')}</div>
  </div>` : '';

  const scripts = events.length ? `<script>
(function(){
  function num(td){ return parseFloat((td && td.getAttribute('data-v')) || '0') || 0; }
  document.querySelectorAll('table.sortable').forEach(function(table){
    table.querySelectorAll('th.sort-th').forEach(function(th){
      th.addEventListener('click', function(){
        var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
        var tb = table.tBodies[0];
        var rows = Array.prototype.slice.call(tb.querySelectorAll('tr:not([data-total])'));
        var total = tb.querySelector('tr[data-total]');
        var asc = th.getAttribute('data-dir') === 'asc';
        rows.sort(function(a, b){ return asc ? num(a.children[idx]) - num(b.children[idx]) : num(b.children[idx]) - num(a.children[idx]); });
        table.querySelectorAll('th.sort-th').forEach(function(o){ o.removeAttribute('data-dir'); var s = o.querySelector('.sort-ind'); if (s) s.textContent = ''; });
        th.setAttribute('data-dir', asc ? 'desc' : 'asc');
        var ind = th.querySelector('.sort-ind'); if (ind) ind.textContent = asc ? ' ▲' : ' ▼';
        rows.forEach(function(r){ tb.appendChild(r); }); if (total) tb.appendChild(total);
      });
    });
  });
  var btn = document.getElementById('ins-btn'), out = document.getElementById('ins-out');
  if (btn) { btn.addEventListener('click', function(){
    btn.disabled = true; out.textContent = ${JSON.stringify(t('ins.loading'))};
    fetch('/admin/overview/insight').then(function(r){ return r.json(); }).then(function(d){
      out.textContent = (d && d.insight) || (d && d.error) || ${JSON.stringify(t('ins.err'))};
    }).catch(function(){ out.textContent = ${JSON.stringify(t('ins.err'))}; }).finally(function(){ btn.disabled = false; });
  }); }
})();
</script>` : '';

  const body = `<div class="wrap">
  ${staffHead(staff, t('ov.title'))}
  <p class="muted" style="font-size:13px;margin-top:-6px">${t('ov.hint')}</p>
  ${summaryBar}
  ${insightCard}
  ${sections}
  ${scripts}
</div>`;
  return appLayout({ title: t('ov.title') + ' — 20FIT', body, role: staff && staff.role, active: 'overview', user: staff && staff.name, lang: L });
}

// Tab 2 — Bukti Post: every proof + extraction (super admin can act on them).
function adminProofs({ staff, proofs, lang, settings }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const isSuper = staff && staff.role === 'super_admin';
  const body = `<div class="wrap">
  ${staffHead(staff, t('proofs.pageTitle'))}
  ${proofTable(proofs, isSuper, L, settings)}
</div>`;
  return appLayout({ title: t('proofs.pageTitle') + ' — 20FIT', body, role: staff && staff.role, active: 'proofs', user: staff && staff.name, lang: L });
}

// Tab 3 — Kelola (super admin only): events, assignments, EO accounts.
function adminManage({ staff, events, assignments, talents, eos, proofs, lang, settings }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  events = events || []; assignments = assignments || []; talents = talents || []; eos = eos || []; proofs = proofs || [];
  settings = settings || { vpd_green: 3000, vpd_yellow: 10000 };
  const eventNameById = new Map(events.map((e) => [e.id, e.name]));
  const talentNameById = new Map(talents.map((tt) => [tt.id, tt.name]));
  // Eligibility score per talent -> assignment dropdown is sorted best-first and labelled.
  const proofsByTalent = new Map();
  proofs.forEach((p) => { const a = proofsByTalent.get(p.talent_id) || []; a.push(p); proofsByTalent.set(p.talent_id, a); });
  const scoreByTalent = new Map(talents.map((tt) => [tt.id, kolScore(proofsByTalent.get(tt.id) || [], settings)]));

  const eventRows = events.map((e) => `<tr>
    <td data-label="${t('th.event')}"><div style="display:flex;align-items:center;gap:10px">${e.mockup_url ? `<img src="${esc(e.mockup_url)}" alt="" class="ev-mockup-thumb" onerror="this.style.display='none'">` : ''}<b>${esc(e.name)}</b></div></td>
    <td data-label="${t('th.schedule')}" class="muted" style="font-size:13px;white-space:nowrap">${e.starts_at || e.ends_at ? `${e.starts_at ? fmtDay(e.starts_at) : '…'} – ${e.ends_at ? fmtDay(e.ends_at) : '…'}` : '—'}</td>
    <td data-label="${t('th.needs')}">${(e.needs || []).map((n) => `${talentLabel(L, n.talent_type)}${n.headcount > 1 ? ' ×' + n.headcount : ''}`).join(', ') || '<span class="muted">—</span>'}</td>
    <td data-label="${t('th.status')}"><span class="pill ${e.is_active ? 'pill-ok' : 'pill-off'}">${e.is_active ? t('ev.active') : t('ev.inactive')}</span>${e.completed_at ? ` <span class="pill pill-off">✓ ${t('ev.done')}</span>` : ''}</td>
    <td style="text-align:right;white-space:nowrap"><a href="/admin/events/${esc(e.id)}/edit?lang=${L}" class="btn btn-ghost btn-sm" title="${t('title.edit')}">✎ ${t('btn.edit')}</a> <form class="inline-form" method="post" action="/admin/events/${esc(e.id)}/complete"><input type="hidden" name="completed" value="${e.completed_at ? '0' : '1'}"><button class="btn btn-ghost btn-sm">${e.completed_at ? t('btn.reopen') : t('btn.markDone')}</button></form> <form class="inline-form" method="post" action="/admin/events/${esc(e.id)}/toggle"><button class="btn btn-ghost btn-sm">${e.is_active ? t('btn.deactivate') : t('btn.activate')}</button></form> <form class="inline-form" method="post" action="/admin/events/${esc(e.id)}/delete" ${jsConfirm(t('confirm.deleteEvent'))}><button class="btn btn-ghost btn-sm" title="${t('title.delete')}">🗑</button></form></td>
  </tr>`).join('');

  const eventOpts = events.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  const talentOpts = talents.slice()
    .sort((a, b) => { const sa = scoreByTalent.get(a.id).score; const sb = scoreByTalent.get(b.id).score; return (sb == null ? -1 : sb) - (sa == null ? -1 : sa); })
    .map((tt) => { const sc = scoreByTalent.get(tt.id); const tag = sc.score == null ? '' : ` · ${sc.score} ${tr(L, sc.label)}`; return `<option value="${esc(tt.id)}">${esc(tt.name)} (${talentLabel(L, tt.talent_type)})${tag}</option>`; }).join('');
  const assignRows = assignments.map((a) => `<tr>
    <td data-label="${t('th.talent')}"><b>${esc(talentNameById.get(a.talent_id) || '—')}</b> <span class="muted">(${talentLabel(L, a.talent_type)})</span></td>
    <td data-label="${t('th.event')}">${esc(eventNameById.get(a.event_id) || '—')}</td>
    <td data-label="${t('th.time')}" class="muted">${fmtDate(a.assigned_at)}</td>
  </tr>`).join('');

  const body = `<div class="wrap">
  ${staffHead(staff, t('manage.title'), L)}

  <div class="section-head"><h2 style="margin:0">${t('manage.events')}</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/events" enctype="multipart/form-data" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:18px">
      <input type="text" name="name" placeholder="${t('ph.eventName')}" required maxlength="140" style="flex:2;min-width:180px">
      <input type="text" name="location" placeholder="${t('manage.locationPh')}" maxlength="200" style="flex:2;min-width:180px">
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.startDate')}<input type="date" name="starts_at" style="min-width:150px"></label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.endDate')}<input type="date" name="ends_at" style="min-width:150px"></label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">📷 ${t('manage.mockup')}<input type="file" name="mockup" accept="image/*" style="min-width:170px;font-size:12px"></label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_kol" checked> ${talentLabel(L, 'kol')}</label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_main_power"> ${talentLabel(L, 'main_power')}</label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.mpQuota')}<input type="number" name="mp_headcount" min="1" value="1" style="width:90px"></label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_fotografer"> ${talentLabel(L, 'fotografer')}</label>
      <button class="btn btn-sm">${t('btn.createEvent')}</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>${t('th.event')}</th><th>${t('th.schedule')}</th><th>${t('th.needs')}</th><th>${t('th.status')}</th><th></th></tr></thead>
      <tbody>${eventRows || `<tr><td colspan="5" class="muted">${t('manage.emptyEvents')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('manage.assignments')}</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/assignments" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px">
      <select name="talent_id" required style="flex:1;min-width:180px"><option value="" disabled selected>${t('pick.talent')}</option>${talentOpts}</select>
      <select name="event_id" required style="flex:1;min-width:180px"><option value="" disabled selected>${t('pick.event')}</option>${eventOpts}</select>
      <button class="btn btn-sm">${t('btn.assign')}</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>${t('th.talent')}</th><th>${t('th.event')}</th><th>${t('th.time')}</th></tr></thead>
      <tbody>${assignRows || `<tr><td colspan="3" class="muted">${t('manage.emptyAssign')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('manage.eos')}</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/eos" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px">
      <input type="text" name="name" placeholder="${t('ph.eoName')}" required maxlength="120" style="flex:1;min-width:150px">
      <input type="text" name="login" placeholder="${t('ph.eoEmail')}" required style="flex:1;min-width:170px">
      <input type="text" name="password" placeholder="${t('ph.eoPass')}" required minlength="6" style="flex:1;min-width:150px">
      <button class="btn btn-sm">${t('btn.createEo')}</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>${t('th.name')}</th><th>${t('common.email')}</th><th>${t('th.created')}</th><th></th></tr></thead>
      <tbody>${eos.length ? eos.map((e) => `<tr><td data-label="${t('th.name')}"><a href="/admin/eos/${esc(e.id)}?lang=${L}" style="font-weight:700;color:var(--red);text-decoration:none">${esc(e.name)}</a>${e.status === 'suspended' ? ` <span class="pill pill-off" style="font-size:11px">${t('eo.status.suspended')}</span>` : ''}</td><td data-label="${t('common.email')}">${esc(e.login)}</td><td data-label="${t('th.created')}" class="muted">${fmtDate(e.created_at)}</td><td style="text-align:right;white-space:nowrap"><a href="/admin/eos/${esc(e.id)}?lang=${L}" class="btn btn-ghost btn-sm">${t('eo.detail.view')}</a> <form class="inline-form" method="post" action="/admin/eos/${esc(e.id)}/delete" ${jsConfirm(t('confirm.deleteEo'))}><button class="btn btn-ghost btn-sm" title="${t('title.delete')}">🗑</button></form></td></tr>`).join('') : `<tr><td colspan="4" class="muted">${t('manage.emptyEos')}</td></tr>`}</tbody>
    </table></div>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('manage.settings')}</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/settings">
      <div class="table-wrap"><table>
        <thead><tr><th>${t('an.metric')}</th><th style="text-align:right">🟢 ${t('set.greenLabel')}</th><th style="text-align:right">🟡 ${t('set.yellowLabel')}</th></tr></thead>
        <tbody>${[['views', '👁', 'vpd'], ['likes', '❤️', 'lpd'], ['comments', '💬', 'cpd'], ['saves', '🔖', 'spd'], ['shares', '📤', 'shpd']].map(([k, icon, pre]) => `<tr>
          <td data-label="${t('an.metric')}">${icon} ${t('stats.' + k)}</td>
          <td data-label="🟢" style="text-align:right"><input type="number" name="g_${k}" min="0" value="${esc(settings[pre + '_green'])}" style="width:120px"></td>
          <td data-label="🟡" style="text-align:right"><input type="number" name="y_${k}" min="0" value="${esc(settings[pre + '_yellow'])}" style="width:120px"></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <button class="btn btn-sm" style="margin-top:16px">${t('btn.saveSettings')}</button>
    </form>
    <p class="muted" style="font-size:13px;margin-top:14px">${t('set.hint')}</p>
  </div>

  <div class="section-head"><h2 style="margin:0">${t('score.settings')}</h2></div>
  <div class="card" style="margin-top:14px">
    <form method="post" action="/admin/settings" style="display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;max-width:640px">
      ${[['score_target_views', 'score.targetViews'], ['score_target_eng', 'score.targetEng'], ['score_min_campaigns', 'score.minCampaigns'], ['score_eligible', 'score.eligibleAt'], ['score_consider', 'score.considerAt']].map(([key, lab]) => `<label style="display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted)">${t(lab)}<input type="number" name="${key}" min="0" value="${esc(settings[key])}" style="width:100%"></label>`).join('')}
      <div style="grid-column:1/-1"><button class="btn btn-sm">${t('btn.saveSettings')}</button></div>
    </form>
    <p class="muted" style="font-size:13px;margin-top:14px">${t('score.settingsHint')}</p>
  </div>
</div>`;
  return appLayout({ title: t('manage.title') + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: 'manage', user: staff && staff.name, lang: L });
}

// Super Admin read-only detail for one EO account: profile + the events they created.
function adminEoDetail({ staff, eo, profile, events, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const p = profile || {};
  const suspended = eo.status === 'suspended';
  const statusPill = `<span class="pill ${suspended ? 'pill-off' : 'pill-ok'}">${suspended ? t('eo.status.suspended') : t('eo.status.active')}</span>`;
  const typeLabel = p.org_type ? t('eo.type.' + p.org_type) : null;
  const row = (label, val) => val ? `<div class="dl-item" style="align-items:flex-start"><div class="muted" style="min-width:150px;font-size:13px">${label}</div><div style="flex:1;min-width:0">${val}</div></div>` : '';
  const profileCard = (profile && (p.org_name || p.pic_name || p.phone || p.city || p.description))
    ? `<div class="card" style="margin-top:14px"><div class="dl-list">
        ${row(t('eo.f.orgType'), typeLabel ? esc(typeLabel) : '')}
        ${row(t('eo.f.company'), esc(p.org_name || eo.name || ''))}
        ${row(t('eo.f.pic'), esc(p.pic_name || ''))}
        ${row(t('eo.f.email'), esc(p.email || eo.login || ''))}
        ${row(t('eo.f.phone'), esc(p.phone || ''))}
        ${row(t('dd.province'), esc(p.province || ''))}
        ${row(t('dd.city'), esc(p.city || ''))}
        ${row(t('eo.f.desc'), p.description ? `<span style="white-space:pre-wrap">${esc(p.description)}</span>` : '')}
      </div></div>`
    : `<div class="banner banner-warn" style="margin-top:14px">${t('eo.detail.noProfile')}</div>`;
  const evList = (events || []).length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>${t('th.event')}</th><th>${t('th.schedule')}</th><th>${t('th.status')}</th><th style="text-align:right">${t('eo.detail.applicants')}</th></tr></thead>
        <tbody>${events.map((e) => `<tr>
          <td data-label="${t('th.event')}"><b>${esc(e.name)}</b></td>
          <td data-label="${t('th.schedule')}" class="muted" style="font-size:13px;white-space:nowrap">${e.starts_at ? fmtDay(e.starts_at) + (e.ends_at && e.ends_at !== e.starts_at ? ' – ' + fmtDay(e.ends_at) : '') : '—'}</td>
          <td data-label="${t('th.status')}">${eoRegBadge(e.displayStatus || e.status, L)}</td>
          <td data-label="${t('eo.detail.applicants')}" style="text-align:right"><b>${e.applyCount || 0}</b></td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : `<p class="muted" style="margin-top:12px">${t('eo.detail.noEvents')}</p>`;
  const body = `<div class="wrap">
    <a href="/admin/manage?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:14px">${t('common.back')}</a>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <h1 style="margin:0">${esc(eo.name || '')}</h1>${statusPill}
    </div>
    <p class="sub" style="margin:4px 0 0">${esc(eo.login || '')} · ${t('th.created')} ${fmtDate(eo.created_at)}</p>
    ${suspended ? `<div class="banner banner-warn" style="margin-top:14px">${t('eo.detail.suspendedNote')}</div>` : ''}

    <div class="section-head"><h2 style="margin:0">${t('eo.detail.profile')}</h2></div>
    ${profileCard}

    <div class="section-head"><h2 style="margin:0">${t('eo.detail.events')}</h2></div>
    <div class="card" style="margin-top:14px">${evList}</div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
      <form method="post" action="/admin/eos/${esc(eo.id)}/status" ${suspended ? '' : jsConfirm(t('eo.detail.suspendConfirm'))}>
        <input type="hidden" name="status" value="${suspended ? 'active' : 'suspended'}">
        <button class="btn btn-sm">${suspended ? '✓ ' + t('eo.detail.activate') : '⏸ ' + t('eo.detail.suspend')}</button>
      </form>
      <form method="post" action="/admin/eos/${esc(eo.id)}/delete" ${jsConfirm(t('confirm.deleteEo'))}>
        <button class="btn btn-ghost btn-sm">🗑 ${t('title.delete')}</button>
      </form>
    </div>
  </div>`;
  return appLayout({ title: (eo.name || t('eo.detail.title')) + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: 'manage', user: staff && staff.name, lang: L });
}

/**
 * Super Admin: edit an existing event — schedule, which talent types it needs
 * (KOL / Man Power / Fotografer) with per-type quotas, and the Man Power SOW.
 */
function adminEventEdit({ staff, event, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const ev = event || {};
  const needOf = (type) => (ev.needs || []).find((n) => n.talent_type === type);
  const hc = (type) => { const n = needOf(type); return (n && n.headcount) || 1; };
  const needRow = (type, quotaKey, quotaLabel) => `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:13px 0;border-bottom:1px solid var(--line)">
      <label style="display:flex;align-items:center;gap:9px;font-weight:600;font-size:15px;min-width:150px;cursor:pointer">
        <input type="checkbox" name="need_${type}" ${needOf(type) ? 'checked' : ''}> ${talentLabel(L, type)}</label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${quotaLabel}
        <input type="number" name="${quotaKey}" min="1" value="${esc(hc(type))}" style="width:110px"></label>
    </div>`;

  const body = `<div class="wrap">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    ${staffHead(staff, t('manage.editEvent'), L)}
    <a href="/admin/manage?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
  </div>
  <p class="sub">${t('manage.editSub')}</p>
  <form method="post" action="/admin/events/${esc(ev.id)}/edit" enctype="multipart/form-data" class="card" style="margin-top:16px">
    <div class="field">
      <label for="name">${t('ph.eventName')}</label>
      <input type="text" id="name" name="name" required maxlength="140" value="${esc(ev.name || '')}">
    </div>
    <div class="field">
      <label>📷 ${t('manage.mockup')}</label>
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        ${ev.mockup_url ? `<img src="${esc(ev.mockup_url)}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:10px;border:1px solid var(--line);flex-shrink:0" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;min-width:180px">
          <input type="file" name="mockup" accept="image/*">
          <p class="muted" style="font-size:12px;margin:6px 0 0">${t('manage.mockupHint')}</p>
          ${ev.mockup_url ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:8px;cursor:pointer"><input type="checkbox" name="remove_mockup" value="1"> ${t('manage.mockupRemove')}</label>` : ''}
        </div>
      </div>
    </div>
    <div class="field">
      <label for="location">${t('manage.location')}</label>
      <input type="text" id="location" name="location" maxlength="200" placeholder="${t('manage.locationPh')}" value="${esc(ev.location || '')}">
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);flex:1;min-width:150px">${t('manage.startDate')}<input type="date" name="starts_at" value="${esc(ev.starts_at || '')}"></label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);flex:1;min-width:150px">${t('manage.endDate')}<input type="date" name="ends_at" value="${esc(ev.ends_at || '')}"></label>
    </div>
    <div class="field" style="margin-top:18px">
      <label>${t('manage.needsLabel')}</label>
      ${needRow('kol', 'kol_headcount', t('manage.kolQuota'))}
      ${needRow('main_power', 'mp_headcount', t('manage.mpQuota'))}
      ${needRow('fotografer', 'fg_headcount', t('manage.fgQuota'))}
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <a href="/admin/manage?lang=${L}" class="btn btn-ghost">${t('common.cancel')}</a>
      <button type="submit" class="btn" style="flex:1">${t('btn.save')}</button>
    </div>
  </form>
</div>`;
  return appLayout({ title: t('manage.editEvent') + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: 'manage', user: staff && staff.name, lang: L });
}

/**
 * Super Admin review of Man Power applications: applicant + jobdesk + answers,
 * with approve (optionally assigning a station) / reject actions. Approved
 * applications keep a small form to set or update their station later.
 */
function adminApplications({ staff, applications, attendanceLinks, lang, flash, cat }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  applications = applications || [];
  // Which review tab this is (Man Power crew / KOL / Fotografer-Videografer).
  const catTitle = cat === 'kol' ? t('mpr.titleKol') : cat === 'creative' ? t('mpr.titleCreative') : t('mpr.title');
  const catActive = cat === 'kol' ? 'applications-kol' : cat === 'creative' ? 'applications-creative' : 'applications';
  const catEmpty = cat === 'kol' ? t('mpr.emptyKol') : cat === 'creative' ? t('mpr.emptyCreative') : t('mpr.empty');
  const okBanner = (msg) => `<div class="card" style="margin-top:14px;border:1px solid var(--ok);background:var(--ok-soft);font-size:14px">✅ ${msg}</div>`;
  const warnBanner = (msg) => `<div class="card" style="margin-top:14px;border:1px solid var(--warn);background:var(--warn-soft);font-size:14px">⚠️ ${msg}</div>`;
  const errBanner = (msg) => `<div class="card" style="margin-top:14px;border:1px solid var(--err);background:var(--err-soft);font-size:14px">⚠️ ${msg}</div>`;
  const flashBanner = {
    sent: okBanner(t('mpr.mailSent')),
    mock: warnBanner(t('mpr.mailMock')),
    error: errBanner(t('mpr.mailError')),
    remsent: okBanner(t('mpr.remSent')),
    remmock: warnBanner(t('mpr.remMock')),
    rem0: okBanner(t('mpr.remNone')),
    remerr: errBanner(t('mpr.mailError')),
  }[flash] || '';
  // Labels for application answer keys (new category forms + legacy MP q1–q4).
  const ANSWER_LABEL = {
    name: 'common.fullname', phone: 'dd.phone', city: 'dd.city',
    ig_username: 'apply.igUser', ig_link: 'apply.igLink', followers: 'apply.followers', tiktok: 'apply.tiktok',
    portfolio_link: 'apply.portfolio', camera: 'apply.camera',
    bank_name: 'apply.bankName', bank_account: 'apply.bankAccount', bank_holder: 'apply.bankHolder',
  };

  const renderCard = (a) => {
    const ans = a.answers || {};
    const answerRows = Object.keys(ans)
      .filter((k) => !k.startsWith('__') && ans[k] !== undefined && ans[k] !== null && String(ans[k]) !== '')
      .map((k) => {
        const raw = String(ans[k]);
        let label; let val;
        if (/^q[1-4]$/.test(k)) { label = t('mp.apply.' + k); val = k === 'q3' ? esc(raw) : esc(mpAnswerLabel(raw, L)); }
        else { label = ANSWER_LABEL[k] ? t(ANSWER_LABEL[k]) : k; val = /^https?:\/\//i.test(raw) ? `<a href="${esc(raw)}" target="_blank" rel="noopener">${esc(raw)}</a>` : esc(raw); }
        return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:12.5px;color:var(--muted)">${esc(label)}</div>
        <div style="font-size:14px;margin-top:2px;word-break:break-word">${val}</div></div>`;
      }).join('');

    // For an already-approved app the primary button starts in a muted "saved"
    // state and only turns red again once the station inputs are edited (wired
    // by the stationScript below). A pending app keeps the solid red "Setujui".
    const saveBtn = a.status === 'approved'
      ? `<button class="btn btn-ghost btn-sm station-save" name="action" value="approve" data-clean="${esc(t('mpr.stationSaved'))}" data-dirty="${esc(t('mpr.updateStation'))}">${esc(t('mpr.stationSaved'))}</button>`
      : `<button class="btn btn-sm" name="action" value="approve">${t('mpr.approve')}</button>`;
    const stationForm = `<form method="post" action="/admin/applications/${esc(a.id)}/review" class="station-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:14px">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:130px">${t('mpr.stationName')}<select name="station">${stationOptions(a.station, t('mpr.stationPick'))}</select></label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:130px">${t('mpr.stationLoc')}<input type="text" name="station_loc" maxlength="120" value="${esc(a.station_loc || '')}"></label>
        <input type="hidden" name="note" value="${esc(a.note || '')}">
        ${saveBtn}
        ${a.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" name="action" value="reject" ${jsConfirm(t('confirm.rejectApp'))}>${t('mpr.reject')}</button>` : ''}
      </form>`;

    const stationLine = (a.status === 'approved' && !(a.choices && a.choices.length))
      ? `<div style="margin-top:8px;font-size:13px">📍 <b>${a.station ? esc(a.station) + (a.station_loc ? ' · ' + esc(a.station_loc) : '') : `<span class="muted" style="font-weight:400">${t('mpr.noStation')}</span>`}</b></div>` : '';

    // Position-based apps: show the ranked position picks (P1/P2/P3) the talent chose.
    const choices = a.choices || [];
    const posBlock = choices.length
      ? `<div style="margin-top:8px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('mpr.positionsTitle')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${choices.map((c) => `<span class="tag">P${c.priority} · ${esc(posLabel(c, L))}${c.accepted ? ' ✓' : ''}</span>`).join('')}</div>
        </div>`
      : '';

    // Per-position accept / reject / undo for Super Admin (mirrors the EO decision controls).
    const posControls = () => {
      const base = `/admin/applications/${esc(a.id)}`;
      const acc = choices.find((c) => c.accepted);
      if (a.status === 'approved' && acc) {
        return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <span class="pill pill-ok">✓ ${esc(t('eo.ap.acceptedAs', { pos: posLabel(acc, L) }))}</span>
          <form class="inline-form" method="post" action="${base}/reset-position"><button class="btn btn-ghost btn-sm">${t('eo.ap.undo')}</button></form>
        </div>`;
      }
      if (a.status === 'rejected') {
        return `<div style="margin-top:12px"><form class="inline-form" method="post" action="${base}/reset-position"><button class="btn btn-ghost btn-sm">${t('eo.ap.undo')}</button></form></div>`;
      }
      const btns = choices.map((c) => c.full
        ? `<button type="button" class="btn btn-ghost btn-sm" disabled style="opacity:.55">P${c.priority} ${esc(posLabel(c, L))} · ${t('eo.ap.posFull')}</button>`
        : `<form class="inline-form" method="post" action="${base}/accept-position"><input type="hidden" name="position_id" value="${esc(c.position_id)}"><button class="btn btn-sm">${t('eo.ap.accept')}: P${c.priority} ${esc(posLabel(c, L))}</button></form>`
      ).join('');
      return `<div style="margin-top:12px">
        <div class="muted" style="font-size:12.5px;margin-bottom:8px">${t('eo.ap.decide')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${btns}
          <form class="inline-form" method="post" action="${base}/reject-position" ${jsConfirm(t('eo.ap.rejectConfirm'))}><button class="btn btn-ghost btn-sm" style="color:var(--red)">${t('eo.ap.reject')}</button></form>
        </div>
      </div>`;
    };

    return `<div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0">
          <b style="font-size:16px">${esc(a.talent_name || '—')}</b>
          <div class="muted" style="font-size:12.5px;margin-top:2px">${a.talent_login ? esc(a.talent_login) + ' · ' : ''}${t('mpr.appliedOn', { date: fmtDate(a.created_at) })}</div>
          <div style="margin-top:6px;font-size:14px">${esc(a.event_name || '—')}${a.role ? ` <span class="muted">·</span> <span class="tag">${esc(a.role)}</span>` : ''}</div>
          ${posBlock}
        </div>
        ${mpStatusBadge(a.status, L)}
      </div>
      ${stationLine}
      ${a.status === 'approved' ? `<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        ${a.attended ? `<span class="pill pill-ok">✓ ${t('mpr.attended')}</span>` : `<span class="pill pill-off">${t('mpr.notAttended')}</span>`}
        <form method="post" action="/admin/applications/${esc(a.id)}/resend-email" class="inline-form">
          <button class="btn btn-ghost btn-sm" title="${t('mpr.resendHint')}">✉ ${t('mpr.resendEmail')}</button>
        </form>
        ${a.attended ? (a.certificate
          ? `<span class="pill ${a.certificate.revoked_at ? 'pill-off' : 'pill-ok'}">🎖️ ${esc(a.certificate.cert_no)}${a.certificate.revoked_at ? ` · ${t('cert.revoked')}` : ''}</span>
             ${a.certificate.revoked_at ? '' : `<a href="/admin/certificates/${esc(a.certificate.id)}" class="btn btn-ghost btn-sm">⬇ ${t('cert.download')}</a>`}
             <form method="post" action="/admin/certificates/${esc(a.certificate.id)}/revoke" class="inline-form"><input type="hidden" name="revoke" value="${a.certificate.revoked_at ? '0' : '1'}"><button class="btn btn-ghost btn-sm">${a.certificate.revoked_at ? t('cert.restore') : t('cert.revoke')}</button></form>`
          : `<form method="post" action="/admin/applications/${esc(a.id)}/issue-cert" class="inline-form"><button class="btn btn-sm">🎖️ ${t('cert.issue')}</button></form>`) : ''}
      </div>` : ''}
      ${choices.length ? posControls() : stationForm}
      <details${a.status === 'approved' ? '' : ' open'} style="margin-top:14px">
        <summary style="cursor:pointer;font-size:12.5px;color:var(--muted);font-weight:600;user-select:none;padding:4px 0">${t('mpr.detailToggle')}</summary>
        <div style="margin-top:10px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('adm.profile.title')}</div>
          <div style="margin-top:8px">${talentProfileBlock(a.profile, L)}</div>
        </div>
        <div style="margin-top:12px">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('mpr.answersTitle')}</div>
          ${answerRows || `<div class="muted" style="font-size:13px;margin-top:6px">—</div>`}
        </div>
      </details>
    </div>`;
  };

  // Group applications into per-event folders so different events don't mix. Each
  // folder is a collapsible <details>; opening it reveals that event's applicants
  // (and the event's on-site attendance link).
  const attnByEvent = new Map((attendanceLinks || []).map((l) => [l.eventId, l]));
  const groups = new Map();
  applications.forEach((a) => {
    const k = a.event_id || '—';
    if (!groups.has(k)) groups.set(k, { name: a.event_name || '—', apps: [] });
    groups.get(k).apps.push(a);
  });
  const folders = [...groups.entries()].map(([eid, g]) => {
    const attn = attnByEvent.get(eid);
    const attnBar = attn
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 2px 2px">
          <span class="muted" style="font-size:12.5px;flex:1;min-width:0">📋 ${t('mpr.attnHead')}</span>
          <button type="button" class="btn btn-ghost btn-sm attn-copy" data-path="${esc(attn.path)}" data-copied="🔗 ${esc(t('mpr.attnCopied'))}" data-label="🔗 ${esc(t('mpr.attnCopy'))}">🔗 ${t('mpr.attnCopy')}</button>
          <a href="${esc(attn.path)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${t('mpr.attnOpen')} ↗</a>
        </div>`
      : '';
    return `<details class="ev-folder" style="margin-top:14px"${groups.size === 1 ? ' open' : ''}>
      <summary style="cursor:pointer;font-weight:800;font-size:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px">📁 ${esc(g.name)} <span class="muted" style="font-weight:600;font-size:13px">· ${t('mpr.count', { n: g.apps.length })}</span></summary>
      ${attnBar}${g.apps.map(renderCard).join('')}
    </details>`;
  }).join('');

  const body = `<div class="wrap">
  ${staffHead(staff, catTitle, L)}
  ${flashBanner}
  <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px">
    <p class="muted" style="font-size:13px;margin:0">${t('mpr.count', { n: applications.length })}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a href="/admin/applications/report.pdf" class="btn btn-sm" title="${t('mpr.reportHint')}">📄 ${t('mpr.report')}</a>
    </div>
  </div>
  ${applications.length ? folders : `<div class="card" style="margin-top:14px"><p class="muted" style="margin:0">${catEmpty}</p></div>`}
</div>
<script>
(function(){
  document.querySelectorAll('.station-save').forEach(function(btn){
    var form = btn.closest('form'); if(!form) return;
    var inputs = form.querySelectorAll('[name="station"], [name="station_loc"]');
    var initial = Array.prototype.map.call(inputs, function(i){ return i.value; });
    function sync(){
      var dirty = Array.prototype.some.call(inputs, function(i, idx){ return i.value !== initial[idx]; });
      if(dirty){ btn.classList.remove('btn-ghost'); btn.disabled = false; btn.textContent = btn.dataset.dirty; }
      else { btn.classList.add('btn-ghost'); btn.disabled = true; btn.textContent = btn.dataset.clean; }
    }
    inputs.forEach(function(i){ i.addEventListener('input', sync); i.addEventListener('change', sync); });
    sync();
  });
  document.querySelectorAll('.attn-copy').forEach(function(btn){
    btn.addEventListener('click', function(){
      var url = location.origin + btn.dataset.path;
      var done = function(){ btn.textContent = btn.dataset.copied; setTimeout(function(){ btn.textContent = btn.dataset.label; }, 1600); };
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done, done); }
      else { var ta=document.createElement('textarea'); ta.value=url; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} document.body.removeChild(ta); done(); }
    });
  });
})();
</script>`;
  return appLayout({ title: catTitle + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: catActive, user: staff && staff.name, lang: L });
}

/**
 * On-site attendance page (public, tokened). An event PIC opens the shared link
 * and checks approved Man Power in as they arrive. Self-contained copy (id/en);
 * no sidebar — meant to be used quickly on a phone at the venue.
 */
/**
 * Super Admin / EO: review & verify talent-uploaded HYROX 360 certificates.
 * Lists everyone who uploaded a cert (pending first), with a link to view the
 * file and verify / reject (with a reason) actions.
 */
function adminHyroxCerts({ staff, certs, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  certs = certs || [];
  const badge = (s) => ({
    pending:  `<span class="pill pill-off">⏳ ${t('doc.hx.pending')}</span>`,
    verified: `<span class="pill pill-ok">✓ ${t('doc.hx.verified')}</span>`,
    rejected: `<span class="pill" style="background:var(--err-soft);color:var(--err)">✕ ${t('doc.hx.rejected')}</span>`,
  }[s] || '');
  const cards = certs.map((c) => {
    const meta = [c.login, c.city, c.instagram ? '@' + c.instagram : ''].filter(Boolean).map(esc).join(' · ');
    const note = (c.hyrox_cert_status === 'rejected' && c.hyrox_cert_note)
      ? `<div class="muted" style="font-size:12.5px;margin-top:6px">📝 ${esc(c.hyrox_cert_note)}</div>` : '';
    return `<div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0">
          <b style="font-size:16px">${esc(c.name || '—')}</b> <span class="tag">${esc(talentLabel(L, c.talent_type))}</span>
          ${meta ? `<div class="muted" style="font-size:12.5px;margin-top:3px">${meta}</div>` : ''}
        </div>
        ${badge(c.hyrox_cert_status)}
      </div>
      ${note}
      <div style="margin-top:12px"><a href="/admin/hyrox/${esc(c.id)}/file" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">📎 ${t('hx.view')}</a></div>
      <form method="post" action="/admin/hyrox/${esc(c.id)}/review" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:12px">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:160px">${t('hx.note')}
          <input type="text" name="note" maxlength="300" placeholder="${t('hx.notePh')}" value="${esc(c.hyrox_cert_status === 'rejected' ? (c.hyrox_cert_note || '') : '')}"></label>
        <button class="btn btn-sm" name="action" value="verify">✓ ${t('hx.verify')}</button>
        <button class="btn btn-ghost btn-sm" name="action" value="reject">${t('hx.reject')}</button>
      </form>
    </div>`;
  }).join('');
  const body = `<div class="wrap">
  ${staffHead(staff, t('hx.title'))}
  <p class="sub">${t('hx.sub')}</p>
  <p class="muted" style="font-size:13px;margin-top:6px">${t('hx.count', { n: certs.length })}</p>
  ${certs.length ? cards : `<div class="card" style="margin-top:14px"><p class="muted" style="margin:0">${t('hx.empty')}</p></div>`}
</div>`;
  return appLayout({ title: t('hx.title') + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: 'hyrox', user: staff && staff.name, lang: L });
}

function attendancePage({ invalid, event, eventDate, rows, days, day, token, lang, done }) {
  const L = normLang(lang);
  const id = L !== 'en';
  const s = id ? {
    title: 'Absensi Man Power',
    invalid: 'Link absensi tidak valid atau sudah tidak berlaku.',
    invalidSub: 'Minta link terbaru ke admin 20FIT.',
    search: 'Cari nama…',
    checkin: 'Check-in', present: '✓ Hadir', undo: 'Batalkan',
    empty: 'Belum ada Man Power yang disetujui untuk event ini.',
    noStation: 'Tanpa station',
    hint: 'Pilih hari, lalu peserta sebutkan namanya → cari → tekan Check-in.',
    doneMsg: (n) => (n ? n + ' ' : '') + 'berhasil check-in ✓',
    dayN: (n) => 'Hari ' + n, todayLabel: 'Hadir hari ini', timesTitle: 'Total hari absen',
  } : {
    title: 'Man Power Attendance',
    invalid: 'This attendance link is invalid or no longer active.',
    invalidSub: 'Ask a 20FIT admin for the latest link.',
    search: 'Search name…',
    checkin: 'Check in', present: '✓ Present', undo: 'Undo',
    empty: 'No approved Man Power for this event yet.',
    noStation: 'No station',
    hint: 'Pick the day, then have the person say their name → search → tap Check in.',
    doneMsg: (n) => (n ? n + ' ' : '') + 'checked in ✓',
    dayN: (n) => 'Day ' + n, todayLabel: 'Present this day', timesTitle: 'Total days attended',
  };
  if (invalid) {
    const b = `<div class="wrap narrow"><div class="card" style="margin-top:48px;text-align:center">
      <div style="font-size:42px">🔒</div>
      <h1 style="margin:12px 0 6px;font-size:20px">${esc(s.invalid)}</h1>
      <p class="muted" style="margin:0">${esc(s.invalidSub)}</p></div></div>`;
    return layout({ title: s.title + ' — 20FIT', body: b, brand: 'TALENT', lang: L });
  }
  const dayList = days || [];
  const daySel = (dayList.length > 1) ? `
  <div style="display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;-webkit-overflow-scrolling:touch">
    ${dayList.map((d, i) => `<a href="/absensi/${esc(event.id)}?k=${esc(token)}&day=${esc(d)}" class="btn btn-sm ${d === day ? '' : 'btn-ghost'}" style="flex-shrink:0;white-space:nowrap">${esc(s.dayN(i + 1))} · ${esc(fmtDay(d))}</a>`).join('')}
  </div>` : '';
  const total = rows.length;
  const doneCount = rows.filter((r) => r.checked).length;
  const list = total ? rows.map((r, i) => {
    const st = r.station ? esc(r.station) + (r.station_loc ? ' · ' + esc(r.station_loc) : '') : `<span class="muted">${esc(s.noStation)}</span>`;
    const f = (attended, inner) => `<form method="post" action="/absensi/${esc(event.id)}/checkin" style="margin:0;flex-shrink:0"><input type="hidden" name="k" value="${esc(token)}"><input type="hidden" name="app" value="${esc(r.id)}"><input type="hidden" name="day" value="${esc(day || '')}"><input type="hidden" name="attended" value="${attended}">${inner}</form>`;
    const totalBadge = r.count > 0 ? `<span class="pill pill-ok" title="${esc(s.timesTitle)}" style="font-size:11px">${r.count}×</span>` : '';
    const toggle = r.checked
      ? `<span class="pill pill-ok">${s.present}</span>${f('0', `<button class="btn btn-ghost btn-sm">${esc(s.undo)}</button>`)}`
      : f('1', `<button class="btn btn-sm">${esc(s.checkin)}</button>`);
    return `<div class="att-row" data-name="${esc(String(r.name).toLowerCase())}" style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 2px;border-top:${i ? '1px solid var(--line)' : '0'}">
      <div style="min-width:0"><b style="font-size:15px">${esc(r.name)}</b><div class="muted" style="font-size:12.5px;margin-top:2px">📍 ${st}</div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">${totalBadge}${toggle}</div>
    </div>`;
  }).join('') : `<p class="muted" style="margin:16px 0 0">${esc(s.empty)}</p>`;
  const doneBanner = done ? `<div class="banner banner-ok" style="margin-bottom:12px">${esc(s.doneMsg(done))}</div>` : '';
  const body = `<div class="wrap narrow">
  <h1 style="margin:6px 0 2px;font-size:22px">${esc(s.title)}</h1>
  <p class="sub" style="margin:0 0 2px">${esc(event.name)}${eventDate ? ' · ' + esc(eventDate) : ''}</p>
  <p class="muted" style="font-size:12.5px;margin:2px 0 12px">${esc(s.hint)}</p>
  ${doneBanner}
  ${daySel}
  <div class="card" style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:0;padding:14px 16px">
    <input type="text" id="attSearch" placeholder="${esc(s.search)}" autocomplete="off" inputmode="search" style="flex:1;min-width:0">
    <span class="pill pill-ok" style="white-space:nowrap" title="${esc(s.todayLabel)}"><b>${doneCount}</b>/${total}</span>
  </div>
  <div class="card" style="margin-top:12px">${list}</div>
</div>
<script>
(function(){
  var q=document.getElementById('attSearch'); if(!q) return;
  var rows=[].slice.call(document.querySelectorAll('.att-row'));
  q.addEventListener('input', function(){
    var v=q.value.trim().toLowerCase();
    rows.forEach(function(r){ r.style.display=(!v||r.dataset.name.indexOf(v)>=0)?'':'none'; });
  });
})();
</script>`;
  return layout({ title: s.title + ' — 20FIT', body, brand: 'TALENT', lang: L });
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
function configError(missing, lang) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const body = `<div class="wrap narrow"><div class="card">
    <h1>${t('cfg.title')}</h1>
    <div class="banner banner-warn">${t('cfg.body', { missing: esc(missing) })}</div>
  </div></div>`;
  return layout({ title: t('cfg.title') + ' — 20FIT', body, lang: L });
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

// Badge for the prioritised-application status flow (applied → … → completed / rejected).
function talentStatusBadge(status, lang) {
  const L = normLang(lang);
  const t = (k) => tr(L, k);
  const map = {
    applied: ['#1d4ed8', '#dbeafe'], pending: ['#1d4ed8', '#dbeafe'],
    under_review: ['#b45309', '#fef3c7'], approved: ['#0f9d6a', '#d1fae5'],
    assigned: ['#0e7490', '#cffafe'], completed: ['#374151', '#e5e7eb'], rejected: ['#b91c1c', '#fee2e2'],
  };
  const c = map[status] || map.applied;
  return `<span class="pill" style="background:${c[1]};color:${c[0]}">${esc(t('ta.status.' + status) || status)}</span>`;
}

// Horizontal progress tracker the talent sees while the EO reviews their
// application: Applied → Under Review → Approved → Assigned. Returns '' for a
// rejected application (that's conveyed by the status badge instead).
function applicationTracker(status, lang) {
  const L = normLang(lang);
  const t = (k) => tr(L, k);
  if (status === 'rejected') return '';
  const steps = ['applied', 'under_review', 'approved', 'assigned'];
  const activeIdx = { applied: 0, pending: 0, under_review: 1, approved: 2, assigned: 3, completed: 3 };
  const achieved = { approved: 1, assigned: 1, completed: 1 };
  const cur = activeIdx[status] != null ? activeIdx[status] : 0;
  const done = !!achieved[status];
  const html = steps.map((s, i) => {
    const cls = i < cur ? 'done' : (i === cur ? (done ? 'done' : 'active') : '');
    const fill = i <= cur ? ' fill' : '';
    const dot = cls === 'done' ? '✓' : String(i + 1);
    return `<div class="trk-step ${cls}${fill}"><span class="trk-dot">${dot}</span><span class="trk-lbl">${esc(t('ta.status.' + s))}</span></div>`;
  }).join('');
  return `<div class="trk" role="list" aria-label="Application progress">${html}</div>`;
}

function talentHomePath(account) { return '/' + ((account && account.talent_type) || 'kol').replace(/_/g, '-'); }

// One card for a position-based EO event. filterable=true adds the search/
// filter hooks (data-status/data-search + ev-item) so it works inside the
// KOL events list; false renders a plain card for dashboards.
function talentPositionCard(e, lang, filterable) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const date = e.starts_at ? fmtDay(e.starts_at) + (e.ends_at && e.ends_at !== e.starts_at ? ' – ' + fmtDay(e.ends_at) : '') : '';
  // Each position chip deep-links to that position's jobdesk on the detail page.
  // Chips sit above the whole-card "stretched" link (higher z-index) so they win the click.
  const posLine = (e.openPositions || []).map((p) => `<a href="/event/${esc(e.id)}?lang=${L}#pos-${esc(p.position_id)}" class="tag" style="margin:0 6px 6px 0;display:inline-block;text-decoration:none;color:inherit">${esc(posLabel(p, L))}</a>`).join('');
  const hay = [e.name, e.location, e.category, e.eoName].filter(Boolean).join(' ').toLowerCase();
  const cls = filterable ? 'card ev-card ev-item' : 'card ev-card';
  const hooks = filterable ? ` data-status="${esc(e.status || '')}" data-search="${esc(hay)}"` : '';
  return `<div class="${cls}"${hooks} style="position:relative;margin-top:12px">
    <a href="/event/${esc(e.id)}?lang=${L}" aria-label="${esc(e.name)}" style="position:absolute;inset:0;z-index:1"></a>
    ${eventCover(e, L)}
    <div><b style="font-size:16px">${esc(e.name)}</b>${e.category ? ` <span class="muted" style="font-size:12.5px">· ${esc(e.category)}</span>` : ''}</div>
    ${e.eoName ? `<div class="muted" style="font-size:12.5px;margin-top:3px">🏢 ${esc(e.eoName)}</div>` : ''}
    ${date ? `<div class="muted" style="font-size:12.5px;margin-top:3px">📅 ${date}</div>` : ''}
    ${e.location ? `<div class="muted" style="font-size:12.5px;margin-top:3px">📍 ${esc(e.location)}</div>` : ''}
    ${e.reg_deadline ? `<div class="muted" style="font-size:12.5px;margin-top:3px">⏳ ${t('ta.closes')}: ${fmtDay(e.reg_deadline)}</div>` : ''}
    <div style="margin-top:10px;position:relative;z-index:2">${posLine}</div>
    ${e.applied ? `<div style="margin-top:8px">${talentStatusBadge(e.myStatus || 'applied', L)} <span class="muted" style="font-size:12px">${t('ta.alreadyApplied')}</span></div>` : ''}
  </div>`;
}

function talentOpenEvents({ account, events, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const cards = (events && events.length)
    ? events.map((e) => talentPositionCard(e, L, false)).join('')
    : `<p class="muted" style="margin-top:14px">${t('ta.noOpen')}</p>`;
  const body = `<div class="wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:4px">
      <h1 style="margin:0">${t('ta.openTitle')}</h1>
      <a href="${talentHomePath(account)}?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    </div>
    <p class="sub">${t('ta.openSub')}</p>
    ${cards}
  </div>`;
  return layout({ title: t('ta.openTitle') + ' — 20FIT', body, brand: 'TALENT', home: talentHomePath(account) + '?lang=' + L, lang: L });
}

function talentEventApply({ account, event, ctx, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const e = event;
  const errors = ctx.errors || [];
  const eb = errors.length ? `<div class="banner banner-err" style="margin-top:14px"><b>${t('err.header')}</b><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const date = e.starts_at ? fmtDay(e.starts_at) + (e.ends_at && e.ends_at !== e.starts_at ? ' – ' + fmtDay(e.ends_at) : '') : '';
  // Work type derived from the event's duration (single day = daily; else N days).
  let days = 1;
  if (e.starts_at) { const s = String(e.starts_at).slice(0, 10); const en = e.ends_at ? String(e.ends_at).slice(0, 10) : s; const d = Math.round((new Date(en + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000) + 1; days = d > 0 ? d : 1; }
  const workType = days <= 1 ? t('ta.workDaily') : (days + ' ' + t('ta.workDaysUnit'));
  // A KOL-type talent without CV + portfolio can't pick creator positions (kol/photog/videog).
  const docsMissing = !!(account && account.talent_type === 'kol' && !hasCreatorDocs(account));
  const editable = ctx.regOpen && (!ctx.myApp || ['applied', 'pending', 'under_review'].includes(ctx.myApp.status));
  const applyMode = !ctx.myApp && editable;

  // Event-level info chips (shared by every position).
  const chip = (icon, txt) => txt ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;background:var(--bg-soft,#f5f5f7);border:1px solid var(--line);border-radius:999px;padding:5px 11px;margin:5px 6px 0 0">${icon} ${esc(txt)}</span>` : '';
  const chips = `<div style="margin-top:10px">${chip('📍', e.location)}${chip('📅', date)}${chip('🗓️', workType)}${e.created_at ? chip('🕒', t('ta.posted') + ': ' + fmtDay(e.created_at)) : ''}${e.reg_deadline ? chip('⏳', t('ta.closes') + ': ' + fmtDay(e.reg_deadline)) : ''}</div>`;

  // Per-position "job listing" cards.
  const posSorted = (ctx.positions || []).slice().sort((a, b) => (a.sort - b.sort) || posLabel(a, L).localeCompare(posLabel(b, L), 'id'));
  const bstyle = 'display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap';
  const sec = (icon, label, txt) => `<div style="margin-top:12px"><div style="font-size:11.5px;font-weight:700;color:var(--muted,#6b6b70)">${icon} ${label}</div><div style="font-size:13.5px;line-height:1.55;white-space:pre-wrap;margin-top:2px">${esc(txt)}</div></div>`;
  // Soft-red line icon per position family (falls back to a clipboard), shown in
  // the tile atop each card — mirrors the "Why Choose" benefit-card style.
  const _svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const POS_ICONS = {
    fotografer: _svg('<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.2-2h7.6L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.2"/>'),
    videografer: _svg('<rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="M15 10.5l6-3v9l-6-3z"/>'),
    kol: _svg('<path d="M4 10v4l3.2.5 2.4 3.8L11 18V6.2l-1.4-.5L7.2 9.5z"/><path d="M15 8.6a4 4 0 0 1 0 6.8"/>'),
    water_station: _svg('<path d="M12 3.6s5.8 5.9 5.8 10.4a5.8 5.8 0 1 1-11.6 0C6.2 9.5 12 3.6 12 3.6z"/>'),
  };
  const posIcon = (key) => POS_ICONS[key] || _svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.4h6V7H9z"/><path d="M8.5 11h7M8.5 15h4.5"/>');
  const card = (p) => {
    const left = Math.max(0, (p.quota || 0) - (p.filled || 0));
    const isOpen = !p.closed_at && !p.full;
    const lock = docsMissing && CREATOR_ROLES.includes(p.key);
    const badge = p.closed_at ? `<span style="${bstyle};background:#eceae5;color:#6b6b70">${t('ta.posClosed')}</span>`
      : p.full ? `<span style="${bstyle};background:#fdeccd;color:#8a5a00">${t('ta.posFull')}</span>`
        : `<span style="${bstyle};background:#d8f3e3;color:#0f7a45">${t('ta.posOpen')}</span>`;
    const btn = (applyMode && isOpen && !lock)
      ? `<button type="button" class="pos-apply btn btn-ghost btn-sm" data-pos="${esc(p.position_id)}" style="margin-top:14px;width:100%">${t('ta.applyThis')}</button>`
      : (applyMode && lock ? `<div class="muted" style="margin-top:12px;font-size:12px">🔒 <a href="/kol/dokumen?need=1&lang=${L}" style="font-weight:700">${t('doc.lockHint')}</a></div>` : '');
    // Jobdesk = the card's main description; requirement/fee/quota + apply button
    // sit in the footer. Uses the shared benefitCard() so it matches the landing
    // "Kenapa Pilih 20FIT Talent" grid exactly.
    const quotaLine = `<div style="font-size:12.5px;color:#5b6069;margin-top:12px">${t('ta.quota')}: ${p.filled || 0}/${p.quota || 0}${isOpen && left > 0 ? ` · ${t('ta.slotsLeft')}: <b style="color:var(--red)">${left}</b>` : ''}</div>`;
    const foot = `${p.requirement ? sec('✅', t('ta.requirement'), p.requirement) : ''}${p.fee ? sec('💰', t('ta.fee'), p.fee) : ''}${quotaLine}${btn}`;
    return benefitCard({
      icon: posIcon(p.key),
      title: esc(posLabel(p, L)),
      desc: p.jobdesk ? esc(p.jobdesk) : '',
      corner: badge,
      foot,
      id: 'pos-' + esc(p.position_id),
    });
  };
  const cardsHtml = posSorted.map(card).join('');

  // Already applied: show the ranked choices + status, with auto-closed labels
  // for the lower-priority choices once the talent is accepted somewhere.
  let myBlock = '';
  if (ctx.myApp) {
    const approved = ctx.myApp.status === 'approved';
    const rows = ctx.myChoices.map((c) => {
      const p = ctx.posById.get(c.position_id) || {};
      let tag = '';
      if (c.accepted) tag = `<span class="pill pill-ok">${t('ta.acceptedHere')}</span>`;
      else if (approved) tag = `<span style="${bstyle};background:#eceae5;color:#6b6b70">${t('ta.autoClosed')}</span>`;
      return `<div class="dl-item" style="align-items:center"><div><b>P${c.priority}</b> · ${esc(posLabel(p, L))}</div>${tag}</div>`;
    }).join('');
    myBlock = `<div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>${t('ta.yourApp')}</b>${talentStatusBadge(ctx.myApp.status, L)}</div>
      ${applicationTracker(ctx.myApp.status, L)}
      <div class="dl-list" style="margin-top:8px">${rows}</div>
      ${approved ? `<p class="muted" style="font-size:12px;margin:8px 0 0">${t('ta.autoClosedHint')}</p>` : ''}
    </div>`;
  }

  // Priority ranking: the Lamar buttons on the cards populate P1/P2/P3 (max 3).
  let rankingForm = '';
  if (applyMode) {
    const labels = {}; posSorted.forEach((p) => { labels[p.position_id] = posLabel(p, L); });
    rankingForm = `<form method="post" action="/event/${esc(e.slug || e.id)}/apply" id="applyForm" class="card" style="margin-top:16px">
      <div style="font-weight:700">${t('ta.yourPriority')}</div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 10px">${t('ta.rankHint')}</p>
      <ol id="rankList" style="margin:0;padding-left:0;list-style:none"></ol>
      <p class="muted" id="rankEmpty" style="font-size:12.5px;margin:0 0 10px">${t('ta.rankEmpty')}</p>
      <input type="hidden" name="pos1" id="hpos1"><input type="hidden" name="pos2" id="hpos2"><input type="hidden" name="pos3" id="hpos3">
      <button type="submit" class="btn btn-block" id="applySubmit" disabled>${t('ta.submit')}</button>
    </form>
    <script>(function(){
      var LBL=${JSON.stringify(labels).replace(/</g, '\\u003c')};
      var ADD=${JSON.stringify(t('ta.applyThis'))},REM=${JSON.stringify(t('ta.rankRemove'))};
      var MAX=3,sel=[];
      var wrap=document.getElementById('posCards'),form=document.getElementById('applyForm');
      if(!wrap||!form)return;
      var h=[document.getElementById('hpos1'),document.getElementById('hpos2'),document.getElementById('hpos3')];
      var sub=document.getElementById('applySubmit'),list=document.getElementById('rankList'),empty=document.getElementById('rankEmpty');
      function render(){
        [].slice.call(wrap.querySelectorAll('.pos-apply')).forEach(function(b){
          var pid=b.getAttribute('data-pos'),i=sel.indexOf(pid);
          if(i>=0){b.textContent='P'+(i+1)+' · '+REM;b.classList.add('on');b.disabled=false;}
          else{b.textContent=ADD;b.classList.remove('on');b.disabled=sel.length>=MAX;}
        });
        for(var k=0;k<3;k++)h[k].value=sel[k]||'';
        list.innerHTML='';
        sel.forEach(function(pid,i){var li=document.createElement('li');li.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)';var s=document.createElement('span');s.textContent='P'+(i+1);s.style.cssText='font-weight:800;color:var(--red);min-width:26px';li.appendChild(s);li.appendChild(document.createTextNode(LBL[pid]||''));list.appendChild(li);});
        empty.style.display=sel.length?'none':'';
        sub.disabled=sel.length===0;
      }
      wrap.addEventListener('click',function(ev){
        var b=ev.target&&ev.target.closest?ev.target.closest('.pos-apply'):null;
        if(!b)return;ev.preventDefault();
        var pid=b.getAttribute('data-pos'),i=sel.indexOf(pid);
        if(i>=0)sel.splice(i,1);else if(sel.length<MAX)sel.push(pid);
        render();
      });
      render();
    })();</script>`;
  }
  const cancelForm = (ctx.myApp && editable)
    ? `<form method="post" action="/event/${esc(e.slug || e.id)}/cancel" ${jsConfirm(t('ta.cancelConfirm'))} style="margin-top:14px"><button type="submit" class="btn btn-ghost btn-block">${t('ta.cancel')}</button></form>`
    : '';
  const regClosedBanner = (!editable && !ctx.myApp) ? `<div class="banner banner-warn" style="margin-top:14px">${t('ta.regClosed')}</div>` : '';

  // Creator accounts missing CV/portfolio can't apply to KOL/photog/videog positions.
  const creatorOpen = (ctx.openPositions || []).some((p) => CREATOR_ROLES.includes(p.key));
  const docsWarn = (docsMissing && creatorOpen)
    ? `<div class="banner banner-warn" style="margin-top:14px">${t('doc.eventWarn')} <a href="/kol/dokumen?need=1&lang=${L}" style="font-weight:700;white-space:nowrap">${t('doc.completeNow')}</a></div>`
    : '';
  const body = `<div class="wrap" style="max-width:1080px">
    <a href="/events?lang=${L}" class="btn btn-ghost btn-sm" style="margin-bottom:16px">${t('common.back')}</a>
    ${e.mockup_url ? `<img src="${esc(e.mockup_url)}" class="ev-detail-hero" alt="" onerror="this.style.display='none'">` : ''}
    <h1 style="margin:0;font-size:clamp(26px,3.2vw,38px);line-height:1.08">${esc(e.name)}</h1>
    <p class="sub" style="margin:7px 0 0;font-size:16px">${e.category ? esc(e.category) + ' · ' : ''}${date}</p>
    ${chips}
    <div style="max-width:820px">
      ${e.description ? `<p style="white-space:pre-wrap;margin-top:14px;text-align:justify">${esc(e.description)}</p>` : ''}
      ${eb}${docsWarn}${myBlock}${cancelForm}
    </div>
    <section class="bband" style="margin-top:26px">
      <h2 class="bband-h">${t('ta.positionsTitle')}</h2>
      <div id="posCards" class="bgrid">${cardsHtml}</div>
    </section>
    <div style="max-width:820px">
      ${rankingForm}${regClosedBanner}
    </div>
  </div>`;
  return layout({ title: e.name + ' — 20FIT', body, brand: 'TALENT', home: talentHomePath(account) + '?lang=' + L, lang: L });
}

module.exports = {
  talentStatusBadge, talentOpenEvents, talentEventApply,
  esc, fmtDate, landingPage, aboutPage, talentPicker, kolForm, kolSuccess, kolProofPage, kolProfilePage, kolEventsPage,
  kolEventDetail, kolApplyForm, kolApplyDone, certVerifyPage, CAT_LABEL, CAT_FIELDS, CREATOR_ROLES, hasCreatorDocs,
  publicSubmitPage, publicSubmitSuccess,
  mainPowerDashboard, mainPowerApply, mainPowerApplyDone, MP_JOBDESKS,
  adminDashboard, adminKolDetail, adminAnalysis, adminOverview, adminProofs, adminManage, adminLanding, adminEoDetail, adminEventEdit, adminApplications, adminHyroxCerts, attendancePage, performancePage,
  talentLogin, talentRegister, talentDataDiri, talentDocuments, forgotPassword, forgotPasswordSent, resetPassword, resetPasswordDone,
  PROVINCES,
  staffLogin, configError, adminNoService, page500,
  staffForgot, staffForgotSent, staffReset, staffResetDone, eoDashboard, eoProfile,
  eoEvents, eoEventForm, eoEventDetail, eoRegister, eoVerifySent, eoVerifyResult, eoVerifyNeeded,
};
