# Knowledge Base Schema

This file is read by the wiki ingest pipeline on every run. Edit it to
shape how the background agent builds and maintains your knowledge base.
No code changes or rebuilds required.

## Page types

| Type      | Use for                                           |
|-----------|---------------------------------------------------|
| `paper`   | A specific paper (summary, contributions, limits) |
| `concept` | A general idea or theoretical construct           |
| `method`  | A technique, algorithm, or training recipe        |
| `entity`  | A specific model, dataset, benchmark, or lab      |

## Tone & depth

- Write for a reader who is technically literate but new to *this*
  subtopic. Assume grad-student-level ML background.
- Prefer plain prose over heavy bullet lists. One diagram / equation per
  section if it clarifies.
- Length target: **150–400 words** per page. Pages that grow past 600
  words should be split into sub-pages and cross-referenced.

## Cross-references

- Link other pages with `[[slug]]` (double square brackets). Slugs are
  lowercase, hyphenated, stable across runs.
- Liberal cross-references are preferred to isolated pages. When in
  doubt, link.
- If you introduce a new concept that *should* have its own page but
  isn't in the existing-pages list yet, still reference it as
  `[[slug]]` — later ingests will pick up the dangling reference and
  create the page.

## Update vs. create

- When the paper adds to an existing page, **update** it by setting
  `update: true` and emitting the full rewritten content. Never paste
  "From: PaperTitle" section headers — merge the insight into the
  existing prose naturally.
- Only create a NEW page when no suitable existing page covers the
  concept.

## Provenance

- Each page that is created or updated from a paper should include a
  short `passage` (≤180 chars): an exact quote from the paper that
  motivates the change. This becomes the "Why was this added?"
  disclosure in the UI.

## What NOT to create pages for

- Throwaway implementation details (specific hyperparameters, exact
  table numbers). These belong on the paper page itself.
- Restatements of user chat turns — the knowledge base is for
  cross-paper knowledge, not a chat log.
- Trivially short content (< 100 words).

## Slug conventions

- Concepts: `attention-mechanism`, `rotary-position-encoding`
- Methods: `flash-attention`, `speculative-decoding`
- Entities: `llama-3`, `imagenet`, `deepmind`
- Papers: use a short distinctive slug based on the paper title
  (`gpt4-technical-report`), *not* the arXiv id.

## Contradictions

- If a new paper contradicts an existing page, update the page to
  present both views with citations. Don't silently overwrite.
