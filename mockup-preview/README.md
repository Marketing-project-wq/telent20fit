# Mockup Preview — Seleksi Pelamar Dua Lapis

**Folder ini BUKAN kode aplikasi.** Isinya hanya gambaran tampilan (mockup statis)
untuk fitur seleksi pelamar dua lapis di halaman *Man Power Applications*
(`/admin/applications`) talent.20fit.id.

- `seleksi-dua-lapis-preview.html` — buka langsung di browser (double‑click).
  Tidak menyimpan data, tidak memanggil server, tidak mengirim email.

Menampilkan: (1) permintaan nama reviewer, (2) bar reviewer aktif + penyaring
status usulan, (3) kartu pelamar dengan tombol usulan + daftar pengusul,
(4) kartu "ditinjau tapi tidak diusulkan", (5) tombol Rapat Keputusan di baris
event, (6) tampilan Rapat Keputusan per posisi, (7) langkah konfirmasi sebelum
keputusan final.

Implementasi sebenarnya ada di `views.js` (`adminApplications`, `decisionMeeting`,
`finalAcceptConfirm`), `server.js`, `store.js`, `mailer.js`, dan `i18n/`.
