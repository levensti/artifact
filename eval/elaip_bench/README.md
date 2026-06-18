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
runs the app's **full reading agent** — `runReadingAgent()` in
[`src/server/reading-agent.ts`](../../src/server/reading-agent.ts) — **directly,
in-process**. That's the same tool-using ReAct loop the `/api/chat` reading
surface runs, so a run exercises the whole harness a user actually talks to (the
real system prompt, `<paper>` wrapping, and tools) with nothing re-implemented
and nothing to drift — but without the HTTP route's proxy auth, session,
transcript persistence, and per-user rate-limit metering, none of which is part
of the agent. The scored answer is the exact text the agent produced, assembled
with the same `stepsToContent` logic the app persists and renders.

Because it's the real agent, the model may call `arxiv_search` / `web_search`
mid-answer: **a full run makes real network calls beyond the model itself**, and
with no Exa key `web_search` returns its configure-key sentinel (the same thing a
user without a key sees). To measure just the model + prompt without the loop,
swap `ReadingAgentClient` for `GenerateClient` in `run.ts` (the bare
[`generate()`](../../src/server/generate.ts) entrypoint).

The only thing it needs is an OpenRouter key. It reads `OPENROUTER_API_KEY` from
the environment, falling back to the repo-root `.env` (the same file the app
uses) via `--env-file-if-exists`; a `--api-key` flag overrides both. The dataset
is pulled on demand from Hugging Face — no local download, no `datasets`
install.

## Run it

```bash
npm run eval:elaip_bench -- --config default
```

Each run reads a YAML config from [`config/`](./config):

```yaml
experiment_name: deepseek-v4-flash
model: deepseek/deepseek-v4-flash
limit: all
num_workers: 8
```

`experiment_name` determines the output folder under `results/`, so the default
config writes to `results/deepseek-v4-flash/`. `model` is the OpenRouter model
ID sent upstream. `limit` is optional (`all` runs the full 403 questions), and
`num_workers` controls concurrency.

### Flags

| Flag              | Default                               | Meaning                                      |
| ----------------- | ------------------------------------- | -------------------------------------------- |
| `--config NAME`   | `default`                             | Config file in `config/`, or a YAML path     |
| `--api-key`       | `OPENROUTER_API_KEY` env, then `.env` | OpenRouter key used for the run              |
| `--limit N`       | config `limit`                        | Override how many questions to run           |
| `--workers N`     | config `num_workers`                  | Override concurrent agent runs in flight     |
| `--num-workers N` | config `num_workers`                  | Alias for `--workers`                        |
| `--out DIR`       | `results/<experiment_name>`           | Override output directory                    |

Outputs land in `results/` (gitignored): `results.jsonl` (one row per question,
including the raw model response) and `summary.json` (overall + per-question-type
accuracy, plus unparsed/API-error counts so a low score can't quietly hide a
broken run).
