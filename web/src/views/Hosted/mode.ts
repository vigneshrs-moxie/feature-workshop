// Whether this page is the hosted site: hosted/scripts/build.js marks the site's index.html with
// <meta name="dashboard-mode" content="hosted">, so the app opens its hosted screens at once, with
// no request first; /api/meta then says mode 'hosted' too (the API client reads that).
export function hostedPage(doc: Document = document): boolean {
  return doc.querySelector('meta[name="dashboard-mode"]')?.getAttribute('content') === 'hosted';
}
