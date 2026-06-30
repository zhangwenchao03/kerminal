---
name: apple-inspired-ui-style
description: "Apply a reusable Apple-inspired UI style system: clean, quiet, minimal, soft, premium, native-like interfaces with system fonts, restrained colors, soft rounded corners, subtle translucent materials, light borders, gentle shadows, designer-grade composition, and fast micro-interactions. Use this skill when designing or refining web, desktop, mobile web, productivity, AI, developer, dashboard, settings, terminal, file-management, or dense workbench UIs that should feel polished, attractive, and Apple-like without copying Apple assets or exact system UI."
---

# Apple-inspired UI Style Skill

This skill defines a reusable visual style system for creating **Apple-inspired** interfaces.

The goal is not to clone Apple products or copy proprietary UI assets. The goal is to apply the broader design language associated with modern Apple software: **clarity, restraint, softness, hierarchy, polish, and native-like interaction**.

Use this skill when a UI should feel:

- clean
- quiet
- minimal
- soft
- premium
- focused
- native-like
- glass-like where appropriate
- content-first
- fluid and precise

Avoid making the UI feel like a generic admin dashboard, SaaS landing page, cyberpunk interface, neon glassmorphism demo, or overly decorative portfolio site.

---

## When to Use This Skill

Use this skill for:

- desktop apps
- web apps
- mobile web apps
- productivity tools
- AI tools
- developer tools
- dashboards
- settings pages
- command palettes
- sidebars
- toolbars
- modal-heavy apps
- lightweight operating-system-like interfaces

This skill is framework-agnostic. It works with React, Vue, Svelte, Solid, plain HTML/CSS, Tailwind CSS, shadcn/ui, Radix UI, native desktop wrappers, or any comparable UI stack.

For dense operational apps, developer tools, terminal/file-management interfaces, or broad style refreshes where regressions are likely, also read:

- `references/operational-app-workbench.md`

For visual art direction, composition, designer taste, and final aesthetic review, also read:

- `references/designer-quality-gate.md`

---

## Core Direction

Design toward these qualities:

```text
clean
quiet
soft
minimal
native-like
glass-like
focused
precise
fluid
premium
```

In practical terms:

```text
low visual noise
clear content hierarchy
neutral color system
subtle surfaces
soft rounded corners
light borders
gentle shadows
short micro-interactions
system typography
careful spacing
```

The interface should feel polished because of proportion, spacing, hierarchy, and interaction detail — not because of heavy decoration.

---

## Core Principles

### 1. Content First

The UI should support the content, not compete with it.

Prioritize:

- readable text
- obvious primary actions
- calm secondary actions
- clear grouping
- generous but efficient spacing
- low visual noise
- predictable interaction

Avoid adding visual effects that reduce readability or make the interface feel busy.

### 2. Restraint Over Decoration

Apple-inspired design is not just blur and transparency. Use restrained materials, subtle contrast, and consistent component rhythm.

Prefer:

- soft backgrounds
- light borders
- subtle shadows
- moderate blur
- low-saturation colors
- consistent radius
- compact controls
- short transitions

Avoid:

- large colorful gradients
- neon glow
- heavy shadows
- thick borders
- highly saturated buttons
- complex particle backgrounds
- excessive glassmorphism
- animation for its own sake

### 3. Hierarchy Through Material and Space

Build visual hierarchy through:

- spacing
- font size
- font weight
- opacity
- background contrast
- subtle borders
- soft shadows
- blur on floating surfaces

Avoid relying on:

- strong dividers
- heavy color blocks
- oversized icons
- excessive card nesting
- dashboard-template styling

---

## Color System

Use neutral colors as the base. Use one primary accent color and a small number of semantic colors.

### Recommended Accent

```text
accent: #0A84FF
```

### Light Mode

```text
page background:      #F5F5F7
secondary background: #FAFAFA
panel background:     rgba(255, 255, 255, 0.68)
main text:            #1D1D1F
secondary text:       rgba(60, 60, 67, 0.72)
subtle text:          rgba(60, 60, 67, 0.48)
border:               rgba(0, 0, 0, 0.08)
divider:              rgba(0, 0, 0, 0.06)
```

### Dark Mode

```text
page background:      #101012
secondary background: #1C1C1E
panel background:     rgba(28, 28, 30, 0.72)
main text:            #F5F5F7
secondary text:       rgba(235, 235, 245, 0.64)
subtle text:          rgba(235, 235, 245, 0.42)
border:               rgba(255, 255, 255, 0.12)
divider:              rgba(255, 255, 255, 0.08)
```

### Semantic Colors

Use semantic colors sparingly and with restrained saturation.

```text
success: #32D74B
warning: #FFD60A
danger:  #FF453A
info:    #64D2FF
purple:  #BF5AF2
accent:  #0A84FF
```

Do not use semantic colors as large decorative surfaces unless the state is the main message.

---

## CSS Theme Tokens

Use CSS variables to keep the style portable across frameworks.

```css
:root {
  --app-bg: 245 245 247;
  --app-bg-secondary: 250 250 250;
  --app-panel: 255 255 255;

  --app-text: 29 29 31;
  --app-text-muted: 60 60 67;
  --app-text-subtle: 60 60 67;

  --app-border: 0 0 0;
  --app-divider: 0 0 0;

  --app-accent: 10 132 255;
  --app-success: 50 215 75;
  --app-warning: 255 214 10;
  --app-danger: 255 69 58;
  --app-info: 100 210 255;
  --app-purple: 191 90 242;

  --radius-control: 0.75rem;
  --radius-card: 1rem;
  --radius-panel: 1.25rem;
  --radius-modal: 1.5rem;
  --radius-large: 1.75rem;
}

.dark {
  --app-bg: 16 16 18;
  --app-bg-secondary: 28 28 30;
  --app-panel: 28 28 30;

  --app-text: 245 245 247;
  --app-text-muted: 235 235 245;
  --app-text-subtle: 235 235 245;

  --app-border: 255 255 255;
  --app-divider: 255 255 255;

  --app-accent: 10 132 255;
  --app-success: 50 215 75;
  --app-warning: 255 214 10;
  --app-danger: 255 69 58;
  --app-info: 100 210 255;
  --app-purple: 191 90 242;
}
```

---

## Typography

### Global UI Font

Prefer system fonts so the UI feels native on each platform.

```css
:root {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Text",
    "SF Pro Display",
    "Segoe UI",
    system-ui,
    sans-serif;
}
```

### Monospace Font

Use monospace fonts for code, logs, terminals, command output, and developer tools.

```css
.mono {
  font-family:
    "SF Mono",
    "JetBrains Mono",
    "Cascadia Code",
    "Menlo",
    "Monaco",
    "Consolas",
    monospace;
}
```

### Recommended Type Scale

```text
page title:      24px - 32px
section title:   17px - 21px
body text:       14px - 16px
secondary text:  12px - 14px
button text:     13px - 15px
label text:      11px - 12px
```

### Recommended Font Weight

```text
page title:     600 - 700
section title:  600
body text:      400 - 500
button text:    500 - 600
label text:     500
helper text:    400
```

Avoid excessive use of heavy font weights. Use spacing, opacity, and material contrast to establish hierarchy.

---

## Radius System

Use consistent radius values. Do not assign random corner radii.

```text
small controls:        8px - 10px
buttons / inputs:      10px - 12px
list items:            10px - 14px
cards:                 14px - 18px
panels:                18px - 22px
modals / sheets:       22px - 28px
large containers:      24px - 32px
```

Recommended mapping:

```text
Button:          12px
Input:           12px
Select:          12px
List item:       12px
Card:            16px
Panel:           20px
Modal:           24px
Command palette: 24px
Sheet:           24px - 28px
```

Tailwind mapping:

```text
controls: rounded-xl
cards:    rounded-2xl
modals:   rounded-3xl
```

---

## Material System

### Glass Panel

Use glass panels for floating or navigational surfaces.

Good use cases:

- top bars
- sidebars
- floating panels
- command palettes
- dialogs
- dropdowns
- popovers
- context menus
- toast notifications
- compact inspector panels

```css
.glass-panel {
  background: rgb(255 255 255 / 0.68);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgb(255 255 255 / 0.45);
  box-shadow:
    0 1px 1px rgb(0 0 0 / 0.04),
    0 12px 40px rgb(0 0 0 / 0.08);
}

.dark .glass-panel {
  background: rgb(28 28 30 / 0.72);
  border-color: rgb(255 255 255 / 0.12);
  box-shadow:
    0 1px 1px rgb(255 255 255 / 0.04) inset,
    0 16px 44px rgb(0 0 0 / 0.32);
}
```

Do not apply glass treatment to every element. Content-heavy areas should usually be more solid for readability.

### Solid Panel

Use solid panels for dense content, tables, forms, long reading surfaces, and data-heavy areas.

```css
.solid-panel {
  background: rgb(255 255 255 / 0.92);
  border: 1px solid rgb(0 0 0 / 0.08);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.04),
    0 8px 30px rgb(0 0 0 / 0.06);
}

.dark .solid-panel {
  background: rgb(28 28 30 / 0.92);
  border-color: rgb(255 255 255 / 0.1);
  box-shadow:
    0 1px 1px rgb(255 255 255 / 0.03) inset,
    0 12px 36px rgb(0 0 0 / 0.28);
}
```

### Subtle Surface

Use subtle surfaces for hover states, selected items, grouped rows, and quiet backgrounds.

```css
.subtle-surface {
  background: rgb(0 0 0 / 0.035);
}

.dark .subtle-surface {
  background: rgb(255 255 255 / 0.07);
}
```

---

## Border and Divider Rules

Borders should be thin and low contrast.

```css
.border-subtle {
  border-color: rgb(0 0 0 / 0.08);
}

.dark .border-subtle {
  border-color: rgb(255 255 255 / 0.1);
}

.divider {
  height: 1px;
  background: rgb(0 0 0 / 0.06);
}

.dark .divider {
  background: rgb(255 255 255 / 0.08);
}
```

Avoid:

- pure black borders
- pure white borders
- thick borders
- too many dividers
- high-contrast grid lines

---

## Shadow System

Use soft, layered shadows. Avoid heavy dashboard-like shadows.

```css
.shadow-soft {
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.04),
    0 8px 28px rgb(0 0 0 / 0.06);
}

.shadow-floating {
  box-shadow:
    0 2px 8px rgb(0 0 0 / 0.08),
    0 24px 80px rgb(0 0 0 / 0.16);
}

.dark .shadow-soft {
  box-shadow:
    0 1px 1px rgb(255 255 255 / 0.03) inset,
    0 12px 36px rgb(0 0 0 / 0.28);
}

.dark .shadow-floating {
  box-shadow:
    0 1px 1px rgb(255 255 255 / 0.04) inset,
    0 28px 90px rgb(0 0 0 / 0.48);
}
```

Usage:

```text
card:              soft shadow
floating surface:  floating shadow
button:            usually no shadow or very subtle shadow
input:             no shadow except focus ring
topbar/sidebar:    mostly blur + border, minimal shadow
```

---

## Spacing System

Use a 4px base rhythm.

```text
4px
8px
12px
16px
20px
24px
32px
40px
48px
64px
```

Recommended component spacing:

```text
button padding:       8px 12px
input padding:        8px 12px
card padding:         16px - 24px
modal padding:        20px - 28px
page padding:         16px - 32px
section spacing:      24px - 40px
toolbar height:       44px - 56px
list row height:      32px - 44px
settings row height:  44px - 56px
```

Use more whitespace for content products. Use tighter but still breathable spacing for developer tools and desktop utilities.

---

## Component Rules

### Buttons

Buttons should be compact, rounded, and responsive.

```text
height:       28px - 40px
radius:       10px - 14px
font size:    13px - 15px
font weight:  500 - 600
hover:        soft background change
active:       slight scale, usually 0.98
focus:        visible accent ring
```

```css
.button {
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  transition:
    background-color 140ms ease,
    transform 100ms ease,
    opacity 140ms ease;
}

.button:hover {
  background: rgb(0 0 0 / 0.05);
}

.button:active {
  transform: scale(0.98);
}

.button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgb(10 132 255 / 0.18);
}

.dark .button:hover {
  background: rgb(255 255 255 / 0.1);
}
```

Button variants:

```text
primary:      accent background, white text
secondary:    subtle translucent background
ghost:        transparent, hover reveals surface
destructive:  restrained red, not overly saturated
```

### Inputs

Inputs should be quiet and readable.

```css
.input {
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: rgb(255 255 255 / 0.72);
  padding: 0 12px;
  font-size: 14px;
  outline: none;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

.input:focus {
  border-color: rgb(10 132 255 / 0.5);
  box-shadow: 0 0 0 4px rgb(10 132 255 / 0.14);
}

.dark .input {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(255 255 255 / 0.08);
}
```

### Cards

Cards should be soft and restrained, not heavy or overly separated.

```css
.card {
  border-radius: 18px;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: rgb(255 255 255 / 0.72);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.04),
    0 8px 28px rgb(0 0 0 / 0.06);
}

.dark .card {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(28 28 30 / 0.72);
  box-shadow:
    0 1px 1px rgb(255 255 255 / 0.03) inset,
    0 12px 36px rgb(0 0 0 / 0.28);
}
```

### Sidebar

Sidebars should feel calm and app-like, not like a heavy admin navigation.

```text
width:          220px - 280px
background:     translucent or low-contrast solid
icon size:      15px - 17px
text size:      13px - 14px
selected item:  soft pill background
section label:  11px - 12px, muted
```

Avoid:

- strong color selected states
- thick borders
- complex nested menus
- large icons
- generic admin-dashboard styling

### Toolbar

Top bars should be compact and functional.

```text
height:      44px - 56px
background:  glass or translucent
icon button: 28px - 34px
border:      1px low-opacity bottom border
text:        13px - 14px
```

### Modal / Dialog

Dialogs should feel like light floating surfaces.

```text
width:       360px - 720px
radius:      22px - 28px
background:  glass or solid panel
shadow:      floating shadow
entry:       opacity + slight scale
exit:        quick fade
```

### Command Palette

Use this pattern for productivity apps, AI tools, developer tools, and complex workflows.

```text
width:         560px - 720px
position:      centered or slightly above center
radius:        22px - 28px
background:    glass
input:         minimal border or no visible border
list items:    compact, rounded, soft hover state
shortcuts:     small low-contrast keycaps
```

### Dropdown / Popover

Floating menus should be compact, readable, and softly layered.

```text
radius:          14px - 18px
background:      glass or solid panel
border:          low-opacity
shadow:          soft / floating
menu item height: 30px - 36px
icon size:       15px - 16px
```

---

## Icon Rules

Use thin, linear icons.

```text
size:          15px - 18px
stroke width:  1.5 - 2
color:         follow text color
style:         consistent across the app
```

Avoid mixing filled icons with line icons unless there is a strong reason.

Example:

```tsx
<Settings size={16} strokeWidth={1.75} />
```

Icons should support recognition, not dominate the visual design.

---

## Motion Rules

Animations should be subtle, fast, and natural.

### Timing

```text
hover:       100ms - 150ms
active:      80ms - 120ms
dropdown:    120ms - 180ms
modal:       150ms - 220ms
panel:       180ms - 260ms
layout:      220ms - 320ms
```

### Easing

Prefer:

```text
ease-out
cubic-bezier(0.16, 1, 0.3, 1)
spring with low bounce
```

### Common Motion Pattern

Floating panel entry:

```text
opacity: 0 -> 1
scale:   0.98 -> 1
y:       -8 -> 0
duration: 160ms - 220ms
```

Button active state:

```text
scale: 1 -> 0.98
duration: 80ms - 120ms
```

List hover:

```text
background opacity change only
no large movement
duration: 100ms - 140ms
```

### Motion Example

```tsx
import { motion } from "motion/react"

export function AppleFloatingPanel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="rounded-3xl border border-white/20 bg-white/70 p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/70"
    >
      {children}
    </motion.div>
  )
}
```

Avoid:

- long animations
- large movements
- infinite decorative loops
- high-frequency flashing
- excessive bounce
- 3D flips
- particle systems
- neon glow animations

---

## Tailwind Utility Patterns

### App Background

```tsx
<div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] antialiased dark:bg-[#101012] dark:text-[#F5F5F7]">
  {children}
</div>
```

### Glass Panel

```tsx
<div className="rounded-3xl border border-white/40 bg-white/70 shadow-2xl shadow-black/10 backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/70 dark:shadow-black/40">
  {children}
</div>
```

### Solid Card

```tsx
<div className="rounded-2xl border border-black/5 bg-white/90 shadow-xl shadow-black/5 dark:border-white/10 dark:bg-zinc-900/90 dark:shadow-black/30">
  {children}
</div>
```

### Ghost Button

```tsx
<button className="rounded-xl px-3 py-2 text-sm font-medium transition hover:bg-black/5 active:scale-[0.98] dark:hover:bg-white/10">
  Action
</button>
```

### Primary Button

```tsx
<button className="rounded-xl bg-[#0A84FF] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98]">
  Continue
</button>
```

### Muted Text

```tsx
<p className="text-sm text-zinc-500 dark:text-zinc-400">
  Secondary description text
</p>
```

### List Item

```tsx
<button className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition hover:bg-black/5 active:scale-[0.99] dark:hover:bg-white/10">
  <span>List item</span>
  <span className="text-xs text-zinc-400">⌘K</span>
</button>
```

---

## Layout Patterns

### Standard App Layout

```text
App
├─ Top Bar
├─ Sidebar, optional
├─ Main Content
│  ├─ Page Header
│  ├─ Primary Content
│  └─ Secondary Panels
└─ Floating Layers
   ├─ Command Palette
   ├─ Dialog
   ├─ Popover
   └─ Toast
```

### Content Page

```text
Page
├─ Title
├─ Description
├─ Primary Action
├─ Section Group
│  ├─ Card
│  ├─ Card
│  └─ Card
└─ Secondary Info
```

### Settings Page

```text
Settings
├─ Sidebar Categories
└─ Detail Panel
   ├─ Section
   │  ├─ Setting Row
   │  ├─ Setting Row
   │  └─ Setting Row
   └─ Section
      ├─ Setting Row
      └─ Setting Row
```

Settings pages should feel like native app settings, not like admin tables.

---

## Dark Mode Rules

Dark mode is not simple color inversion.

Use:

- near-black backgrounds, not pure black
- slightly elevated panels
- white text softened to off-white
- low-opacity white borders
- stronger but soft floating shadows
- restrained accent usage

Recommended:

```text
background: #101012 or #1C1C1E
text:       #F5F5F7
border:     rgba(255, 255, 255, 0.1)
panel:      rgba(28, 28, 30, 0.72 - 0.92)
```

Avoid:

- pure black background with pure white text everywhere
- large blue glows
- high-contrast borders
- too many bright cards
- excessive transparency that damages readability

---

## Accessibility Requirements

The style must remain usable.

Requirements:

- text contrast must be sufficient
- click targets should usually be at least 28px - 32px tall
- primary actions must be visually clear
- focus states must be visible
- hover must not be the only feedback
- error states need text, not only color
- do not use color as the only state indicator
- support reduced motion

Reduced motion CSS:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Quality Checklist

Before finalizing UI, check:

```text
Is the interface quiet and restrained?
Is content the visual center?
Is the typography system-like and readable?
Are radius values consistent?
Are borders light enough?
Are shadows soft enough?
Is glass used only where it helps hierarchy?
Is dark mode natural rather than inverted?
Do hover and active states feel subtle?
Are animations short and fluid?
Are icons thin and consistent?
Is the text hierarchy clear?
Does the settings UI feel native rather than admin-like?
Are there too many gradients, glows, particles, or decorative effects?
Does anything look like a generic dashboard template?
Does anything look like a SaaS landing page instead of an app?
Has readability been preserved?
```

---

## Anti-patterns

Do not create:

```text
heavy card shadows
large colorful gradients
neon glow
cyberpunk styling
complex particle backgrounds
too much blur
generic dashboard-template UI
generic admin-system UI
high-saturation color blocks
thick borders
strong dividers
slow animations
large bounce effects
flashy loading animations
marketing-page hero sections inside app UIs
interfaces where every button is visually loud
interfaces where every region becomes a card
```

---

## Recommended Prompt for AI Coding Tools

Use this prompt when asking an AI coding tool to generate or restyle UI:

```text
Use an Apple-inspired visual style.

The UI should feel clean, quiet, soft, minimal, premium, and native-like. Use system fonts, restrained neutral colors, subtle translucent surfaces, soft rounded corners, light borders, gentle shadows, and short fluid micro-interactions.

The interface should prioritize content and usability over decoration. Use visual hierarchy through spacing, typography, opacity, subtle backgrounds, and soft shadows rather than heavy borders or bright colors.

Support both light and dark mode. In light mode, prefer #F5F5F7-style soft backgrounds, white translucent panels, #1D1D1F text, and low-opacity black borders. In dark mode, prefer #101012 or #1C1C1E backgrounds, #F5F5F7 text, slightly lighter panels, and low-opacity white borders.

Use glass-like panels only where appropriate: top bars, sidebars, floating panels, dialogs, dropdowns, command palettes, popovers, and toast notifications. Do not overuse blur. Content-heavy areas should remain readable and mostly solid.

Use a consistent radius system: 10-12px for controls, 14-18px for cards, 20-28px for dialogs and floating panels. Use subtle shadows, never heavy dashboard-like shadows.

Buttons should be compact, rounded, and responsive. Hover states should be soft. Active states can use a slight scale of 0.98. Icons should be thin, linear, and consistent, around 16px with 1.5-2 stroke width.

Animations should be subtle and fast: 100-150ms for hover, 150-220ms for dialogs and floating panels, using ease-out or a low-bounce spring. Avoid large movements, long animations, neon effects, excessive gradients, particles, and decorative motion.

Avoid making the UI look like a generic admin dashboard, SaaS landing page, cyberpunk interface, or overly glossy glassmorphism demo. The final result should feel like a polished, modern, native Apple-style productivity application.
```

---

## Short Prompt Version

```text
Design the UI in an Apple-inspired style: clean, quiet, minimal, soft, premium, and native-like. Use system fonts, neutral colors, subtle translucent panels, soft rounded corners, light borders, gentle shadows, and short fluid micro-interactions. Support light and dark mode. Keep content as the visual center. Avoid heavy gradients, neon glow, excessive blur, dashboard-template styling, thick borders, loud colors, and decorative animations.
```

---

## Final Principle

**Less noise, more clarity. Less decoration, more polish. Less weight, more softness. Content first; details make it premium.**
