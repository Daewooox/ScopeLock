const SGR_COLOR = {
  "31": "#ff7b72",
  "32": "#7ee787",
  "33": "#e3b341",
  "36": "#79c0ff",
  "2": "#8b949e",
};
const DEFAULT_FILL = "#e6edf3";

export function ansiToSpans(line) {
  const spans = [];
  let fill = DEFAULT_FILL;
  let bold = false;
  let last = 0;
  // Matches SGR escape sequences with or without the leading ESC ()
  // control character: real captured CLI output includes the ESC byte
  // (e.g. "[32m"), while the fixture strings used in tests below omit
  // it and use the literal "[32m" text. Without the optional ? here,
  // the ESC byte from real output would fall outside the match and leak
  // into the preceding text span as a stray control character, which is
  // both invisible in the rendered SVG and illegal in XML 1.0 text content.
  const re = /?\[(\d+)m/g;
  let match;
  const push = (text) => {
    if (text.length > 0) spans.push({ text, fill, bold });
  };
  while ((match = re.exec(line)) !== null) {
    push(line.slice(last, match.index));
    const code = match[1];
    if (code === "0") {
      fill = DEFAULT_FILL;
      bold = false;
    } else if (code === "1") {
      bold = true;
    } else if (SGR_COLOR[code]) {
      fill = SGR_COLOR[code];
    }
    last = re.lastIndex;
  }
  push(line.slice(last));
  return spans;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CANVAS_WIDTH = 960;
const HEADER_HEIGHT = 48;
const TOP_PADDING = 34;
const LINE_HEIGHT = 20;
const PROMPT_HEIGHT = 34;
const BOTTOM_PADDING = 24;
const PENDING_HEIGHT = 34;

function sceneContentLineCount(scene) {
  return scene.human.split("\n").length;
}

function renderLine(x, y, line) {
  const spans = ansiToSpans(line);
  const tspans = spans
    .map((span) => `<tspan fill="${span.fill}"${span.bold ? ' font-weight="700"' : ""}>${escapeXml(span.text)}</tspan>`)
    .join("");
  return `<text class="mono" x="${x}" y="${y}" font-size="13" xml:space="preserve">${tspans}</text>`;
}

export function renderTerminalSvg({ title, description, promptPrefix, scenes }) {
  const totalContentLines = scenes.reduce((sum, scene) => sum + sceneContentLineCount(scene), 0);
  const height = TOP_PADDING + HEADER_HEIGHT
    + scenes.length * (PROMPT_HEIGHT + PENDING_HEIGHT)
    + totalContentLines * LINE_HEIGHT
    + BOTTOM_PADDING;

  const keyframeRules = [];
  const classRules = [];
  let cursorY = HEADER_HEIGHT + TOP_PADDING;
  const groups = [];
  const sceneCount = scenes.length;

  scenes.forEach((scene, index) => {
    const pendingStart = (index / sceneCount) * 100;
    const pendingEnd = pendingStart + 50 / sceneCount;
    const afterStart = pendingEnd;

    classRules.push(`.pending${index}{animation-name:pending${index}}`);
    classRules.push(`.after${index}{animation-name:after${index}}`);
    keyframeRules.push(
      `@keyframes pending${index}{0%,${pendingStart.toFixed(3)}%{opacity:0}${(pendingStart + 0.001).toFixed(3)}%,${pendingEnd.toFixed(3)}%{opacity:1}${(pendingEnd + 0.001).toFixed(3)}%,100%{opacity:0}}`,
    );
    keyframeRules.push(
      `@keyframes after${index}{0%,${(afterStart - 0.001).toFixed(3)}%{opacity:0}${afterStart.toFixed(3)}%,100%{opacity:1}}`,
    );

    const promptY = cursorY;
    groups.push(
      `<text class="mono blue" x="32" y="${promptY}" font-size="14">${escapeXml(promptPrefix)} ${escapeXml(scene.prompt)}</text>`,
    );
    cursorY += PROMPT_HEIGHT;

    const pendingY = cursorY;
    groups.push(
      `<g class="animated pending${index}"><text class="ui muted" x="32" y="${pendingY}" font-size="13">${escapeXml(scene.pendingLabel)}...</text></g>`,
    );

    const afterLines = scene.human.split("\n");
    let lineY = cursorY;
    const afterContent = afterLines.map((line) => {
      lineY += LINE_HEIGHT;
      return renderLine(32, lineY, line);
    }).join("");
    groups.push(`<g class="animated after${index} final">${afterContent}</g>`);

    cursorY = lineY + LINE_HEIGHT;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${height}" viewBox="0 0 ${CANVAS_WIDTH} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <style>
    .ui{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .mono{font-family:SFMono-Regular,Consolas,"Liberation Mono",monospace}
    .text{fill:${DEFAULT_FILL}}.muted{fill:#8b949e}.blue{fill:#79c0ff}
    .animated{opacity:0;animation-duration:8s;animation-timing-function:steps(1,end);animation-iteration-count:infinite}
    ${classRules.join("")}
    ${keyframeRules.join("")}
    @media (prefers-reduced-motion:reduce){.animated{animation:none;opacity:0}.final{opacity:1}}
  </style>
  <rect width="${CANVAS_WIDTH}" height="${height}" rx="12" fill="#0d1117"/>
  <rect width="${CANVAS_WIDTH}" height="${HEADER_HEIGHT}" rx="12" fill="#161b22"/>
  <circle cx="24" cy="24" r="6" fill="#ff5f56"/><circle cx="46" cy="24" r="6" fill="#ffbd2e"/><circle cx="68" cy="24" r="6" fill="#27c93f"/>
  <text class="ui text" x="92" y="30" font-size="15" font-weight="700">${escapeXml(title)}</text>
  ${groups.join("\n  ")}
</svg>`;
}
