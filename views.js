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
.linklist a{display:block;font-size:13px;word-break:break-all;margin-bottom:2px}
.inline-form{display:inline}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:36px 0 0}
@media(max-width:560px){.topbar nav a{padding:7px 9px;font-size:13px}}
`;

function layout({ title, body, admin }) {
  const nav = admin
    ? `<a href="/admin"${admin === 'admin' ? ' class="active"' : ''}>Admin</a>
       <a href="/performance"${admin === 'perf' ? ' class="active"' : ''}>Performance</a>`
    : '';
  return `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
<div class="topbar"><div class="in">
  <a href="${admin ? '/admin' : '/kol'}" class="logo">20FIT<b> KOL</b></a>
  <nav>${nav}</nav>
</div></div>
${body}
</body></html>`;
}

/** Public KOL submission form. `opts.errors` and `opts.values` re-render on validation failure. */
function kolForm(campaigns, opts = {}) {
  const errors = opts.errors || [];
  const v = opts.values || {};
  const options = (campaigns || [])
    .map((c) => `<option value="${esc(c.id)}"${v.campaign_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  const noCampaigns = !campaigns || campaigns.length === 0;
  const errorBanner = errors.length
    ? `<div class="banner banner-err"><b>Periksa lagi:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
    : '';
  const prefLinks = (v.links && v.links.length ? v.links : ['']);

  const body = `<div class="wrap narrow">
  <h1>Submit Hasil KOL</h1>
  <p class="sub">Isi form di bawah untuk mengirim hasil campaign kamu ke tim 20FIT.</p>
  ${errorBanner}
  ${noCampaigns ? '<div class="banner banner-warn">Belum ada campaign aktif. Hubungi admin untuk membuka campaign.</div>' : ''}
  <form class="card" method="post" action="/kol/submit" enctype="multipart/form-data" id="kolForm">
    <div class="field">
      <label for="kol_name">Nama KOL</label>
      <input type="text" id="kol_name" name="kol_name" required maxlength="120" placeholder="Nama lengkap / nama akun" value="${esc(v.kol_name || '')}">
    </div>

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
  return layout({ title: 'Submit Hasil KOL — 20FIT', body });
}

function kolSuccess(name, campaign) {
  const body = `<div class="wrap narrow">
  <div class="card success">
    <div class="check">✓</div>
    <h1>Submission Terkirim!</h1>
    <p class="sub" style="margin:10px 0 24px">Terima kasih, <b>${esc(name)}</b>. Hasil kamu untuk campaign
      <b>${esc(campaign)}</b> sudah masuk dan menunggu review tim 20FIT.</p>
    <a href="/kol" class="btn btn-ghost">Kirim submission lagi</a>
  </div>
</div>`;
  return layout({ title: 'Terkirim — 20FIT KOL', body });
}

function adminPage({ totalSubs, uniqueKol, camps, recent }) {
  const campRows = camps.map((c) => `<tr>
    <td><b>${esc(c.name)}</b></td>
    <td>${c.count}</td>
    <td><span class="pill ${c.is_active ? 'pill-ok' : 'pill-off'}">${c.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td style="text-align:right">
      <form class="inline-form" method="post" action="/admin/campaigns/${esc(c.id)}/toggle">
        <button class="btn btn-ghost btn-sm">${c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </form>
    </td></tr>`).join('');

  const recentRows = recent.length ? recent.map((s) => `<tr>
    <td><b>${esc(s.kol_name)}</b><div class="muted" style="font-size:12px">${fmtDate(s.created_at)}</div></td>
    <td>${esc(s.campaign_name || '—')}</td>
    <td><div class="thumbs">${(s.images || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`).join('') || '<span class="muted">—</span>'}</div></td>
    <td class="linklist">${(s.links || []).map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('') || '<span class="muted">—</span>'}</td>
  </tr>`).join('') : `<tr><td colspan="4" class="muted" style="padding:22px;text-align:center">Belum ada submission.</td></tr>`;

  const body = `<div class="wrap">
  <h1>Dashboard Admin</h1>
  <p class="sub">Ringkasan submission KOL dan pengelolaan campaign.</p>

  <div class="stat-grid">
    <div class="stat"><div class="n">${totalSubs}</div><div class="l">Total submission</div></div>
    <div class="stat"><div class="n">${uniqueKol}</div><div class="l">KOL unik</div></div>
    <div class="stat"><div class="n">${camps.filter((c) => c.is_active).length}</div><div class="l">Campaign aktif</div></div>
  </div>

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
  </div>

  <div class="section-head"><h2 style="margin:0">Submission Terbaru</h2><a href="/performance" class="btn btn-ghost btn-sm">Lihat Leaderboard →</a></div>
  <div class="card" style="margin-top:14px">
    <div class="table-wrap"><table>
      <thead><tr><th>KOL</th><th>Campaign</th><th>Gambar</th><th>Link postingan</th></tr></thead>
      <tbody>${recentRows}</tbody>
    </table></div>
  </div>
</div>`;
  return layout({ title: 'Admin — 20FIT KOL', body, admin: 'admin' });
}

function performancePage(board, totalSubs) {
  const rows = board.length ? board.map((e, i) => `<tr>
    <td class="rank rank-${i + 1}">${i + 1}</td>
    <td><b>${esc(e.kol_name)}</b></td>
    <td>${e.submissions}</td>
    <td>${e.posts}</td>
    <td>${e.images}</td>
    <td class="muted">${fmtDate(e.last)}</td>
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
  esc, fmtDate, kolForm, kolSuccess, adminPage, performancePage,
  configError, adminNoService, page500,
};
