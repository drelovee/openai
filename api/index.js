// api/index.js — серверлес-обработчик для Vercel
import OpenAI from 'openai';

// (память можно подключить позже; для проверки она не нужна)
// Заглушки памяти, чтобы не падало без Redis:
async function addMessage(){ }
async function getRecentMessages(){ return []; }
async function clearUser(){ }

const MEMORY_TURNS = Number(process.env.MEMORY_TURNS || 12);

function aliceResponse(reqBody, text, endSession = false) {
  const version = reqBody?.version || '1.0';
  const session = reqBody?.session || {};
  const safeText = (text || '').toString().trim();
  const maxLen = 900;
  const t = safeText.length > maxLen ? safeText.slice(0, maxLen) + '…' : safeText;
  return { version, session, response: { text: t, tts: t, end_session: endSession } };
}

function getUserId(body) {
  const sid = body?.session?.user_id || body?.session?.user?.user_id || body?.meta?.user_id;
  const result = sid || `anon-${body?.session?.session_id || 'unknown'}`;
  return `alice:${result}`;
}

function isResetIntent(text) {
  const t = (text || '').toLowerCase();
  return /(новая тема|начни с чистого листа|сброс|забудь|reset|start new)/i.test(t);
}

// ВАЖНО: export default handler — это и есть точка входа Vercel
export default async function handler(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/ping')) {
    return res.status(200).send('pong');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const isNew = body?.session?.new === true;
    const utterance = body?.request?.original_utterance || body?.request?.command || '';
    const userId = getUserId(body);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(200).json(aliceResponse(body, 'Не настроен ключ OpenAI. Добавь OPENAI_API_KEY.', true));

    if (isNew) return res.status(200).json(aliceResponse(body, 'Привет! Я GPT-помощник. Скажи «новая тема», чтобы очистить память.', false));
    if (!utterance || !utterance.trim()) return res.status(200).json(aliceResponse(body, 'Повтори, пожалуйста — я не расслышала.', false));

    if (isResetIntent(utterance)) {
      await clearUser(userId);
      return res.status(200).json(aliceResponse(body, 'Память очищена. Новая тема — о чём поговорим?', false));
    }

    await addMessage(userId, 'user', utterance);

    const openai = new OpenAI({ apiKey });
    const systemPrompt = 'Говори кратко для TTS (1–3 фразы).';

    const history = await getRecentMessages(userId, MEMORY_TURNS); // сейчас пусто — ок
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: utterance }];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 350,
      messages
    });
    const answer = completion.choices?.[0]?.message?.content?.trim() || 'Не удалось сформировать ответ.';

    await addMessage(userId, 'assistant', answer);
    return res.status(200).json(aliceResponse(body, answer, false));
  } catch (e) {
    console.error(e);
    return res.status(200).json(aliceResponse(req.body || {}, 'Ошибка обработки. Попробуй ещё раз.', false));
  }
}
