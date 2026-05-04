# Terra BarPath

Visual schedule builder for pre-GMP / early-works construction planning.

## Deployment

This repo is configured to deploy on [Railway](https://railway.app):

1. Connect this GitHub repo as a new Railway service
2. Set the environment variable `ANTHROPIC_API_KEY` to your Anthropic API key
3. Railway auto-detects `package.json` and runs `npm start`
4. The server serves `index.html` and proxies chat requests through `/api/chat`

## Structure

- `index.html` — the full Terra BarPath app (single-file HTML)
- `server.js` — minimal Node.js server that serves the HTML and proxies Claude API calls
- `package.json` — Railway build config

## Local development

Not required — make changes directly in GitHub via the web editor and Railway will redeploy automatically on push.
