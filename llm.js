'use strict';

/**
 * Extract social-media engagement stats from a screenshot using a multimodal
 * LLM (google/gemini-2.5-flash-lite) via OpenRouter. The model reads the image
 * directly — no separate OCR engine needed — and also returns the raw visible
 * text for audit. A JS safety-net normalizes abbreviated numbers.
 */

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';
// OpenRouter key. OPENROUTER_API_KEY is the canonical name; the fallbacks
// match variable names already configured in the deployment for this feature.
const API_KEY = process.env.OPENROUTER_API_KEY
  || process.env.API_KEY_VIEW_LIKE_KOMEN
  || process.env.API_KEY_OCR;
const BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

function configured() { return !!API_KEY || process.env.LLM_MOCK === '1'; }

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
  "raw_text": string
}
Field meanings (match Indonesian & English labels):
- "likes": suka / likes / disukai.
- "comments": komentar / comments.
- "saves": disimpan / simpan / saves / bookmarks (the bookmark/ribbon metric).
- "shares": dibagikan / bagikan / kirim / shares / sends.
- "views": content views / dilihat / ditonton / tayangan / plays / impressions / reach — whichever is shown for how many times the content was seen.
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
      extracted: { platform: 'instagram', likes: 1200, comments: 45, saves: 89, shares: 30, views: 15000 },
      ocr_text: '1.2K suka · 45 komentar · 89 disimpan · 30 dibagikan · 15K dilihat (mock)',
    };
  }
  if (!API_KEY) { const e = new Error('OPENROUTER_API_KEY belum di-set'); e.code = 'NO_KEY'; throw e; }

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + API_KEY,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://telent.20fit.id',
      'X-Title': '20FIT Talent',
    },
    body: JSON.stringify({
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
    }),
  });

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

module.exports = { configured, extractFromImage, normalizeCount, normalizeExtracted, MODEL };
