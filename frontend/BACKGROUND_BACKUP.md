# Background Backup

This file preserves the exact original static dotted background implementation of PRobe.

## 1. CSS Pattern
**File**: `frontend/src/app/globals.css` (lines 133–140)

```css
/* ── Textured Dither Dot Pattern ────────────────────────── */
.dither-pattern {
  background-color: #0A0A0B;
  background-image: radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: radial-gradient(ellipse 85% 65% at 50% 25%, black 20%, transparent 85%);
  -webkit-mask-image: radial-gradient(ellipse 85% 65% at 50% 25%, black 20%, transparent 85%);
}
```

## 2. Component Markup
**File**: `frontend/src/app/page.tsx` (lines 1788–1794)

Applied directly inside the main page root container:

```tsx
    <div className="relative min-h-screen bg-[#0A0A0B] text-[#EDEDEF] selection:bg-[#C8F135]/20 selection:text-[#C8F135]">
      {/* Textured Dither Dot Pattern Background fading toward edges */}
      <div
        className="pointer-events-none fixed inset-0 dither-pattern z-0"
        aria-hidden="true"
      />
```

## 3. Original Properties Summary
- **Grid Spacing**: 20px by 20px
- **Dot Radius**: 1px
- **Dot Color**: `rgba(255, 255, 255, 0.08)`
- **Background Color**: `#0A0A0B`
- **Mask**: `radial-gradient(ellipse 85% 65% at 50% 25%, black 20%, transparent 85%)`
- **Positioning**: `fixed inset-0 z-0 pointer-events-none`
