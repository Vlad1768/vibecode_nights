// Сообщение Telegram → вход диалога (текст, голосовое, файл или фото).
export function inputFromMessage(message) {
  if (message.voice) return { media: { kind: 'voice', fileId: message.voice.file_id, mimeType: message.voice.mime_type, duration: message.voice.duration, size: message.voice.file_size } };
  if (message.audio) return { media: { kind: 'audio', fileId: message.audio.file_id, mimeType: message.audio.mime_type, fileName: message.audio.file_name, duration: message.audio.duration, size: message.audio.file_size } };
  if (message.video_note) return { media: { kind: 'voice', fileId: message.video_note.file_id, mimeType: 'video/mp4', duration: message.video_note.duration, size: message.video_note.file_size } };
  if (message.document) return { media: { kind: 'document', fileId: message.document.file_id, mimeType: message.document.mime_type, fileName: message.document.file_name, size: message.document.file_size } };
  if (message.photo?.length) {
    const p = message.photo.at(-1);
    return { media: { kind: 'photo', fileId: p.file_id, mimeType: 'image/jpeg', size: p.file_size } };
  }
  return { text: message.text };
}
