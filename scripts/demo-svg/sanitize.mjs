export function sanitizeHuman(human, repoDir) {
  let result = human.split(repoDir).join(".");
  result = result.replace(
    /\.scopelock\/reports\/drift-[0-9T:-]+\.\d+Z\.json/g,
    ".scopelock/reports/drift-demo.json",
  );
  return result;
}
