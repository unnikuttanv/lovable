// Minimal OpenRouter chat-completions client with streaming.
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function streamChat({ model, messages, onToken }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.includes('your-key-here')) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to server/.env');
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Adorable (Lovable clone POC)',
    },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.4 }),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body?.error?.message || detail;
    } catch {}
    throw new Error(`OpenRouter error: ${detail}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          onToken?.(token, fullText);
        }
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
  return fullText;
}
