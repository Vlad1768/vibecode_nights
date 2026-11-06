import { env, argv } from 'node:process';
import process from 'node:process';
import { createGeminiClientFromEnv, GeminiError } from './client.mjs';

// Default mode reads model metadata only. --generate makes one small generation call.
try {
  const client = createGeminiClientFromEnv();
  if (argv.includes('--generate')) {
    const result = await client.generateJSON({
      prompt: 'Return exactly this JSON object: {"ok":true}. No other text.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    });
    if (result.data?.ok !== true) throw new GeminiError('RESPONSE');
    console.log(JSON.stringify({ ok: true, check: 'generation', model: client.model, modelVersion: result.modelVersion, usage: result.usage }));
  } else {
    let pageToken;
    let available = false;
    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY }, signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok) {
        console.error(JSON.stringify({ ok: false, check: 'model-access', httpStatus: response.status }));
        process.exitCode = 1;
        break;
      }
      const payload = await response.json();
      available ||= (payload.models || []).some((model) => model.name === 'models/' + client.model && (model.supportedGenerationMethods || []).includes('generateContent'));
      pageToken = available ? undefined : payload.nextPageToken;
    } while (pageToken);
    if (!process.exitCode) {
      console.log(JSON.stringify({ ok: available, check: 'model-access', model: client.model }));
      if (!available) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error instanceof GeminiError ? error.code : 'NETWORK', httpStatus: error instanceof GeminiError ? error.httpStatus : 0 }));
  process.exitCode = 1;
}
