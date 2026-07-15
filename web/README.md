# stratless-web

**stratless.com** — the front door.

The site for [stratless](https://github.com/stratless-ai/stratless), a local tool that reads your
AI coding assistant's own history and builds it a living model of who you are — so it stops talking
over your head, or under it.

## Run it

```
pnpm install
pnpm dev
```

## What's in here

Nuxt 3, `markdown-it`, and **nothing else**. No modules. The docs renderer is 83 lines
(`lib/docs.ts`), the language switcher is CSS-only, and the whole site is prerendered to static HTML.

Deploys to Cloudflare Pages on push to `main`.
