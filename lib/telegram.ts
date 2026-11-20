// Sends HTML messages through a Telegram bot. Long text is split on line breaks (limit is 4096 chars).
const LIMIT = 4000;

export async function sendTelegram(html: string, button?: { text: string; url: string }): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');

  const chunks: string[] = [];
  let current = '';
  for (const line of html.split('\n')) {
    if (current && current.length + line.length + 1 > LIMIT) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);

  for (const [i, text] of chunks.entries()) {
    const last = i === chunks.length - 1;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        // Optional button under the last message (e.g. "Open report").
        ...(last && button ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage -> ${res.status}: ${await res.text()}`);
  }
}
