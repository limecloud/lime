# Lime i18n Guide

## Overview

Lime currently keeps a single frontend i18n fact source:

- `I18nPatchProvider.tsx`: manages language state and patch lifecycle
- `dom-replacer.ts`: replaces static Chinese UI text in the DOM
- `text-map.ts`: provides the patch dictionaries
- `patches/zh.json` and `patches/en.json`: translation data
- `withI18nPatch.tsx`: class-component helper

The old `@/i18n` barrel export and dynamic template helpers have been removed.
If you need language state, import from `@/i18n/I18nPatchProvider`.
If you need language types, import from `@/i18n/text-map`.

## Active Architecture

```text
src/i18n/
├── patches/
│   ├── zh.json
│   └── en.json
├── I18nPatchProvider.tsx
├── dom-replacer.ts
├── text-map.ts
└── withI18nPatch.tsx
```

## Setup

```tsx
import { I18nPatchProvider } from "@/i18n/I18nPatchProvider";

function App() {
  return (
    <I18nPatchProvider initialLanguage="zh">
      <YourApp />
    </I18nPatchProvider>
  );
}
```

## Language Switching

```tsx
import { useI18nPatch } from "@/i18n/I18nPatchProvider";

function LanguageSwitcher() {
  const { language, setLanguage } = useI18nPatch();

  return (
    <select
      value={language}
      onChange={(event) => setLanguage(event.target.value)}
    >
      <option value="zh">中文</option>
      <option value="en">English</option>
    </select>
  );
}
```

## Text Rules

- Source UI text should stay in Chinese.
- Static UI text is translated by the patch layer after render.
- For runtime copy with variables, prefer the repository's current translation runtime such as `react-i18next`; do not reintroduce the removed `@/i18n` barrel or template helpers.

## Adding Translations

1. Add the Chinese source text to `src/i18n/patches/zh.json`.
2. Add the English translation to `src/i18n/patches/en.json`.
3. Keep the component source text in Chinese.

Example:

```json
{
  "保存设置": "Save Settings"
}
```

```tsx
<button>保存设置</button>
```

## Troubleshooting

- Text not translating:
  - Confirm `I18nPatchProvider` wraps the app.
  - Confirm the text exists in both patch files.
  - Confirm the text is not inside an editable container.
- Language not updating:
  - Confirm `useI18nPatch()` is used inside `I18nPatchProvider`.
  - Confirm local storage language state is changing as expected.

## Current Boundary

- Allowed current imports:
  - `@/i18n/I18nPatchProvider`
  - `@/i18n/text-map`
  - `@/i18n/withI18nPatch`
- Removed legacy surface:
  - `@/i18n`
  - `src/i18n/index.ts`
  - `src/i18n/dynamic-translation.ts`
