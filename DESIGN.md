---
name: PostDeploy Analytics
description: Paper, ink and lime across the public product site and private analytics workspace.
colors:
  paper: "#F5F6F1"
  paper-2: "#FFFFFF"
  paper-3: "#ECEEE8"
  ink: "#171B12"
  ink-2: "#4C5445"
  muted: "#5E6656"
  rule: "#ECEEE8"
  rule-strong: "#D8DCD1"
  accent: "#C0DF16"
  accent-deep: "#ADC916"
  accent-soft: "#F1F8C9"
  accent-mid: "#DCEC85"
  accent-strong: "#5B6B00"
  logo-period: "#8FA80E"
  focus: "#2E62E8"
  field-edge: "#868D7D"
  error: "#A12D24"
  success: "oklch(50% 0.12 150)"
typography:
  display:
    fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(44px, 4.8vw, 66px)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(30px, 3vw, 42px)"
    fontWeight: 550
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.602rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1rem"
    lineHeight: 1.55
  label:
    fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 550
  brand:
    fontFamily: '"Open Runde", "Onest", sans-serif'
    fontWeight: 700
rounded:
  card: "18px"
  control: "10px"
  inner: "12px"
  pill: "999px"
  report-preview: "14px"
spacing:
  3xs: "2px"
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  2xl: "64px"
  3xl: "96px"
  4xl: "144px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
  button-secondary:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  marketing-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
  input:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  panel:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.pill}"
    padding: "0 4px 0 12px"
  navigation-active:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
---

# Design System: PostDeploy Analytics

## Overview

The adopted postdeploy. identity pairs pale green paper with dark ink, lime accents and rounded sans serif lettering. The public site extends that identity through large, closely spaced headings, open editorial rows and a labelled sample report. The private workspace uses the same materials at a denser scale for charts, filters, tables and settings.

This records the implemented system in `demo/css/tokens.css`, `base.css`, `app.css` and `marketing.css`. Shared tokens remain the foundation; the marketing display scale, report illustration and section composition describe that surface rather than a replacement identity.

**Key Characteristics:**

- Warm pale surfaces, dark readable text and lime actions.
- Onest for interface and editorial type; Open Runde for the adopted wordmark.
- Quiet borders and restrained depth around functional report surfaces.
- Larger public storytelling and compact private reporting share the same brand.

## Colors

The shared palette uses a single lime accent family against green-tinted neutrals. Frontmatter preserves the source token names and canonical CSS values.

### Primary

- **Lime accent:** primary actions and filled measurement graphics. The deeper variant supplies button hover states.
- **Soft and mid lime:** selected filters, chart fills and secondary data marks.
- **Strong olive:** small accent text and data strokes that need more contrast than bright lime provides.
- **Logo period:** the darker lime used on the wordmark's full stop and the public sample chart line.

### Neutral

- **Paper:** the page canvas; **paper-2** creates white report surfaces; **paper-3** groups controls and supplies soft hover fills.
- **Ink:** headings and primary text; **ink-2** carries supporting prose; **muted** carries metadata.
- **Rule and strong rule:** quiet internal divisions and more visible section or control boundaries.
- **Field edge:** the stronger boundary used by editable controls.

Focus blue identifies keyboard focus. Error red and success green express measurement or form status, rather than expanding the brand accent palette. Additional semantic and share-series colors remain defined in `tokens.css`.

The public hosting section has a local pale green wash and border. Its sample-report header has a local near-white wash. Those are surface treatments in `marketing.css`, not additional shared palette families.

**The Brand Continuity Rule.** Preserve the adopted wordmark, icon, font pairing and paper/ink/lime roles when extending either surface.

## Typography

**Display and body font:** Onest, with the shared sans serif fallback stack. The local variable font supports weights from 100 to 900.

**Brand font:** Open Runde, locally supplied at bold weight (700). It belongs to the wordmark; ordinary headings and controls use Onest.

**Code font:** the incumbent monospace stack from `--font-code`, used for snippets and technical identifiers.

### Hierarchy

- **Display:** the frontmatter display role describes the public hero. It is tightly tracked, balanced and constrained to a short measure (10ch on desktop). Mobile uses its own fluid size (`clamp(43px, 10vw, 62px)`) and wider measure (12ch).
- **Headline:** the public section-heading role is larger and lighter than workspace headings. Feature-row headings use a smaller intermediate size (22px, weight 550).
- **Title:** the frontmatter title role describes the private page heading. Private section and smaller headings step down to 1.125rem and 1rem, retaining weight 650.
- **Body:** shared body text uses the frontmatter body role. Public hero copy is larger (18px, line height 1.65); feature explanations use a compact prose setting (15px, line height 1.7). Unclassed paragraphs have a maximum measure (65ch).
- **Label:** compact controls and metadata use the shared small-text scale. Numeric reports use tabular figures; they retain their metric labels rather than relying on typography alone to explain values.

The shared type scale ranges from 0.8125rem through 2.027rem. Public display sizes are explicit surface overrides, rather than a global increase to workspace typography.

## Layout

The workspace uses a centered container (maximum 1280px) with gutters that step from 40px to 24px below 60rem and 16px below 40rem. Cards and controls use the shared spacing scale. Tables, metric ledgers and charts retain compact internal rhythm.

The public site uses a centered wrap (maximum 1240px) with 44px horizontal padding. At 1050px this becomes 30px; at 760px it becomes 22px. The desktop hero pairs copy and report in columns (1fr / 1.1fr, gap 60px). Feature and FAQ areas use a narrow introductory column and wider content column. Long rows divide with rules rather than individual cards.

Below 760px the public hero, feature rows, hosting section and FAQ stack into a single column. The report straightens, fits the available width and remains centered (maximum 560px). Header section links hide while sign-in remains visible. Closing actions and footer wrap naturally. Public section spacing reduces alongside the column change.

Private navigation collapses below 60rem into its existing expandable menu. Private metric and table layouts have their own responsive rules; public breakpoints do not replace them.

## Elevation & Depth

The system combines tonal layering, thin rules and soft shadows. Workspace panels have a faint contact shadow; menus, dialogs and tooltips use a broader floating shadow. The public report illustration has a more visible diffuse shadow and a slight desktop rotation. That illustration treatment does not apply to operational report panels.

### Shadow Vocabulary

- **Card:** `--shadow-card` (`0 1px 2px oklch(23% 0.025 268 / 0.04)`), for quiet workspace surfaces.
- **Pop:** `--shadow-pop` (`0 12px 32px -8px oklch(23% 0.025 268 / 0.18), 0 2px 6px oklch(23% 0.025 268 / 0.06)`), for floating workspace UI.
- **Public report:** `0 16px 50px -20px rgb(23 27 18 / .22)`, scoped to the marketing illustration.

## Shapes

Workspace panels use broad rounded corners, controls smaller rounded corners and chips full pill ends. Nested surfaces use the inner radius. The public report illustration uses its own intermediate radius. The exact reused values are in frontmatter.

Dividers remain straight and fine (1px). Charts use rounded line joins and small rounded data marks. The supplied PostDeploy icon remains the identity asset; action arrows use inline stroked SVG.

## Components

### Buttons

Compact workspace controls have a minimum height (36px), small text and modest horizontal padding. Primary buttons use lime with ink text; secondary buttons use white with a strong-rule border; ghost buttons start transparent. Hover moves primary lime deeper and neutral controls toward paper-3. Pressed workspace buttons move down slightly (1px); disabled controls reduce opacity (0.55).

Public actions use the same control shape with more room: a minimum height (52px), weight 600 and wider horizontal padding. Header sign-in uses the smaller public variant (minimum 42px). SVG arrows inherit the label color. Public button background transitions take 180ms using the shared ease-out curve.

All keyboard-focusable controls retain the blue focus outline (2px, offset 2px) unless a component supplies its existing inset treatment.

### Inputs / Fields

White editable surfaces use the field-edge stroke and shared control radius, with a minimum height (36px) and small text. Hover strengthens the boundary; focus uses blue with a darkened border. Invalid inputs use error red. Labels and help text remain separate and readable.

### Navigation

Workspace navigation uses compact pill links, muted ink at rest and white with a subtle inset border for the current page. The translucent sticky top bar keeps its existing blur treatment. Public navigation is open text with underline on hover and an outlined sign-in action; its header remains in normal document flow.

### Chips

Filter chips use soft lime, strong olive text and pill corners, with a minimum height (30px). The remove control is circular and provides its own hover fill. Neutral status tags use paper-3 instead.

### Cards / Containers

Private panels are white, lightly bordered and softly shadowed. Panel headers and metric sections align to the shared spacing rhythm. Public feature and FAQ content use ruled rows directly on the page; the public sample report remains a contained illustration. Keep those surface roles distinct when reusing components.

### Report graphics

Metrics use tabular figures, explicit names and muted comparison metadata. Chart accents come from the existing lime family; quiet grid lines support the data. The public illustration visibly says “Sample data” and has an accessible description of its illustrative figures. The interactive demo retains its own explicit sample-data treatment.

### FAQ

The public FAQ uses native details/summary disclosure rows, strong-rule dividers and supporting prose beneath the active question. It preserves native keyboard behavior and visible disclosure markers.

Motion uses the incumbent ease-out curve for state changes. The public report's short entrance animation is limited to the illustration; shared reduced-motion rules suppress animation and smooth scrolling when requested.

## Do's and Don'ts

### Do:

- **Do** preserve the existing postdeploy. wordmark and supplied icon.
- **Do** use Onest for headings, prose and controls, and Open Runde for the wordmark.
- **Do** use dark ink on lime actions and darker olive for small accent text.
- **Do** keep metrics labelled, numerals tabular and sample data explicitly identified.
- **Do** retain keyboard focus and the shared reduced-motion behavior.
- **Do** apply public display and spacing overrides within the public surface.

### Don't:

- **Don't** replace the adopted identity while adding a page or component.
- **Don't** use bright lime for small body text on pale backgrounds.
- **Don't** present illustrative report figures as live installation data.
- **Don't** transfer the marketing illustration's rotation to operational panels.
