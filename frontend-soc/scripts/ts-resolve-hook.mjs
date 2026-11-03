/**
 * Minimal resolver so Node's built-in test runner can execute the project's
 * TypeScript directly, with no test framework to install.
 *
 * Node's native ESM requires explicit file extensions, while the app's source
 * uses extensionless and "@/" aliased imports (as Next and tsconfig expect).
 * This hook bridges the two WITHOUT distorting the source, which must keep the
 * import style the Next build understands.
 *
 * Used by: npm test
 */

import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function firstExisting(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "@/lib/x" -> <cwd>/src/lib/x, matching tsconfig paths.
    if (specifier.startsWith('@/')) {
      const found = firstExisting(resolvePath(SRC, specifier.slice(2)));
      if (found) return { url: found, shortCircuit: true };
    }

    // Relative import with no extension, or pointing at a directory.
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const basePath = resolvePath(parentDir, specifier);
      if (!existsSync(basePath)) {
        const found = firstExisting(basePath);
        if (found) return { url: found, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
