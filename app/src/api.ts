import { Analysis } from './types';

const API = import.meta.env.VITE_API_URL ?? 'http://157.230.22.69:3000';

export async function askLex(question: string): Promise<Analysis> {
  const res = await fetch(`${API}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
}
