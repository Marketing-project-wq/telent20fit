'use strict';

/**
 * Extract social-media engagement stats from a screenshot using a multimodal
 * LLM (google/gemini-2.5-flash-lite) via OpenRouter. The model reads the image
 * directly — no separate OCR engine needed — and also returns the raw visible
 * text for audit. A JS safety-net normalizes abbreviated numbers.
 */

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';
// OpenRouter key(s). OPENROUTER_API_KEY is the canonical name; the others
// match variable names already configured in this deployment. Collect all of
// them (trimmed, in priority order) and try each until one authenticates, so a
// stray/blank value in one variable doesn't block a valid key in another.
const API_KEYS = [
  process.env.OPENROUTER_API_KEY,
  process.env.API_KEY_VIEW_LIKE_KOMEN,
  process.env.API_KEY_OCR,
].map((k) => (k || '').trim()).filter(Boolean);
const BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

function configured() { return API_KEYS.length > 0 || process.env.LLM_MOCK === '1'; }

/** Normalize "1.2K", "15rb", "1,5jt", "15.000", 1200 -> integer, or null. */
function normalizeCount(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null;
  let s = String(v).trim().toLowerCase().replace(/\s+/g, '');
  if (!s || s === '-' || s === 'n/a' || s === 'null') return null;

  let factor = 1;
  const suffixes = [
    [/(rb|ribu|k)$/, 1e3],
    [/(jt|juta|mio|mn|m)$/, 1e6],
    [/(b|miliar|milyar)$/, 1e9],
  ];
  for (const [re, f] of suffixes) { if (re.test(s)) { factor = f; s = s.replace(re, ''); break; } }

  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;

  if (factor > 1) {
    // treat separator as decimal (1.2K -> 1.2, 1,5jt -> 1.5)
    const n = parseFloat(s.replace(/,/g, '.'));
    return isFinite(n) ? Math.round(n * factor) : null;
  }
  // no multiplier -> separators are thousands, strip them
  const n = parseInt(s.replace(/[.,]/g, ''), 10);
  return isFinite(n) ? n : null;
}

function normalizeExtracted(raw) {
  raw = raw || {};
  return {
    platform: raw.platform ? String(raw.platform).toLowerCase().trim() : null,
    likes: normalizeCount(raw.likes),
    comments: normalizeCount(raw.comments),
    saves: normalizeCount(raw.saves),
    shares: normalizeCount(raw.shares),
    views: normalizeCount(raw.views),
    reach: normalizeCount(raw.reach),
    impressions: normalizeCount(raw.impressions),
    link_clicks: normalizeCount(raw.link_clicks),
  };
}

const PROMPT = `You are given a screenshot of a social media post's performance/insights (Instagram, TikTok, YouTube, Facebook, X, etc.).
Extract the engagement numbers. Return ONLY a JSON object with these keys:
{
  "platform": string|null,
  "likes": number|null,
  "comments": number|null,
  "saves": number|null,
  "shares": number|null,
  "views": number|null,
  "reach": number|null,
  "impressions": number|null,
  "link_clicks": number|null,
  "raw_text": string
}
Field meanings (match Indonesian & English labels):
- "likes": suka / likes / disukai.
- "comments": komentar / comments.
- "saves": disimpan / simpan / saves / bookmarks (the bookmark/ribbon metric).
- "shares": dibagikan / bagikan / kirim / shares / sends.
- "views": ditonton / dilihat / tayangan / plays / views — how many times the video/content was played or seen.
- "reach": jangkauan / akun dijangkau / reach / accounts reached — the number of unique accounts.
- "impressions": impresi / impressions — total times the content was displayed.
- "link_clicks": klik tautan / ketukan link / kunjungan / link clicks / link taps / website taps / profile visits from the post.
Rules:
- Convert abbreviated numbers to full integers (Indonesian & English: rb/ribu/K = thousand, jt/juta/M = million).
- If a metric is not visible or unreadable, use null (do not guess). Public posts often show only likes & comments; insights screens show saves/shares/views too.
- "raw_text" is the raw visible text you read (for audit).
- Output valid JSON only. No markdown, no explanation.`;

function parseJsonLoose(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

/** Extract from an image buffer. Returns { model, extracted, ocr_text }. Throws on failure. */
async function extractFromImage(buffer, mimeType) {
  if (process.env.LLM_MOCK === '1') {
    return {
      model: 'mock',
      extracted: { platform: 'instagram', likes: 1200, comments: 45, saves: 89, shares: 30, views: 15000, reach: 12000, impressions: 18000, link_clicks: 230 },
      ocr_text: '1.2K suka · 45 komentar · 89 disimpan · 30 dibagikan · 15K dilihat · 12K jangkauan · 230 klik (mock)',
    };
  }
  if (!API_KEYS.length) { const e = new Error('OPENROUTER_API_KEY belum di-set'); e.code = 'NO_KEY'; throw e; }

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  });

  let authErr = null;
  for (const key of API_KEYS) {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://telent.20fit.id',
        'X-Title': '20FIT Talent',
      },
      body,
    });

    // An auth failure means this particular key/variable is wrong; try the
    // next configured key rather than failing the whole extraction.
    if (res.status === 401 || res.status === 403) {
      authErr = new Error('OpenRouter ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 200));
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('OpenRouter ' + res.status + ': ' + t.slice(0, 300));
    }
    const json = await res.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    let parsed;
    try { parsed = parseJsonLoose(content); } catch (_) {
      throw new Error('LLM tidak mengembalikan JSON valid: ' + String(content).slice(0, 200));
    }
    return {
      model: MODEL,
      extracted: normalizeExtracted(parsed),
      ocr_text: parsed.raw_text || parsed.transcript || null,
    };
  }
  throw authErr || new Error('OpenRouter: semua API key ditolak');
}

/**
 * Generate a short, plain-language performance insight from aggregated campaign
 * data (per content-type and per-KOL). Text-only LLM call. Returns a string.
 */
async function generateInsight(summary, lang) {
  const id = lang !== 'en';
  if (process.env.LLM_MOCK === '1') {
    return id
      ? 'Reels adalah tipe konten yang paling perform — rata-rata engagement-nya paling tinggi, kemungkinan karena video pendek mendapat reach lebih besar di Instagram dan mendorong komentar. Untuk perbandingan KOL, Maira memimpin baik di views maupun engagement, sedangkan thefirstdaughters tertinggal di engagement meski views-nya lumayan — worth dicek format & jam postingnya. Saran: perbanyak porsi Reels untuk campaign berikutnya.'
      : 'Reels is the best-performing content type — it has the highest average engagement, likely because short video gets more reach on Instagram and drives comments. Comparing KOLs, Maira leads on both views and engagement, while thefirstdaughters lags on engagement despite decent views — worth reviewing format and posting time. Suggestion: allocate more Reels for the next campaign.';
  }
  if (!API_KEYS.length) { const e = new Error('OPENROUTER_API_KEY belum di-set'); e.code = 'NO_KEY'; throw e; }
  const langName = id ? 'Indonesian' : 'English';
  const prompt = `You are a social-media performance analyst for an influencer (KOL) campaign. Using ONLY the aggregated data below, write a concise, practical insight in ${langName} (3-5 sentences, plain text, no markdown headings or bullet symbols):
1) which content type (feed / reels / story) performs best and a plausible reason why,
2) a short comparison between the KOLs — who leads, who lags, and on which metric,
3) one actionable suggestion.
Cite the actual numbers where useful. Data (JSON):
${JSON.stringify(summary).slice(0, 4000)}`;
  const body = JSON.stringify({ model: MODEL, temperature: 0.4, messages: [{ role: 'user', content: prompt }] });
  let authErr = null;
  for (const key of API_KEYS) {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://telent.20fit.id', 'X-Title': '20FIT Talent' },
      body,
    });
    if (res.status === 401 || res.status === 403) { authErr = new Error('OpenRouter ' + res.status); continue; }
    if (!res.ok) throw new Error('OpenRouter ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 200));
    const json = await res.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return String(content || '').trim();
  }
  throw authErr || new Error('OpenRouter: semua API key ditolak');
}

module.exports = { configured, extractFromImage, generateInsight, normalizeCount, normalizeExtracted, MODEL };
