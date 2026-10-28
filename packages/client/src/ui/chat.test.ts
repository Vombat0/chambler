import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, ClientChatGate, sanitizeChatText } from './chat.js';

const T1 = 1_000;
const T2 = 1_100;
const T3 = 1_200;

describe('chat helpers (D1)', () => {
  it(' kontrol karakterleri boşluğa dönüşür, whitespace birleşir (sunucuyla aynı)', () => {
    expect(sanitizeChatText('Merhaba\u0001dunya\u200B!  var')).toBe('Merhaba dunya ! var');
  });

  it(' boş/yalnız boşluk mesaj reddedilir', () => {
    expect(sanitizeChatText('   ')).toBeNull();
  });

  it(' 300 karakter sınırı client tarafında kırpılır', () => {
    const long = 'x'.repeat(320);
    expect((sanitizeChatText(long) ?? '').length).toBe(CHAT_MAX_LENGTH);
  });
});

describe('client chat gate (rate limit feedback, D1)', () => {
  it(' ilk üç mesaj geçer', () => {
    const gate = new ClientChatGate();
    expect(gate.submit('p1', 'selam', T1).allowed).toBe(true);
    expect(gate.submit('p1', 'ikinci', T2).allowed).toBe(true);
    expect(gate.submit('p1', 'ucuncu', T3).allowed).toBe(true);
  });

  it(' aynı saniyede dördüncü mesaj rate_limited döner', () => {
    const gate = new ClientChatGate();
    gate.submit('p1', 'bir', T1);
    gate.submit('p1', 'iki', T2);
    gate.submit('p1', 'üç', T3);
    const fourth = gate.submit('p1', 'dört', T3 + 100);
    expect(fourth).toEqual({ allowed: false, reason: 'rate_limited' });
  });

  it(' pencere geçince tekrar açılır', () => {
    const gate = new ClientChatGate();
    gate.submit('p1', 'bir', T1);
    gate.submit('p1', 'iki', T2);
    gate.submit('p1', 'üç', T3);
    expect(gate.submit('p1', 'dört', T1 + 1500).allowed).toBe(true);
  });

  it(' farklı oyuncular bağımsız sayılır', () => {
    const gate = new ClientChatGate();
    gate.submit('p1', 'bir', T1);
    gate.submit('p1', 'iki', T2);
    expect(gate.submit('p2', 'selam', T1).allowed).toBe(true);
  });

  it(' boş mesaj empty, uzun mesaj too_long döner', () => {
    const gate = new ClientChatGate();
    expect(gate.submit('p1', '   ', T1)).toEqual({ allowed: false, reason: 'empty' });
    expect(gate.submit('p1', 'x'.repeat(301), T1)).toEqual({ allowed: false, reason: 'too_long' });
  });
});
