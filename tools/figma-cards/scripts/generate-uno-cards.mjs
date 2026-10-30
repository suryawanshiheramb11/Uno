import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { cleanMercyWildArtwork, diagonalReverse } from "./uno-special-art.mjs"
import { sourcePixelArtwork } from "./uno-source-pixels.mjs"

const root = new URL("../public/cards/", import.meta.url)
const check = process.argv.includes("--check")
const actions = JSON.parse(
  await readFile(new URL("../src/card-actions.json", import.meta.url), "utf8"),
)

// Normalized, closed contours: the exported artwork never depends on a font.
const digits = {
  0: "M100 0C31 0 0 54 0 150S31 300 100 300S200 246 200 150S169 0 100 0ZM100 57C130 57 139 91 139 150S130 243 100 243S61 209 61 150S70 57 100 57Z",
  1: "M25 52C59 46 82 29 96 0H150V300H83V80C66 93 45 99 25 101Z",
  2: "M3 88C1 29 39 0 101 0C164 0 199 32 199 85C199 132 165 161 129 191L66 244H200V300H0V246C19 211 51 185 93 150C119 129 138 108 138 86C138 64 124 52 103 52C78 52 64 66 63 92Z",
  3: "M4 77C8 27 44 0 102 0C161 0 195 30 195 78C195 109 178 130 151 141C183 152 200 174 200 211C200 267 161 300 100 300C38 300 1 269 0 214H60C61 238 75 250 100 250C126 250 140 236 140 213C140 187 123 176 94 176H72V125H93C119 125 135 112 135 89C135 65 121 52 100 52C79 52 65 63 63 82Z",
  4: "M111 0H174V181H200V235H174V300H112V235H0V178ZM112 76L49 181H112Z",
  5: "M17 0H190V55H69L62 112C77 104 94 100 112 100C168 100 200 139 200 197C200 262 162 300 99 300C40 300 4 269 0 217H61C64 240 77 251 99 251C125 251 139 232 139 201C139 171 124 153 99 153C80 153 67 162 61 175L7 165Z",
  6: "M194 77H134C131 60 119 50 102 50C74 50 60 78 59 122C73 107 91 99 113 99C166 99 200 137 200 196C200 259 163 300 103 300C33 300 0 250 0 151C0 54 35 0 105 0C155 0 187 27 194 77ZM102 150C76 150 61 169 61 198C61 229 76 248 102 248C126 248 141 230 141 199C141 169 127 150 102 150Z",
  7: "M0 0H200V53C143 114 111 195 102 300H34C44 192 76 113 128 58H0Z",
  8: "M100 0C158 0 193 28 193 75C193 105 179 127 156 140C184 154 200 177 200 212C200 269 163 300 100 300S0 269 0 212C0 177 16 154 44 140C21 127 7 105 7 75C7 28 42 0 100 0ZM100 49C78 49 65 62 65 84S78 119 100 119S135 106 135 84S122 49 100 49ZM100 168C74 168 60 182 60 209S74 250 100 250S140 236 140 209S126 168 100 168Z",
  9: "M6 223H66C69 240 81 250 98 250C126 250 140 222 141 178C127 193 109 201 87 201C34 201 0 163 0 104C0 41 37 0 97 0C167 0 200 50 200 149C200 246 165 300 95 300C45 300 13 273 6 223ZM98 150C124 150 139 131 139 102C139 71 124 52 98 52C74 52 59 70 59 101C59 131 73 150 98 150Z",
}

const letters = {
  U: "M0 0H26V64Q26 82 42 82Q58 82 58 64V0H84V65Q84 104 42 104Q0 104 0 65Z",
  N: "M0 100V0H27L61 58V0H85V100H58L24 42V100Z",
  O: "M45 0C15 0 0 19 0 52S15 104 45 104S90 85 90 52S75 0 45 0ZM45 23C59 23 64 34 64 52S59 81 45 81S26 70 26 52S31 23 45 23Z",
  M: "M0 100V0H30L49 58L68 0H98V100H74V38L57 100H41L24 38V100Z",
  E: "M0 0H72V22H26V39H67V61H26V78H74V100H0Z",
  R: "M0 100V0H47Q80 0 80 32Q80 53 62 61L85 100H55L36 66H26V100ZM26 22V45H43Q54 45 54 33Q54 22 43 22Z",
  C: "M85 32H59Q56 23 44 23Q26 23 26 51Q26 79 44 79Q57 79 60 66H86Q81 103 44 103Q0 103 0 51Q0 0 44 0Q79 0 85 32Z",
  Y: "M0 0H29L48 38L67 0H96L61 64V100H35V64Z",
  S: "M80 29H54Q52 20 40 20Q27 20 27 29Q27 36 47 40Q83 47 83 70Q83 103 42 103Q0 103 0 70H27Q28 82 43 82Q57 82 57 73Q57 66 36 61Q1 53 1 30Q1 0 40 0Q78 0 80 29Z",
  H: "M0 0H26V38H59V0H85V100H59V62H26V100H0Z",
  W: "M0 0H27L39 65L53 0H79L93 65L105 0H132L108 100H79L66 41L53 100H24Z",
  "'": "M0 0H20V18L9 35H0L7 18H0Z",
}

const palettes = JSON.parse(
  await readFile(new URL("../src/card-palette.json", import.meta.url), "utf8"),
)

const path = (d, attributes = "") => `<path d="${d}" ${attributes}/>`
const round = (n) => Number(n.toFixed(2))

function lettering(word) {
  let x = 0
  const shapes = []
  for (const letter of word) {
    if (letter === " ") {
      x += 32
      continue
    }
    const width = { M: 98, W: 132, Y: 96, E: 74, "'": 20, O: 90 }[letter] ?? 85
    shapes.push(`<g transform="translate(${x} 0)">${path(letters[letter])}</g>`)
    x += width + 6
  }
  return { body: shapes.join(""), width: x - 6 }
}

function fittedWord(word, x, y, width, height, attributes = "") {
  const shape = lettering(word)
  return `<g transform="translate(${x} ${y}) scale(${width / shape.width} ${height / 104})" ${attributes}>${shape.body}</g>`
}

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function wear(seed) {
  const random = seeded(seed)
  const light = []
  const dark = []
  for (let i = 0; i < 660; i++) {
    const x = round(random() * 570)
    const y = round(random() * 890)
    const dx = round((random() - 0.5) * 5)
    const dy = round(1 + random() * 7)
    ;(i % 5 ? light : dark).push(`M${x} ${y}l${dx} ${dy}`)
  }
  for (let i = 0; i < 22; i++) {
    const x = round(12 + random() * 545)
    const y = round(random() * 890)
    light.push(
      `M${x} ${y}l${round(random() * 15 - 7)} ${round(random() * 34 + 5)}`,
    )
  }
  return `<g clip-path="url(#card-clip)" fill="none" stroke-linecap="round">
${path(light.join(""), 'stroke="#fff9ed" stroke-width="1.1" opacity=".25"')}
${path(dark.join(""), 'stroke="#151315" stroke-width=".8" opacity=".18"')}
</g>`
}

function defs(color, dark) {
  return `<defs>
<clipPath id="card-clip"><rect width="570" height="890" rx="35"/></clipPath>
<clipPath id="face-clip"><rect x="35" y="36" width="500" height="818" rx="36"/></clipPath>
<linearGradient id="face" x1="0" y1="0" x2="1" y2=".7">
<stop stop-color="${color}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/>
</linearGradient>
</defs>`
}

function glyph(
  number,
  x,
  y,
  width,
  height,
  fill,
  stroke,
  strokeWidth,
  offset = 0,
) {
  const transform = `translate(${x} ${y}) scale(${width / 200} ${height / 300})`
  const style = `fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"`
  return (
    (offset
      ? `<g transform="translate(${-offset} ${offset})"><g transform="${transform}">${path(digits[number], `fill="${stroke}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-rule="evenodd" stroke-linejoin="round"`)}</g></g>`
      : "") + `<g transform="${transform}">${path(digits[number], style)}</g>`
  )
}

function marker(number) {
  if (number === 7) {
    return (
      path(
        "M63 229H152M63 229l13-11M63 229l13 11M152 229l-13-11M152 229l-13 11",
        'fill="none" stroke="#292526" stroke-width="8" stroke-linejoin="round" opacity=".4"',
      ) +
      path(
        "M63 227H152M63 227l13-11M63 227l13 11M152 227l-13-11M152 227l-13 11",
        'fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"',
      )
    )
  }
  if (number === 0) {
    return path(
      "M111 223a17 17 0 1 1-15-5M107 209l5 14-14-1",
      'fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"',
    )
  }
  return ""
}

function index(number, mercy) {
  const numeral = glyph(
    number,
    66,
    67,
    91,
    130,
    "#fff",
    mercy ? "#292526" : "#111",
    mercy ? 10 : 4,
  )
  const rule = mercy ? marker(number) : ""
  const orientation =
    number === 6 || number === 9
      ? path(
          "M70 211H153",
          `stroke="${mercy ? "#fff" : "#fff"}" stroke-width="6"`,
        )
      : ""
  const corner = numeral + rule + orientation
  return `<g>${corner}</g><g transform="rotate(180 285 445)">${corner}</g>`
}

function front(edition, color, number) {
  const mercy = edition === "no-mercy"
  const palette = palettes[color]
  const ink = mercy ? "#242225" : "#fff"
  const face = mercy ? "url(#face)" : palette.classic
  const oval = `<ellipse cx="285" cy="445" rx="${mercy ? 184 : 224}" ry="${
    mercy ? 395 : 430
  }" transform="rotate(31 285 445)" fill="${mercy ? "none" : "#fff"}" stroke="${
    mercy ? "#202022" : "none"
  }" stroke-width="13"/>`
  const large = glyph(
    number,
    178,
    296,
    214,
    300,
    mercy ? "#fff" : palette.classic,
    "#222024",
    mercy ? 16 : 5,
    mercy ? 7 : 6,
  )
  const orientation =
    number === 6 || number === 9
      ? path(
          "M195 624H375",
          `stroke="${mercy ? "#fff" : palette.classic}" stroke-width="12"`,
        )
      : ""
  return wrap(
    `${mercy ? "UNO No Mercy" : "Classic UNO"} ${color} ${number}`,
    defs(palette.mercy, palette.shade) +
      `<rect width="570" height="890" rx="35" fill="${ink}"/>` +
      `<rect x="35" y="36" width="500" height="818" rx="36" fill="${face}"/>` +
      `<g clip-path="url(#face-clip)">${oval}</g>` +
      large +
      orientation +
      index(number, mercy) +
      (mercy
        ? wear(301 + number * 41 + Object.keys(palettes).indexOf(color) * 907)
        : ""),
  )
}

function unoLogo(x, y, width, height) {
  const word = lettering("UNO")
  return `<g transform="translate(${x} ${y}) scale(${width / word.width} ${height / 104}) skewX(-9)" fill-rule="evenodd" stroke-linejoin="round">
<g transform="translate(-3 6)" fill="#171416" stroke="#171416" stroke-width="12">${word.body}</g>
<g fill="#ffe327" stroke="#fff" stroke-width="8" paint-order="stroke fill">${word.body}</g>
<g fill="none" stroke="#171416" stroke-width="1.8">${word.body}</g>
</g>`
}

// Symbols use a shared 300 × 300 coordinate system for centers and indices.
function reverseSymbol() {
  return diagonalReverse(32, 4, 236, 290)
}

function skipSymbol() {
  return (
    '<circle cx="150" cy="150" r="105" fill="none" stroke="currentColor" stroke-width="38"/>' +
    path(
      "M77 223L223 77",
      'fill="none" stroke="currentColor" stroke-width="38"',
    )
  )
}

function cardTile(x, y, color, angle = 0, miniatureBack = false) {
  return `<g transform="translate(${x} ${y}) rotate(${angle} 47 73)">
<rect width="94" height="146" rx="9" fill="${color}" stroke="#222024" stroke-width="7"/>
${
  miniatureBack
    ? '<ellipse cx="47" cy="73" rx="28" ry="66" transform="rotate(27 47 73)" fill="#fff"/>'
    : ""
}
</g>`
}

function drawCards(count, color, mercy) {
  const positions = {
    2: [
      [64, 28],
      [142, 122],
    ],
    4: [
      [131, 0],
      [193, 81],
      [14, 91],
      [77, 162],
    ],
    6: [
      [147, 0],
      [85, 29],
      [211, 78],
      [19, 103],
      [145, 153],
      [80, 190],
    ],
    10: [
      [164, -15],
      [78, 30],
      [213, 45],
      [125, 92],
      [5, 107],
      [177, 144],
      [66, 164],
      [239, 198],
      [119, 230],
      [13, 249],
    ],
  }
  const hues = mercy
    ? ["#167fcb", "#ffd020", "#159244", "#ed262d"]
    : ["#1685d1", "#10a44a", "#f6c915", "#ed1c24"]
  return positions[count]
    .map(([x, y], index) =>
      cardTile(
        x,
        y,
        color ?? hues[index % 4],
        -5,
        count === 10 && (index === 3 || index === 8),
      ),
    )
    .join("")
}

function wildWheel() {
  return `<g transform="rotate(25 150 150)" stroke="#222024" stroke-width="7">
${path("M150 150V18A132 132 0 0 1 282 150Z", 'fill="#ed1c24"')}
${path("M150 150H282A132 132 0 0 1 150 282Z", 'fill="#f6c915"')}
${path("M150 150V282A132 132 0 0 1 18 150Z", 'fill="#10a44a"')}
${path("M150 150H18A132 132 0 0 1 150 18Z", 'fill="#1685d1"')}
</g>`
}

function rouletteFaces() {
  return [
    [105, 8, "#ffd020", -3],
    [21, 78, "#ed262d", -18],
    [171, 87, "#167fcb", 16],
    [105, 155, "#159244", 5],
  ]
    .map(
      ([x, y, color, angle]) =>
        `<g transform="translate(${x} ${y}) rotate(${angle} 55 50)">
${path("M10 0H100Q110 0 110 10V68Q110 78 100 78H77L65 93Q55 108 45 93L33 78H10Q0 78 0 68V10Q0 0 10 0Z", `fill="${color}" stroke="#222024" stroke-width="6"`)}
<g fill="#222024"><ellipse cx="35" cy="28" rx="5" ry="8"/><ellipse cx="75" cy="28" rx="5" ry="8"/></g>
${path("M33 61Q55 40 77 61", 'fill="none" stroke="#222024" stroke-width="6" stroke-linecap="round"')}
</g>`,
    )
    .join("")
}

function actionSymbol(action, ink, mercy) {
  let symbol
  if (action === "reverse") symbol = reverseSymbol()
  else if (action === "skip") symbol = skipSymbol()
  else if (action === "skip-everyone") {
    symbol = path(
      "M245 107A105 105 0 1 0 250 185L212 170A65 65 0 1 1 211 120L177 131L264 157L280 64Z",
    )
  } else if (action === "discard-all") {
    symbol =
      `<g transform="translate(4 42) scale(.77)">
${cardTile(7, 47, "#fff", -28)}${cardTile(58, 24, "#fff", -14)}${cardTile(112, 14, "#fff")}
</g>` +
      path(
        "M102 165Q181 85 250 121L255 80L298 155L220 190L229 153Q172 126 102 165Z",
        'fill="#222024"',
      )
  } else if (action === "wild") symbol = wildWheel()
  else if (action === "wild-color-roulette") symbol = rouletteFaces()
  else {
    const count = {
      "draw-two": 2,
      "draw-four": 4,
      "wild-draw-four": 4,
      "wild-reverse-draw-four": 4,
      "wild-draw-six": 6,
      "wild-draw-ten": 10,
    }[action]
    symbol = drawCards(count, action.startsWith("wild") ? null : ink, mercy)
    if (action === "wild-reverse-draw-four") {
      symbol += `<g transform="translate(70 53) scale(.58)" fill="#fff" stroke="#222024" stroke-width="9" paint-order="stroke fill">${reverseSymbol()}</g>`
    }
  }
  return `<g fill="${ink}" color="${ink}" stroke="#222024" stroke-width="5" stroke-linejoin="round" paint-order="stroke fill">${symbol}</g>`
}

function drawIndex(count, reverse = false) {
  const numeral = String(count)
  const digitWidth = numeral.length === 2 ? 54 : 72
  const plus = path(
    "M67 93H84V76H101V93H118V110H101V127H84V110H67Z",
    'fill="#fff" stroke="#222024" stroke-width="3" paint-order="stroke fill"',
  )
  const digitsMarkup = [...numeral]
    .map((number, index) =>
      glyph(
        number,
        127 + index * (digitWidth + 6),
        63,
        digitWidth,
        102,
        "#fff",
        "#222024",
        9,
      ),
    )
    .join("")
  return (
    (reverse
      ? `<g transform="translate(55 60) scale(.22)" fill="#fff" stroke="#222024" stroke-width="9">${reverseSymbol()}</g>`
      : "") +
    `<g transform="${
      reverse ? "translate(65 0)" : ""
    }">${plus}${digitsMarkup}</g>`
  )
}

function specialFront(edition, color, action) {
  const mercy = edition === "no-mercy"
  const wild = !color
  if (mercy && wild) {
    return wrap(
      `UNO No Mercy ${actions.labels[action]}`,
      cleanMercyWildArtwork(action, { drawIndex }),
    )
  }
  if (!mercy || wild) {
    return wrap(
      `${mercy ? "UNO No Mercy" : "Classic UNO"} ${
        color ? `${color} ` : ""
      }${actions.labels[action]}`,
      sourcePixelArtwork(edition, color, action),
    )
  }
  const palette = palettes[color] ?? { mercy: "#171619", shade: "#0c0b0e" }
  const ink = wild ? "#fff" : mercy ? "#fff" : palette.classic
  const count = {
    "draw-two": 2,
    "draw-four": 4,
    "wild-draw-four": 4,
    "wild-reverse-draw-four": 4,
    "wild-draw-six": 6,
    "wild-draw-ten": 10,
  }[action]
  const symbol = actionSymbol(action, ink, mercy)
  const corner = count
    ? drawIndex(count, action === "wild-reverse-draw-four")
    : `<g transform="translate(57 63) scale(.36)">${actionSymbol(action, "#fff", mercy)}</g>`
  const scale = action === "wild-draw-ten" ? 0.95 : 1.05
  const x = 285 - 150 * scale
  const y = action === "wild-draw-ten" ? 240 : 285
  return wrap(
    `${mercy ? "UNO No Mercy" : "Classic UNO"} ${
      color ? `${color} ` : ""
    }${actions.labels[action]}`,
    defs(palette.mercy, palette.shade) +
      `<rect width="570" height="890" rx="35" fill="${
        mercy ? "#242225" : "#fff"
      }"/>` +
      `<rect x="35" y="36" width="500" height="818" rx="36" fill="${
        wild ? "#171619" : mercy ? "url(#face)" : palette.classic
      }"/>` +
      `<g clip-path="url(#face-clip)"><ellipse cx="285" cy="445" rx="${
        mercy ? 184 : 224
      }" ry="${mercy ? 395 : 430}" transform="rotate(31 285 445)" fill="${
        wild || !mercy ? "#fff" : "none"
      }" stroke="${
        mercy && !wild ? "#202022" : "none"
      }" stroke-width="13"/></g>` +
      `<g transform="translate(${x} ${y}) scale(${scale})">${symbol}</g>` +
      corner +
      `<g transform="rotate(180 285 445)">${corner}</g>` +
      (mercy
        ? wear(
            6000 +
              Object.keys(actions.labels).indexOf(action) * 91 +
              Object.keys(palettes).indexOf(color) * 907,
          )
        : ""),
  )
}

function burst() {
  const random = seeded(280)
  let shapes = ""
  for (let i = 0; i < 76; i++) {
    const angle = (i / 76) * Math.PI * 2
    const tip = 60 + random() * 170
    const x = (r, a) => round(285 + Math.cos(a) * r)
    const y = (r, a) => round(445 + Math.sin(a) * r)
    shapes += path(
      `M${x(tip, angle)} ${y(tip, angle)}Q${x(440, angle - 0.04)} ${y(440, angle - 0.04)} ${x(800, angle - 0.015)} ${y(800, angle - 0.015)}L${x(800, angle + 0.016)} ${y(800, angle + 0.016)}Q${x(430, angle + 0.025)} ${y(430, angle + 0.025)} ${x(tip, angle)} ${y(tip, angle)}Z`,
      `fill="${i % 3 ? "#86141a" : "#ff5e3b"}" opacity="${
        i % 3 ? ".65" : ".45"
      }"`,
    )
  }
  return `<g clip-path="url(#face-clip)">${shapes}</g>`
}

function back(edition) {
  const mercy = edition === "no-mercy"
  let body = defs("#ef222a", "#c40f19")
  body += `<rect width="570" height="890" rx="35" fill="${
    mercy ? "#242225" : "#fff"
  }"/>`
  body += `<rect x="35" y="36" width="500" height="818" rx="36" fill="${
    mercy ? "url(#face)" : "#141315"
  }"/>`
  if (mercy) {
    body += burst()
    body += `<g transform="rotate(-7 285 445)">`
    body += unoLogo(98, 320, 390, 138)
    body += `<path d="M58 489L510 489L505 626L52 626Z" fill="#171416"/>`
    body += fittedWord(
      "SHOW 'EM",
      214,
      470,
      160,
      23,
      'fill="#fff" fill-rule="evenodd"',
    )
    body += fittedWord(
      "NO MERCY",
      76,
      515,
      413,
      82,
      'fill="#fff" fill-rule="evenodd"',
    )
    body += "</g>" + wear(780)
  } else {
    body += `<g clip-path="url(#face-clip)"><ellipse cx="285" cy="445" rx="223" ry="370" transform="rotate(31 285 445)" fill="#e32228"/></g>`
    body += `<g transform="rotate(-22 285 445)">${unoLogo(93, 362, 405, 150)}</g>`
  }
  return wrap(
    `${mercy ? "UNO Show ’Em No Mercy" : "Classic UNO"} card back`,
    body,
  )
}

function wrap(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="57mm" height="89mm" viewBox="0 0 570 890" role="img" aria-labelledby="title">
<title id="title">${title}</title>
${body}
</svg>
`
}

let total = 0
for (const edition of ["classic", "no-mercy"]) {
  const directory = new URL(`${edition}/`, root)
  const assets = { "back.svg": back(edition) }
  for (const color of Object.keys(palettes)) {
    for (let number = 0; number <= 9; number++) {
      assets[`${color}-${number}.svg`] = front(edition, color, number)
    }
    for (const action of actions[edition].colored) {
      assets[`${color}-${action}.svg`] = specialFront(edition, color, action)
    }
  }
  for (const action of actions[edition].wild) {
    assets[`${action}.svg`] = specialFront(edition, null, action)
  }
  if (!check) await mkdir(directory, { recursive: true })
  for (const [name, svg] of Object.entries(assets)) {
    const url = new URL(name, directory)
    if (check) {
      if ((await readFile(url, "utf8")) !== svg)
        throw new Error(`Stale asset: ${fileURLToPath(url)}`)
      if (/<(?:text|script)\b/.test(svg))
        throw new Error(`Nonportable asset: ${name}`)
      for (const [, href] of svg.matchAll(/\b(?:href|xlink:href)="([^"]+)"/g)) {
        if (
          !href.startsWith("#") &&
          !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(href)
        ) {
          throw new Error(`External asset dependency: ${name}`)
        }
      }
      const geometry = svg.replace(
        /data:image\/png;base64,[A-Za-z0-9+/]+=*/g,
        "",
      )
      if (/NaN|undefined/.test(geometry))
        throw new Error(`Invalid geometry: ${name}`)
    } else {
      await writeFile(url, svg)
    }
    total++
  }
  if (
    check &&
    (await readdir(directory)).filter((name) => name.endsWith(".svg"))
      .length !== Object.keys(assets).length
  ) {
    throw new Error(
      `Expected exactly ${Object.keys(assets).length} SVGs in ${edition}`,
    )
  }
}
console.log(
  `${check ? "Verified" : "Generated"} ${total} standalone SVG cards.`,
)
