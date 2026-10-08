export const LIMITS = Object.freeze({ inputBytes: 2 * 1024 * 1024, records: 2000, text: 10000,
  depth: 16, nodes: 100000, cells: 100, terms: 100, lineage: 2000 });

export class InputValidationError extends TypeError {
  constructor(code) {
    super(`Invalid Darkhalo input: ${code}`);
    this.name = 'InputValidationError';
    this.code = code;
  }
}

const fail = code => { throw new InputValidationError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

// Reject accessors, custom prototypes and non-JSON values without invoking toJSON.
export function cloneJson(value, limits = LIMITS) {
  let nodes = 0;
  let budget = 0;
  const seen = new Set();
  const add = size => { budget += size; if (budget > limits.inputBytes) fail('INPUT_TOO_LARGE'); };
  function walk(item, depth) {
    if (++nodes > limits.nodes || depth > limits.depth) fail('STRUCTURE_LIMIT');
    if (item === null || typeof item === 'boolean') { add(item === false ? 5 : 4); return item; }
    if (typeof item === 'string') { add(new TextEncoder().encode(JSON.stringify(item)).length); return item; }
    if (typeof item === 'number' && Number.isFinite(item)) { add(String(item).length); return item; }
    if (typeof item !== 'object' || (!Array.isArray(item) && !plain(item))) fail('NON_JSON_VALUE');
    if (seen.has(item)) fail('CYCLIC_INPUT');
    seen.add(item);
    add(2);
    const array = Array.isArray(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).some(key => typeof key !== 'string')) fail('SYMBOL_KEY');
    const keys = Object.keys(descriptors).filter(key => !(array && key === 'length'));
    if (array && (keys.length !== item.length || keys.some((key, i) => key !== String(i)))) fail('SPARSE_OR_CUSTOM_ARRAY');
    const output = array ? [] : {};
    for (const [index, key] of keys.entries()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) fail('NON_DATA_PROPERTY');
      if (forbidden.has(key)) fail('UNSAFE_KEY');
      add((index ? 1 : 0) + (array ? 0 : new TextEncoder().encode(JSON.stringify(key)).length + 1));
      output[key] = walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
    return output;
  }
  return walk(value, 0);
}

export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

const string = (value, max, code, nonempty = true) => {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) fail(code);
};
const stringArray = (value, max, code) => {
  if (!Array.isArray(value) || value.length > max) fail(code);
  for (const entry of value) string(entry, 512, code);
};
const optionalStrings = ['author', 'signerUuid', 'authorityDigest', 'sourceUrl', 'observedAt', 'status',
  'parentId', 'threadId', 'threadOwner'];
export const ORIGINAL_FIELDS = Object.freeze(['id', 'text', ...optionalStrings, 'upstreamAuthorities', 'derivedFrom']);

function timestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59;
}

export function validateInput(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > LIMITS.inputBytes) fail('INPUT_TOO_LARGE');
    try { input = JSON.parse(input); } catch { fail('MALFORMED_JSON'); }
  }
  const data = cloneJson(input);
  if (!plain(data) || data.version !== 1 || !Array.isArray(data.records)) fail('CONTRACT');
  if (Object.keys(data).some(key => !['version', 'records', 'revokedAuthorities', 'cells'].includes(key))) fail('UNKNOWN_TOP_LEVEL_FIELD');
  if (data.records.length > LIMITS.records) fail('TOO_MANY_RECORDS');
  const ids = new Set();
  for (const record of data.records) {
    if (!plain(record)) fail('RECORD_OBJECT');
    string(record.id, 512, 'RECORD_ID');
    if (ids.has(record.id)) fail('DUPLICATE_RECORD_ID');
    ids.add(record.id);
    string(record.text, LIMITS.text, 'RECORD_TEXT', false);
    for (const key of optionalStrings) {
      if (key in record) string(record[key], key === 'sourceUrl' ? 2048 : 512, 'RECORD_FIELD');
    }
    for (const key of ['id', 'author', 'signerUuid', 'authorityDigest']) {
      if (key in record && record[key] !== record[key].trim()) fail('PADDED_IDENTITY');
    }
    for (const key of ['derivedFrom', 'upstreamAuthorities']) {
      if (key in record) stringArray(record[key], LIMITS.lineage, 'LINEAGE');
      if (record[key]?.some(id => id !== id.trim())) fail('PADDED_IDENTITY');
    }
    if ('observedAt' in record && !timestamp(record.observedAt)) fail('OBSERVED_AT');
    if ('sourceUrl' in record) {
      let url;
      try { url = new URL(record.sourceUrl); } catch { fail('SOURCE_URL'); }
      if (!['http:', 'https:'].includes(url.protocol)) fail('SOURCE_URL');
    }
  }
  if ('revokedAuthorities' in data) {
    stringArray(data.revokedAuthorities, LIMITS.lineage, 'REVOCATIONS');
    if (data.revokedAuthorities.some(id => id !== id.trim())) fail('PADDED_IDENTITY');
  }
  if ('cells' in data) {
    if (!Array.isArray(data.cells) || data.cells.length > LIMITS.cells) fail('CELLS');
    const cellIds = new Set();
    for (const cell of data.cells) {
      if (!plain(cell) || Object.keys(cell).some(key => !['id', 'label', 'terms'].includes(key))) fail('CELL_OBJECT');
      string(cell.id, 512, 'CELL_ID');
      string(cell.label, 512, 'CELL_LABEL');
      stringArray(cell.terms, LIMITS.terms, 'CELL_TERMS');
      if (cell.terms.some(term => term.length > 128)) fail('CELL_TERM_LENGTH');
      if (cellIds.has(cell.id)) fail('DUPLICATE_CELL_ID');
      cellIds.add(cell.id);
    }
  }
  const json = stableJson(data);
  if (new TextEncoder().encode(json).length > LIMITS.inputBytes) fail('INPUT_TOO_LARGE');
  return { data, json };
}
