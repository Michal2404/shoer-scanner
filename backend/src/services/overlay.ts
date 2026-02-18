import sharp from 'sharp';
import type { VisionCandidate } from '../types/contracts.js';

const BOX_COLORS = [
  '#f43f5e',
  '#10b981',
  '#3b82f6',
  '#f59e0b',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#22c55e'
];

function escapeSvgText(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function candidateLabel(candidate: VisionCandidate): string {
  const name = candidate.brand && candidate.model ? `${candidate.brand} ${candidate.model}` : candidate.raw_label;
  return `${name} (${Math.round(candidate.confidence * 100)}%)`;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.max(40, Math.round(text.length * fontSize * 0.58));
}

function buildOverlaySvg(width: number, height: number, candidates: VisionCandidate[]): string {
  const minSide = Math.min(width, height);
  const strokeWidth = Math.max(2, Math.round(minSide * 0.004));
  const fontSize = Math.max(13, Math.round(minSide * 0.028));
  const labelPadX = 8;
  const labelPadY = 5;

  const elements: string[] = [];
  const missingLabels: string[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const label = candidateLabel(candidate);
    const color = BOX_COLORS[i % BOX_COLORS.length];

    if (!candidate.bbox) {
      missingLabels.push(label);
      continue;
    }

    const x = Math.round(candidate.bbox.x * width);
    const y = Math.round(candidate.bbox.y * height);
    const boxWidth = Math.max(1, Math.round(candidate.bbox.w * width));
    const boxHeight = Math.max(1, Math.round(candidate.bbox.h * height));

    const xSafe = Math.min(x, Math.max(0, width - 1));
    const ySafe = Math.min(y, Math.max(0, height - 1));
    const wSafe = Math.min(boxWidth, width - xSafe);
    const hSafe = Math.min(boxHeight, height - ySafe);

    const labelWidth = Math.min(width - 4, estimateTextWidth(label, fontSize) + labelPadX * 2);
    const labelHeight = fontSize + labelPadY * 2;
    let labelX = xSafe;
    let labelY = ySafe - labelHeight - 4;

    if (labelX + labelWidth > width - 2) {
      labelX = Math.max(2, width - labelWidth - 2);
    }
    if (labelY < 2) {
      labelY = Math.min(height - labelHeight - 2, ySafe + 4);
    }

    elements.push(
      `<rect x="${xSafe}" y="${ySafe}" width="${wSafe}" height="${hSafe}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`
    );
    elements.push(
      `<rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" fill="${color}" fill-opacity="0.9" rx="4" ry="4" />`
    );
    elements.push(
      `<text x="${labelX + labelPadX}" y="${labelY + labelPadY + fontSize - 2}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#111111">${escapeSvgText(label)}</text>`
    );
  }

  if (missingLabels.length > 0) {
    const listFontSize = Math.max(12, Math.round(fontSize * 0.9));
    const rowHeight = listFontSize + 4;
    const visibleMissing = missingLabels.slice(0, 8);
    const moreCount = missingLabels.length - visibleMissing.length;
    const lines = [`No bbox (${missingLabels.length})`, ...visibleMissing];
    if (moreCount > 0) {
      lines.push(`+${moreCount} more`);
    }

    const maxLineWidth = lines.reduce(
      (max, line) => Math.max(max, estimateTextWidth(line, listFontSize)),
      estimateTextWidth('No bbox', listFontSize)
    );

    const panelWidth = Math.min(width - 20, maxLineWidth + 20);
    const panelHeight = lines.length * rowHeight + 12;
    const panelX = 10;
    const panelY = 10;

    elements.push(
      `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" fill="#111111" fill-opacity="0.72" rx="6" ry="6" />`
    );

    lines.forEach((line, index) => {
      const textY = panelY + 8 + (index + 1) * rowHeight - 4;
      elements.push(
        `<text x="${panelX + 10}" y="${textY}" font-family="Arial, sans-serif" font-size="${listFontSize}" fill="#f8fafc">${escapeSvgText(line)}</text>`
      );
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements.join('')}</svg>`;
}

export async function renderVisionOverlay(imageBuffer: Buffer, candidates: VisionCandidate[]): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to read image dimensions for overlay rendering');
  }

  const svg = buildOverlaySvg(metadata.width, metadata.height, candidates);
  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
