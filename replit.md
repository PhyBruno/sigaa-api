# SIGAA API — Fork Modernizado para IFSC

## Overview
API REST + biblioteca TypeScript para o SIGAA do IFSC, com bypass de Cloudflare Turnstile via `puppeteer-real-browser`, servidor Express com 16 endpoints, e integração completa com o sistema de biblioteca SophiA.

Fork do [sigaa-api](https://github.com/GeovaneSchmitz/sigaa-api) de Geovane Schmitz, significativamente expandido.

## Architecture
- **Type:** TypeScript library + Express REST server + SophiA browser automation
- **Language:** TypeScript → compiled via Babel to JavaScript
- **Runtime:** Node.js 20+
- **Browser:** Chromium via `puppeteer-real-browser` (headless: false + Xvfb)
- **Build output:** `dist/` directory
- **Main entry:** `dist/sigaa-all-types.js`

## Key Files
| File | Lines | Purpose |
|---|---|---|
| `sigaa-api-server.js` | 703 | Express REST server (16 endpoints, session mgmt) |
| `sophia-library.js` | 590 | SophiA library automation (login, empréstimos, renovação, recibo) |
| `sigaa-menu.js` | 822 | Interactive terminal menu |
| `src/session/sigaa-browser.ts` | 565 | puppeteer-real-browser + Cloudflare bypass |
| `src/session/login/sigaa-login-ifsc.ts` | 110 | IFSC login with Turnstile handling |
| `src/courses/resources/sigaa-news-student.ts` | — | News parsing (fixed: full content) |
| `SIGAA-API.postman_collection.json` | — | Postman collection (16 endpoints documented) |
| `examples/` | 9 files | Interactive examples with credential prompts |

## Dependencies
- `puppeteer-real-browser` — Cloudflare bypass browser automation
- `express` 5.2 — REST server
- `cheerio` 1.2 — HTML parsing
- `cors` — CORS middleware
- `form-data` / `formdata-node` — Multipart form handling
- `he` — HTML entity decoding
- `iconv-lite` — Character encoding
- `lodash` — Utility functions
- `source-map-support` — Source maps for debugging

Install: `npm install --legacy-peer-deps` (ESLint peer dep conflicts)

## Build System
Uses **Babel** for transpilation (`@babel/cli` + `@babel/preset-typescript`). Build: `npm run build`.

## Workflow
- **"Start application"** — `npm run build && node sigaa-api-server.js` (port 3000)

## REST API Server (sigaa-api-server.js)
Express server on port 3000 with 16 endpoints:

**Auth:** POST `/login` (returns token), POST `/logout`
**Academic:** GET `/conta`, `/disciplinas`, `/notas`, `/faltas`, `/atividades`, `/tarefas`, `/aulas`, `/noticias`, `/arquivos`
**Library:** POST `/biblioteca/login`, GET `/biblioteca/emprestimos`, POST `/biblioteca/renovar`, POST `/biblioteca/logout`
**Server:** GET `/status`, GET `/`

All authenticated endpoints require `Authorization: Bearer <token>`.
Auto-reconnects on SIGAA session expiry. Max 5 concurrent sessions. 5min inactivity timeout.

## SophiA Library (sophia-library.js)
- `loginSophia(browser, matricula, senha)` — login using existing browser
- `loginSophiaStandalone(matricula, senha)` — standalone login
- `session.getEmprestimos()` — lists borrowed books
- `session.renovar(codigos?)` — renews loans, parses recibo from `#dRecibo`, closes popup via `fechaPopup()`
- `session.navigateToCirculacoes()` — smart navigation (3 state detection)

## Key Technical Notes
- **`headless: false` + Xvfb** is intentional — Turnstile blocks headless mode
- Login fills forms via `page.evaluate()` with real DOM events (`input`, `change`)
- `waitForTurnstile()` resolves Cloudflare challenge automatically
- Navigation uses `waitUntil: 'domcontentloaded'` to avoid hanging on heavy pages
- News fix: iterates all divs with `divs.each()` instead of `find('div').html()` (first div only)
- Renewal flow: checkboxes → LinkRenovar() → 4s wait → pre-recibo → LinkImpRecibo(1) → 2s wait → #dRecibo parse → fechaPopup()

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `MAX_SESSIONS` | `5` | Max concurrent browser sessions |
| `SESSION_TIMEOUT_MIN` | `5` | Inactivity timeout in minutes |
| `DISPLAY` | — | X11 display (required for Xvfb) |
