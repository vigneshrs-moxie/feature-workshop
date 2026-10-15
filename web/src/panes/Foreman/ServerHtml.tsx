// HTML the dashboard rendered from the Foreman's Markdown (replies, briefs, detail files).
//
// Why inserting it is safe: the dashboard renders it with markdown-it in dashboard/lib/markdown.js,
// with `html: false` (raw HTML in the source comes out as text), a link check that drops unsafe
// schemes such as javascript:, and IDs linked only after escaping. The node tests hold it to that
// (test/actions.test.js "renderMarkdown", test/server-v2.test.js "thread and doc HTML"). Only
// strings from those dashboard fields come through here; never pass anything else, and never
// text typed by a person (render that as plain text instead).
export function ServerHtml({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`prose ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}
