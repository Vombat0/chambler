/**
 * R2 — vitest'in node ortamında kullanılan minimum `node:fs` bildirimi.
 * Client tsconfig `types: ["vite/client"]` kullandığı ve @types/node bağımlılığı
 * olmadığı için yalnızca testlerin ihtiyaç duyduğu iki sembol burada bildirilir.
 * (Yalnızca test dosyaları import eder; tarayıcı derlemesine girmez.)
 */

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: string): string;
}
