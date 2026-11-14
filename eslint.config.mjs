import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// ESLint stays on 9 (#599): eslint-plugin-import, eslint-plugin-jsx-a11y and
// eslint-plugin-react, which eslint-config-next pulls in, declare ESLint 9 at
// most, and on 10 eslint-plugin-import's import/order crashed on every
// out-of-order import until this file patched SourceCode back. Move to 10 once
// all three declare it.

// Flat config (ESLint 9+). It reproduces the rule set of the former
// `.eslintrc.json` (`next/core-web-vitals` plus the project rules below);
// see #449 for the rule-by-rule comparison.

// eslint-plugin-react-hooks 7's `recommended` set (pulled in by
// eslint-config-next 16) adds the React Compiler rules. The eslintrc config ran
// only `rules-of-hooks` and `exhaustive-deps`, so every other react-hooks rule
// the preset enables is switched off here until it is adopted on purpose.
const reactCompilerRulesOff = Object.fromEntries(
  nextCoreWebVitals
    .flatMap((entry) => Object.keys(entry.rules ?? {}))
    .filter((rule) => rule.startsWith('react-hooks/'))
    .map((rule) => [rule, 'off']),
);

// The TypeScript parser eslint-config-next already uses for .ts/.tsx. Its
// own block covers only those, so a .d.mts beside a script (scripts/) would
// otherwise go to the JavaScript parser and fail to parse.
const typescriptParser = nextCoreWebVitals.find((entry) => entry.name === 'next/typescript')?.languageOptions?.parser;
if (!typescriptParser) throw new Error('eslint-config-next no longer exposes its TypeScript parser as next/typescript');

const config = [
  {
    ignores: ['.next/**', 'out/**', 'video-promo/**', '.agents/**', '**/*.patch'],
  },
  ...nextCoreWebVitals,
  {
    // ESLint 9 started reporting unused disable directives by default;
    // ESLint 8 did not, and the gate runs with --max-warnings=0.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      ...reactCompilerRulesOff,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // New in @next/eslint-plugin-next 16; not part of the eslintrc set.
      '@next/next/no-location-assign-relative-destination': 'off',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'react/self-closing-comp': 'warn',
    },
  },
  {
    files: ['**/*.mts', '**/*.cts'],
    languageOptions: { parser: typescriptParser },
  },
  {
    // Build and maintenance scripts report to the terminal: that is their output.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'warn',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
];

export default config;
