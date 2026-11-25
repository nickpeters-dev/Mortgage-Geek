import { P, F } from "../../theme";

// headingLevel: 2 inside the homepage (a section under the page's h1); 1 when a
// section is rendered as its own standalone page, so that page has an h1.
// Visual styling is identical either way: every property is set inline and the
// global reset zeroes heading margins.
export function SectionHeader({ eyebrow, title, subtitle, headingLevel = 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div style={{ maxWidth: 640, marginBottom: 40 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", color: P.gold, display: "block", marginBottom: 10 }}>{eyebrow}</span>
      <Heading style={{ fontFamily: F.display, fontSize: "clamp(26px, 3.5vw, 36px)", color: P.navy, marginBottom: 10, lineHeight: 1.15 }}>{title}</Heading>
      {subtitle && <p style={{ fontSize: 14, lineHeight: 1.7, color: P.warmGray }}>{subtitle}</p>}
    </div>
  );
}
