// Превращает голосовое, файл или фото из Telegram в текст для API.
// TXT/MD/DOCX/PPTX читаются локально, голос, PDF и картинки — моделью из integrations/llm.mjs (ChatGPT или Gemini).
// Контракт API не меняется: дальше уходит обычный текст питча или ответа.
import { inflateRawSync } from 'node:zlib';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_VOICE_SEC = 10 * 60;
const MAX_UNZIPPED = 8 * 1024 * 1024;

export class MediaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export const MEDIA_TEXTS = {
  TOO_BIG: 'Файл слишком большой: до 15 МБ.',
  TOO_LONG_VOICE: 'Голосовое слишком длинное: до 10 минут.',
  UNSUPPORTED: 'Этот формат я не читаю. Подойдут: текст, голосовое, PDF, DOCX, PPTX, TXT или фото слайда.',
  NO_RECOGNITION: 'Распознавание голоса, PDF и фото пока не подключено. Пришлите текстом или файлом DOCX, PPTX, TXT.',
  EMPTY: 'Не смог разобрать текст. Пришлите ещё раз или напишите текстом.',
  FAILED: 'Не получилось распознать. Пришлите ещё раз или напишите текстом.',
  BROKEN: 'Файл не открывается. Сохраните его заново или пришлите текстом.',
};

const fail = (code) => new MediaError(code, MEDIA_TEXTS[code]);

// ---------- ZIP (DOCX/PPTX) без зависимостей ----------

export function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('BROKEN');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) throw fail('BROKEN');
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith('.xml')) continue;
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw fail('BROKEN');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compSize);
    total += size;
    if (total > MAX_UNZIPPED) throw fail('TOO_BIG');
    let data;
    try {
      data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : null;
    } catch {
      throw fail('BROKEN');
    }
    if (data) files.set(name, data.toString('utf8'));
  }
  return files;
}

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

// Текст из XML Office: абзацы <*:p> → строки, текст из <*:t>.
function officeXmlText(xml, ns) {
  const paragraphs = xml.split(new RegExp(`</${ns}:p>`));
  const lines = paragraphs.map((p) => {
    const runs = [...p.matchAll(new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>`, 'g'))].map((m) => decodeXml(m[1]));
    return runs.join('').replace(/\s+/g, ' ').trim();
  });
  return lines.filter(Boolean).join('\n');
}

export function docxToText(buffer) {
  const doc = unzip(buffer).get('word/document.xml');
  if (!doc) throw fail('BROKEN');
  return officeXmlText(doc, 'w');
}

export function pptxToText(buffer) {
  const files = unzip(buffer);
  const slides = [...files.keys()]
    .map((name) => [name, /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)])
    .filter(([, m]) => m)
    .sort((a, b) => Number(a[1][1]) - Number(b[1][1]));
  if (!slides.length) throw fail('BROKEN');
  return slides
    .map(([name], i) => {
      const text = officeXmlText(files.get(name), 'a');
      return text ? `Слайд ${i + 1}\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// ---------- Определение формата ----------

export function fileKind({ mimeType = '', fileName = '' }) {
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? '').toLowerCase();
  const mime = mimeType.toLowerCase();
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'pptx' || mime.includes('presentationml')) return 'pptx';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['txt', 'md', 'markdown', 'text'].includes(ext) || mime.startsWith('text/')) return 'text';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) return 'image';
  if (mime.startsWith('audio/') || ['ogg', 'oga', 'mp3', 'm4a', 'wav', 'opus'].includes(ext)) return 'audio';
  return 'unknown';
}

const PROMPTS = {
  audio:
    'Это голосовое сообщение студента, который рассказывает о своём стартапе или отвечает на вопрос инвестора. ' +
    'Расшифруй его дословно на языке оригинала: только сказанное, без пояснений, заголовков и оценок. ' +
    'Цифры пиши цифрами. Если речи нет или она неразборчива, верни пустую строку.',
  document:
    'Это документ студента о его стартапе (питч или презентация). Извлеки весь текст по порядку страниц или слайдов. ' +
    'Сохрани цифры, названия и формулировки как есть. Ничего не добавляй, не пересказывай и не оценивай. ' +
    'Верни только текст документа.',
  shorten:
    'Это текст питча студента. Сократи его до 3500 знаков, сохранив все цифры, факты, названия, клиентов и деньги. ' +
    'Ничего не добавляй от себя и не оценивай. Верни только сокращённый текст.',
};

const clean = (s) => String(s ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// gemini — клиент из integrations/gemini или null (тогда голос, PDF и фото недоступны).
export function createMediaReader({ gemini = null, download, maxChars = 4000 }) {
  async function ask(prompt, mimeType, buffer) {
    if (!gemini) throw fail('NO_RECOGNITION');
    try {
      // У OpenAI голос распознаётся отдельной моделью речи, у Gemini — тем же запросом с аудио.
      if (mimeType.startsWith('audio/') && typeof gemini.transcribe === 'function') {
        const ext = mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'ogg';
        const { data } = await gemini.transcribe({ buffer, mimeType, filename: `voice.${ext}` });
        return clean(data);
      }
      const { data } = await gemini.generateText({ prompt, media: [{ mimeType, data: buffer.toString('base64') }] });
      return clean(data);
    } catch (err) {
      if (err instanceof MediaError) throw err;
      throw fail('FAILED');
    }
  }

  async function fit(text, { source }) {
    if (!text) throw fail('EMPTY');
    if (text.length <= maxChars) return { text, shortened: false, source };
    if (!gemini) return { text, shortened: false, source }; // API ответит PITCH_TOO_LONG — попросим сократить
    try {
      const { data } = await gemini.generateText({ prompt: `${PROMPTS.shorten}\n\n<питч>\n${text.slice(0, 30_000)}\n</питч>` });
      const short = clean(data);
      return short ? { text: short, shortened: true, source } : { text, shortened: false, source };
    } catch {
      return { text, shortened: false, source };
    }
  }

  return {
    canRecognize: !!gemini,

    // media: { kind: 'voice'|'audio'|'document'|'photo', fileId, mimeType, fileName, size, duration }
    async toText(media) {
      if (media.size && media.size > MAX_FILE_BYTES) throw fail('TOO_BIG');
      if (media.duration && media.duration > MAX_VOICE_SEC) throw fail('TOO_LONG_VOICE');

      if (media.kind === 'voice' || media.kind === 'audio') {
        if (!gemini) throw fail('NO_RECOGNITION');
        const { buffer } = await download(media.fileId, MAX_FILE_BYTES);
        const mime = media.mimeType || 'audio/ogg';
        return fit(await ask(PROMPTS.audio, mime, buffer), { source: 'voice' });
      }

      const kind = media.kind === 'photo' ? 'image' : fileKind(media);
      if (kind === 'unknown') throw fail('UNSUPPORTED');
      if (['pdf', 'image', 'audio'].includes(kind) && !gemini) throw fail('NO_RECOGNITION');
      const { buffer } = await download(media.fileId, MAX_FILE_BYTES);
      if (kind === 'text') return fit(clean(buffer.toString('utf8').replace(/^﻿/, '')), { source: 'file' });
      if (kind === 'docx') return fit(clean(docxToText(buffer)), { source: 'file' });
      if (kind === 'pptx') return fit(clean(pptxToText(buffer)), { source: 'file' });
      if (kind === 'audio') return fit(await ask(PROMPTS.audio, media.mimeType || 'audio/ogg', buffer), { source: 'voice' });
      const mime = kind === 'pdf' ? 'application/pdf' : media.mimeType || 'image/jpeg';
      return fit(await ask(PROMPTS.document, mime, buffer), { source: 'file' });
    },
  };
}
