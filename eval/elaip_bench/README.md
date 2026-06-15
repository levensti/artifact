# ELAIPBench

[**ELAIPBench: A Benchmark for Expert-Level Artificial Intelligence Paper
Understanding**](https://arxiv.org/abs/2510.10549) — 403 expert-written
multiple-choice questions over 137 AI papers, built to test whether a model can
_deeply_ comprehend a full-length paper rather than retrieve surface facts. The
questions emphasize non-trivial reasoning, and they're hard: the paper reports
the best LLM at **39.95%** and humans at **48.14%**, so the benchmark is far
from saturated.

Each row is self-contained: it ships the full `paper_content` and embeds the
A–D options inside the `question` text. Scoring is exact-match on the chosen
option letter(s) — single-answer (SA-MCQ) and multi-answer (MA-MCQ, e.g.
`ABC`) — with **no partial credit** (the dataset's own protocol).

## How it runs

The harness feeds each row's `paper_content` as Artifact's `paperContext` and
sends only the question plus an answer-format instruction as the prompt, then
calls the app's real generation entrypoint — `generate()` in
[`src/server/generate.ts`](../../src/server/generate.ts) — **directly,
in-process**. That's the same function `POST /api/generate` calls, so a run
exercises Artifact's actual system prompt and `<paper>` wrapping with nothing
re-implemented and nothing to drift — but without the HTTP route's proxy auth,
session, and per-user rate-limit metering, none of which is part of the agent.

The only thing it needs is an OpenRouter key. It reads `OPENROUTER_API_KEY` from
the environment, falling back to the repo-root `.env` (the same file the app
uses) via `--env-file-if-exists`; a `--api-key` flag overrides both. The dataset
is pulled on demand from Hugging Face — no local download, no `datasets`
install.

## Run it

```bash
npm run eval:elaip_bench -- --limit 10   # smoke test
npm run eval:elaip_bench                  # full 403
```

### Flags

| Flag          | Default                               | Meaning                                     |
| ------------- | ------------------------------------- | ------------------------------------------- |
| `--api-key`   | `OPENROUTER_API_KEY` env, then `.env` | OpenRouter key used for the run             |
| `--limit N`   | all 403                               | Only run the first N questions (smoke test) |
| `--workers N` | 8                                     | Concurrent `generate()` calls in flight     |
| `--out DIR`   | `eval/elaip_bench/results`            | Output directory                            |

Outputs land in `results/` (gitignored): `results.jsonl` (one row per question,
including the raw model response) and `summary.json` (overall + per-question-type
accuracy, plus unparsed/API-error counts so a low score can't quietly hide a
broken run).
