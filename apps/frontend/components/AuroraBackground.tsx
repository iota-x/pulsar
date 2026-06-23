/**
 * Fixed, GPU-animated gradient "aurora" blobs + grid that sit behind all content
 * and give the app its premium, depth-y feel without any 3D/WebGL cost.
 * Adapts to the active theme via CSS variables (--bg, --aurora-opacity).
 */
export function AuroraBackground({ grid = true }: { grid?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0" style={{ opacity: 'var(--aurora-opacity)' }}>
        <div className="absolute -left-40 -top-40 h-[42rem] w-[42rem] animate-aurora rounded-full bg-violet-600/25 blur-[120px]" />
        <div className="absolute -right-40 top-10 h-[38rem] w-[38rem] animate-aurora rounded-full bg-fuchsia-500/20 blur-[120px] [animation-delay:-6s]" />
        <div className="absolute bottom-[-20rem] left-1/3 h-[40rem] w-[40rem] animate-aurora rounded-full bg-cyan-400/15 blur-[130px] [animation-delay:-12s]" />
      </div>
      {grid && <div className="absolute inset-0 grid-bg opacity-60" />}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 120% at 50% 0%, transparent 40%, var(--bg) 100%)' }}
      />
    </div>
  );
}
