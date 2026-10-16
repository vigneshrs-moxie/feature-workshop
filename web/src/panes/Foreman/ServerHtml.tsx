// HTML the dashboard rendered from Markdown: replies, briefs, detail files, the Docs tab's documents
// (GET /api/job/:slug/doc), the notes Preview (POST /api/job/:slug/render) and a Markdown file a
// permission card shows (plain.previewHtml). Styled by `.prose` in app/app.css.
//
// Why inserting it is safe: the dashboard renders it with markdown-it in dashboard/lib/markdown.js,
// with `html: false` (raw HTML in the source comes out as text), a link check that drops unsafe
// schemes such as javascript:, and IDs linked only after escaping; JSON documents come escaped in a
// <pre> (lib/docs.js jsonHtml). The node tests hold it to that (test/actions.test.js
// "renderMarkdown", test/server-v2.test.js "thread and doc HTML", test/docs.test.js). Only strings
// from those dashboard fields come through here; never pass anything else. Text a person types is
// shown as plain text, or sent to the dashboard's renderer first (the notes Preview).
export function ServerHtml({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`prose ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}
