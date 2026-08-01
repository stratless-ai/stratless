# stratless-web

**Get your AI to understand you.**

**stratless.com** — the front door.

The site for [stratless](https://github.com/stratless-ai/stratless), a local tool that reads your
AI coding assistant's own history and writes it a brief on who you are — so it stops talking over
your head, or under it.

## Run it

```
pnpm install
pnpm dev
```

### Before you ship a rendering change

`pnpm dev` serves fonts and CSS from localhost in <5ms, which hides anything that depends on network
timing. Check the real build over a cold, throttled connection instead:

```
pnpm generate      # the static build Cloudflare receives
pnpm preview       # serve .output/public
pnpm check:fonts   # cold browser profile + throttling; the gate CI runs before deploy
```

## What's in here

Nuxt 3, `markdown-it`, and **nothing else**. No modules. The docs renderer is 83 lines
(`lib/docs.ts`), the language switcher is CSS-only, and the whole site is prerendered to static HTML.

Deploys to Cloudflare Pages on push to `main`.
