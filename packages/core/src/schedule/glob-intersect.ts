import picomatch from "picomatch";

export class UnsupportedGlob extends Error {
  constructor(message: string) {
    super(message);
  }
}

type CharRange = readonly [number, number];
type Token =
  | { kind: "literal"; char: string }
  | { kind: "star" }
  | { kind: "any" }
  | { kind: "class"; ranges: CharRange[]; negated: boolean };

const SAMPLE_CODES = [
  ...".-_".split("").map((char) => char.charCodeAt(0)),
  ...Array.from({ length: 10 }, (_, index) => 48 + index),
  ...Array.from({ length: 26 }, (_, index) => 65 + index),
  ...Array.from({ length: 26 }, (_, index) => 97 + index),
];

function normalizeGlob(glob: string): string {
  const normalized = glob
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (normalized.length === 0) {
    throw new UnsupportedGlob("empty glob");
  }
  if (normalized.startsWith("!") || /(?:^|[^\\])[!@+*?]\(/.test(normalized)) {
    throw new UnsupportedGlob("extglob/negation is unsupported");
  }
  if (/\{[^}]*\.\.[^}]*\}/.test(normalized)) {
    throw new UnsupportedGlob("brace ranges are unsupported");
  }
  return normalized
    .split("/")
    .filter((segment, index, segments) => segment !== "**" || segments[index - 1] !== "**")
    .join("/");
}

function splitAlternatives(input: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      alternatives.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  alternatives.push(current);
  return alternatives;
}

function expandBraces(glob: string, limit = 64): string[] {
  const start = glob.indexOf("{");
  if (start === -1) return [glob];
  const end = glob.indexOf("}", start + 1);
  if (end === -1) throw new UnsupportedGlob("unclosed brace");

  const before = glob.slice(0, start);
  const body = glob.slice(start + 1, end);
  const after = glob.slice(end + 1);
  const parts = splitAlternatives(body);
  if (parts.length < 2 || parts.some((part) => part.length === 0)) {
    throw new UnsupportedGlob("empty brace alternative");
  }

  const expanded = parts.flatMap((part) => expandBraces(`${before}${part}${after}`, limit));
  if (expanded.length > limit) {
    throw new UnsupportedGlob("too many brace alternatives");
  }
  return expanded;
}

function parseClass(segment: string, start: number): { token: Token; end: number } {
  const end = segment.indexOf("]", start + 1);
  if (end === -1) throw new UnsupportedGlob("unclosed character class");

  let body = segment.slice(start + 1, end);
  const negated = body.startsWith("^");
  if (negated) body = body.slice(1);
  if (body.length === 0) throw new UnsupportedGlob("empty character class");

  const ranges: CharRange[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const current = body[index];
    const next = body[index + 1];
    const rangeEnd = body[index + 2];
    if (current === undefined) continue;
    if (next === "-" && rangeEnd !== undefined) {
      ranges.push([current.charCodeAt(0), rangeEnd.charCodeAt(0)]);
      index += 2;
    } else {
      ranges.push([current.charCodeAt(0), current.charCodeAt(0)]);
    }
  }

  return {
    token: { kind: "class", ranges, negated },
    end,
  };
}

function segmentTokens(segment: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (char === undefined) continue;
    if (char === "*") {
      tokens.push({ kind: "star" });
    } else if (char === "?") {
      tokens.push({ kind: "any" });
    } else if (char === "[") {
      const parsed = parseClass(segment, index);
      tokens.push(parsed.token);
      index = parsed.end;
    } else {
      tokens.push({ kind: "literal", char });
    }
  }
  return tokens;
}

export function globToRegExpSource(glob: string): string {
  return globToRegExp(glob).source;
}

export function globToRegExp(glob: string): RegExp {
  return picomatch.makeRe(normalizeGlob(glob), { dot: true });
}

function tokenAccepts(token: Token, char: string): boolean {
  const code = char.charCodeAt(0);
  if (char === "/") return false;
  if (token.kind === "literal") return token.char === char;
  if (token.kind === "star" || token.kind === "any") return true;
  const inClass = token.ranges.some(([from, to]) => code >= from && code <= to);
  return token.negated ? !inClass : inClass;
}

function sharedChar(a: Token, b: Token): string | null {
  const literalCodes = [a, b]
    .filter((token): token is { kind: "literal"; char: string } => token.kind === "literal")
    .map((token) => token.char.charCodeAt(0));
  const classCodes = [a, b].flatMap((token) =>
    token.kind === "class" ? token.ranges.flatMap(([from, to]) => [from, to]) : [],
  );
  const candidates = [...new Set([...literalCodes, ...classCodes, ...SAMPLE_CODES])]
    .filter((code) => code > 0 && code !== 47)
    .sort((left, right) => left - right);

  for (const code of candidates) {
    const char = String.fromCharCode(code);
    if (tokenAccepts(a, char) && tokenAccepts(b, char)) return char;
  }
  return null;
}

function segmentIntersectionWitness(a: string, b: string): string | null {
  for (const expandedA of expandBraces(a)) {
    for (const expandedB of expandBraces(b)) {
      const witness = tokenIntersectionWitness(
        segmentTokens(expandedA),
        segmentTokens(expandedB),
      );
      if (witness !== null) return witness;
    }
  }
  return null;
}

function tokenIntersectionWitness(a: Token[], b: Token[]): string | null {
  type State = { i: number; j: number; witness: string };
  const queue: State[] = [{ i: 0, j: 0, witness: "" }];
  const seen = new Set<string>();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    if (state === undefined) continue;
    const key = `${state.i}:${state.j}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (state.i === a.length && state.j === b.length) {
      if (state.witness.length > 0) return state.witness;
      const fallback = "a";
      return matchesTokens(a, fallback) && matchesTokens(b, fallback) ? fallback : "";
    }

    const tokenA = a[state.i];
    const tokenB = b[state.j];

    if (tokenA?.kind === "star") {
      queue.push({ i: state.i + 1, j: state.j, witness: state.witness });
    }
    if (tokenB?.kind === "star") {
      queue.push({ i: state.i, j: state.j + 1, witness: state.witness });
    }

    if (tokenA !== undefined && tokenB !== undefined) {
      const char = sharedChar(tokenA, tokenB);
      if (char !== null) {
        queue.push({
          i: tokenA.kind === "star" ? state.i : state.i + 1,
          j: tokenB.kind === "star" ? state.j : state.j + 1,
          witness: `${state.witness}${char}`,
        });
      }
    }
  }

  return null;
}

function matchesTokens(tokens: Token[], value: string): boolean {
  let states = new Set<number>([0]);
  for (const char of value) {
    states = epsilonClose(tokens, states);
    const next = new Set<number>();
    for (const index of states) {
      const token = tokens[index];
      if (token !== undefined && tokenAccepts(token, char)) {
        next.add(token.kind === "star" ? index : index + 1);
      }
    }
    states = next;
  }
  return epsilonClose(tokens, states).has(tokens.length);
}

function epsilonClose(tokens: Token[], states: Set<number>): Set<number> {
  const closed = new Set(states);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of [...closed]) {
      if (tokens[state]?.kind === "star" && !closed.has(state + 1)) {
        closed.add(state + 1);
        changed = true;
      }
    }
  }
  return closed;
}

function isGlobstar(segment: string | undefined): boolean {
  return segment === "**";
}

function exampleForSegment(segment: string): string | null {
  return segmentIntersectionWitness(segment, "*");
}

function expandedSegmentLists(glob: string): string[][] {
  return expandBraces(normalizeGlob(glob)).map((expanded) => expanded.split("/"));
}

const matcherCache = new Map<string, (path: string) => boolean>();

function matcherFor(glob: string): (path: string) => boolean {
  let matcher = matcherCache.get(glob);
  if (matcher === undefined) {
    matcher = picomatch(glob, { dot: true });
    matcherCache.set(glob, matcher);
  }
  return matcher;
}

/**
 * The segment product search is an over-approximating candidate GENERATOR: it
 * proposes concrete paths, but picomatch (the same matcher the runtime hook
 * gate uses) is the single source of truth for whether a candidate really
 * belongs to both globs. This removes any seam between the scheduler and the
 * gate, and sidesteps picomatch's subtle trailing-`**` quirks (e.g.
 * `literal/**` matches the bare parent but `wildcard/**` does not).
 *
 * A verdict of "disjoint" (null) is only returned when the search is exhausted
 * with no picomatch-valid candidate. If the search is truncated by the cap, we
 * stay conservative and report an intersection (over-approximation is safe:
 * it costs parallelism, never correctness).
 */
export function intersectionWitness(a: string, b: string): string | null {
  try {
    const listsA = expandedSegmentLists(a);
    const listsB = expandedSegmentLists(b);
    const matchA = matcherFor(a);
    const matchB = matcherFor(b);
    let conservative: string | null = null;

    for (const segmentsA of listsA) {
      for (const segmentsB of listsB) {
        const { candidates, capped } = collectWitnesses(segmentsA, segmentsB);
        for (const candidate of candidates) {
          if (matchA(candidate) && matchB(candidate)) return candidate;
        }
        if (capped && conservative === null) {
          conservative = candidates[0] ?? "x";
        }
      }
    }

    return conservative;
  } catch (error) {
    if (error instanceof UnsupportedGlob) return conservativeWitness(a, b);
    throw error;
  }
}

function conservativeWitness(a: string, b: string): string {
  return normalizeBestEffort(a).includes("*") ? normalizeBestEffort(b) : normalizeBestEffort(a);
}

function normalizeBestEffort(glob: string): string {
  return glob
    .replaceAll("\\", "/")
    .replace(/[!*?[\]{}()@+]/g, "x")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "") || "x";
}

/** Upper bound on candidate paths generated per glob pair before we stop and
 * fall back to a conservative "intersect" verdict. Real globs have a handful of
 * segments, so this is only a guard against pathological blow-up. */
const CANDIDATE_CAP = 2000;

/**
 * Enumerate concrete candidate paths for a pair of segment lists. Every push
 * strictly increases `i + j` (globstar-skip, globstar-consume, and both-concrete
 * all advance at least one index), so the state space is a finite DAG and the
 * DFS always terminates without needing visited-state pruning. Pruning by
 * `(i, j)` would drop alternative witnesses reaching the same state and could
 * hide a valid path, so it is intentionally omitted.
 */
function collectWitnesses(
  a: string[],
  b: string[],
): { candidates: string[]; capped: boolean } {
  type State = { i: number; j: number; parts: string[] };
  const candidates: string[] = [];
  const stack: State[] = [{ i: 0, j: 0, parts: [] }];
  let capped = false;
  // Two overlapping `**` can span arbitrarily many shared segments; bound the
  // extra depth we explore so both trailing globstars can descend far enough to
  // satisfy picomatch's `wildcard/**` rule without looping forever.
  const maxDepth = a.length + b.length + 2;

  while (stack.length > 0) {
    if (candidates.length >= CANDIDATE_CAP) {
      capped = true;
      break;
    }
    const state = stack.pop();
    if (state === undefined) continue;

    if (state.i === a.length && state.j === b.length) {
      candidates.push(state.parts.length > 0 ? state.parts.join("/") : "x");
      continue;
    }

    const segA = a[state.i];
    const segB = b[state.j];
    const bothGlobstar = isGlobstar(segA) && isGlobstar(segB);

    // Both sides globstar: they can jointly absorb an arbitrary shared segment.
    // Depth-bounded so the DFS still terminates.
    if (bothGlobstar && state.parts.length < maxDepth) {
      stack.push({ i: state.i, j: state.j, parts: [...state.parts, "z"] });
    }

    if (isGlobstar(segA)) {
      stack.push({ i: state.i + 1, j: state.j, parts: state.parts });
      if (segB !== undefined && !isGlobstar(segB)) {
        const example = exampleForSegment(segB);
        if (example !== null) {
          stack.push({ i: state.i, j: state.j + 1, parts: [...state.parts, example] });
        }
      }
    }

    if (isGlobstar(segB)) {
      stack.push({ i: state.i, j: state.j + 1, parts: state.parts });
      if (segA !== undefined && !isGlobstar(segA)) {
        const example = exampleForSegment(segA);
        if (example !== null) {
          stack.push({ i: state.i + 1, j: state.j, parts: [...state.parts, example] });
        }
      }
    }

    if (segA !== undefined && segB !== undefined && !isGlobstar(segA) && !isGlobstar(segB)) {
      const segment = segmentIntersectionWitness(segA, segB);
      if (segment !== null) {
        stack.push({ i: state.i + 1, j: state.j + 1, parts: [...state.parts, segment] });
      }
    }
  }

  return { candidates, capped };
}

export function globsIntersect(a: string, b: string): boolean {
  try {
    return intersectionWitness(a, b) !== null;
  } catch (error) {
    if (error instanceof UnsupportedGlob) return true;
    throw error;
  }
}

export function globSetsIntersect(as: string[], bs: string[]): boolean {
  return as.some((a) => bs.some((b) => globsIntersect(a, b)));
}
