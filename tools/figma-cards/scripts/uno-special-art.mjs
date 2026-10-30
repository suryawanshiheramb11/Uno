import { readFile } from "node:fs/promises"

const shapes = JSON.parse(
  await readFile(new URL("./uno-special-shapes.json", import.meta.url), "utf8"),
)

const path = (d, attributes = "") => `<path d="${d}" ${attributes}/>`
const colors = {
  red: "#ce302c",
  yellow: "#e6d146",
  green: "#569346",
  blue: "#2c639e",
}

function traced(shape, x, y, width, height) {
  return `<g transform="translate(${x} ${y}) scale(${width / shape.width} ${height / shape.height})" fill-rule="evenodd">
${shape.black ? path(shape.black, 'fill="#050505"') : ""}
${path(shape.white, 'fill="#fff"')}
</g>`
}

export function diagonalReverse(x = 0, y = 0, width = 300, height = 365) {
  return traced(shapes.reverse, x, y, width, height)
}

function skip(x, y, size, fill) {
  const shape = shapes.skip
  return `<g transform="translate(${x} ${y}) scale(${size / shape.width} ${size / shape.height})" fill-rule="evenodd">
${path(shape.black, 'fill="#050505"')}
${path(shape.ink, `fill="${fill}"`)}
</g>`
}

function tile(x, y, width, height, color, miniatureBack = false) {
  return `<g data-role="tile" transform="translate(${x} ${y})">
<rect x="-13" y="14" width="${width}" height="${height}" rx="10" fill="#000"/>
<rect width="${width}" height="${height}" rx="10" fill="${color}" stroke="#000" stroke-width="6"/>
${
  miniatureBack
    ? `<rect x="7" y="8" width="${width - 14}" height="${height - 16}" rx="3" fill="#151515" stroke="#fff" stroke-width="4"/>
<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.25}" ry="${height * 0.43}" transform="rotate(29 ${width / 2} ${height / 2})" fill="#fff"/>`
    : ""
}
</g>`
}

function opposite(corner) {
  return corner + `<g transform="rotate(180 285 445)">${corner}</g>`
}

function ellipse(fill, stroke, rx = 224, ry = 430, angle = 31, width = 13) {
  return `<g clip-path="url(#face-clip)"><ellipse cx="285" cy="445" rx="${rx}" ry="${ry}" transform="rotate(${angle} 285 445)" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/></g>`
}

function background(fill, inset = 35) {
  return `<rect width="570" height="890" rx="35" fill="#fff"/>
<rect x="${inset}" y="${inset}" width="${570 - inset * 2}" height="${890 - inset * 2}" rx="35" fill="${fill}"/>`
}

function wheel(cx, cy, rx, ry, angle, id) {
  return `<defs><clipPath id="${id}"><ellipse rx="${rx}" ry="${ry}"/></clipPath></defs>
<g transform="translate(${cx} ${cy}) rotate(${angle})">
<g clip-path="url(#${id})">
<path d="M0 0H-${rx}V-${ry}H0Z" fill="#b72e32"/>
<path d="M0 0V-${ry}H${rx}V0Z" fill="#2a68a7"/>
<path d="M0 0V${ry}H-${rx}V0Z" fill="#e4ce45"/>
<path d="M0 0H${rx}V${ry}H0Z" fill="#7baf3e"/>
</g>
<ellipse rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="${
    rx > 100 ? 12 : 6
  }"/>
</g>`
}

function classicWild() {
  const letters = shapes.wildLetters
  const contours = ["red", "blue", "yellow", "green"]
    .map((color) => path(letters[color], `fill="${colors[color]}"`))
    .join("")
  const outline = ["red", "blue", "yellow", "green"]
    .map((color) => path(letters[color], 'fill="#050505"'))
    .join("")
  return (
    background("#171616") +
    wheel(285, 445, 182, 399, 31, "wild-oval") +
    `<g transform="translate(23 252) scale(.91 .86)" fill-rule="evenodd" stroke-linejoin="miter">
<g transform="translate(-14 37)" stroke="#fff" stroke-width="51">${outline}</g>
<g stroke="#fff" stroke-width="51">${outline}</g>
<g transform="translate(-14 37)" stroke="#050505" stroke-width="39">${outline}</g>
<g stroke="#050505" stroke-width="39">${outline}</g>
<g stroke="#fff" stroke-width="7" paint-order="stroke fill">${contours}</g>
</g>` +
    wheel(113, 151, 37, 76, 25, "wild-corner-top") +
    wheel(457, 739, 37, 76, 205, "wild-corner-bottom")
  )
}

function classicDrawFour() {
  return (
    background("#211f20") +
    ellipse("#fff", "none", 184, 395, 31) +
    tile(329, 220, 114, 193, colors.yellow) +
    tile(109, 434, 114, 193, colors.green) +
    tile(190, 291, 114, 193, colors.blue) +
    tile(255, 364, 114, 193, colors.red) +
    opposite(traced(shapes.plusFour, 54, 66, 172, 121))
  )
}

function classicColored(color, action, palettes) {
  const ink =
    color === "yellow"
      ? action === "skip"
        ? "#f8ce46"
        : "#e6d146"
      : palettes[color].classic
  if (action === "skip") {
    return (
      background(ink) +
      ellipse("#fff", "none", 221, 371, 43) +
      skip(151, 307, 268, ink) +
      opposite(skip(55, 59, 70, "#fff"))
    )
  }
  if (action === "reverse") {
    return (
      background(ink) +
      ellipse("none", "#fff", 220, 419, 33, 17) +
      diagonalReverse(148, 282, 274, 336) +
      opposite(diagonalReverse(59, 61, 125, 153))
    )
  }
  return (
    background(ink) +
    ellipse("none", "#fff", 211, 397, 33, 17) +
    tile(269, 301, 122, 204, "#fff") +
    tile(204, 408, 122, 204, "#fff") +
    opposite(traced(shapes.plusTwo, 46, 62, 166, 143))
  )
}

function mercyGradients() {
  return `<defs>${[
    ["red", "#f23a2b", "#c51a20"],
    ["yellow", "#ffe446", "#e4b91b"],
    ["blue", "#2399e1", "#1a4c9c"],
    ["green", "#55ad33", "#247c27"],
  ]
    .map(
      ([name, light, dark]) =>
        `<radialGradient id="tile-${name}" cx=".5" cy=".45" r=".8"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`,
    )
    .join("")}</defs>`
}

function mercyTiles(action) {
  const t = (x, y, color, width = 122, height = 209) =>
    tile(
      x,
      y,
      width,
      height,
      color === "back" ? "#fff" : `url(#tile-${color})`,
      color === "back",
    )
  if (action === "wild-reverse-draw-four") {
    return (
      t(99, 444, "green") +
      t(344, 214, "yellow") +
      t(183, 288, "blue") +
      t(269, 396, "red") +
      cleanReverse(155, 277, 253, 310)
    )
  }
  if (action === "wild-draw-six") {
    return (
      t(279, 435, "green") +
      t(365, 241, "red") +
      t(280, 160, "blue") +
      t(193, 241, "yellow") +
      t(108, 398, "red") +
      t(191, 493, "blue")
    )
  }
  return [
    [315, 117, "yellow"],
    [164, 189, "blue"],
    [383, 197, "green"],
    [235, 263, "back"],
    [84, 342, "yellow"],
    [315, 352, "blue"],
    [164, 425, "green"],
    [387, 427, "red"],
    [84, 573, "red"],
    [237, 504, "back"],
  ]
    .map(([x, y, color]) => t(x, y, color, 116, 195))
    .join("")
}

function faces() {
  return [
    [97, 0, "yellow", 10],
    [27, 79, "red", -12],
    [166, 87, "blue", 10],
    [101, 163, "green", -5],
  ]
    .map(
      ([x, y, color, angle]) =>
        `<g data-role="face" transform="translate(${x} ${y}) rotate(${angle} 59 45)">
${path("M14 0H104Q118 0 118 14V65Q118 88 99 89Q92 88 87 84Q76 79 70 90Q59 106 47 90Q41 80 30 85Q5 98 0 75V14Q0 0 14 0Z", `fill="url(#tile-${color})" stroke="#161311" stroke-width="4"`)}
<g fill="#111"><ellipse cx="44" cy="29" rx="4.4" ry="6"/><ellipse cx="72" cy="29" rx="4.4" ry="6"/></g>
${path("M34 66Q57 37 82 66", 'fill="none" stroke="#111" stroke-width="5" stroke-linecap="round"')}
</g>`,
    )
    .join("")
}

function cleanReverse(x, y, width, height) {
  return `<g transform="translate(${x} ${y}) scale(${width / 360} ${height / 440})">
${path("M184 8H349Q354 8 352 24L327 172Q325 182 308 193Q296 202 281 198L265 184C286 216 283 253 265 280C249 302 213 333 183 362L201 385Q211 400 198 414L176 433H8Q3 433 5 422L30 269Q35 257 52 247Q66 238 79 244L95 260C74 226 74 194 87 170C101 143 139 112 174 78L159 61Q147 46 158 31L177 12Q180 8 184 8Z", 'fill="#000"')}
${path("M145 240C122 214 113 198 118 175C124 151 137 135 153 122L221 65L191 30Q185 23 191 23H337L314 169Q314 173 310 170L276 129Z", 'fill="#fff"')}
${path("M105 292L230 186Q237 179 240 182C256 201 266 222 263 243C261 267 249 285 230 301L160 355L189 390Q196 398 190 399H45Q42 399 43 394L67 253Q68 247 73 253Z", 'fill="#fff"')}
</g>`
}

export function cleanMercyWildArtwork(action, { drawIndex }) {
  const roulette = action === "wild-color-roulette"
  const count = {
    "wild-reverse-draw-four": 4,
    "wild-draw-six": 6,
    "wild-draw-ten": 10,
  }[action]
  if (!roulette && !count)
    throw new Error(`Unsupported clean wild card: ${action}`)
  const corner = roulette
    ? `<g transform="translate(51 48) scale(.62)">${faces()}</g>`
    : action === "wild-reverse-draw-four"
      ? cleanReverse(57, 62, 63, 77) +
        `<g transform="translate(63 0)">${drawIndex(4)}</g>`
      : drawIndex(count)
  return `<desc>Clean scalable vector print: smooth curves, straight tile edges, pure black background, and no photographic wear.</desc>
<defs><clipPath id="face-clip"><rect width="570" height="890" rx="35"/></clipPath></defs>
<rect data-role="background" width="570" height="890" rx="35" fill="#000000"/>
${mercyGradients()}
<g data-role="print" clip-path="url(#face-clip)">
${ellipse("#fff", "none", 182, 393, 31)}
<g data-role="main-symbol">${
    roulette
      ? `<g transform="translate(61 267) scale(1.45)">${faces()}</g>`
      : mercyTiles(action)
  }</g>
<g data-role="corner-index">${corner}</g>
<g data-role="corner-index" transform="rotate(180 285 445)">${corner}</g>
</g>`
}

function mercyWear() {
  return `<g clip-path="url(#card-clip)" fill="none" stroke="#d4d0bc" stroke-width="1.2" opacity=".28">
${path("M65 15l45 39 76 20 69 42 78 19 35 41M92 93l-17 65 12 77-15 45M453 31l-15 81 14 78 39 87M36 514l81 30 123-11 69 16 47-11 112 32M29 708l60 39 70 13 47 29 96 5 120 22 91-2M80 868l15-99 25-32M514 428l-66 66-31 53-88 92-40 46M49 364l28 99 41 82 10 43")}
</g>`
}

export function referenceSpecialArtwork(
  edition,
  color,
  action,
  { palettes, drawIndex },
) {
  if (edition === "classic") {
    if (action === "wild") return classicWild()
    if (action === "wild-draw-four") return classicDrawFour()
    return classicColored(color, action, palettes)
  }
  const isRoulette = action === "wild-color-roulette"
  const count = {
    "wild-reverse-draw-four": 4,
    "wild-draw-six": 6,
    "wild-draw-ten": 10,
  }[action]
  const corner = isRoulette
    ? `<g transform="translate(51 48) scale(.36)">${faces()}</g>`
    : action === "wild-reverse-draw-four"
      ? diagonalReverse(57, 62, 63, 77) +
        `<g transform="translate(63 0)">${drawIndex(4)}</g>`
      : drawIndex(count)
  return (
    `<rect width="570" height="890" rx="35" fill="#131311"/>` +
    mercyGradients() +
    ellipse("#fff", "none", 182, 393, 31) +
    (isRoulette
      ? `<g transform="translate(61 267) scale(1.45)">${faces()}</g>`
      : mercyTiles(action)) +
    opposite(corner) +
    mercyWear()
  )
}
