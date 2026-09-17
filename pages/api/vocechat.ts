export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const payload = await req.json();
    const { detail, target, from_uid } = payload;

    // Nur Textnachrichten verarbeiten (Reaktionen, Bilder etc. ignorieren)
    if (!detail || detail.type !== 'text' || !detail.content) {
      return new Response('OK', { status: 200 });
    }

    const userMessage = detail.content;
    const apiKey = (process.env.OPENAI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    const vocechatSecret = (process.env.VOCECHAT_BOT_SECRET || '').trim();
    const vocechatUrl = (process.env.VOCECHAT_URL || '').trim().replace(/\/$/, '');

    if (!apiKey || !vocechatSecret || !vocechatUrl) {
      console.error('Fehlende Konfiguration in den Environment Variables.');
      return new Response('Server Config Error', { status: 500 });
    }

    // 1. Anfrage an Groq senden
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      method: 'POST',
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'Du bist ein hilfreicher Chatbot in einem VoceChat-Server. Antworte kurz, präzise und direkt auf Deutsch.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      throw new Error(`Groq Fehler: ${groqRes.statusText}`);
    }

    const groqData = await groqRes.json();
    const replyText = groqData.choices?.[0]?.message?.content || 'Entschuldigung, ich konnte keine Antwort generieren.';

    // 2. Antwort an VoceChat senden
    const isGroup = !!target?.group_id;
    const sendEndpoint = isGroup
      ? `${vocechatUrl}/api/bot/send_to_group/${target.group_id}`
      : `${vocechatUrl}/api/bot/send_to_user/${from_uid}`;

    await fetch(sendEndpoint, {
      method: 'POST',
      headers: {
        'x-api-key': vocechatSecret,
        'Content-Type': 'text/plain',
      },
      body: replyText,
    });

    return new Response('OK', { status: 200 });
  } catch (error: any) {
    console.error('❌ VoceChat Webhook Fehler:', error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
