# Reson8 A&R Audit Engine — Design Direction

## Register
Product / Operate.

## Design objective
Make evidence and decisions immediately scannable for music-industry professionals. The interface should feel like a serious intelligence workstation rather than a generic AI dashboard.

## Visual principles
- Evidence first: observed facts visually outrank interpretation.
- Confidence is explicit: distinguish verified, partial, unresolved, and inferred states.
- Dense but calm: compact data presentation with deliberate whitespace and hierarchy.
- Strong typography hierarchy; avoid dashboard-card repetition as the primary layout.
- No generic AI aesthetic, decorative gradients, gratuitous glassmorphism, or ornamental motion.
- Errors explain what failed, what is still trustworthy, and what the user can do next.
- Accessibility and responsive behavior are product requirements, not polish items.
- Motion is purposeful and subordinate to task completion.

## Core UI surfaces
1. Intake / upload
2. Analysis progress
3. Evidence reconciliation
4. A&R assessment
5. Song-specific report
6. Audit history

## Evidence language
Use labels such as Observed, Recognized, Reconciled, Verified, Partial, Unresolved, and Inferred. Never present inference as measurement.

## Future design-system rule
When a frontend is introduced, run Impeccable context/audit/polish against the actual implementation before declaring the UI production-ready. Preserve this product truth while allowing the visual system to evolve.
