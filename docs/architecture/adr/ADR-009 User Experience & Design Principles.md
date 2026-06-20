# ADR-009 User Experience & Design Principles

|Status|Version|Date|
|---|---|---|
|Accepted|1.0|2026-06-15|

---

# Context

Horizon has established:

- Product Vision
- Product Principles
- Information Architecture
- Domain Model
- Persistence Architecture
- Backend Architecture
- Frontend Architecture
- Engineering Guidelines

The product currently lacks a formal definition of its user experience philosophy and design principles.

> [!IMPORTANT]
> Without explicit UX principles, future design work risks becoming inconsistent across modules and heavily influenced by the defaults of individual design tools, AI systems, or implementation decisions.

This ADR establishes the design philosophy that should guide all future user experience, visual design, and interface decisions.

It serves as the foundation for future design exploration, including Stitch-generated concepts and implementation work.

---

# Decision

Horizon adopts a design philosophy best described as:

```
Focused Like Linear + Calm Like Things 3
```

The user experience should prioritize:

- Clarity
- Focus
- Efficiency
- Calmness
- Predictability

while avoiding unnecessary complexity, visual noise, and workflow overload.

The interface exists to help users:

- Capture
- Review
- Execute
- Retrieve

with minimal friction.

---

# Core Experience Principles

## Content First

Content is the primary object of the system.

Navigation, metadata, filters, views, and controls exist to support content rather than compete with it.

The interface should consistently emphasize:

- Tasks
- Notes

before:

- Views
- Dashboards
- Configuration
- Metadata

---

## Focus Before Features

Every screen should have a clear primary purpose.

Examples:

- **Tasks** → Manage Tasks
- **Inbox** → Review Captured Content
- **Today** → Execute Current Commitments
- **Search** → Retrieve Information

Additional capabilities should not dilute the primary purpose of a screen.

---

## Calm Efficiency

Horizon should feel efficient without feeling aggressive.

Optimize for:

- Fast scanning
- Low friction
- Minimal clicks
- Predictable interactions
- High signal-to-noise ratio

Avoid creating urgency where none exists.

The interface should feel calm rather than demanding.

---

## Progressive Disclosure

Frequently used functionality should be immediately accessible.

Advanced or infrequent functionality should appear only when needed.

Preferred flow:

```
Primary Actions
      ↓
Visible Secondary Actions
      ↓
Menus / Additional Controls
```

Avoid overwhelming users with rarely used controls.

---

## Context Preservation

Users should always understand:

- Where They Came From
- Where They Are
- How To Return

Opening content should preserve surrounding context whenever practical.

Example:

```
Inbox
  ↓
Open Task
  ↓
Close
  ↓
Return To Inbox
```

The interface should avoid disorienting navigation flows.

---

## Desktop First

Horizon V1 is optimized primarily for:

- Desktop
- Laptop

> [!NOTE]
> Mobile-first design is intentionally deferred. Interfaces should remain responsive and functional on smaller screens, but desktop workflows are the primary design target.

---

# Interaction Philosophy

## Module-Appropriate Interaction

Interaction patterns should be optimized for the primary job of each module rather than enforcing artificial consistency.

Examples:

- **Tasks** → List-Oriented
- **Notes** → Document-Oriented
- **Search** → Retrieval-Oriented
- **Inbox** → Review-Oriented

Consistency should come from:

- Navigation
- Visual Language
- Interaction Conventions

rather than identical workflows.

---

## Task Experience Philosophy

Tasks primarily support:

- Scan
- Prioritize
- Review
- Complete

Task interfaces should favor:

- Lists
- Quick Actions
- Efficient Editing
- Dense Information Presentation
- Fast Completion

Task management should feel operational and lightweight.

---

## Note Experience Philosophy

Notes primarily support:

- Read
- Write
- Edit
- Reference

Note interfaces should favor:

- Readability
- Writing Comfort
- Strong Typography
- Content Focus
- Long-Form Editing

Notes should feel like content rather than records.

---

## Search Experience Philosophy

Search is a capability, not a destination.

Search exists to help users locate known information quickly.

Search should prioritize:

- Speed
- Relevance
- Navigation To Content

over discovery experiences.

---

## Side Panel Philosophy

Side panels are Horizon's primary inspection surface.

Purpose:

- Inspect
- Review
- Edit

without leaving the originating context.

Side panels should not become miniature applications.

Closing a side panel should return users to their previous context.

---

## Full Page Philosophy

Full pages provide:

- Focus
- Space
- Depth

rather than additional functionality.

The same content should remain recognizable whether viewed in a panel or full page.

---

# Visual Design Principles

## Functional Before Decorative

Visual design should improve understanding and usability.

Decoration should never compete with content.

Avoid visual elements that do not serve a functional purpose.

---

## Moderate Information Density

Horizon should provide enough information to support efficient work while avoiding visual overload.

The target density is:

```
Moderately Dense
```

More information-dense than consumer mobile applications.

Less dense than enterprise productivity software.

---

## Typography As Hierarchy

Typography should be the primary tool for establishing hierarchy.

Prefer:

- Size
- Weight
- Spacing

before introducing additional colors, decorations, or visual effects.

---

## Restrained Color Usage

Color should communicate meaning.

Use color intentionally for:

- Status
- Attention
- Feedback
- Categorization

Avoid using color primarily as decoration.

---

## Borders Over Shadows

Prefer:

- Borders
- Layout
- Spacing

for structure.

Use shadows sparingly.

Avoid heavy elevation systems.

---

## Subtle Motion

Animation should:

- Provide feedback
- Clarify transitions
- Reinforce context

Avoid motion that distracts from content.

---

# Navigation Principles

## Stable Navigation

Primary navigation should remain predictable and recognizable throughout the application.

Users should not need to relearn navigation between modules.

---

## Content Has Canonical Destinations

Every content object owns a canonical route.

Examples:

- `/tasks/{id}`
- `/notes/{id}`

Panels, search results, inbox items, and other views should ultimately resolve to canonical destinations.

---

## Views Are Lenses

Views are temporary perspectives on content.

Content remains primary.

Examples:

- Inbox
- Today
- Search

These are ways to access content rather than content ownership locations.

---

# Design Inspirations

## Positive Influences

The following products represent desirable characteristics:

### Linear

For:

- Focus
- Clarity
- Speed
- Professionalism

### Things 3

For:

- Calmness
- Simplicity
- Polish
- Visual Restraint

### GitHub

For:

- Information Density
- Practicality
- Predictability

### Raycast

For:

- Efficiency
- Minimalism
- Purposeful Design

---

## Influences To Avoid

The following characteristics should generally be avoided:

### Productivity Cockpit Design

Examples:

- ClickUp
- Monday
- Similar highly configurable platforms

Characteristics to avoid:

- Excessive dashboards
- Configuration-heavy experiences
- Widget overload
- Persistent visual noise
