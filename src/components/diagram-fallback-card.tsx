/**
 * Friendly card shown when a diagram or chart can't be drawn: a one-line
 * message with the source tucked behind a collapsed disclosure, instead of
 * dumping raw markup at the reader.
 */
export default function DiagramFallbackCard({
  kind,
  source,
}: {
  kind: "diagram" | "chart";
  source: string;
}) {
  return (
    <div className="diagram-fallback-card">
      <p className="diagram-fallback-message">
        Couldn&rsquo;t draw this {kind}.
      </p>
      <details>
        <summary>Show source</summary>
        <pre className="diagram-fallback-source">
          <code>{source}</code>
        </pre>
      </details>
    </div>
  );
}
