# Artifact evals

Offline evaluation harnesses for the paper reading assistant. Each eval lives in
its own folder; shared plumbing lives in [`utils.ts`](./utils.ts). Written in
TypeScript and run with `tsx`, so there's no second toolchain — same language as
the app.

```
eval/
  utils.ts          # GenerateClient, MCQ parsing/scoring, HF loader, helpers
  tsconfig.json     # isolates eval from the app's typecheck/build
  elaip/            # ELAIPBench: 403 expert MCQs over 137 AI papers
    run.ts
    results/        # written by run.ts (gitignored)
```

## How evals run

Harnesses call the app's **real generation entrypoint** — `generate()` in
[`src/server/generate.ts`](../src/server/generate.ts) — directly, in-process.
That's the same function `POST /api/generate` calls, so a run measures what we
ship (Artifact's system prompt and `<paper>` wrapping) with **nothing
re-implemented and nothing to drift out of sync** — but without the HTTP route's
proxy auth, session, and per-user rate-limit metering, none of which is part of
the agent. So there's no dev server to start, no login, no limiter to disable:

```bash
npm run eval:elaip -- --limit 10        # smoke test
npm run eval:elaip                       # full 403
```

The only thing the eval needs is an OpenRouter key. It reads `OPENROUTER_API_KEY`
from your environment, and if that's unset it loads the repo-root `.env` as a
fallback (the same file the app uses), so a key kept there just works. A `--api-key`
flag overrides both.

> Why not drive the HTTP endpoint? An earlier version did, to get the "no
> re-implementation" property. But the endpoint drags in the whole web layer —
> the auth proxy (`src/proxy.ts`) rejects any sessionless `/api/*` request with
> `401 Unauthorized` before the route even runs, and the rate limiter meters
> per-user spend. None of that is the agent. Calling `generate()` directly keeps
> the fidelity and drops the scaffolding, with zero eval-awareness in production
> code.

The dataset is pulled on demand from Hugging Face (no local download, no
`datasets` install).

### Flags (ELAIPBench)

| Flag | Default | Meaning |
|------|---------|---------|
| `--api-key` | `OPENROUTER_API_KEY` env, then `.env` | OpenRouter key used for the run |
| `--limit N` | all 403 | Only run the first N questions (smoke test) |
| `--workers N` | 8 | Concurrent `generate()` calls in flight |
| `--out DIR` | `eval/elaip/results` | Output directory |

Outputs: `results.jsonl` (one row per question, including the raw response) and
`summary.json` (overall + per-question-type accuracy, plus unparsed/API-error
counts so a low score can't hide a broken run).

## Adding a new eval

Make `eval/<name>/run.ts`, import what you need from `../utils.ts`, and follow
the ELAIPBench runner's shape: `loadHfJsonl` → `mapConcurrent` over
`GenerateClient` (which wraps `generate()` with retry + truncation) → score →
write `results.jsonl` + `summary.json`. Add an `eval:<name>` script to
`package.json`.

## Scope note

ELAIPBench is an off-the-shelf **comprehension** baseline (does the underlying
model understand the paper). It does not test Artifact's distinctive features —
evidence localization, citation pointing, reading-in-context. Treat it as a
known-quantity sanity check, not a measure of the assistant's contribution.
