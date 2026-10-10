// ═══════════════════════════════════════
// Telegram Image Bot — All Routes
// ═══════════════════════════════════════

let lastAIError = null;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // GET /info
  if (path === '/info') {
    return json({
      status: 'ok',
      token_set: !!env.TELEGRAM_BOT_TOKEN,
      kv_bound: !!env.BOT_KV,
      ai_bound: !!env.AI
    });
  }

  // GET /api/test-models
  if (path === '/api/test-models') {
    return await testModels(env);
  }

  // GET /setup
  if (path === '/setup') {
    return await setupWebhook(url, env);
  }

  // POST /webhook
  if (path === '/webhook' && request.method === 'POST') {
    return await handleWebhook(request, env);
  }

  // Default
  return new Response('Telegram Image Bot — Running 🤖', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function json(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function testModels(env) {
  const models = [
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    '@cf/bytedance/stable-diffusion-xl-lightning',
    '@cf/lykon/dreamshaper-8-lcm'
  ];
  const results = [];
  for (const m of models) {
    const s = Date.now();
    try {
      const r = await env.AI.run(m, { prompt: 'red apple', num_steps: 4 });
      results.push({ model: m, ok: true, ms: Date.now() - s, hasImage: !!(r && r.image), keys: r ? Object.keys(r) : [] });
    } catch (e) {
      results.push({ model: m, ok: false, ms: Date.now() - s, error: e.message });
    }
  }
  return json({ results });
}

async function setupWebhook(url, env) {
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true })
  });
  const data = await res.json();
  return json({ webhook_url: webhookUrl, telegram: data });
}

// ═══════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════
async function handleWebhook(request, env) {
  let update;
  try { update = await request.json(); } catch { return new Response('OK'); }
  const msg = update.message || update.edited_message;
  if (!msg) return new Response('OK');

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    if (msg.text) {
      const t = msg.text.trim();
      if (t === '/start') {
        await sendMsg(env, chatId,
          'Salam! 👋 Aku boleh enhance gambar anda.\n\n' +
          '📸 Cara guna:\n' +
          '1. Hantar Gambar 1 (nak enhance)\n' +
          '2. Hantar Gambar 2 (rujukan kualiti tinggi)\n' +
          '3. AI process\n' +
          '4. Terima hasil\n\n' +
          '/reset - Mula baru\n/help - Bantuan'
        );
        await clearState(env, userId);
        return new Response('OK');
      }
      if (t === '/reset') {
        await clearState(env, userId);
        await sendMsg(env, chatId, '✅ Reset selesai. Hantar Gambar 1.');
        return new Response('OK');
      }
      if (t === '/help') {
        await sendMsg(env, chatId, '🤖 Hantar 2 gambar: Gambar 1 (nak enhance) + Gambar 2 (rujukan kualiti).');
        return new Response('OK');
      }
      await sendMsg(env, chatId, '📸 Hantar gambar ya, bukan text.');
      return new Response('OK');
    }

    if (msg.photo && msg.photo.length > 0) {
      const state = await getState(env, userId);
      const fileId = msg.photo[msg.photo.length - 1].file_id;

      if (!state || state.step === 'waiting_image1') {
        await sendMsg(env, chatId, '⏳ Downloading Gambar 1...');
        const img1 = await downloadImg(env, fileId);
        if (!img1) { await sendMsg(env, chatId, '❌ Gagal download.'); return new Response('OK'); }
        await setState(env, userId, { step: 'waiting_image2', image1: img1 });
        await sendMsg(env, chatId, '✅ Gambar 1 OK!\n\nSekarang hantar Gambar 2 (rujukan).');
        return new Response('OK');
      }

      if (state.step === 'waiting_image2') {
        await sendMsg(env, chatId, '⏳ Downloading Gambar 2...');
        const img2 = await downloadImg(env, fileId);
        if (!img2) { await sendMsg(env, chatId, '❌ Gagal download.'); return new Response('OK'); }

        await sendMsg(env, chatId, '🎨 AI processing... (10-30 saat)');

        const result = await enhance(env, state.image1, img2);

        if (result) {
          await sendPhoto(env, chatId, result);
          await sendMsg(env, chatId, '✅ Siap! 🎉\n\n/reset untuk mula baru.');
        } else {
          await sendMsg(env, chatId, '❌ Gagal: ' + String(lastAIError || 'unknown').slice(0, 250));
        }
        await clearState(env, userId);
        return new Response('OK');
      }
    }

    if (msg.document) {
      await sendMsg(env, chatId, '📸 Hantar sebagai photo ya.');
      return new Response('OK');
    }
  } catch (e) {
    console.error('Error:', e);
    await sendMsg(env, chatId, '❌ Error: ' + e.message);
  }
  return new Response('OK');
}

// ═══════════════════════════════════════
// TELEGRAM API
// ═══════════════════════════════════════
async function sendMsg(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function sendPhoto(env, chatId, base64) {
  const bytes = b64ToBytes(base64);
  const blob = new Blob([bytes], { type: 'image/png' });
  const fd = new FormData();
  fd.append('chat_id', chatId.toString());
  fd.append('photo', blob, 'enhanced.png');
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST', body: fd
  });
}

async function downloadImg(env, fileId) {
  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    const info = await infoRes.json();
    if (!info.ok) return null;
    const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`;
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return bufToB64(buf);
  } catch { return null; }
}

// ═══════════════════════════════════════
// KV STATE
// ═══════════════════════════════════════
async function getState(env, userId) {
  try {
    const s = await env.BOT_KV.get(`user:${userId}`);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
async function setState(env, userId, state) {
  await env.BOT_KV.put(`user:${userId}`, JSON.stringify(state), { expirationTtl: 3600 });
}
async function clearState(env, userId) {
  await env.BOT_KV.delete(`user:${userId}`);
}

// ═══════════════════════════════════════
// AI ENHANCE
// ═══════════════════════════════════════
async function enhance(env, subjectB64, refB64) {
  lastAIError = null;
  try {
    const subjBytes = b64ToBytes(subjectB64);
    const refBytes = b64ToBytes(refB64);

    console.log('Sizes:', subjBytes.length, refBytes.length);

    // ⚠️ WAJIB: FormData, bukan JSON
    const form = new FormData();
    form.append('input_image_0', new Blob([subjBytes], { type: 'image/jpeg' }), 'subject.jpg');
    form.append('input_image_1', new Blob([refBytes], { type: 'image/jpeg' }), 'reference.jpg');
    form.append('prompt', [
        'ENHANCE image 0. This is a quality restoration task.',
        'STRICT RULES:',
        '- Keep the EXACT same person, face, pose, clothing, and background as image 0.',
        '- Do NOT swap faces. Do NOT change the identity.',
        '- Do NOT add new objects, people, or scenery.',
        '- Preserve the exact composition and framing.',
        '',
        'ONLY IMPROVE:',
        '- Sharpness and clarity (make it crisp, HD)',
        '- Detail and texture quality',
        '- Lighting balance from image 1',
        '- Color grading inspiration from image 1',
        '- Overall visual fidelity',
        '',
        'Output: The same photo of image 0, but enhanced to professional HD quality.'
      ].join(' '));
    form.append('width', '1024');
    form.append('height', '1024');

    // Serialize FormData supaya dapat multipart boundary
    const formResponse = new Response(form);
    const formStream = formResponse.body;
    const formContentType = formResponse.headers.get('content-type');

    console.log('Calling FLUX.2 klein 9B (multipart)...');

    const r = await env.AI.run('@cf/black-forest-labs/flux-2-klein-9b', {
      multipart: {
        body: formStream,
        contentType: formContentType
      }
    });

    console.log('Response type:', typeof r);
    console.log('Response keys:', r ? Object.keys(r) : 'null');

    // Response format: { image: "base64string" }
    if (r && r.image) return r.image;
    if (typeof r === 'string') return r;

    lastAIError = 'RESPONSE: ' + JSON.stringify(r).slice(0, 250);
    return null;
  } catch (e) {
    lastAIError = 'CATCH: ' + e.message;
    console.error('AI error:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
