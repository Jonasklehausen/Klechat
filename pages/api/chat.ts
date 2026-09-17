import { ParsedEvent, ReconnectInterval, createParser } from 'eventsource-parser';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { messages, prompt, temperature } = (await req.json()) as any;
    
    const apiKey = (process.env.OPENAI_API_KEY || '').trim().replace(/^["']|["']$/g, '');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API Key fehlt in den Vercel Environment Variables.' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Standard-Groq-Modell
    const selectedModel = 'llama-3.3-70b-versatile';

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      method: 'POST',
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          {
            role: 'system',
            content: prompt || 'Du bist ein hilfreicher KI-Assistent. Antworte immer präzise auf Deutsch.',
          },
          ...(messages || []),
        ],
        temperature: temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('❌ Groq API Fehler:', errorText);
      return new Response(
        JSON.stringify({ error: `Groq Fehler (${res.status}): ${errorText}` }), 
        { status: res.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const body = res.body;

    if (!body) {
      return new Response('Kein Stream von Groq empfangen.', { status: 500 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const onParse = (event: ParsedEvent | ReconnectInterval) => {
          if (event.type === 'event') {
            const data = event.data;
            if (data === '[DONE]') {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const text = json.choices[0]?.delta?.content;
              if (text) {
                controller.enqueue(encoder.encode(text));
              }
            } catch (e) {
              controller.error(e);
            }
          }
        };

        const parser = createParser(onParse);
        const reader = body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
        } catch (e) {
          controller.error(e);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('❌ Server Fehler:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
