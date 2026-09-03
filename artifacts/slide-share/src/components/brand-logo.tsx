import crestAsset from '@assets/image_1786687066164.png';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="St Peter's College">
      <span className={`${compact ? 'h-10 w-8' : 'h-14 w-10'} relative shrink-0 overflow-hidden rounded-sm bg-[#843b49]`}>
        <img
          src={crestAsset}
          alt=""
          className="absolute left-1/2 top-[-8px] h-[97px] w-auto max-w-none -translate-x-1/2"
        />
      </span>
      {!compact && (
        <span className="font-serif text-lg font-bold tracking-tight text-[#fff8df]">
          St Peter&apos;s <span className="text-[#f0d875]">College</span>
        </span>
      )}
    </div>
  );
}