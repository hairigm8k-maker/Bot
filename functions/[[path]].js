// Telegram Bot — Image Enhancement
// Cloudflare Pages Function

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.pathname === '/webhook' && request.method === 'POST') {
    return handleWebhook(request, env);
  }

  if (url.pathname === '/setup') {
    return setupWebhook(request, env);
  }

  if (url.pathname === '/info') {
    return new Response(JSON.stringify({
      bot: 'Telegram Image Bot',
      status: 'running',
      token_set: !!env.TELEGRAM_BOT_TOKEN,
      kv_bound: !!env.BOT_KV,
      ai_bound: !!env.AI
    }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Telegram Image Bot — Running 🤖', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// ============================================
// SETUP WEBHOOK
// ============================================
async function setupWebhook(request, env) {
  const url = new URL(request.url);
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;

  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        drop_pending_updates: true
      })
    }
  );

  const data = await res.json();

  return new Response(JSON.stringify({
    webhook_url: webhookUrl,
    telegram_response: data
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

// ============================================
// WEBHOOK HANDLER
// ============================================
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
    if (message.text) {
      const text = message.text.trim();

      if (text === '/start') {
        await sendMessage(env, chatId,
          'Salam! 👋 Aku boleh enhance gambar anda.\n\n' +
          '📸 Cara guna:\n' +
          '1. Hantar gambar yang nak enhance (Gambar 1)\n' +
          '2. Hantar gambar rujukan kualiti tinggi (Gambar 2)\n' +
          '3. AI akan apply kualiti Gambar 2 ke Gambar 1\n' +
          '4. Terima hasil dalam 10-30 saat\n\n' +
          '📋 Commands:\n' +
          '/start - Mula\n' +
          '/reset - Reset & mula baru\n' +
          '/help - Bantuan'
        );
        await clearState(env, userId);
        return new Response('OK');
      }

      if (text === '/help') {
        await sendMessage(env, chatId,
          '🤖 Bot Enhancement Gambar\n\n' +
          'Bot ni guna AI untuk improve kualiti gambar.\n\n' +
          'Cara guna:\n' +
          '1. Hantar Gambar 1 (nak enhance)\n' +
          '2. Hantar Gambar 2 (rujukan kualiti tinggi)\n' +
          '3. AI process\n' +
          '4. Terima hasil\n\n' +
          'Tips:\n' +
          '• Guna gambar clear untuk rujukan\n' +
          '• Result bergantung pada AI'
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

    // ===== PHOTOS =====
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
          '⏱️ Ini ambil masa 10-30 saat. Sila tunggu.'
        );

        const resultBase64 = await enhanceImage(env, state.image1, image2Base64);

        if (resultBase64) {
          await sendPhotoBase64(env, chatId, resultBase64);
          await sendMessage(env, chatId,
            '✅ Siap! 🎉\n\n' +
            'Hantar /reset untuk process gambar baru.'
          );
        } else {
          await sendMessage(env, chatId,
            '❌ Maaf, gagal generate.\n\n' +
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

// ============================================
// TELEGRAM API
// ============================================
async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
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

// ============================================
// STATE MANAGEMENT (KV)
// ============================================
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

// ============================================
// AI — IMAGE ENHANCEMENT
// ============================================
async function enhanceImage(env, subjectBase64, referenceBase64) {
  try {
    const subjectBytes = base64ToBytes(subjectBase64);
    const referenceBytes = base64ToBytes(referenceBase64);

    console.log('Calling FLUX.2 [klein] 9B with 2 images...');

    const response = await env.AI.run(
      '@cf/black-forest-labs/flux-2-klein-9b',
      {
        prompt: 'Take the exact subject, composition, and content from image 0. Apply the quality level, sharpness, detail, clarity, lighting, and visual fidelity from image 1. Keep the subject of image 0 identical but render it with the professional quality and crisp detail of image 1.',
        input_images: [Array.from(subjectBytes), Array.from(referenceBytes)],
        width: 1024,
        height: 1024,
        num_steps: 28
      }
    );

    console.log('AI response keys:', Object.keys(response || {}));

    if (response && response.image) {
      return response.image;
    }

    if (response && typeof response === 'string') {
      return response;
    }

    console.error('Unexpected AI response:', JSON.stringify(response).slice(0, 300));
    return null;
  } catch (error) {
    console.error('AI generation error:', error.message);
    return null;
  }
}

// ============================================
// UTILS
// ============================================
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
