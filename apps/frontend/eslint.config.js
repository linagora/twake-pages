import js from '@eslint/js'
import tanstackQuery from '@tanstack/eslint-plugin-query'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y-x'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const LAYERS = ['domain', 'application', 'adapters', 'ui', 'ds', 'app']

const layers = (...names) => names.map(name => `@/${name}/**`)

const EVERYWHERE = [
  { group: ['cozy-ui', 'cozy-ui/**'], message: 'cozy-ui is never used.' },
  {
    group: ['@linagora/twake-mui/*'],
    message: 'Import from the @linagora/twake-mui entry point.'
  },
  {
    group: ['posthog-js', 'posthog-js/**'],
    message: 'Only adapters/posthog/ imports posthog-js.'
  }
]

const RAW_UI = [
  {
    group: ['@mui/*', '@mui/*/**', '@emotion/*', '@emotion/*/**'],
    message: 'Import from @linagora/twake-mui. Missing UI goes to @/ds/.'
  }
]

const NO_STYLED = {
  name: '@linagora/twake-mui',
  importNames: ['styled'],
  message: 'No styled components outside @/ds/.'
}

const FRAMEWORKS = [
  'react',
  'react-dom',
  'react-router',
  'twake-i18n',
  '@tanstack/*',
  '@linagora/*'
]

const BOUNDARIES = {
  domain: [...layers(...LAYERS.filter(l => l !== 'domain')), ...FRAMEWORKS],
  application: [...layers('adapters', 'ui', 'ds', 'app'), ...FRAMEWORKS],
  adapters: layers('ui', 'ds', 'app'),
  ui: layers('adapters', 'app'),
  ds: [
    ...layers('domain', 'application', 'adapters', 'ui', 'app'),
    'react-router',
    'twake-i18n',
    '@tanstack/*'
  ],
  app: []
}

const restrictImports = layer => {
  const patterns = [...EVERYWHERE]
  if (layer !== 'ds') patterns.push(...RAW_UI)
  if (BOUNDARIES[layer].length > 0) {
    patterns.push({
      group: BOUNDARIES[layer],
      message: `Not allowed from ${layer}/ (hexagonal boundaries).`
    })
  }
  return ['error', { paths: layer === 'ds' ? [] : [NO_STYLED], patterns }]
}

const FORBIDDEN_SYNTAX = [
  {
    selector: 'ExportDefaultDeclaration',
    message: 'Named exports only.'
  },
  { selector: 'TSEnumDeclaration', message: 'Use a string union.' },
  {
    selector: 'JSXAttribute[name.name="style"]',
    message: 'No inline style: use twake-mui props or twake-css classes.'
  },
  {
    selector:
      'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
    message: 'No `as unknown as T`.'
  }
]

const NO_SX = {
  selector: 'JSXAttribute[name.name="sx"]',
  message: 'No sx outside @/ds/.'
}

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'public/'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' }
      ]
    }
  },
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [jsxA11y.configs.strict],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      'no-restricted-syntax': ['error', ...FORBIDDEN_SYNTAX, NO_SX]
    }
  },
  ...LAYERS.map(layer => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': restrictImports(layer) }
  })),
  {
    files: ['src/ds/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...FORBIDDEN_SYNTAX] }
  },
  {
    files: ['src/adapters/posthog/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: EVERYWHERE.filter(p => !p.group.includes('posthog-js')) }
      ]
    }
  },
  ...tanstackQuery.configs['flat/recommended'],
  {
    files: ['src/**/*.spec.{ts,tsx}'],
    ...vitest.configs.recommended
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  prettier
)
