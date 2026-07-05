export const SCOPELOCK_CONTRACT_BEGIN = "<!-- SCOPELOCK CONTRACT BEGIN -->";
export const SCOPELOCK_CONTRACT_END = "<!-- SCOPELOCK CONTRACT END -->";

export function contractSection(section: string): string {
  return `${SCOPELOCK_CONTRACT_BEGIN}\n${section.trim()}\n${SCOPELOCK_CONTRACT_END}`;
}

export function injectContractSection(
  existing: string | null,
  section: string,
): string {
  const block = contractSection(section);
  if (existing === null || existing.length === 0) return `${block}\n`;

  const start = existing.indexOf(SCOPELOCK_CONTRACT_BEGIN);
  const end = existing.indexOf(SCOPELOCK_CONTRACT_END);
  if (start === -1 || end === -1 || end < start) {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${block}\n`;
  }

  const before = existing.slice(0, start);
  const after = existing.slice(end + SCOPELOCK_CONTRACT_END.length);
  return `${before}${block}${after}`;
}
