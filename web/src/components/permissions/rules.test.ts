// The quick check on an edited "Always allow" rule (rules.ts coverProblem): the folder must be a
// full path that holds the file waiting now, written the Mac way or the Windows way.
import { describe, expect, it } from 'vitest';
import { coverProblem } from './rules';

describe('coverProblem: a folder rule for a file change', () => {
  it('a full path holding the file is fine; a relative one or another folder says why not', () => {
    const input = { file_path: '/r/app/src/a.ts' };
    expect(coverProblem('Edit', 'prefix', '/r/app/src/', input)).toBeNull();
    expect(coverProblem('Edit', 'prefix', 'r/app/src', input)).toMatch(/full path/);
    expect(coverProblem('Edit', 'prefix', '/r/app/other', input)).toMatch(/isn’t inside this folder/);
  });

  it('Windows paths: a drive letter, either slash, any case', () => {
    const input = { file_path: 'C:\\Users\\sam\\app\\src\\a.ts' };
    expect(coverProblem('Edit', 'prefix', 'C:\\Users\\sam\\app\\src', input)).toBeNull();
    expect(coverProblem('Edit', 'prefix', 'c:/users/sam/app', input)).toBeNull();
    expect(coverProblem('Edit', 'prefix', 'C:\\Users\\sam\\other', input)).toMatch(/isn’t inside this folder/);
    expect(coverProblem('Edit', 'prefix', 'Users\\sam', input)).toMatch(/full path/);
  });
});
