export function sanitizeHuman(human, repoDir) {
  let result = human.split(repoDir).join(".");
  // `task finish` emits both a JSON drift report and an HTML flight report,
  // both stamped with the real capture time (e.g.
  // ".scopelock/reports/drift-2026-07-21T14-04-44.234Z.json" and the
  // ".html" sibling rendered alongside it). Matching only ".json" left the
  // ".html" path's timestamp unsanitized, which made generated output
  // non-deterministic across runs.
  result = result.replace(
    /\.scopelock\/reports\/drift-[0-9T:-]+\.\d+Z\.(json|html)/g,
    (_match, extension) => `.scopelock/reports/drift-demo.${extension}`,
  );
  return result;
}
