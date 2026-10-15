import { ImageResponse } from "next/og";
import { BrandGlyph } from "@/components/app/brand-glyph";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandGlyph size={512} />, { ...size });
}
