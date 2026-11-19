export class InvalidForm extends Error {}

export async function readForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new InvalidForm();
  }
  if (!request.body) throw new InvalidForm();
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 48_000) {
      await reader.cancel();
      throw new InvalidForm();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return new URLSearchParams(text + decoder.decode());
}

export function redirect(path: string, cookie?: string): Response {
  const headers = new Headers({ Location: path, 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get('Cookie')?.split(';').map(pair => pair.trim())
    .find(pair => pair.startsWith(name + '='))?.slice(name.length + 1);
}
