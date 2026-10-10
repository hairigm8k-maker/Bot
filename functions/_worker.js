// ═══════════════════════════════════════════
// Telegram Image Enhancement Bot
// Cloudflare Pages Advanced Mode Worker
// ═══════════════════════════════════════════

let lastAIError = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route: /api/test-models
    if (path === '/api/test-models') {
      return await handleTestModels(env);
    }

    // Route: /info
    if (path === '/info') {
      return json({
        bot: 'Telegram Image Bot',
        status: 'running',
        token_set: !!env.TELEGRAM_BOT_TOKEN,
        kv_bound: !!env.BOT_KV,
        ai_bound: !!env.AI
      });
    }

    // Route: /setup
    if (path === '/setup') {
      return await handleSetup(url, env);
    }

    // Route: /webhook
    if (path === '/webhook' && request.method === 'POST') {
      return await handleWebhook(request, env);
    }

    // Default
    return new Response('Telegram Image Bot — Running 🤖', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ═══════════════════════════════════════════
// TEST MODELS
// ═══════════════════════════════════════════
async function handleTestModels(env) {
  const models = [
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    '@cf/bytedance/stable-diffusion-xl-lightning',
    '@cf/lykon/dreamshaper-8-lcm',
    '@cf/runwayml/stable-diffusion-v1-5-img2img'
  ];

  const results = [];
  for (const model of models) {
    const start = Date.now();
    try {
      const r = await env.AI.run(model, { prompt: 'red apple', num_steps: 4 });
      results.push({
        model,
        ok: true,
        ms: Date.now() - start,
        keys: r ? Object.keys(r) : [],
        hasImage: !!(r && r.image)
      });
    } catch (e) {
      results.push({
        model,
        ok: false,
        ms: Date.now() - start,
        error: e.message
      });
    }
  }

  return json({
    total: models.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results
  });
}

// ═══════════════════════════════════════════
// SETUP WEBHOOK
// ═══════════════════════════════════════════
async function handleSetup(url, env) {
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;

  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true })
    }
  );

  const data = await res.json();
  return json({ webhook_url: webhookUrl, telegram_response: data });
}

// ═══════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════
async function handleWebhook(request, env) {
  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('OK');
  }

  const message = update.message || update.edited_message;
  if (!message) return new Response('OK');

  const chatId = message.chat.id;
  const userId = message.from.id;

  try {
    // COMMANDS
    if (message.text) {
      const text = message.text.trim();

      if (text === '/start') {
        await sendMessage(env, chatId,
          'Salam! 👋 Aku boleh enhance gambar anda.\n\n' +
          '📸 Cara guna:\n' +
          '1. Hantar gambar yang nak enhance (Gambar 1)\n' +
          '2. Hantar gambar rujukan kualiti tinggi (Gambar 2)\n' +
          '3. AI apply kualiti Gambar 2 ke Gambar 1\n' +
          '4. Terima hasil dalam 10-30 saat\n\n' +
          '📋 Commands: /start /reset /help'
        );
        await clearState(env, userId);
        return new Response('OK');
      }

      if (text === '/help') {
        await sendMessage(env, chatId,
          '🤖 Bot Enhancement Gambar\n\n' +
          '1. Hantar Gambar 1 (nak enhance)\n' +
          '2. Hantar Gambar 2 (rujukan kualiti tinggi)\n' +
          '3. AI process\n' +
          '4. Terima hasil'
        );
        return new Response('OK');
      }

      if (text === '/reset') {
        await clearState(env, userId);
        await sendMessage(env, chatId, '✅ Reset selesai. Hantar Gambar 1 untuk mula.');
        return new Response('OK');
      }

      await sendMessage(env, chatId, '📸 Hantar gambar ya, bukan text.');
      return new Response('OK');
    }

    // PHOTOS
    if (message.photo && message.photo.length > 0) {
      const state = await getState(env, userId);
      const largestPhoto = message.photo[message.photo.length - 1];
      const fileId = largestPhoto.file_id;

      // Step 1: Terima Gambar 1
      if (!state || state.step === 'waiting_image1') {
        await sendMessage(env, chatId, '⏳ Downloading Gambar 1...');

        const image1Base64 = await downloadImageAsBase64(env, fileId);
        if (!image1Base64) {
          await sendMessage(env, chatId, '❌ Gagal download gambar. Cuba lagi.');
          return new Response('OK');
        }

        await setState(env, userId, {
          step: 'waiting_image2',
          image1: image1Base64
        });

        await sendMessage(env, chatId,
          '✅ Gambar 1 diterima!\n\n' +
          'Sekarang hantar Gambar 2 (gambar rujukan kualiti tinggi).'
        );
        return new Response('OK');
      }

      // Step 2: Terima Gambar 2 & Process
      if (state.step === 'waiting_image2') {
        await sendMessage(env, chatId, '⏳ Downloading Gambar 2...');

        const image2Base64 = await downloadImageAsBase64(env, fileId);
        if (!image2Base64) {
          await sendMessage(env, chatId, '❌ Gagal download gambar. Cuba lagi.');
          return new Response('OK');
        }

        await sendMessage(env, chatId,
          '🎨 AI sedang process...\n\n' +
          '⏱️ Ambil masa 10-30 saat. Sila tunggu.'
        );

        const resultBase64 = await enhanceImage(env, state.image1, image2Base64);

        if (resultBase64) {
          await sendPhotoBase64(env, chatId, resultBase64);
          await sendMessage(env, chatId,
            '✅ Siap! 🎉\n\nHantar /reset untuk process gambar baru.'
          );
        } else {
          await sendMessage(env, chatId,
            '❌ Maaf, gagal generate.\n\n' +
            'Error: ' + String(lastAIError || 'unknown').slice(0, 300) + '\n\n' +
            'Cuba /reset dan hantar semula.'
          );
        }

        await clearState(env, userId);
        return new Response('OK');
      }
    }

    if (message.document) {
      await sendMessage(env, chatId, '📸 Hantar sebagai photo ya, bukan file.');
      return new Response('OK');
    }

  } catch (error) {
    console.error('Bot error:', error);
    await sendMessage(env, chatId, '❌ Error: ' + error.message);
  }

  return new Response('OK');
}

// ═══════════════════════════════════════════
// TELEGRAM API
// ═══════════════════════════════════════════
async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function sendPhotoBase64(env, chatId, base64) {
  const bytes = base64ToBytes(base64);
  const blob = new Blob([bytes], { type: 'image/png' });

  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('photo', blob, 'enhanced.png');

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData
  });
}

async function downloadImageAsBase64(env, fileId) {
  try {
    const fileInfoRes = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoRes.json();

    if (!fileInfo.ok) {
      console.error('getFile error:', fileInfo);
      return null;
    }

    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    const imageRes = await fetch(fileUrl);
    const arrayBuffer = await imageRes.arrayBuffer();

    return arrayBufferToBase64(arrayBuffer);
  } catch (error) {
    console.error('Download error:', error);
    return null;
  }
}

// ═══════════════════════════════════════════
// STATE (KV)
// ═══════════════════════════════════════════
async function getState(env, userId) {
  try {
    const state = await env.BOT_KV.get(`user:${userId}`);
    return state ? JSON.parse(state) : null;
  } catch {
    return null;
  }
}

async function setState(env, userId, state) {
  await env.BOT_KV.put(`user:${userId}`, JSON.stringify(state), {
    expirationTtl: 3600
  });
}

async function clearState(env, userId) {
  await env.BOT_KV.delete(`user:${userId}`);
}

// ═══════════════════════════════════════════
// AI — IMAGE ENHANCEMENT
// ═══════════════════════════════════════════
async function enhanceImage(env, subjectBase64, referenceBase64) {
  lastAIError = null;

  try {
    const subjectBytes = base64ToBytes(subjectBase64);
    const referenceBytes = base64ToBytes(referenceBase64);

    console.log('AI call — subject:', subjectBytes.length, 'ref:', referenceBytes.length);

    const response = await env.AI.run(
      '@cf/black-forest-labs/flux-2-klein-9b',
      {
        prompt: 'Take the exact subject and composition from image 0. Apply the quality, sharpness, detail, clarity, lighting, and visual fidelity from image 1. Keep the subject identical but render with professional quality.',
        input_images: [Array.from(subjectBytes), Array.from(referenceBytes)],
        width: 1024,
        height: 1024,
        num_steps: 28
      }
    );

    console.log('AI response type:', typeof response);
    console.log('AI response keys:', response ? Object.keys(response) : 'null');

    if (response && response.image) {
      return response.image;
    }

    if (response && typeof response === 'string') {
      return response;
    }

    lastAIError = 'RESPONSE: ' + JSON.stringify(response).slice(0, 250);
    return null;

  } catch (error) {
    lastAIError = 'CATCH: ' + error.message;
    console.error('AI error:', error.message);
    return null;
  }
}

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
