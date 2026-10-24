import { SourceCode } from 'eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// ESLint 10 removed two deprecated SourceCode methods that
// eslint-plugin-import 2.32 (`import/order`) still calls when it builds a fix,
// so every out-of-order import crashed the run instead of being reported.
// These are ESLint 9's own implementations; drop them once eslint-plugin-import
// supports ESLint 10.
for (const [name, method] of [
  ['getTokenOrCommentBefore', 'getTokenBefore'],
  ['getTokenOrCommentAfter', 'getTokenAfter'],
]) {
  if (typeof SourceCode.prototype[name] !== 'function') {
    SourceCode.prototype[name] = function (node, skip) {
      return this[method](node, { includeComments: true, skip });
    };
  }
}

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
