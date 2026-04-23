/**
 * Raster asset pipeline. Invoked from `.github/workflows/pages.yml` right
 * before the Pages artifact is uploaded, so the deploy always contains
 * freshly-rasterised favicons + an Open Graph PNG fallback for platforms
 * (LinkedIn, Facebook, Slack) that don't render SVG og:images reliably.
 *
 * Inputs:
 *   docs/assets/logo-mark.svg  (source for every favicon size)
 *   docs/assets/og-image.svg   (source for the 1200x630 Open Graph fallback)
 *
 * Outputs (all inside docs/, git-ignored, generated on every deploy):
 *   docs/favicon.ico             (multi-resolution 16/32/48)
 *   docs/favicon-16.png
 *   docs/favicon-32.png
 *   docs/favicon-48.png
 *   docs/apple-touch-icon.png    (180x180)
 *   docs/android-chrome-192.png  (192x192, referenced by manifest.webmanifest)
 *   docs/android-chrome-512.png  (512x512)
 *   docs/assets/og-image.png     (1200x630)
 */
import sharp from 'sharp';
import toIco from 'png-to-ico';
import { writeFile, readFile } from 'node:fs/promises';

async function pngFromSvg(svgPath, size) {
  return sharp(await readFile(svgPath), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function rasterOg(svgPath, width, height) {
  return sharp(await readFile(svgPath), { density: 192 })
    .resize(width, height, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const src = 'docs/assets/logo-mark.svg';
  const og = 'docs/assets/og-image.svg';

  const [p16, p32, p48, p180, p192, p512, ogPng] = await Promise.all([
    pngFromSvg(src, 16),
    pngFromSvg(src, 32),
    pngFromSvg(src, 48),
    pngFromSvg(src, 180),
    pngFromSvg(src, 192),
    pngFromSvg(src, 512),
    rasterOg(og, 1200, 630),
  ]);

  await Promise.all([
    writeFile('docs/favicon-16.png', p16),
    writeFile('docs/favicon-32.png', p32),
    writeFile('docs/favicon-48.png', p48),
    writeFile('docs/apple-touch-icon.png', p180),
    writeFile('docs/android-chrome-192.png', p192),
    writeFile('docs/android-chrome-512.png', p512),
    writeFile('docs/assets/og-image.png', ogPng),
  ]);

  // Multi-resolution ICO (16, 32, 48 merged)
  const ico = await toIco([p16, p32, p48]);
  await writeFile('docs/favicon.ico', ico);

  console.log('[generate-favicons] wrote 8 raster files');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
