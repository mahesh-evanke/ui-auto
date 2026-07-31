import * as fs from 'fs';
import { test, expect, ScenarioCache, getFromJsonFile, getFromJsonFileAt, saveJsonFile, fixtureFilePath } from '../src';

/**
 * Proves two things against a real, deeply-nested fixture file
 * (e2e/data/company.json, 6+ levels deep):
 *
 *  1. saveJsonFile() - the "save" counterpart to getFromJsonFile() - writes
 *     ANY value straight to e2e/data/<name>.json, no ScenarioCache required.
 *
 *  2. Every path can be given SHORT, without repeating the root ("company."):
 *     getFromJsonFile('company', 'departments[0].manager.name') resolves the
 *     same as the full 'company.departments[0].manager.name', by matching the
 *     given path as a SUFFIX anywhere in the document. If a short path
 *     genuinely matches more than once, it throws listing every full path
 *     that matched - resolved with getFromJsonFileAt(name, path, occurrence).
 */
test.describe('Deep JSON paths - full vs. short form', () => {
  test('every path from the spec table, in FULL form', () => {
    expect(getFromJsonFile('company', 'company.departments[0]')).toMatchObject({ id: 'DEP-001', name: 'Engineering' });
    expect(getFromJsonFile('company', 'company.departments[0].name')).toBe('Engineering');
    expect(getFromJsonFile('company', 'company.departments[0].manager')).toMatchObject({ id: 'EMP-100', name: 'Rahul Sharma' });
    expect(getFromJsonFile('company', 'company.departments[0].manager.name')).toBe('Rahul Sharma');
    expect(getFromJsonFile('company', 'company.departments[0].teams[0]')).toMatchObject({ id: 'TEAM-001', name: 'Backend' });
    expect(getFromJsonFile('company', 'company.departments[0].teams[0].projects[0]')).toMatchObject({ projectId: 'PROJ-101' });
    expect(getFromJsonFile('company', 'company.departments[0].teams[0].projects[0].members[0]')).toMatchObject({ id: 'EMP-101', name: 'Surya' });
    expect(getFromJsonFile('company', 'company.departments[0].teams[0].projects[0].members[0].tasks[0]')).toMatchObject({ taskId: 'TASK-001' });
    expect(getFromJsonFile('company', 'company.departments[0].teams[0].projects[0].members[0].tasks[0].comments[0]')).toMatchObject({
      user: 'Manager',
    });
    expect(getFromJsonFile('company', 'company.departments[0].teams[0].projects[0].members[0].tasks[0].comments[0].message')).toBe(
      'Good progress',
    );
  });

  test('the SAME paths, SHORT form - no "company." root, no full path to remember', () => {
    // Unique short paths resolve to exactly the same values as the full form above.
    expect(getFromJsonFile('company', 'departments[0]')).toMatchObject({ id: 'DEP-001', name: 'Engineering' });
    expect(getFromJsonFile('company', 'departments[0].name')).toBe('Engineering');
    expect(getFromJsonFile('company', 'departments[0].manager')).toMatchObject({ id: 'EMP-100', name: 'Rahul Sharma' });
    expect(getFromJsonFile('company', 'departments[0].manager.name')).toBe('Rahul Sharma');
    expect(getFromJsonFile('company', 'teams[0]')).toMatchObject({ id: 'TEAM-001', name: 'Backend' }); // only Engineering has a "teams" key at all
    expect(getFromJsonFile('company', 'teams[0].projects[0].members[0].tasks[0]')).toMatchObject({ taskId: 'TASK-001' }); // long enough to be unique
    expect(getFromJsonFile('company', 'tasks[0].comments[0]')).toMatchObject({ user: 'Manager' });
    expect(getFromJsonFile('company', 'tasks[0].comments[0].message')).toBe('Good progress');

    // Deep single-field search still works too - "email" only appears once (the manager's).
    expect(getFromJsonFile('company', 'contact.email')).toBe('rahul@technova.com');
  });

  test('a short path that matches more than once throws, listing every full path - then occurrence picks one', () => {
    // "manager" alone appears under BOTH departments (Engineering + HR).
    expect(() => getFromJsonFile('company', 'manager')).toThrow(/ambiguous.*2 matches/s);
    expect(getFromJsonFileAt<{ name: string }>('company', 'manager', { occurrence: 1 }).name).toBe('Rahul Sharma'); // Engineering's manager
    expect(getFromJsonFileAt<{ name: string }>('company', 'manager', { occurrence: 2 }).name).toBe('Meena'); // HR's manager

    // "projects[0]" appears under BOTH teams (Backend + Frontend).
    expect(() => getFromJsonFile('company', 'projects[0]')).toThrow(/ambiguous.*2 matches/s);
    expect(getFromJsonFileAt<{ name: string }>('company', 'projects[0]', { occurrence: 1 }).name).toBe('Inventory API');
    expect(getFromJsonFileAt<{ name: string }>('company', 'projects[0]', { occurrence: 2 }).name).toBe('Customer Portal');

    // Adding one more segment of context ("teams[0].projects[0]") disambiguates without needing occurrence at all.
    expect(getFromJsonFile('company', 'teams[0].projects[0]')).toMatchObject({ name: 'Inventory API' });
    expect(getFromJsonFile('company', 'teams[1].projects[0]')).toMatchObject({ name: 'Customer Portal' });
  });

  test('ScenarioCache.get() has the exact same short-path fallback - not just the file version', () => {
    const cache = new ScenarioCache();
    cache.set('COMPANY', getFromJsonFile('company'));

    expect(cache.get('COMPANY.departments[0].manager.name')).toBe('Rahul Sharma'); // full path
    expect(cache.get('departments[0].manager.name')).toBe('Rahul Sharma'); // short path, no "COMPANY." prefix at all
    expect(() => cache.get('manager')).toThrow(/ambiguous.*2 matches/s);
    expect(cache.getAt<{ name: string }>('manager', 2).name).toBe('Meena');
  });

  test('saveJsonFile() - the "save" counterpart - writes ANY value to a file, no cache needed', () => {
    const managerOnly = getFromJsonFile('company', 'departments[0].manager');
    const filePath = saveJsonFile('_debug-manager-only', managerOnly);

    try {
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toBe(fixtureFilePath('_debug-manager-only'));

      const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(onDisk).toEqual({ id: 'EMP-100', name: 'Rahul Sharma', contact: { email: 'rahul@technova.com', phone: '+91-9876543210' } });

      // And it's immediately reusable with getFromJsonFile(), by key name.
      expect(getFromJsonFile('_debug-manager-only', 'name')).toBe('Rahul Sharma');
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
