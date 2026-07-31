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
.brand .brand-img{height:2.1em;width:auto;display:block;flex:0 0 auto}
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
.wrap{max-width:1000px;margin:0 auto;padding:30px 20px 70px}
.wrap.narrow{max-width:640px}
h1{font-size:27px;font-weight:800;letter-spacing:-.01em}
h2{font-size:18px;font-weight:700;margin:0 0 14px}
.sub{color:var(--muted);font-size:15px;margin-top:5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:20px}
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
`;

// Head script: apply the saved theme before first paint (no flash), and wire the toggle pills.
const THEME_HEAD = `<script>
(function(){try{if(localStorage.getItem('theme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();
function setTheme(m){var el=document.documentElement;if(m==='light')el.setAttribute('data-theme','light');else el.removeAttribute('data-theme');try{localStorage.setItem('theme',m);}catch(e){}syncThemeBtns();}
function syncThemeBtns(){var cur=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';var bs=document.querySelectorAll('[data-theme-set]');for(var i=0;i<bs.length;i++){bs[i].classList.toggle('active',bs[i].getAttribute('data-theme-set')===cur);}}
if(document.readyState!=='loading')syncThemeBtns();else document.addEventListener('DOMContentLoaded',syncThemeBtns);
</script>`;

/** Theme toggle pill (light / dark), synced client-side. */
function themeToggle() {
  return `<div class="theme-toggle" role="group" aria-label="Theme"><button type="button" data-theme-set="light" onclick="setTheme('light')" title="Light">☀️</button><button type="button" data-theme-set="dark" onclick="setTheme('dark')" title="Dark">🌙</button></div>`;
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
  return `<!doctype html><html lang="${normLang(lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
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
  const isStaff = role === 'super_admin' || role === 'eo';
  const roleLabel = t('role.' + (role || 'kol'));
  const homeHref = isStaff ? '/admin' : '/kol';
  const logoutAction = isStaff ? '/admin/logout' : '/kol/logout';
  const items = isStaff
    ? navLink('/admin', 'dashboard', active, 'dashboard', t('nav.dashboard'))
      + navLink('/admin/overview', 'overview', active, 'overview', t('nav.overview'))
      + navLink('/admin/analytics', 'analytics', active, 'analytics', t('nav.analytics'))
      + navLink('/admin/proofs', 'proofs', active, 'proofs', t('nav.proofs'))
      + (role === 'super_admin' ? navLink('/admin/applications', 'applications', active, 'applications', t('nav.applications')) : '')
      + (role === 'super_admin' ? navLink('/admin/manage', 'manage', active, 'manage', t('nav.manage')) : '')
    : navLink('/kol', 'kol', active, 'proofs', t('nav.proofs'));

  return `<!doctype html><html lang="${L}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style>${THEME_HEAD}</head>
<body>
<input type="checkbox" id="nav-cb" class="nav-cb" aria-label="Menu">
<aside class="sidebar">
  <a href="${homeHref}" class="side-logo brand">${brandMark('TALENT')}</a>
  <nav class="side-nav">${items}</nav>
  <div class="side-foot">
    <div style="margin-bottom:12px">${toggles(L)}</div>
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
</body></html>`;
}

/**
 * Landing page at "/" (dark prototype hero) with an ID/EN language toggle.
 * CTAs lead to the talent-type picker for sign up (/register) and log in (/login).
 */
function landingPage(lang) {
  const L = (lang === 'en') ? 'en' : 'id';
  const t = (k, v) => tr(L, k, v);
  // Feature cards: [icon badge, i18n key base] — title/desc resolved from the dictionary.
  const FEATS = [
    ['ID', 'feat.identity'],
    ['AI', 'feat.face'],
    ['SOW', 'feat.job'],
    ['3', 'feat.roles'],
    ['★', 'feat.cert'],
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

  const featHtml = FEATS.map(([icon, key]) => `<div style="background:var(--lp-card);border:1px solid var(--lp-line);border-radius:14px;padding:24px">
      <div style="width:44px;height:44px;background:rgba(228,18,31,.14);border:1px solid rgba(228,18,31,.3);border-radius:10px;display:flex;align-items:center;justify-content:center;font:800 18px/1 'Barlow Condensed',sans-serif;color:var(--red);margin-bottom:16px">${esc(icon)}</div>
      <div style="font:700 19px/1.1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin-bottom:8px">${esc(t(key + '.title'))}</div>
      <p style="color:var(--lp-tx3);font-size:14px;line-height:1.5;margin:0">${esc(t(key + '.desc'))}</p>
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

  const langBtn = (code, label) => {
    const on = code === L;
    return `<a href="/?lang=${code}" style="padding:9px 16px;border-radius:8px;font:700 15px/1 Barlow,sans-serif;color:${on ? '#fff' : 'var(--lp-tx3)'};background:${on ? 'var(--red)' : 'transparent'}">${label}</a>`;
  };
  const toggle = `<div style="display:flex;background:var(--lp-chip);border:1px solid var(--lp-line);border-radius:11px;padding:4px;gap:3px">${langBtn('id', 'ID')}${langBtn('en', 'EN')}</div>`;
  const q = `?lang=${L}`;

  return `<!doctype html><html lang="${L}"><head>
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
.hero-stage{position:relative;overflow:hidden;background:var(--lp-bg)}
.hero-stage>header,.hero-stage>section{position:relative;z-index:2}
.hero-bg{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.hero-bg i{position:absolute;display:block;border-radius:45% 55% 58% 42%;filter:blur(90px);opacity:.5;will-change:transform}
.hero-bg .b1{width:70vw;height:56vw;left:-18%;top:-32%;background:radial-gradient(closest-side,#E4121F,transparent);animation:flow1 48s ease-in-out infinite}
.hero-bg .b2{width:60vw;height:54vw;right:-14%;top:-8%;background:radial-gradient(closest-side,#8f0d15,transparent);animation:flow2 58s ease-in-out infinite}
.hero-bg .b3{width:64vw;height:48vw;left:22%;bottom:-36%;background:radial-gradient(closest-side,#c20e18,transparent);animation:flow3 66s ease-in-out infinite}
.hero-bg .b4{width:24vw;height:24vw;left:52%;top:12%;opacity:.13;background:radial-gradient(closest-side,#fff,transparent);animation:flow2 52s ease-in-out infinite reverse}
.hero-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(130% 100% at 28% 42%,transparent 34%,rgba(9,9,12,.55) 100%)}
:root[data-theme="light"] .hero-bg i{opacity:.18}
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
@keyframes shimmer{to{background-position:-220% 0}}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
.lp-float{animation:floaty 7s ease-in-out infinite;will-change:transform}
@media(prefers-reduced-motion:reduce){.hero-bg i{animation:none}.hero-in{animation:none;opacity:1}.accent-shimmer{animation:none;-webkit-text-fill-color:#E4121F;color:#E4121F}.lp-float{animation:none}}
.stripe{background-image:repeating-linear-gradient(135deg,#eceae5 0 10px,#f4f2ee 10px 20px)}
.resp1{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.resp3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.eco-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
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
.foot-main{max-width:1180px;margin:0 auto;padding:52px 28px 0;display:flex;justify-content:center;align-items:center;gap:26px;flex-wrap:wrap}
.foot-social{display:flex;flex-direction:row;gap:22px}
.foot-social a{color:var(--lp-tx3);display:inline-flex}
.foot-social a:hover{color:var(--red)}
.foot-social svg{width:24px;height:24px;display:block}
.foot-bottom{max-width:1180px;margin:44px auto 0;padding:22px 28px 44px;border-top:1px solid var(--lp-line);color:var(--lp-tx4);font-size:13px;text-align:center}
.foot-bottom a{color:var(--lp-tx3)}
@media(max-width:760px){.foot-main{padding-top:40px}}
@media(max-width:860px){.resp1{grid-template-columns:1fr !important}.resp3{grid-template-columns:1fr 1fr !important}.eco-grid{grid-template-columns:1fr 1fr !important}}
@media(max-width:560px){.resp3{grid-template-columns:1fr !important}}
</style>${THEME_HEAD}</head>
<body>
<div style="min-height:100vh">
  <div class="hero-stage">
  <div class="hero-bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
  <header class="lp-head">
    <span class="lp-logo-box">
      <img src="${LOGO_DARK}" alt="20FIT" class="lp-logo lp-logo-dark">
      <img src="${LOGO_LIGHT}" alt="20FIT" class="lp-logo lp-logo-light">
    </span>
    <div class="lp-toggles">
      <a href="/submit${q}" class="lp-submit">${esc(t('land.submit'))}</a>
      ${toggle}
      ${themeToggle()}
    </div>
  </header>

  <section class="resp1" style="max-width:1180px;margin:0 auto;padding:48px 28px 60px">
    <div>
      <h1 class="hero-in d1" style="font:800 clamp(40px,6vw,72px)/0.92 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin:0 0 20px">${esc(tr(L, 'hero.headlineLead'))}<span class="accent-shimmer"> ${esc(tr(L, 'hero.headlineAccent'))}</span></h1>
      <p class="hero-in d2" style="font-size:18px;line-height:1.55;color:var(--lp-tx2);max-width:520px;margin:0 0 30px">${esc(tr(L, 'hero.subheadline'))}</p>
      <div class="hero-in d3" style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="/register${q}" style="padding:16px 30px;background:var(--red);color:#fff;border-radius:10px;font:700 16px/1 Barlow,sans-serif;box-shadow:0 8px 24px rgba(228,18,31,.4)">${esc(t('land.join'))} →</a>
        <a href="/login${q}" style="padding:16px 30px;background:var(--lp-chip);color:var(--lp-tx);border:1px solid var(--lp-line2);border-radius:10px;font:700 16px/1 Barlow,sans-serif">${esc(t('land.login'))}</a>
      </div>
    </div>
    <div style="position:relative">
      <div class="lp-float" style="background:var(--lp-card);border:1px solid var(--lp-line);border-radius:20px;padding:22px">
        <img src="https://media.20fit.id/wp-content/uploads/2026/07/Background-BRI-WELNESS-EXPERIENCE.jpeg" alt="Platarox Jakarta Hybrid Race" style="width:100%;height:auto;border-radius:12px;display:block;margin-bottom:16px;background:var(--lp-chip)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
          <div style="font:700 18px/1 'Barlow Condensed',sans-serif;text-transform:uppercase">Platarox Jakarta Hybrid Race</div>
          <span style="background:var(--ok);color:#fff;font:600 11px/1 Barlow,sans-serif;padding:5px 9px;border-radius:6px">${esc(t('land.slot'))}</span>
        </div>
        <div style="font-size:13px;color:var(--lp-tx3)">12 Sep 2026 · Jakarta · Judges</div>
      </div>
    </div>
  </section>
  </div>

  <section style="background:var(--lp-bg2);padding:56px 0">
    <div style="max-width:1180px;margin:0 auto;padding:0 28px">
      <h2 style="font:800 32px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 34px">${esc(t('land.featTitle'))}</h2>
      <div class="resp3">${featHtml}</div>
    </div>
  </section>

  <section style="max-width:1180px;margin:0 auto;padding:64px 28px;text-align:center">
    <h2 style="font:800 clamp(30px,4.5vw,44px)/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 12px">${esc(t('land.ecoTitle'))}</h2>
    <p style="color:var(--lp-tx3);font-size:16px;margin:0 auto 34px;max-width:620px">${esc(t('land.ecoSub'))}</p>
    <div class="eco-grid">${ecoHtml}</div>
  </section>

  <footer>
    <div class="foot-main">
      <div class="foot-social" role="group" aria-label="Social media">${socialHtml}</div>
    </div>
    <div class="foot-bottom">talent.20fit.id · © 2026 PT Kredo AUM · ${esc(t('land.foot'))} · <a href="/submit${q}">${esc(t('land.submit'))}</a> · <a href="/admin/login">Login Admin</a> · <a href="/eo/login">Login EO</a></div>
  </footer>
</div>
</body></html>`;
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
    { type: 'main_power', tag: 'MP', name: 'Main Power', id: 'Judges, Marshal, Drop Bag, Registrasi — apply sendiri ke event sesuai jobdesk.', en: 'Judges, Marshal, Drop Bag, Registration — apply to events yourself per jobdesk.', active: true },
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

const TALENT_LABEL = { kol: 'KOL', main_power: 'Main Power', fotografer: 'Fotografer' };
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

function authShell(type, title, sub, formHtml, footHtml, errors, lang) {
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
  return layout({ title: `${title} — 20FIT ${talentLabel(L, type)}`, body, brand: talentLabel(L, type) || 'Talent', home: '/?lang=' + L, lang: L });
}

function talentLogin(type, opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type);
  const v = opts.values || {};
  const form = `<form method="post" action="/${p}/login">
    <div class="field">
      <label for="login">${t('common.emailphone')}</label>
      <input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
    </div>
    <div class="field">
      <label for="password">${t('common.password')}</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
    </div>
    <button type="submit" class="btn btn-block">${t('btn.signin')}</button>
    <div style="text-align:center;margin-top:14px"><a href="/${p}/forgot-password?lang=${L}" style="color:var(--muted);font-size:14px">${t('auth.forgot.link')}</a></div>
  </form>`;
  const foot = t('auth.foot.toRegister', { href: `/${p}/register?lang=${L}` });
  return authShell(type, t('auth.login.title', { role: talentLabel(L, type) }), t('auth.login.sub'), form, foot, opts.errors, L);
}

function talentRegister(type, opts = {}) {
  const L = normLang(opts.lang);
  const t = (k, v) => tr(L, k, v);
  const p = talentPath(type);
  const v = opts.values || {};
  const form = `<form method="post" action="/${p}/register">
    <div class="field">
      <label for="name">${t('common.fullname')}</label>
      <input type="text" id="name" name="name" required maxlength="120" value="${esc(v.name || '')}">
    </div>
    <div class="field">
      <label for="login">${t('common.emailphone')}</label>
      <input type="text" id="login" name="login" required autocomplete="username" value="${esc(v.login || '')}">
      <div class="hint" style="margin-top:6px">${t('hint.usedForLogin')}</div>
    </div>
    <div class="field">
      <label for="password">${t('common.password')}</label>
      <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
      <div class="hint" style="margin-top:6px">${t('hint.min6')}</div>
    </div>
    <button type="submit" class="btn btn-block">${t('btn.register')}</button>
  </form>`;
  const foot = t('auth.foot.toLogin', { href: `/${p}/login?lang=${L}` });
  return authShell(type, t('auth.register.title', { role: talentLabel(L, type) }), t('auth.register.sub'), form, foot, opts.errors, L);
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
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    <div style="display:flex;gap:10px;align-items:center">
      ${toggles(L)}
      <form method="post" action="/${p}/logout" style="margin:0"><button class="btn btn-ghost btn-sm">${t('nav.logout')}</button></form>
    </div>
  </div>
  <h1>${editing ? t('dd.editTitle') : t('dd.title')}</h1>
  <p class="sub">${editing ? t('dd.editSub') : t('dd.sub', { name: esc(account.name || '') })}</p>
  ${editing ? '' : `<div class="banner banner-warn" style="display:flex;gap:10px;align-items:flex-start"><span>🪪</span><span>${t('dd.notice')}</span></div>`}
  ${errorBanner}
  <form class="card" method="post" action="/${p}/data-diri?lang=${L}">
    <div class="field">
      <label for="phone">${t('dd.phone')}${req}</label>
      <input type="tel" id="phone" name="phone" required maxlength="20" placeholder="08xxxxxxxxxx" value="${esc(v.phone || '')}">
      <div class="hint" style="margin-top:6px">${t('dd.phoneHint')}</div>
    </div>
    <div class="field">
      <label for="city">${t('dd.city')}${req}</label>
      <input type="text" id="city" name="city" required maxlength="80" placeholder="${esc(t('dd.cityPh'))}" value="${esc(v.city || '')}">
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
      <label for="instagram">${t('dd.instagram')}${igRequired ? req : opt}</label>
      <input type="text" id="instagram" name="instagram" maxlength="60" ${igRequired ? 'required' : ''} placeholder="username" value="${esc(v.instagram || '')}">
      <div class="hint" style="margin-top:6px">${t('dd.instagramHint')}</div>
    </div>
    <div class="field">
      <label for="instagram_followers">${t('dd.followers')}${opt}</label>
      <input type="number" id="instagram_followers" name="instagram_followers" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(v.instagram_followers || '')}">
    </div>
    <div class="field">
      <label for="experience">${t('dd.experience')}${opt}</label>
      <textarea id="experience" name="experience" rows="3" maxlength="1000" placeholder="${esc(t('dd.experiencePh'))}">${esc(v.experience || '')}</textarea>
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
  </div>
  <p style="text-align:center;margin-top:18px;font-size:14px"><a href="${otherHref}" style="color:var(--muted)">${esc(otherText)}</a></p>
</div>`;
  return layout({ title: title + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
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
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px">
    <a href="/?lang=${L}" class="btn btn-ghost btn-sm">${t('common.back')}</a>
    <div style="display:flex;gap:10px;align-items:center">
      ${toggles(L)}
      <form method="post" action="/kol/logout" style="margin:0"><button class="btn btn-ghost btn-sm">${t('nav.logout')}</button></form>
    </div>
  </div>
  <h1>${t('kol.title')}</h1>
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
  return layout({ title: t('kol.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

// ------------------------------------------------------------ Main Power ----

// The four on-ground jobdesks a Main Power talent can apply for.
const MP_JOBDESKS = ['Judges', 'Marshal', 'Drop Bag', 'Registrasi'];

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
 * Main Power dashboard: "Event Baru Untukmu" (events opening MP slots the talent
 * hasn't applied to) + "Aplikasi Saya" (their applications with live status).
 */
function mainPowerDashboard({ talent, openEvents, myApps, lang, applied }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  const openCards = (openEvents && openEvents.length) ? openEvents.map((e) => {
    const full = e.slotsLeft <= 0;
    const slot = full
      ? `<span class="dl-when dl-late">${t('mp.slotFull')}</span>`
      : `<span class="dl-when" style="background:var(--ok-soft);color:var(--ok)">${t('mp.slotLeft', { n: e.slotsLeft })}</span>`;
    const dateLine = e.starts_at ? `<div class="muted" style="font-size:12.5px;margin-top:3px">${fmtDay(e.starts_at)}${e.ends_at ? ' – ' + fmtDay(e.ends_at) : ''}</div>` : '';
    return `<div class="dl-item" style="align-items:flex-start">
      <div style="min-width:0"><b>${esc(e.name)}</b>${dateLine}<div style="margin-top:8px">${slot}</div></div>
      ${full ? '' : `<a href="/main-power/apply/${esc(e.id)}?lang=${L}" class="btn btn-sm" style="flex-shrink:0">${t('mp.viewSow')}</a>`}
    </div>`;
  }).join('') : `<p class="muted" style="margin-top:12px">${t('mp.noOpenEvents')}</p>`;

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
    <div style="display:flex;gap:10px;align-items:center">
      ${toggles(L)}
      <form method="post" action="/main-power/logout" style="margin:0"><button class="btn btn-ghost btn-sm">${t('nav.logout')}</button></form>
    </div>
  </div>
  <h1>${t('mp.dash.title')}</h1>
  <p class="sub">${t('mp.dash.greeting', { name: esc((talent && talent.name) || '') })}</p>
  ${applied ? `<div class="banner banner-ok">${t('mp.applied')}</div>` : ''}
  <div class="banner banner-warn" style="display:flex;gap:10px;align-items:flex-start"><span>🪪</span><span>${t('mp.dash.verifyNote')}</span></div>

  <div class="section-head"><h2 style="margin:0">${t('mp.newEvents')}</h2></div>
  <p class="muted" style="font-size:13px;margin:6px 0 0">${t('mp.newEventsSub')}</p>
  <div class="dl-list">${openCards}</div>

  <div class="section-head"><h2 style="margin:0">${t('mp.myApps')}</h2></div>
  <div class="dl-list">${appCards}</div>
</div>`;
  return layout({ title: t('mp.dash.title') + ' — 20FIT', body, home: '/?lang=' + L, lang: L });
}

/**
 * Main Power apply page: a 2-step form (SOW + jobdesk + agree, then the four
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
    ${toggles(L)}
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

/** Confirmation after a Main Power application is submitted. */
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
    <td data-label="${t('th.event')}"><b>${esc(e.name)}</b></td>
    <td data-label="${t('th.schedule')}" class="muted" style="font-size:13px;white-space:nowrap">${e.starts_at || e.ends_at ? `${e.starts_at ? fmtDay(e.starts_at) : '…'} – ${e.ends_at ? fmtDay(e.ends_at) : '…'}` : '—'}</td>
    <td data-label="${t('th.needs')}">${(e.needs || []).map((n) => `${talentLabel(L, n.talent_type)}${n.headcount > 1 ? ' ×' + n.headcount : ''}`).join(', ') || '<span class="muted">—</span>'}</td>
    <td data-label="${t('th.status')}"><span class="pill ${e.is_active ? 'pill-ok' : 'pill-off'}">${e.is_active ? t('ev.active') : t('ev.inactive')}</span></td>
    <td style="text-align:right;white-space:nowrap"><a href="/admin/events/${esc(e.id)}/edit?lang=${L}" class="btn btn-ghost btn-sm" title="${t('title.edit')}">✎ ${t('btn.edit')}</a> <form class="inline-form" method="post" action="/admin/events/${esc(e.id)}/toggle"><button class="btn btn-ghost btn-sm">${e.is_active ? t('btn.deactivate') : t('btn.activate')}</button></form> <form class="inline-form" method="post" action="/admin/events/${esc(e.id)}/delete" ${jsConfirm(t('confirm.deleteEvent'))}><button class="btn btn-ghost btn-sm" title="${t('title.delete')}">🗑</button></form></td>
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
    <form method="post" action="/admin/events" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:18px">
      <input type="text" name="name" placeholder="${t('ph.eventName')}" required maxlength="140" style="flex:2;min-width:180px">
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.startDate')}<input type="date" name="starts_at" style="min-width:150px"></label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.endDate')}<input type="date" name="ends_at" style="min-width:150px"></label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_kol" checked> ${talentLabel(L, 'kol')}</label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_main_power"> ${talentLabel(L, 'main_power')}</label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)">${t('manage.mpQuota')}<input type="number" name="mp_headcount" min="1" value="1" style="width:90px"></label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" name="need_fotografer"> ${talentLabel(L, 'fotografer')}</label>
      <textarea name="mp_sow" rows="2" maxlength="2000" placeholder="${t('manage.mpSow')}" style="flex-basis:100%;width:100%"></textarea>
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
      <tbody>${eos.length ? eos.map((e) => `<tr><td data-label="${t('th.name')}"><b>${esc(e.name)}</b></td><td data-label="${t('common.email')}">${esc(e.login)}</td><td data-label="${t('th.created')}" class="muted">${fmtDate(e.created_at)}</td><td style="text-align:right"><form class="inline-form" method="post" action="/admin/eos/${esc(e.id)}/delete" ${jsConfirm(t('confirm.deleteEo'))}><button class="btn btn-ghost btn-sm" title="${t('title.delete')}">🗑</button></form></td></tr>`).join('') : `<tr><td colspan="4" class="muted">${t('manage.emptyEos')}</td></tr>`}</tbody>
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

/**
 * Super Admin: edit an existing event — schedule, which talent types it needs
 * (KOL / Main Power / Fotografer) with per-type quotas, and the Main Power SOW.
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
  <form method="post" action="/admin/events/${esc(ev.id)}/edit" class="card" style="margin-top:16px">
    <div class="field">
      <label for="name">${t('ph.eventName')}</label>
      <input type="text" id="name" name="name" required maxlength="140" value="${esc(ev.name || '')}">
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
    <div class="field" style="margin-top:18px">
      <label for="mp_sow">${t('manage.mpSow')}</label>
      <textarea id="mp_sow" name="mp_sow" rows="3" maxlength="2000">${esc(ev.mp_sow || '')}</textarea>
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
 * Super Admin review of Main Power applications: applicant + jobdesk + answers,
 * with approve (optionally assigning a station) / reject actions. Approved
 * applications keep a small form to set or update their station later.
 */
function adminApplications({ staff, applications, lang }) {
  const L = normLang(lang);
  const t = (k, v) => tr(L, k, v);
  applications = applications || [];
  const QKEYS = ['q1', 'q2', 'q3', 'q4'];

  const cards = applications.map((a) => {
    const ans = a.answers || {};
    const answerRows = QKEYS.map((q) => {
      const raw = ans[q];
      if (raw === undefined || raw === null || raw === '') return '';
      const val = q === 'q3' ? esc(String(raw)) : esc(mpAnswerLabel(String(raw), L));
      return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:12.5px;color:var(--muted)">${t('mp.apply.' + q)}</div>
        <div style="font-size:14px;margin-top:2px">${val}</div></div>`;
    }).join('');

    const stationForm = `<form method="post" action="/admin/applications/${esc(a.id)}/review" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:14px">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:130px">${t('mpr.stationName')}<input type="text" name="station" maxlength="120" value="${esc(a.station || '')}"></label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:130px">${t('mpr.stationLoc')}<input type="text" name="station_loc" maxlength="120" value="${esc(a.station_loc || '')}"></label>
        <input type="hidden" name="note" value="${esc(a.note || '')}">
        <button class="btn btn-sm" name="action" value="approve">${a.status === 'approved' ? t('mpr.updateStation') : t('mpr.approve')}</button>
        ${a.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" name="action" value="reject" ${jsConfirm(t('confirm.rejectApp'))}>${t('mpr.reject')}</button>` : ''}
      </form>`;

    const stationLine = (a.status === 'approved')
      ? `<div style="margin-top:8px;font-size:13px">📍 <b>${a.station ? esc(a.station) + (a.station_loc ? ' · ' + esc(a.station_loc) : '') : `<span class="muted" style="font-weight:400">${t('mpr.noStation')}</span>`}</b></div>` : '';

    return `<div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0">
          <b style="font-size:16px">${esc(a.talent_name || '—')}</b>
          <div class="muted" style="font-size:12.5px;margin-top:2px">${a.talent_login ? esc(a.talent_login) + ' · ' : ''}${t('mpr.appliedOn', { date: fmtDate(a.created_at) })}</div>
          <div style="margin-top:6px;font-size:14px">${esc(a.event_name || '—')} <span class="muted">·</span> <span class="tag">${esc(a.role || '—')}</span></div>
        </div>
        ${mpStatusBadge(a.status, L)}
      </div>
      ${stationLine}
      <div style="margin-top:12px">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('adm.profile.title')}</div>
        <div style="margin-top:8px">${talentProfileBlock(a.profile, L)}</div>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${t('mpr.answersTitle')}</div>
        ${answerRows || `<div class="muted" style="font-size:13px;margin-top:6px">—</div>`}
      </div>
      ${stationForm}
    </div>`;
  }).join('');

  const body = `<div class="wrap">
  ${staffHead(staff, t('mpr.title'), L)}
  <p class="sub">${t('mpr.sub')}</p>
  <p class="muted" style="font-size:13px;margin-top:6px">${t('mpr.count', { n: applications.length })}</p>
  ${applications.length ? cards : `<div class="card" style="margin-top:14px"><p class="muted" style="margin:0">${t('mpr.empty')}</p></div>`}
</div>`;
  return appLayout({ title: t('mpr.title') + ' — 20FIT', body, role: (staff && staff.role) || 'super_admin', active: 'applications', user: staff && staff.name, lang: L });
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

module.exports = {
  esc, fmtDate, landingPage, talentPicker, kolForm, kolSuccess, kolProofPage,
  publicSubmitPage, publicSubmitSuccess,
  mainPowerDashboard, mainPowerApply, mainPowerApplyDone, MP_JOBDESKS,
  adminDashboard, adminKolDetail, adminAnalysis, adminOverview, adminProofs, adminManage, adminEventEdit, adminApplications, performancePage,
  talentLogin, talentRegister, talentDataDiri, forgotPassword, forgotPasswordSent, resetPassword, resetPasswordDone,
  staffLogin, configError, adminNoService, page500,
};
