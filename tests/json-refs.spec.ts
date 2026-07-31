import * as fs from 'fs';
import { test, expect, getFromJsonFile, resolveRefs, fixtureFilePath } from '../src';

/**
 * e2e/data/company-refs.json is the client's exact example, de-duplicated:
 * "manager" is defined ONCE (company.manager) and every other location
 * (reportingManager, owner, reviewer, accountManager, approvedBy, createdBy)
 * is just {"$ref": "company.manager"} - resolved automatically on load.
 */
test.describe('$ref de-duplication in JSON fixtures', () => {
  test('every referenced location resolves to the single source object', () => {
    const RAHUL = { name: 'Rahul Sharma' };

    expect(getFromJsonFile('company-refs', 'company.manager')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.departments[0].employees[0].reportingManager')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.departments[0].teams[0].projects[0].owner')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.departments[0].teams[0].projects[0].members[0].reviewer')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.clients[0].accountManager')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.audit.approvedBy')).toEqual(RAHUL);
    expect(getFromJsonFile('company-refs', 'company.metadata.createdBy')).toEqual(RAHUL);

    // Short paths work on $ref targets too - same suffix-fallback as get()/getFromJsonFile().
    expect(getFromJsonFile('company-refs', 'reviewer.name')).toBe('Rahul Sharma');
  });

  test('editing the ONE source updates every reference - genuine single source of truth', () => {
    const filePath = fixtureFilePath('company-refs');
    const original = fs.readFileSync(filePath, 'utf8');

    try {
      const edited = JSON.parse(original);
      edited.company.manager.name = 'New Manager';
      fs.writeFileSync(filePath, JSON.stringify(edited, null, 2), 'utf8');

      // getFromJsonFile re-reads the file fresh every call (no caching) - every
      // single one of the 7 locations reflects the edit, from the one change.
      expect(getFromJsonFile('company-refs', 'company.manager.name')).toBe('New Manager');
      expect(getFromJsonFile('company-refs', 'company.departments[0].employees[0].reportingManager.name')).toBe('New Manager');
      expect(getFromJsonFile('company-refs', 'company.departments[0].teams[0].projects[0].owner.name')).toBe('New Manager');
      expect(getFromJsonFile('company-refs', 'company.clients[0].accountManager.name')).toBe('New Manager');
      expect(getFromJsonFile('company-refs', 'company.audit.approvedBy.name')).toBe('New Manager');
      expect(getFromJsonFile('company-refs', 'company.metadata.createdBy.name')).toBe('New Manager');
    } finally {
      fs.writeFileSync(filePath, original, 'utf8'); // restore the checked-in fixture
    }
  });

  test('a circular $ref is detected and throws a clear error, not an infinite loop', () => {
    const cyclic = {
      a: { $ref: 'b' },
      b: { $ref: 'a' },
    };
    expect(() => resolveRefs(cyclic)).toThrow(/Circular \$ref/);
  });

  test('an unresolvable $ref throws a clear error', () => {
    const broken = { thing: { $ref: 'this.path.does.not.exist' } };
    expect(() => resolveRefs(broken)).toThrow(/No field named "this\.path\.does\.not\.exist"|No value|ambiguous/i);
  });
});
