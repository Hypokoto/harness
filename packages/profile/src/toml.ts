import { TOMLParseError } from './errors.js';

export function parseTOML(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string[] = [];

  const lines = input.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i].trim();

    // Skip empty lines or full-line comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Strip inline comments if not inside string
    line = stripInlineComment(line);
    if (!line) continue;

    // Table header: [section] or [section.subsection]
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionName = line.slice(1, -1).trim();
      if (!sectionName) {
        throw new TOMLParseError('Empty section header', lineNum);
      }
      currentSection = sectionName.split('.').map((s) => s.trim());
      ensurePath(result, currentSection);
      continue;
    }

    // Key-value pair
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      throw new TOMLParseError(`Invalid line (missing '='): ${line}`, lineNum);
    }

    const rawKey = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();

    if (!rawKey) {
      throw new TOMLParseError('Empty key', lineNum);
    }

    const keyPath = rawKey.split('.').map((k) => k.trim());
    const fullPath = [...currentSection, ...keyPath];
    const parsedVal = parseTOMLValue(rawVal, lineNum);

    setPathValue(result, fullPath, parsedVal);
  }

  return result;
}

function stripInlineComment(line: string): string {
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '#' && !inDouble && !inSingle) {
      return line.slice(0, i).trim();
    }
  }

  return line.trim();
}

function parseTOMLValue(valStr: string, lineNum: number): unknown {
  valStr = valStr.trim();

  // Boolean
  if (valStr === 'true') return true;
  if (valStr === 'false') return false;

  // Strings
  if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
    return valStr.slice(1, -1);
  }

  // Arrays
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    const inner = valStr.slice(1, -1).trim();
    if (!inner) return [];

    const elements: string[] = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;
    let nestLevel = 0;

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (char === '"' && !inSingle) inDouble = !inDouble;
      else if (char === "'" && !inDouble) inSingle = !inSingle;
      else if (char === '[' && !inDouble && !inSingle) nestLevel++;
      else if (char === ']' && !inDouble && !inSingle) nestLevel--;

      if (char === ',' && !inDouble && !inSingle && nestLevel === 0) {
        elements.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      elements.push(current.trim());
    }

    return elements.map((elem) => parseTOMLValue(elem, lineNum));
  }

  // Numbers
  if (/^-?\d+$/.test(valStr)) {
    return parseInt(valStr, 10);
  }
  if (/^-?\d+\.\d+$/.test(valStr)) {
    return parseFloat(valStr);
  }

  // Bare string fallback or unquoted string if simple
  if (/^[a-zA-Z0-9_\-\/.]+$/.test(valStr)) {
    return valStr;
  }

  throw new TOMLParseError(`Unable to parse TOML value: ${valStr}`, lineNum);
}

function ensurePath(target: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let curr = target;
  for (const part of path) {
    if (curr[part] === undefined || curr[part] === null || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part] as Record<string, unknown>;
  }
  return curr;
}

function setPathValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  const lastKey = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const parentObj = ensurePath(target, parentPath);
  parentObj[lastKey] = value;
}
