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
    
    const rawKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY || '';
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');

    if (!apiKey) {
      return new Response('FEHLER: Kein API-Key in .env.local gefunden.', { status: 500 });
    }

    // 1. Verfügbare Groq-Modelle abrufen
    let validChatModels: string[] = [];
    try {
      const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        const allIds: string[] = modelsData.data?.map((m: any) => m.id) || [];
        
        // Filtert Guard-, Whisper- und Embed-Modelle aus
        validChatModels = allIds.filter(id => 
          !id.includes('guard') && 
          !id.includes('whisper') && 
          !id.includes('embed') &&
          !id.includes('safeguard')
        );
      }
    } catch (e) {
      console.warn('Modellliste konnte nicht geladen werden.');
    }

    // 2. Bevorzugte Reihenfolge reiner Textmodelle
    const preferredOrder = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama-3.2-3b-preview',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ];

    // Kombiniert gefilterte Live-Modelle mit der Bevorzugungsliste
    const modelsToTry = [
      ...preferredOrder.filter(id => validChatModels.includes(id)),
      ...validChatModels,
      ...preferredOrder
    ].filter((value, index, self) => self.indexOf(value) === index);

    let res: Response | null = null;
    let lastErrorText = '';

    // 3. Erstes funktionierendes Chat-Modell ermitteln
    for (const model of modelsToTry) {
      console.log(`Versuche Groq Chat-Modell: ${model}`);
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        method: 'POST',
        body: JSON.stringify({
          model: model,
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

      if (response.ok) {
        res = response;
        console.log(`✅ Erfolgreich verbunden mit Chat-Modell: ${model}`);
        break;
      } else {
        lastErrorText = await response.text();
        console.warn(`Modell ${model} übersprungen:`, lastErrorText);
      }
    }

    if (!res) {
      console.error('❌ Keines der Chat-Modelle konnte geladen werden:', lastErrorText);
      return new Response(`Groq Fehler: ${lastErrorText}`, { status: 500 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const body = res.body;

    if (!body) {
      return new Response('Kein Stream-Body empfangen.', { status: 500 });
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
    return new Response(`Internal Server Error: ${error?.message || error}`, { status: 500 });
  }
}
