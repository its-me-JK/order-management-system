import type { MySqlTransactionStatementDefinition } from '../src/mysql-transaction.contract';
import {
  defineMySqlTransactionStatement,
  getMySqlTransactionStatementRegistration,
} from '../src/mysql-transaction.statement';

type Failure = 'conflict' | 'unavailable';
type OneString = readonly [string];

function definition(
  overrides: Partial<MySqlTransactionStatementDefinition<OneString, string, Failure>> = {},
): MySqlTransactionStatementDefinition<OneString, string, Failure> {
  return {
    decode: (value): string => String(value),
    parameterCount: 1,
    text: 'SELECT value FROM records WHERE id = ?',
    ...overrides,
  };
}

describe('defineMySqlTransactionStatement', (): void => {
  it('creates an opaque frozen token and keeps reviewed SQL in the private registry', (): void => {
    const statement = defineMySqlTransactionStatement(definition());
    const registration = getMySqlTransactionStatementRegistration(statement);

    expect(Object.isFrozen(statement)).toBe(true);
    expect(Reflect.ownKeys(statement)).toEqual([]);
    expect(registration.statement).toBe(statement);
    expect(registration.text).toBe('SELECT value FROM records WHERE id = ?');
    expect(registration.parameterCount).toBe(1);
  });

  it('captures the decoder, SQL, and duplicate mappings at definition time', (): void => {
    const duplicateKeyFailures: Record<string, Failure> = {
      'records.uk_records_value': 'conflict',
    };
    const mutableDefinition = {
      decode: (): string => 'captured',
      duplicateKeyFailures,
      parameterCount: 1 as const,
      text: '  INSERT INTO records (value) VALUES (?)  ' as string,
    };
    const statement = defineMySqlTransactionStatement<OneString, string, Failure>(
      mutableDefinition,
    );

    mutableDefinition.text = 'DELETE FROM records';
    mutableDefinition.decode = (): string => 'mutated';
    duplicateKeyFailures['records.uk_records_value'] = 'unavailable';

    const registration = getMySqlTransactionStatementRegistration(statement);

    expect(registration.text).toBe('INSERT INTO records (value) VALUES (?)');
    expect(registration.decode('ignored')).toBe('captured');
    expect(registration.duplicateKeyFailures.get('records.uk_records_value')).toBe('conflict');
  });

  it('counts placeholders lexically and ignores question marks inside reviewed literals', (): void => {
    const statement = defineMySqlTransactionStatement(
      definition({ text: "SELECT '?' AS marker, ? AS value" }),
    );

    expect(getMySqlTransactionStatementRegistration(statement).parameterCount).toBe(1);
  });

  it.each([
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'SET SESSION time_zone = ?',
    'CREATE TABLE records (id INT)',
    'CALL mutate_records(?)',
    'SELECT 1; SELECT 2',
    'SELECT 1 -- comment',
    'SELECT 1 # comment',
    'SELECT /* comment */ 1',
    'SELECT 1\0',
    'SELECT "mode-dependent-quote"',
    "SELECT 'unterminated",
    'SELECT \\ AS mode-dependent-escape',
  ])('rejects SQL outside the single reviewed DML statement subset: %s', (text): void => {
    expect((): unknown => defineMySqlTransactionStatement(definition({ text }))).toThrow(
      'Invalid MySQL transaction statement definition',
    );
  });

  it('rejects mismatched and excessive positional parameter counts', (): void => {
    expect((): unknown =>
      defineMySqlTransactionStatement(definition({ parameterCount: 1, text: 'SELECT 1' })),
    ).toThrow('Invalid MySQL transaction statement definition');

    const text = `SELECT ${Array.from({ length: 65 }, (): string => '?').join(', ')}`;
    expect((): unknown =>
      defineMySqlTransactionStatement({
        decode: (): string => 'unused',
        parameterCount: 65,
        text,
      }),
    ).toThrow('Invalid MySQL transaction statement definition');
  });

  it.each([
    { 'bad name!': 'conflict' },
    { 'records.uk_records_value': '' },
    { 'records.uk_records_value': 7 },
  ])('rejects unsafe duplicate-key mappings', (duplicateKeyFailures): void => {
    expect((): unknown =>
      defineMySqlTransactionStatement(
        definition({ duplicateKeyFailures: duplicateKeyFailures as never }),
      ),
    ).toThrow('Invalid MySQL transaction statement definition');
  });

  it('rejects definitions with accessors, extra keys, or a non-plain prototype', (): void => {
    const accessor = Object.defineProperty({}, 'text', {
      enumerable: true,
      get: (): string => 'SELECT ?',
    });
    Object.assign(accessor, {
      decode: (): string => 'unused',
      parameterCount: 1,
    });

    expect((): unknown => defineMySqlTransactionStatement(accessor as never)).toThrow(
      'Invalid MySQL transaction statement definition',
    );
    expect((): unknown =>
      defineMySqlTransactionStatement({ ...definition(), extra: true } as never),
    ).toThrow('Invalid MySQL transaction statement definition');
    expect((): unknown =>
      defineMySqlTransactionStatement(Object.create(definition()) as never),
    ).toThrow('Invalid MySQL transaction statement definition');
  });

  it('rejects forged and proxied statement identities without inspecting properties', (): void => {
    expect((): unknown => getMySqlTransactionStatementRegistration(Object.freeze({}))).toThrow(
      'Invalid MySQL transaction statement definition',
    );

    const statement = defineMySqlTransactionStatement(definition());
    const proxy = new Proxy(statement, {
      get: (): never => {
        throw new Error('must not inspect token properties');
      },
    });

    expect((): unknown => getMySqlTransactionStatementRegistration(proxy)).toThrow(
      'Invalid MySQL transaction statement definition',
    );
  });
});
