// Vercel Serverless Function: perantara aman ke Google Gemini untuk tab "Asisten Data" di aplikasi.
// API key TIDAK ada di file HTML — disimpan di Vercel: Settings -> Environment Variables -> GEMINI_API_KEY.
// Opsional: GEMINI_MODEL (mis. "gemini-3.8-flash"); kalau model itu tidak tersedia, dicoba model cadangan.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-latest'];

module.exports = async (req, res) => {
  // Hanya boleh dipanggil dari aplikasi sendiri (domain yang sama).
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  if (origin && host && !origin.endsWith('//' + host)) { res.status(403).json({ error: 'Akses ditolak' }); return; }
  if (req.method === 'GET') { res.status(200).json({ ok: true, configured: !!process.env.GEMINI_API_KEY }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method tidak didukung' }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: 'GEMINI_API_KEY belum dipasang di Vercel (Settings → Environment Variables).' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !Array.isArray(body.contents)) { res.status(400).json({ error: 'Format permintaan salah' }); return; }
  // Batas ukuran sederhana supaya tidak disalahgunakan
  const size = JSON.stringify(body).length;
  if (size > 400000) { res.status(413).json({ error: 'Permintaan terlalu besar' }); return; }
  const payload = {
    contents: body.contents,
    systemInstruction: body.systemInstruction,
    tools: body.tools,
    generationConfig: Object.assign({ temperature: 0.3, maxOutputTokens: 2048 }, body.generationConfig || {}),
  };
  const models = [process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = null;
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { res.status(200).json(Object.assign({ model }, data)); return; }
      lastErr = { status: r.status, model, error: (data && data.error && data.error.message) || ('HTTP ' + r.status) };
      if (r.status === 404 || r.status === 400 && /model/i.test(lastErr.error)) continue; // model tidak ada -> coba cadangan
      res.status(r.status).json(lastErr); return; // 429 batas habis, 401/403 key salah, dll.
    } catch (e) { lastErr = { status: 502, model, error: String(e && e.message || e) }; }
  }
  res.status((lastErr && lastErr.status) || 502).json(lastErr || { error: 'Gagal menghubungi Gemini' });
};
