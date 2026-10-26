// The gate card's proof stamp: which commit the test report checked, and whether the branch has
// moved on since (new commits the checks never saw). The commit comes from the test report's
// "commit under test" line, in any of the shapes the tester writes (a table row or a bullet; the
// first commit id after the label, so a base named later on the line isn't taken). Pure.

const SHA = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/;

/** The commit id the test report says it tested, or null. */
export function testedCommit(text) {
  for (const line of String(text ?? '').split('\n')) {
    const at = line.search(/commit under test/i);
    if (at < 0) continue;
    const sha = SHA.exec(line.slice(at + 'commit under test'.length).replace(/^[^|:]*[|:]/, ' '))?.[0];
    if (sha) return sha;
  }
  return null;
}

/**
 * { tested, head, stale, reportAt }: stale when the branch's head is known and isn't the tested
 * commit; null when there's no report or it names no commit.
 */
export function proofStamp({ reportText, reportAt = null, head = null }) {
  const tested = testedCommit(reportText);
  if (!tested) return null;
  const same = head ? head.startsWith(tested) || tested.startsWith(head) : null;
  return { tested, head: head ?? null, stale: same === false, reportAt };
}
