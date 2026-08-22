import sharp from "sharp";
import { loadGray, findPages } from "./src/index.ts";
import { readdir } from "node:fs/promises";
const DIR = "/Users/ledjke/Documents/WhatsApp Chat with Bio group";
const files = (await readdir(DIR)).filter((f) => f.endsWith(".jpg")).sort();

const strips: Buffer[] = [];
for (const f of files) {
  const img = await loadGray(`${DIR}/${f}`);
  const page = findPages(img)[0];
  if (!page) {
    console.log(`${f}: no page found`);
    continue;
  }
  // The masthead band, upscaled — it carries युवक / युवती.
  strips.push(
    await sharp(`${DIR}/${f}`)
      .extract({ left: 0, top: page.box.top, width: img.width, height: 26 })
      .resize({ width: 1100, kernel: "lanczos3" })
      .toBuffer(),
  );
}
const meta = await Promise.all(strips.map((b) => sharp(b).metadata()));
const h = meta.reduce((s, m) => s + (m.height ?? 0) + 6, 0);
await sharp({
  create: { width: 1100, height: h, channels: 3, background: "#fff" },
})
  .composite(
    strips.map((input, i) => ({
      input,
      left: 0,
      top: meta.slice(0, i).reduce((s, m) => s + (m.height ?? 0) + 6, 0),
    })),
  )
  .png()
  .toFile("/Users/ledjke/Desktop/CalebX/mastheads.png");
console.log(files.map((f, i) => `${i + 1}. ${f}`).join("\n"));
