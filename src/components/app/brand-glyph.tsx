/**
 * The LifeStory mark: an open book whose pages form a gentle horizon line.
 * Drawn with plain shapes so it renders identically in the favicon, the
 * app icon and inline in the header.
 */
export function BrandGlyph({ size = 32 }: { size?: number }) {
  const r = size * 0.22;
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#9a5a3c",
        borderRadius: r,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64" fill="none" aria-hidden>
        <path
          d="M8 16c8-4 16-4 24 2 8-6 16-6 24-2v34c-8-4-16-4-24 2-8-6-16-6-24-2V16Z"
          fill="#f7f2e9"
        />
        <path d="M32 18v36" stroke="#9a5a3c" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M14 26c5-2 10-2 14 1M14 34c5-2 10-2 14 1M14 42c5-2 10-2 14 1M36 27c4-3 9-3 14-1M36 35c4-3 9-3 14-1M36 43c4-3 9-3 14-1"
          stroke="#9a5a3c"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] bg-clay">
        <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden>
          <path
            d="M8 16c8-4 16-4 24 2 8-6 16-6 24-2v34c-8-4-16-4-24 2-8-6-16-6-24-2V16Z"
            fill="#f7f2e9"
          />
          <path d="M32 18v36" stroke="#9a5a3c" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="font-serif text-[1.35rem] leading-none tracking-tight text-ink">LifeStory</span>
    </span>
  );
}
