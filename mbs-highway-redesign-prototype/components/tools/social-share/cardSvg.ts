/** Social graphic renderer: the same SVG string powers the card preview and the download. */
import type { CoBranding } from '@/data/mock/cobranding';
import { CARD_THEMES, type ShareCard } from '@/data/mock/socialShare';
import { esc, initials, wrapLines } from '@/components/tools/social-studio/shared';

const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

export function shareCardSvg(card: ShareCard, c: CoBranding): string {
  const t = CARD_THEMES[card.theme];
  const S = 1080;
  const statSize = card.stat.length > 6 ? 150 : 200;
  const head = wrapLines(card.headline, 24, 3);
  const label = wrapLines(card.statLabel, 40, 2);
  const darkText = card.theme === 'gold';
  const footBg = darkText ? '#111833' : '#ffffff';
  const footText = darkText ? '#ffffff' : '#111833';
  const footSub = darkText ? '#bcadff' : '#5a21d6';
  const headY = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/></linearGradient></defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
<circle cx="930" cy="140" r="260" fill="${t.text}" opacity="0.06"/>
<circle cx="120" cy="760" r="180" fill="${t.text}" opacity="0.05"/>
<rect x="80" y="80" width="${Math.min(620, 28 + card.category.length * 17)}" height="56" rx="28" fill="${t.text}" opacity="0.14"/>
<text x="108" y="117" font-family="${FONT}" font-size="26" font-weight="700" letter-spacing="2" fill="${t.text}">${esc(card.category.toUpperCase())}</text>
<text x="80" y="${200 + statSize * 0.85}" font-family="${FONT}" font-size="${statSize}" font-weight="800" fill="${darkText ? t.accent : t.text}">${esc(card.stat)}</text>
${label.map((l, i) => `<text x="84" y="${250 + statSize * 0.85 + 6 + i * 40}" font-family="${FONT}" font-size="30" fill="${t.text}" opacity="0.8">${esc(l)}</text>`).join('')}
<rect x="84" y="${headY - 70}" width="96" height="8" rx="4" fill="${t.accent}"/>
${head.map((l, i) => `<text x="80" y="${headY + i * 70}" font-family="${FONT}" font-size="60" font-weight="800" fill="${t.text}">${esc(l)}</text>`).join('')}
<rect x="40" y="880" width="1000" height="160" rx="28" fill="${footBg}"/>
<circle cx="130" cy="960" r="50" fill="${darkText ? '#6a2ff2' : '#6a2ff2'}"/>
<text x="130" y="977" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="700" fill="#ffffff">${esc(initials(c.name))}</text>
<text x="205" y="948" font-family="${FONT}" font-size="36" font-weight="800" fill="${footText}">${esc(c.name)}</text>
<text x="205" y="992" font-family="${FONT}" font-size="25" fill="${footSub}">${esc(`${c.company} · NMLS# ${c.nmls}`)}</text>
<text x="1000" y="948" text-anchor="end" font-family="${FONT}" font-size="26" font-weight="600" fill="${footText}">${esc(c.cell)}</text>
<text x="1000" y="992" text-anchor="end" font-family="${FONT}" font-size="22" fill="${footSub}">${esc(c.email)}</text>
</svg>`;
}
