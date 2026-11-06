import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createMediaReader, docxToText, pptxToText, fileKind, unzip, MEDIA_TEXTS } from '../src/media.mjs';
import { inputFromMessage } from '../src/input.mjs';

// Минимальный zip-архив (deflate) для DOCX/PPTX в тестах.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = zip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Смена — курс для бариста.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Пилот: 3 точки &amp; 40 </w:t></w:r><w:r><w:t>сетей</w:t></w:r></w:p></w:body></w:document>',
});
const PPTX = zip({
  'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Рынок</a:t></a:r></a:p></p:sld>',
  'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Команда</a:t></a:r></a:p></p:sld>',
  'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Проблема</a:t></a:r></a:p><a:p><a:r><a:t>Текучка 60%</a:t></a:r></a:p></p:sld>',
});

test('DOCX и PPTX читаются без зависимостей, слайды по порядку', () => {
  assert.equal(docxToText(DOCX), 'Смена — курс для бариста.\nПилот: 3 точки & 40 сетей');
  assert.equal(pptxToText(PPTX), 'Слайд 1\nПроблема\nТекучка 60%\n\nСлайд 2\nРынок\n\nСлайд 3\nКоманда');
  assert.throws(() => unzip(Buffer.from('not a zip')), { code: 'BROKEN' });
});

test('формат определяется по mime и расширению', () => {
  assert.equal(fileKind({ fileName: 'Pitch.DOCX' }), 'docx');
  assert.equal(fileKind({ mimeType: 'application/pdf' }), 'pdf');
  assert.equal(fileKind({ fileName: 'a.pptx' }), 'pptx');
  assert.equal(fileKind({ mimeType: 'text/plain' }), 'text');
  assert.equal(fileKind({ fileName: 'slide.png' }), 'image');
  assert.equal(fileKind({ fileName: 'a.zip' }), 'unknown');
});

function reader({ gemini = null, files = {} } = {}) {
  return createMediaReader({ gemini, download: async (id) => ({ buffer: files[id] }) });
}

test('без Gemini: TXT/DOCX/PPTX работают, голос/PDF/фото — понятный отказ', async () => {
  const r = reader({ files: { t: Buffer.from('﻿Питч текстом'), d: DOCX, p: PPTX } });
  assert.equal((await r.toText({ kind: 'document', fileId: 't', fileName: 'p.txt' })).text, 'Питч текстом');
  assert.match((await r.toText({ kind: 'document', fileId: 'd', fileName: 'p.docx' })).text, /Пилот/);
  assert.match((await r.toText({ kind: 'document', fileId: 'p', fileName: 'p.pptx' })).text, /^Слайд 1/);
  for (const m of [{ kind: 'voice', fileId: 'v' }, { kind: 'document', fileId: 'x', fileName: 'a.pdf' }, { kind: 'photo', fileId: 'f' }]) {
    await assert.rejects(r.toText(m), { code: 'NO_RECOGNITION' });
  }
  await assert.rejects(r.toText({ kind: 'document', fileId: 'z', fileName: 'a.zip' }), { code: 'UNSUPPORTED' });
  await assert.rejects(r.toText({ kind: 'document', fileId: 'z', fileName: 'a.txt', size: 50 * 1024 * 1024 }), { code: 'TOO_BIG' });
  await assert.rejects(r.toText({ kind: 'voice', fileId: 'z', duration: 3600 }), { code: 'TOO_LONG_VOICE' });
});

test('с Gemini: голос и PDF уходят как media, длинный текст сокращается', async () => {
  const calls = [];
  const gemini = {
    generateText: async (req) => {
      calls.push(req);
      if (req.media?.[0]?.mimeType === 'audio/ogg') return { data: 'Мы продаём курсы, 12 клиентов.' };
      if (req.media?.[0]?.mimeType === 'application/pdf') return { data: 'x'.repeat(5000) };
      return { data: 'Короткая версия питча с цифрами 12 и 40.' };
    },
  };
  const r = reader({ gemini, files: { v: Buffer.from('ogg'), pdf: Buffer.from('%PDF') } });
  const voice = await r.toText({ kind: 'voice', fileId: 'v', mimeType: 'audio/ogg' });
  assert.deepEqual(voice, { text: 'Мы продаём курсы, 12 клиентов.', shortened: false, source: 'voice' });
  assert.equal(calls[0].media[0].data, Buffer.from('ogg').toString('base64'));
  const pdf = await r.toText({ kind: 'document', fileId: 'pdf', fileName: 'deck.pdf' });
  assert.equal(pdf.shortened, true);
  assert.match(pdf.text, /^Короткая версия/);

  const broken = reader({ gemini: { generateText: async () => { throw new Error('quota'); } }, files: { v: Buffer.from('x') } });
  await assert.rejects(broken.toText({ kind: 'voice', fileId: 'v' }), { message: MEDIA_TEXTS.FAILED });
});

test('сообщение Telegram превращается во вход диалога', () => {
  assert.deepEqual(inputFromMessage({ text: 'привет' }), { text: 'привет' });
  assert.equal(inputFromMessage({ voice: { file_id: 'v', duration: 5 } }).media.kind, 'voice');
  assert.equal(inputFromMessage({ document: { file_id: 'd', file_name: 'a.pdf' } }).media.fileName, 'a.pdf');
  assert.equal(inputFromMessage({ photo: [{ file_id: 's' }, { file_id: 'big' }] }).media.fileId, 'big');
});

test('OpenAI: голос идёт через transcribe, а не через чат', async () => {
  const seen = [];
  const llm = {
    transcribe: async ({ mimeType, filename }) => { seen.push([mimeType, filename]); return { data: ' Питч голосом, 5 клиентов. ' }; },
    generateText: async () => { throw new Error('не должен вызываться для голоса'); },
  };
  const r = createMediaReader({ gemini: llm, download: async () => ({ buffer: Buffer.from('OggS') }) });
  const out = await r.toText({ kind: 'voice', fileId: 'v', mimeType: 'audio/ogg' });
  assert.equal(out.text, 'Питч голосом, 5 клиентов.');
  assert.deepEqual(seen, [['audio/ogg', 'voice.ogg']]);
});
