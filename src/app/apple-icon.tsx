import { ImageResponse } from "next/og";
import { BrandGlyph } from "@/components/app/brand-glyph";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandGlyph size={180} />, { ...size });
}
