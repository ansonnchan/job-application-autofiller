<p align="center">
  <img src="public/icons/koalified-mascot.png" alt="koalified koala mascot" width="180">
</p>

<h1 align="center">koalified</h1>

<p align="center"><em>a little help with applications.</em></p>

<p align="center">
  A local-first Chrome extension that helps fill repetitive job-application fields—without taking control away from you.
</p>

## What it does

koalified keeps your reusable application details in your local Chrome profile, recognizes matching fields on an application page, and lets you review every proposed value before filling.

The current version includes:

- An in-popup profile editor for contact details, location, links, and education, with advanced experience, résumé, and AI settings available from the gear menu.
- Structured phone input with selectable country calling codes while retaining a combined number for application forms.
- Country selection plus province/state suggestions for Canada and the United States.
- Local résumé PDF upload with bundled PDF.js text extraction and a contact-detail import review.
- Generic field recognition using labels, accessibility attributes, names, IDs, and placeholders.
- A review panel where values can be edited, included, or excluded before filling.
- Native text, select, date, and month input handling with framework-compatible events.
- Accessible custom-combobox interaction that opens the menu and clicks a matching option.
- Configurable degree fallbacks, such as `Computer Engineering` → `Engineering`.
- Optional Gemini or Groq/OpenAI-compatible AI configuration for future short-answer drafts.
- An explicit `Alt+A` shortcut for user-triggered one-click filling.

Dedicated Greenhouse, Lever, Ashby, SmartRecruiters, and Workday adapters will build on the same matching and interaction engine.

## How it works

```mermaid
flowchart TD
    U[Open koalified on an application] --> C[Scan the current page]
    C --> N[Normalize recognized fields]
    N --> M[Match against the local profile]
    M --> R[Review and edit proposed values]
    R -->|Approve selected fields| I{Interaction engine}
    I -->|Native field| V[Set value and dispatch events]
    I -->|Custom combobox| K[Open menu and click matching option]
    V --> X[You review and submit manually]
    K --> X

    P[Profile editor] --> L[(chrome.storage.local)]
    PDF[Résumé PDF] -->|Local PDF.js extraction| P
    L --> M
    L --> A[Optional AI provider]
```

## Privacy and control

koalified is designed for a private, trusted browser profile:

- Profile data and API configuration stay in `chrome.storage.local`.
- Résumé PDF extraction happens locally; choosing a PDF does not contact an AI provider.
- Nothing is filled without an explicit user action.
- The review-first workflow shows proposed values before changing the page.
- Unknown fields are left blank instead of guessed.
- Passwords, verification codes, CAPTCHAs, uploads, and submission controls are ignored.
- koalified never clicks **Next**, **Apply**, **Create account**, or **Submit**.
- AI requests occur only when explicitly requested and use the provider you configure.

Chrome clears local extension data when an extension is removed. Keep your original résumé and profile information elsewhere. API keys are stored as plain extension data, not in an operating-system keychain.

## Install locally

No Chrome Web Store account or fee is needed.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this repository directory.
5. Pin koalified and use **My profile** inside the popup to add your core information.
6. Use the gear menu for experience, résumé, and optional AI settings.
7. Open a job application and choose **Review this page**.

After pulling or editing code, reload the extension from `chrome://extensions` and refresh the application page.

## Development

The extension ships the PDF.js browser files it needs, so loading the unpacked extension does not require a build step. For development:

```bash
npm ci
npm test
```

After changing the `pdfjs-dist` version, refresh the checked-in browser files with `npm run vendor:pdfjs`.

The matching and import cores have unit coverage for common labels, safety exclusions, degree fallbacks, date formatting, custom-combobox matching, and résumé contact detection.

## AI providers

AI configuration is optional. The settings page supports:

- **Gemini** through the Gemini `generateContent` API.
- **OpenAI-compatible** chat-completions endpoints, preconfigured for Groq.

Model names, free tiers, and provider data-use terms change over time. Confirm the current provider terms before sending résumé or application context.

## Roadmap

The full [product and engineering roadmap](ROADMAP.md) covers the reliability baseline, local résumé PDF import, inline AI drafting, repeated profile records, Greenhouse and Lever adapters, Workday controls, saved corrections, undo, backup, testing, and release quality.
