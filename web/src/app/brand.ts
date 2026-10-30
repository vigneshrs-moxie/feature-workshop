// The product's name, in one place: Starbase (decision G36). The top bar, the page titles, the
// help text that names the product and both index.html files take it from here (brand.test.ts
// checks the index files carry it), so a change of name is a change to this file and those two
// <title> lines.

export const BRAND = {
  /** The name, as the top bar and the page titles show it. */
  name: 'Starbase',
  /** What the mark in the top bar says to a screen reader. */
  markLabel: 'Starbase, back to Jobs',
} as const;

/** The browser tab's title for a page: "Jobs · Starbase", or the name alone. */
export function pageTitle(page?: string | null): string {
  return page ? `${page} · ${BRAND.name}` : BRAND.name;
}
