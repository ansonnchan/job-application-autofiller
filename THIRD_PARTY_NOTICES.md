# Third-party notices

## PDF.js

koalified includes the prebuilt browser API and worker from Mozilla PDF.js (`pdfjs-dist` 6.2.108) for local PDF text extraction.

- Project: <https://github.com/mozilla/pdf.js>
- License: Apache License 2.0
- Vendored files: `vendor/pdfjs/pdf.mjs`, `vendor/pdfjs/pdf.worker.mjs`
- License text: `vendor/pdfjs/LICENSE`

Run `npm run vendor:pdfjs` after updating the dependency to keep the API, worker, and license from the same package version.
