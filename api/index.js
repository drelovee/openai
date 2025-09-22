// api/index.js — Vercel serverless + Google Gemini (AI Studio)
// Минимальная версия: без внешней «памяти», зато просто и надёжно.

import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function aliceResponse(reqBody, text, endSession = false) {
  const version = reqBody?.version || "1.0";
  const session = reqBody?.session || {};
  const safeText = (text || "").toString().trim();
  const maxLen = 900;
  const t = safeText.length > maxLen ? safeText.slice(0, maxLen) + "…" : safeText;
  return { version, session, response: { text: t, tts: t, end_session: endSession } };
}

function getUserId(body) {
  const sid = body?.session?.user_id || body?.session?.user?.user_id || body?.meta?.user_id;
  const result = sid || `anon-${body?.session?.session_id || "unknown"}`;
  return `alice:${result}`;
}

function isResetIntent(text) {
  const t = (text || "").toLowerCase();
  return /(новая тема|начни с чистого листа|сброс|забудь|reset|start new)/i.test(t);
}

export default async function handler(req, res) {
  // GET /ping — healthcheck
  if (req.method === "GET" && req.url.startsWith("/ping")) {
    return res.status(200).send("pong");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const isNew = body?.session?.new === true;
    const utterance = body?.request?.original_utterance || body?.request?.command || "";
    const userId = getUserId(body);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(200).json(aliceResponse(body, "Не настроен ключ Google (GOOGLE_API_KEY).", true));
    }

    if (isNew) {
      return res.status(200).json(
        aliceResponse(
          body,
          "Привет! Я помощник на модели Gemini. Скажи «новая тема», чтобы начать с чистого листа."
        )
      );
    }
    if (!utterance.trim()) {
      return res.status(200).json(aliceResponse(body, "Повтори, пожалуйста — я не расслышала."));
    }
    if (isResetIntent(utterance)) {
      // Памяти пока нет, просто подтверждаем
      return res.status(200).json(aliceResponse(body, "Ок, начинаем новую тему. О чём поговорим?"));
    }

    // Подготовим промпт (кратко, удобно для TTS)
    const systemPrompt =
      "Ты голосовой ассистент для Яндекс.Алисы. Отвечай кратко и понятно для озвучки: 1–3 короткие фразы. " +
      "Если просят список — до 3 пунктов, без лишней воды.";

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });

    // Простой вызов без history (историю можно добавить позже через Upstash/Redis)
    const prompt = `${systemPrompt}\n\nВопрос пользователя: "${utterance}"`;
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "Не удалось получить ответ.";

    return res.status(200).json(aliceResponse(body, text));
  } catch (e) {
    console.error(e);
    const msg =
      /permission|quota|unauthorized|apikey|api key|invalid/i.test(String(e))
        ? "Сервис недоступен: проверь ключ и лимиты Gemini."
        : "Ошибка обработки. Попробуй ещё раз.";
    return res.status(200).json(aliceResponse(req.body || {}, msg));
  }
}
