// Test all image generation models
export async function onRequestGet({ env }) {
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
      const r = await env.AI.run(model, {
        prompt: 'a simple red apple on white background',
        num_steps: 4
      });

      results.push({
        model: model,
        ok: true,
        ms: Date.now() - start,
        responseType: typeof r,
        keys: r ? Object.keys(r) : [],
        hasImage: !!(r && r.image)
      });
    } catch (e) {
      results.push({
        model: model,
        ok: false,
        ms: Date.now() - start,
        error: e.message,
        errorCode: e.code || 'n/a'
      });
    }
  }

  return new Response(JSON.stringify({
    total: models.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results: results
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
