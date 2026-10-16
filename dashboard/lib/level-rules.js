// The rules that suggest a level (L0–L3) for a job without asking a model: scan the description,
// and once a worktree exists the paths `git diff --numstat` reports, for risk triggers. A trigger
// sets a floor the suggestion never goes under; with none, size words in the description decide.
//
// Pure (no Node built-ins), so the new UI imports this very file (web/src/lib/levels.ts, typed by
// level-rules.d.ts) and suggests a level as you type the New job description, with the same rules
// the dashboard uses: the two never drift. lib/levels.js re-exports it next to changedPaths.

// "Add a column", "a new table": a database change only when the description also says database,
// migration, schema or SQL; a column can just as well be one in a list on a page.
const TABLE_OR_COLUMN = /\b(add|adds|adding|new|drop|drops|dropping|rename|renames|renaming)\b[^.;\n]{0,30}?\b(tables?|columns?)\b/i;
const DB_CONTEXT = /\b(db|database|databases|migrations?|schema|schemas|sql)\b/i;

/**
 * Risk triggers and the lowest level each allows.
 * KEEP IN STEP with the /feature skill's level-floor rule (job-options.md, "Levels" in
 * claude-feature-workflow): same triggers, same floors. Change one, change the other.
 *   text: matched against the job's description. withContext (optional): also a match when the
 *   description has both `phrase` and `context`. path: matched against each changed file path.
 */
export const RISK_TRIGGERS = [
  {
    id: 'migrations', label: 'database migrations', floor: 3,
    text: /\bmigrat(e|es|ed|ing|ion|ions)\b|\bschema change|\balter table\b|\b(db|database|sql) (tables?|columns?)\b/i,
    withContext: { phrase: TABLE_OR_COLUMN, context: DB_CONTEXT },
    path: /(^|\/)(migrations?|migrate)\/|migration/i,
  },
  {
    id: 'auth', label: 'sign-in, roles or permissions', floor: 3,
    text: /\bauth(entication|entication's|orization|orisation|z|n)?\b|\bsign[- ]?(in|on|up)s?\b|\blog[- ]?ins?\b|\b(sso|oauth|rbac)\b|\broles?\b|\bpermissions?\b|\baccess control\b/i,
    path: /(^|\/)[^/]*(auth(?!or)|signin|sign-in|login|permission|roles?\b|rbac)[^/]*(\/|$)/i,
  },
  {
    id: 'scope', label: 'data scoping (getScope, scopeWhere)', floor: 3,
    text: /\bgetScope\b|\bscopeWhere\b|\b(data|row|record|office|branch|user|access)[- ]scop(e|es|ed|ing)\b|\bscop(ed|ing) (to|by)\b/i,
    // "scope" as a word or name part (lib/scope.ts, getScope.ts, scope_where.js), not inside a word (telescope.svg).
    path: /(?:^|[^A-Za-z])[Ss]cop(?:e|es|ed|ing)(?![a-z])|[a-z]Scop(?:e|es|ed|ing)(?![a-z])/,
  },
  {
    id: 'office-visibility', label: 'office visibility (entity_branches)', floor: 2,
    text: /\bentity_branches\b|\boffice (visibility|access)\b|\bwhich offices?\b|\bbranch(es)? visibility\b/i,
    path: /entity[_-]?branches/i,
  },
  {
    id: 'people', label: 'people or profile queries', floor: 2,
    text: /\bpeople\b|\bprofiles?\b|\bpersons?\b|\buser (list|lookup|search|query|queries|records?|details)\b/i,
    path: /(^|\/)[^/]*(people|person|profile)[^/]*(\/|$)/i,
  },
  {
    id: 'email', label: 'sending email or notifications', floor: 2,
    text: /\be-?mails?\b|\bnotifications?\b|\bnotify\b|\bsms\b|\btext messages?\b/i,
    path: /(^|\/)[^/]*(e-?mail|mailer|notif)[^/]*(\/|$)/i,
  },
  {
    id: 'shared-config', label: 'shared config', floor: 2,
    text: /\bshared config\b|\bconfig(uration)? files?\b|\benv(ironment)? var(iable)?s?\b|\.env\b|\bfeature flags?\b|\bsettings file\b/i,
    path: /(^|\/)(\.env[^/]*|config\/[^/]+|[^/]+\.config\.(js|cjs|mjs|ts|json)|package\.json|tsconfig[^/]*\.json)$/i,
  },
];

// Size words: a change this small is a tweak (L0) when the description is short.
const TWEAK_WORDS = /\b(typos?|spelling|wording|rename[ds]?|renaming|colou?rs?|tweaks?|padding|margins?|spacing|font( size)?|copy (change|edit|fix|tweak|update)s?|(change|fix|update) the (copy|text|label)|button (text|label))\b/i;
// Words that say it is more than one small change.
const BIG_WORDS = /\b(refactor\w*|redesign\w*|rewrite|overhaul|new (page|screen|feature|report|workflow|module|service)|integrat\w+|across|every (page|screen)|end[- ]to[- ]end|import|export)\b/i;
// Joins that usually mean several changes in one description.
const SEVERAL = /\band (also )?(add|change|make|update|fix|remove|show|let)\b|;|\balso\b|\bplus\b|\bthen\b/i;

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const says = (t, text) => t.text.test(text) || Boolean(t.withContext && t.withContext.phrase.test(text) && t.withContext.context.test(text));

/**
 * Suggest a level from the description and, when there is one, the list of changed paths.
 * Returns { level, floor, reasons, floorReasons, triggers }: floor is the lowest level the risk
 * rules allow (0: none applies); reasons are plain sentences for the page (the risk ones, then one
 * about the size); floorReasons only the ones that set the floor; triggers the ids of RISK_TRIGGERS
 * that fired. "Add a column" or "a new table" without any word about the database is not a
 * migration trigger, but sets a floor of L2 in case it changes stored data.
 */
export function suggestLevel({ description = '', paths = [] } = {}) {
  const text = String(description ?? '');
  const files = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p);
  const reasons = [];
  const triggers = [];
  let floor = 0;
  for (const t of RISK_TRIGGERS) {
    const said = says(t, text);
    const touched = files.filter((p) => t.path.test(p));
    if (!said && !touched.length) continue;
    triggers.push(t.id);
    floor = Math.max(floor, t.floor);
    const where = [said ? 'the description mentions it' : null, touched.length ? `changes ${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` and ${touched.length - 3} more` : ''}` : null].filter(Boolean).join('; ');
    reasons.push(`Touches ${t.label} (${where}), so at least L${t.floor}.`);
  }
  if (!triggers.includes('migrations') && TABLE_OR_COLUMN.test(text)) {
    floor = Math.max(floor, 2);
    reasons.push('Mentions a new or changed table or column, which may change stored data, so at least L2.');
  }
  const floorReasons = [...reasons];

  // The size of the change, from the description (and how many files the branch already changes).
  const words = wordCount(text);
  let size;
  let why;
  if (BIG_WORDS.test(text) || words > 30) { size = 2; why = 'it sounds like more than one small change'; }
  else if (TWEAK_WORDS.test(text) && words <= 25 && !SEVERAL.test(text)) { size = 0; why = 'a small tweak (wording, a rename, a colour)'; }
  else if (words <= 20 && !SEVERAL.test(text)) { size = 1; why = 'a short single change'; }
  else { size = 2; why = 'not obviously a one-line change'; }
  if (files.length > 15 && size < 2) { size = 2; why = `already ${files.length} files changed`; }

  const level = Math.max(floor, size);
  // Never contradict the level: when a floor raises it, the size is only what it would be otherwise.
  reasons.push(level > size ? `Otherwise ${why} (L${size}).` : `${why[0].toUpperCase()}${why.slice(1)}, so L${size}.`);
  return { level, floor, reasons, floorReasons, triggers };
}
