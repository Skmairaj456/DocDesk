import Image from "next/image";

export const BRAND_NAME = "Practice Up";

// The Practice Up wordmark (cross mark, name and "Connect Beyond Consultation" tagline).
export default function BrandLogo({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <Image
      className={["brand-logo", className].filter(Boolean).join(" ")}
      src="/practice-up-logo.png"
      alt={BRAND_NAME}
      width={Math.round((height * 580) / 158)}
      height={height}
      loading="eager"
    />
  );
}
