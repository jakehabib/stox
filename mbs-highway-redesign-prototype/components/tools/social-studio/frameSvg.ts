/** Intro/Outro frame renderer: one SVG string used for the on-screen preview AND the download. */
import type { CoBranding } from '@/data/mock/cobranding';
import type { FrameTemplate } from '@/data/mock/socialStudio';
import { esc, initials } from './shared';

const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

export function frameSvg(t: FrameTemplate, c: CoBranding, kind: 'intro' | 'outro'): string {
  const W = 1280;
  const H = 720;
  const head = kind === 'intro' ? c.name : 'Let’s talk about your next move';
  const sub = kind === 'intro' ? `${c.title ?? 'Loan Officer'} · ${c.company}` : `${c.name} · ${c.company}`;
  const l1 = kind === 'intro' ? `NMLS# ${c.nmls}` : `Cell ${c.cell}  ·  Direct ${c.direct}`;
  const l2 = kind === 'intro' ? `Cell ${c.cell}` : `${c.email}  ·  NMLS# ${c.nmls}`;
  const ini = esc(initials(c.name));
  const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/></linearGradient></defs>`;
  const bg = `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  const avatar = (cx: number, cy: number, r: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${t.accent}" opacity="0.95"/><text x="${cx}" y="${cy + r * 0.36}" text-anchor="middle" font-family="${FONT}" font-size="${r}" font-weight="700" fill="${t.from}">${ini}</text>`;
  let body = '';
  switch (t.layout) {
    case 'center':
      body = `${avatar(W / 2, 220, 70)}
<text x="${W / 2}" y="380" text-anchor="middle" font-family="${FONT}" font-size="${kind === 'intro' ? 72 : 54}" font-weight="800" fill="${t.text}">${esc(head)}</text>
<text x="${W / 2}" y="440" text-anchor="middle" font-family="${FONT}" font-size="30" fill="${t.text}" opacity="0.85">${esc(sub)}</text>
<rect x="${W / 2 - 60}" y="478" width="120" height="6" rx="3" fill="${t.accent}"/>
<text x="${W / 2}" y="548" text-anchor="middle" font-family="${FONT}" font-size="26" fill="${t.text}" opacity="0.8">${esc(l1)}</text>
<text x="${W / 2}" y="590" text-anchor="middle" font-family="${FONT}" font-size="26" fill="${t.text}" opacity="0.8">${esc(l2)}</text>`;
      break;
    case 'left':
      body = `<rect x="96" y="200" width="10" height="300" rx="5" fill="${t.accent}"/>
<text x="140" y="300" font-family="${FONT}" font-size="${kind === 'intro' ? 80 : 58}" font-weight="800" fill="${t.text}">${esc(head)}</text>
<text x="140" y="365" font-family="${FONT}" font-size="32" fill="${t.text}" opacity="0.85">${esc(sub)}</text>
<text x="140" y="440" font-family="${FONT}" font-size="26" fill="${t.text}" opacity="0.75">${esc(l1)}</text>
<text x="140" y="482" font-family="${FONT}" font-size="26" fill="${t.text}" opacity="0.75">${esc(l2)}</text>
${avatar(1090, 600, 56)}`;
      break;
    case 'split':
      body = `<rect x="${W * 0.58}" y="0" width="${W * 0.42}" height="${H}" fill="#ffffff" opacity="0.08"/>
${avatar(W * 0.79, 250, 90)}
<text x="${W * 0.79}" y="430" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="600" fill="${t.text}">${esc(c.company)}</text>
<text x="${W * 0.79}" y="475" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${t.text}" opacity="0.75">NMLS# ${esc(c.nmls)}</text>
<text x="90" y="290" font-family="${FONT}" font-size="${kind === 'intro' ? 70 : 46}" font-weight="800" fill="${t.text}">${esc(head)}</text>
<rect x="90" y="322" width="140" height="8" rx="4" fill="${t.accent}"/>
<text x="90" y="400" font-family="${FONT}" font-size="28" fill="${t.text}" opacity="0.85">${esc(kind === 'intro' ? (c.title ?? 'Loan Officer') : c.name)}</text>
<text x="90" y="450" font-family="${FONT}" font-size="24" fill="${t.text}" opacity="0.75">Cell ${esc(c.cell)}</text>
<text x="90" y="490" font-family="${FONT}" font-size="24" fill="${t.text}" opacity="0.75">${esc(c.email)}</text>`;
      break;
    case 'lower-third':
    default:
      body = `<rect x="0" y="0" width="${W}" height="${H}" fill="#000" opacity="0.18"/>
<text x="${W / 2}" y="300" text-anchor="middle" font-family="${FONT}" font-size="34" fill="#fff" opacity="0.6">[ your video ]</text>
<rect x="60" y="500" width="${W - 300}" height="150" rx="16" fill="${t.from}" opacity="0.92"/>
<rect x="60" y="500" width="12" height="150" rx="6" fill="${t.accent}"/>
${avatar(150, 575, 46)}
<text x="220" y="565" font-family="${FONT}" font-size="${kind === 'intro' ? 46 : 36}" font-weight="800" fill="${t.text}">${esc(head)}</text>
<text x="220" y="612" font-family="${FONT}" font-size="24" fill="${t.text}" opacity="0.85">${esc(sub)}  ·  ${esc(kind === 'intro' ? l1 : c.cell)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${bg}${body}</svg>`;
}
