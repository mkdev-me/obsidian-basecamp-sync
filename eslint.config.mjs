import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['node_modules/**', 'main.js', 'dist/**', 'build-meta.json', 'broker/**', 'scripts/**', 'tests/**', 'vitest.config.ts', 'esbuild.config.mjs', 'eslint.config.mjs'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } },
    rules: { 'obsidianmd/ui/sentence-case': ['warn', { ignoreWords: ['Basecamp', 'MB', 'Secret'] }] } },
  { files: ['src/settings.ts'], rules: {
    // The imperative settings API supports the declared minimum Obsidian 1.11.4.
    'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    '@typescript-eslint/no-deprecated': 'off',
  } },
]);
