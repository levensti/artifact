import type { CSSProperties, ReactNode } from "react";

/**
 * The hero's backdrop: a full-bleed spread of typeset research prose that
 * drifts upward like a paper being scrolled, with passages getting marked in
 * the reader's two highlight colours (warm = note, indigo = thread). Purely
 * decorative, so it's hidden from assistive tech. The copy is written for
 * this page, not quoted from a real paper.
 *
 * Motion is CSS-only (see `.paper-field*` in globals.css): the column stack is
 * rendered twice and translated by -50% for a seamless loop, and each mark
 * sweeps in on its own delay. Reduced motion freezes the drift and shows the
 * marks already drawn.
 */
export function LandingPaperField() {
  return (
    <div aria-hidden className="paper-field">
      <div className="paper-field-clear">
        <div className="paper-field-spread">
          {COLUMNS.map((Column, i) => (
            // Each column drifts on its own track at its own speed, so the
            // loop seam never lines up across columns (and reads as depth).
            <div
              key={i}
              className={`paper-field-track paper-field-track--${i + 1}`}
            >
              <Column />
              <Column />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnOne() {
  return (
    <div>
      <h4>3.1&ensp;Retrieval over the full text</h4>
      <p>
        Prior systems condition on the abstract alone, which discards most of
        what a reader actually asks about. We instead keep{" "}
        <Mark kind="thread" delay={0.4}>
          every section, table, and equation in context
        </Mark>
        , so a question about a single ablation can be answered from the
        ablation itself rather than from a summary of it.
      </p>
      <p>
        Answers are required to cite. Each claim is tied to the span it was
        drawn from, and a citation that cannot be resolved to a span is dropped
        before it reaches the reader.
      </p>
      <h4>3.2&ensp;Anchored threads</h4>
      <p>
        A highlight is more than a bookmark. Selecting a passage opens a thread
        that stays pinned to it, so the conversation about{" "}
        <Mark kind="note" delay={3.2}>
          a definition lives next to the definition
        </Mark>{" "}
        and is still there the next time the page is opened.
      </p>
    </div>
  );
}

function ColumnTwo() {
  return (
    <div>
      <p>
        We evaluate on questions written by readers mid-paper, not after it.
        These questions are short, underspecified, and almost always refer to
        something on the screen: a figure, a symbol, the sentence above.
      </p>
      <h4>4&ensp;Finding what to read next</h4>
      <p>
        Given a topic, an agent searches the literature and the open web, reads
        what it finds, and returns a ranked shortlist.{" "}
        <Mark kind="thread" delay={6}>
          Each pick carries one sentence on why it matters
        </Mark>{" "}
        to the question that was asked, rather than a generic abstract.
      </p>
      <p>
        The shortlist is deliberately small. Five strong papers read closely are
        worth more than fifty skimmed, and the agent is penalised for padding
        the list with near-duplicates.
      </p>
      <p>
        Follow-up questions narrow a shortlist rather than replacing it. The
        agent is given the earlier picks as context and asked to go deeper
        instead of starting over.
      </p>
    </div>
  );
}

function ColumnThree() {
  return (
    <div>
      <h4>4.1&ensp;Reading notes as a record</h4>
      <p>
        Margin notes, threads, and the papers they connect accumulate into a
        record of how an idea was understood.{" "}
        <Mark kind="note" delay={8.8}>
          Sharing a review shares that record
        </Mark>
        : the highlights, the questions, and the answers, exactly where they
        were made.
      </p>
      <p>
        Table 2 reports agreement between cited spans and human annotations.
        Disagreements cluster around figures, where the relevant evidence is
        visual and the surrounding prose only gestures at it.
      </p>
      <h4>5&ensp;Limitations</h4>
      <p>
        Scanned documents without a text layer remain out of reach, and very
        long appendices are retrieved rather than held in full.{" "}
        <Mark kind="thread" delay={11.4}>
          We note where an answer leans on retrieval
        </Mark>{" "}
        so the reader can check the passage directly.
      </p>
    </div>
  );
}

const COLUMNS = [ColumnOne, ColumnTwo, ColumnThree];

function Mark({
  kind,
  delay,
  children,
}: {
  kind: "note" | "thread";
  /// Seconds into the 14s mark cycle at which this passage gets highlighted.
  delay: number;
  children: ReactNode;
}) {
  return (
    <mark
      className={`paper-field-mark paper-field-mark--${kind}`}
      style={{ "--mark-delay": `${delay}s` } as CSSProperties}
    >
      {children}
    </mark>
  );
}
