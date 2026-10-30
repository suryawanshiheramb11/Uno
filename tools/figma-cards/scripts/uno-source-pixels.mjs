import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

const directory = new URL("./reference-specials/", import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", directory), "utf8"),
)
const artwork = new Map()

for (const [key, entry] of Object.entries(manifest)) {
  const png = await readFile(new URL(entry.file, directory))
  if (createHash("sha256").update(png).digest("hex") !== entry.pngSha256) {
    throw new Error(`Reference pixels changed unexpectedly: ${entry.file}`)
  }
  artwork.set(
    key,
    `<desc>Reference-based card artwork at ${entry.width} by ${entry.height} pixels.${
      entry.restored
        ? " Print restored from the reference with scratches removed and a solid black background."
        : " Colored inks normalized to the exact shared Classic numbered-card palette."
    } Embedded raster artwork.</desc>
<image x="0" y="0" width="570" height="890" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${png.toString("base64")}"/>`,
  )
}

export function sourcePixelArtwork(edition, color, action) {
  const key = `${edition}/${color ? `${color}-` : ""}${action}`
  const image = artwork.get(key)
  if (!image) throw new Error(`Missing original artwork: ${key}`)
  return image
}
