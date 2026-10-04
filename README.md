# CustomerGPT SDK

[![npm version](https://img.shields.io/npm/v/@customergpt/sdk.svg)](https://www.npmjs.com/package/@customergpt/sdk)
[![License: MIT](https://img.shields.io/npm/l/@customergpt/sdk.svg)](https://github.com/Xursand7777/customergpt-sdk/blob/main/LICENSE)

Official **[CustomerGPT](https://customergpt.ai)** SDK for TypeScript and JavaScript — a typed, zero-dependency client for chatbots, knowledge, conversations, leads, messages and onboarding.

Works in Node.js 18+, Bun, Deno, edge runtimes and anywhere with `fetch`. Keep your API key on the server; never ship it to browsers.

## Install

```bash
npm install @customergpt/sdk
```

## Quick start

```ts
import { CustomerGPT } from '@customergpt/sdk';

const client = new CustomerGPT({ apiKey: process.env.CUSTOMERGPT_API_KEY });

const bot = await client.chatbots.create({ name: 'Support Bot', websiteUrl: 'https://example.com' });

const job = await client.knowledge.addWebsite(bot.id, 'https://example.com', { maxPages: 10 });
await client.jobs.wait(job, { onProgress: (j) => console.log(j.status) });

const answer = await client.messages.send(bot.id, 'What do you offer?');
const snippet = await client.chatbots.installSnippet(bot.id);
```

Create an API key in the [CustomerGPT dashboard](https://dashboard.customergpt.ai). Authenticated calls require a plan with API access.

Train on documents (`.pdf`, `.docx`, `.md`, `.txt`, `.csv`, up to 10 MB):

```ts
import { readFile } from 'node:fs/promises';

const job = await client.knowledge.addFile(bot.id, { name: 'handbook.pdf', data: await readFile('./handbook.pdf') });
await client.jobs.wait(job);
```

`data` can also be a `Blob` or `File`, for example when your server or edge function forwards a user's upload. Keep the call server-side so the API key stays private.

## Try without an account

```ts
const demo = new CustomerGPT();
const job = await demo.onboarding.start('https://example.com');
const ready = await demo.jobs.wait(job);
await demo.onboarding.preview(ready.id, ready.token!, 'What do you sell?');
console.log(ready.previewUrl); // open it to claim the bot
```

Draft tokens are secrets and expire after 24 hours.

## API

| Resource | Methods |
| --- | --- |
| `chatbots` | `list`, `get`, `create`, `update`, `delete`, `installSnippet` |
| `knowledge` | `list`, `addWebsite`, `addLinks`, `addSitemap`, `addFile`, `addText`, `resync`, `delete` |
| `messages` | `send` |
| `conversations` | `list`, `get`, `update` |
| `leads` | `list` |
| `analytics` | `get` |
| `account` | `usage` |
| `jobs` | `get`, `wait` |
| `onboarding` | `start`, `preview`, `claim` |
| `actions` | `list`, `call` — every server action with its JSON schema |

### Changes and dry runs

Methods that change data apply immediately. Pass `{ dryRun: true }` as the last argument to validate without changes:

```ts
await client.knowledge.delete(botId, sourceId, { dryRun: true });
await client.chatbots.delete(botId, { dryRun: true }); // { name, sources, conversations }
```

### Errors

Failures throw `CustomerGPTError` with `code`, `status` and, when helpful, `hint`. `jobs.wait` throws `TRAINING_FAILED` or `WAIT_TIMEOUT` and attaches the last known `job` so you can resume.

```ts
import { CustomerGPTError } from '@customergpt/sdk';

try {
  await client.account.usage();
} catch (error) {
  if (error instanceof CustomerGPTError && error.status === 401) console.error(error.hint);
}
```

## Configuration

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiKey` | `CUSTOMERGPT_API_KEY` | none (anonymous onboarding only) |
| `baseUrl` | `CUSTOMERGPT_API_URL` | `https://api.customergpt.ai` |
| `timeoutMs` | | `180000` per request |
| `fetch` | | `globalThis.fetch` |

## Related

- [`@customergpt/cli`](https://www.npmjs.com/package/@customergpt/cli) — the same API from your terminal and scripts
- [`@customergpt/mcp`](https://www.npmjs.com/package/@customergpt/mcp) — connect AI assistants over MCP

## License

MIT
