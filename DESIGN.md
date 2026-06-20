---
name: Horizon
description: A calm, trusted vantage point for your work and thoughts
colors:
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "Geist Variable, sans-serif"
    fontWeight: 500
    letterSpacing: "-1.68px"
  body:
    fontFamily: "Geist Variable, sans-serif"
    lineHeight: "145%"
    letterSpacing: "0.18px"
  mono:
    fontFamily: "ui-monospace, Consolas, monospace"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
---

# Design System: Horizon

## 1. Overview

**Creative North Star: "A calm, trusted vantage point for your work and thoughts"**

Horizon is designed as a calm place to think. It values clarity over density, consistency over customization, and confidence over cleverness. The interface should quietly organize complexity rather than hide it, helping users regain perspective and move forward deliberately. It functions as a foundation for capturing information quickly, reviewing it, managing actionable work, and executing daily commitments without getting in the user's way. 

It explicitly rejects complex PKM systems, extensive project management paradigms, over-automation, and unnecessary decorative clutter.

**Key Characteristics:**
- Unobtrusive and reality-focused
- Fast, frictionless capture
- Content takes priority over metadata
- Clear, opinionated workflows before customization

### Layout Philosophy
Hierarchy should be established through spacing, alignment, typography, and grouping before relying on color or elevation. The interface should feel structured, predictable, and visually quiet.

### Spacing Philosophy
Whitespace creates hierarchy before color, borders, or shadows. Layout should feel breathable and intentional, allowing content to remain the primary focus.

### Progressive Disclosure
Horizon reveals complexity gradually. Frequently used actions remain immediately accessible, while advanced functionality is progressively disclosed to preserve focus and reduce cognitive load.

### Motion Philosophy
Motion communicates cause and effect, never entertainment. Animations should be subtle, brief, and purposeful, reinforcing user actions without drawing attention to themselves.

## 2. Colors

Zinc & Paper: A high-contrast grayscale palette with stark white and near-black.

### Primary
- **Zinc 950** (`oklch(0.205 0 0)`): The main actionable color for primary buttons and dominant active states.
- **Paper White** (`oklch(0.985 0 0)`): High contrast text resting on Zinc 950.

### Neutral
- **Page Background** (`oklch(1 0 0)`): The stark white canvas.
- **Primary Ink** (`oklch(0.145 0 0)`): Near-black text for maximum readability and crisp contrast.
- **Muted Surface** (`oklch(0.97 0 0)`): Secondary backgrounds for secondary panels or inactive elements.
- **Subtle Border** (`oklch(0.922 0 0)`): Structural dividers that define regions without calling attention to themselves.

### Named Rules
**The Content First Rule.** The interface itself is grayscale so that user content can be the only source of true color. Do not use color for decoration, only for semantic meaning (like destructive actions).

## 3. Typography

**Display Font:** Geist Variable, sans-serif
**Body Font:** Geist Variable, sans-serif
**Label/Mono Font:** ui-monospace, Consolas, monospace

**Character:** Calm, neutral, and highly legible. Typography should feel effortless to read, placing clarity and comfort above personality. It should quietly support the content rather than become a visual feature.

### Hierarchy
- **Display** (500 weight, large size, negative letter-spacing): A large display style intended only for hero surfaces and major headings.
- **Body** (400 weight, 16-18px, 145% line-height, positive letter-spacing): Optimized for long-term readability rather than density. Varies depending on context.
- **Label** (400 weight, 15px, 135% line-height): Used for code blocks, badges, and counters.

### Named Rules
**The Legibility Rule.** Body text should never be smaller than 16px. Optimize for long-term readability by adjusting line height and spacing appropriately.

## 4. Elevation

Surfaces are flat by default.

### Shadow Vocabulary
- **Ambient Focus** (`rgba(0, 0, 0, 0.1) 0 10px 15px -3px, rgba(0, 0, 0, 0.05) 0 4px 6px -2px`): Used strictly for elevated states such as popovers, modals, and deep hover interactions.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, elevation, modals).

## 5. Components

Quiet and purposeful. Components recede into the background, allowing content to take visual priority.

### Buttons
- **Shape:** Softly rounded edges (8px / md).
- **Primary:** Zinc 950 background with Paper White text. Confident and highly visible.
  - Primary actions should be used sparingly.
  - Each screen should ideally have only one visually dominant primary action.
- **Secondary:** Secondary actions should remain visually restrained.
- **Hover / Focus:** Clear focus rings. State changes should be instantaneous and precise.

### Cards / Containers
- **Corner Style:** Rounded (10px / lg).
- **Background:** Paper White or Muted Surface depending on hierarchy.
- **Shadow Strategy:** The Flat-By-Default Rule. Borders are used for structure instead of ambient shadows.
- **Border:** Subtle Border (`1px solid var(--border)`).

### Inputs / Fields
- **Style:** Flat, transparent or subtle background with a 1px border.
- **Focus:** Crisp outline ring (`oklch(0.708 0 0)`) without glow or blur.

### Iconography Philosophy
Icons support recognition rather than decoration. Prefer simple outlined icons with consistent stroke weight. Pair icons with labels whenever practical, and avoid icon-only actions unless they are universally understood.

## 6. Do's and Don'ts

### Do:
- **Do** use the Zinc & Paper palette to keep the UI unobtrusive and neutral.
- **Do** ensure all text hits a strong contrast ratio (e.g. Primary Ink on Page Background).
- **Do** use borders for structure instead of shadows for resting states.

### Don't:
- **Don't** use complex PKM paradigms like knowledge graphs, backlinks, or analytics dashboards.
- **Don't** use neon accents, glassmorphism, or heavy drop shadows.
- **Don't** use color purely for decoration.
- **Don't** use border-left greater than 1px as a colored stripe.
