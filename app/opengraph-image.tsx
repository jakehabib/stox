import { ImageResponse } from 'next/og';

/**
 * The card that renders when someone pastes dynastygm.gg into a chat app.
 * Generated rather than shipped as a file, so it stays in step with the
 * app's own palette and needs no binary asset in the repo.
 */
// Node runtime, not edge: the edge runtime's font/WASM loading for Satori is
// unreliable under next dev here, and this route is generated at build time
// in production anyway, so there is nothing to gain from edge.
export const alt = 'Dynasty GM Football — a single-player front-office simulator';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px 80px',
          background: '#0d1117',
          color: '#f4f6fa',
          position: 'relative',
        }}
      >
        {/* The yard lines the home-page masthead uses, at the same spacing, so
            the share card and the site read as the same object. Drawn as
            elements rather than a repeating-linear-gradient: Satori, which
            renders this image, rejects repeating gradients outright. */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', top: 0, bottom: 0, left: (i + 1) * 96,
              width: 2, background: 'rgba(244,246,250,0.05)',
            }}
          />
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 12, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(47,191,113,0.15)', border: '2px solid rgba(47,191,113,0.45)',
              color: '#2fbf71', fontSize: 30, fontWeight: 800,
            }}
          >
            D
          </div>
          <div style={{ fontSize: 26, letterSpacing: 4, color: '#2fbf71', fontWeight: 700 }}>
            FRONT OFFICE SIMULATOR
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 104, fontWeight: 800, lineHeight: 1.02, marginTop: 28, letterSpacing: -1 }}>
          <div style={{ display: 'flex' }}>Dynasty GM</div>
          <div style={{ display: 'flex' }}>Football</div>
        </div>
        <div style={{ display: 'flex', fontSize: 34, color: '#93a1b5', marginTop: 26 }}>
          Run the franchise. Build the dynasty.
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#5d6b80', marginTop: 'auto' }}>dynastygm.gg</div>
      </div>
    ),
    size,
  );
}
