import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 当前文件位于 server/paths.ts，因此 serverDir 就是 .../server
export const serverDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

export function serverPath(...parts: string[]): string {
  return path.join(serverDir, ...parts);
}


