# ElkRidge — BlueBubbles iMessage API Wrapper

Read `docs/AI-CONTEXT.md` for full project context, API reference, architecture, and connection details.

## Quick Reference

- **Live server:** https://bb1.elkbb.dev (Cloudflare Tunnel)
- **BB password:** RedBubble909
- **Wrapper API key:** 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc
- **BB port:** 1235, **Wrapper port:** 3000
- **PM2 process:** bb-tyler-iphone
- **Stack:** Node.js 20, Express 5, TypeScript 5, Zod, pino, socket.io-client

## Wrapper Endpoints

- `POST /send` — send iMessage (Bearer auth)
- `GET /conversations` — list threads (Bearer auth)
- `GET /conversations/:id` — message history (Bearer auth)
- `GET /health` — health check (no auth)

## Commands

- `npm run build` — compile
- `npm test` — run tests
- `pm2 start ecosystem.config.cjs` — start production
- `pm2 logs bb-tyler-iphone` — view logs
