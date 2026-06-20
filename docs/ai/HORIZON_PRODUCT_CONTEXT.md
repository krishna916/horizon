# HORIZON_PRODUCT_CONTEXT.md

**Status:** Authoritative Product Context  
**Purpose:** Compressed product memory optimized for ChatGPT project context and future Horizon discussions. This document captures Horizon's product vision, scope, concepts, navigation model, and module responsibilities without detailed PRD-level specifications.

---

# 1. Product Overview

## Vision

Horizon is a personal productivity foundation focused on:

```text
Action Management
+
Information Management
```

The system emphasizes:

```text
Capture
Review
Execution
Retrieval
```

rather than comprehensive life management.

Horizon V1 exists to provide a coherent system for:

- Capturing information quickly
    
- Reviewing captured information
    
- Managing actionable work
    
- Managing independent notes
    
- Executing daily commitments
    
- Retrieving information efficiently
    

---

## Product Principles

### Capture First

Users should never be blocked from recording information.

Capture prioritizes speed over organization.

---

### Content First

Content is primary.

Metadata supports content.

Views support content and metadata.

---

### Opinionated Before Configurable

Horizon provides clear workflows before introducing customization.

---

### Earn Complexity

New concepts should only be introduced when justified by real user pressure.

Future possibilities are not sufficient justification.

---

### Assist, Don't Enforce

The system may guide users.

The system should avoid enforcing workflows whenever possible.

User intent takes precedence over system assumptions.

---

### Store Reality

Store objective facts rather than inferred workflow states.

---

### Surface Reality

Expose information as it exists.

Avoid hiding complexity through automation.

---

# 2. Horizon V1 Scope

## Core Experiences

```text
Home
Today
Inbox
Tasks
Notes
Search
Trash
```

---

## Core Capabilities

```text
Capture
Search
Tags
Archive
Trash
```

---

## V1 Goals

```text
Frictionless Capture

Reliable Daily Execution

Action Management

Information Management

Fast Retrieval

Strong Foundation For Future Growth
```

---

## Explicit Non-Goals

```text
Goals
Habits
Projects
Domains

Automation
Analytics
Insights
Recommendations

Knowledge Graph
PKM Features
Backlinks
Version History

Saved Views
Persistent Filters

Collaboration
Sharing
Teams
Organizations
```

---

# 3. Information Architecture

## Global Experiences

Cross-workspace experiences that coordinate information.

```text
Home
Today
Inbox
```

---

## Workspaces

Content-owning modules.

```text
Tasks
Notes
```

---

## Global Capabilities

Actions available from anywhere.

```text
Capture
Search
```

Capabilities are not destinations.

---

## Administration

```text
Settings
Trash
```

Administrative workflows remain separate from operational workflows.

---

## Primary Navigation

```text
Home
Today
Inbox
-------------
Tasks
Notes
-------------
Settings
```

---

# 4. Shared Product Concepts

## Capture

### Definition

Capture is Horizon's global fast-entry mechanism.

```text
Thought
↓
Storage
```

with minimal friction.

---

### Outcomes

Capture Task:

```text
Create Task
↓
inbox = true
```

Capture Note:

```text
Create Note
↓
inbox = true
```

---

### Workspace Creation

Workspace creation is intentionally different from capture.

```text
Create From Workspace
↓
inbox = false
```

---

## Inbox

### Definition

Inbox is Horizon's review queue.

```text
Inbox = Needs Review
```

---

### Inbox Is Not

```text
Storage
Location
Classification
```

---

### Entry Rule

Content enters Inbox through Capture.

---

### Exit Rule

Content leaves Inbox through intentional review.

```text
inbox = true
↓
Review
↓
inbox = false
```

---

### Important Rule

Inbox is one-way.

Items do not return to Inbox after review.

---

## Tags

### Definition

Tags are user-defined labels.

```text
Tag = User-Defined Label
```

---

### Characteristics

- Shared by Tasks and Notes
    
- Created automatically during assignment
    
- Case-insensitive uniqueness
    
- Suggested during entry
    
- Persist independently
    
- Meaning belongs entirely to the user
    

---

### Excluded From V1

```text
Tag Workspace
Tag Hierarchies
Tag Categories
Tag Administration
Tag Analytics
```

---

## Archive

### Definition

Archive means:

```text
Keep For Future Reference
```

---

### Characteristics

Archived content remains:

```text
Searchable
Editable
Restorable
```

---

### Scope

Archive is local to each workspace.

Examples:

```text
Tasks
└─ Archived Tasks

Notes
└─ Archived Notes
```

---

## Trash

### Definition

Trash is Horizon's global recovery mechanism.

```text
Trash = Safety Net
```

---

### Characteristics

```text
Restore Supported

Permanent Delete Supported

Deleted Content Excluded From Search
```

---

### Scope

Trash is shared across Horizon.

Examples:

```text
Deleted Tasks

Deleted Notes
```

appear in the same experience.

---

# 5. Shared Metadata Model

## Base Entity

All primary content entities inherit:

```text
id

created_at
updated_at

inbox

archived_at
deleted_at
```

Optional:

```text
tags[]
```

---

## Metadata Philosophy

Horizon prefers:

```text
Facts Over States

Timestamps Over Enums

Derived Views Over Workflow State Machines
```

---

## Lifecycle Philosophy

Preferred:

```text
completed_at
archived_at
deleted_at
```

Avoid:

```text
status
workflow_state
```

where possible.

---

## Derived Lifecycle Views

### Active

```text
archived_at IS NULL
AND deleted_at IS NULL
```

---

### Archived

```text
archived_at IS NOT NULL
AND deleted_at IS NULL
```

---

### Deleted

```text
deleted_at IS NOT NULL
```

---

# 6. Module Summaries

## Home

Answers:

```text
How am I doing?
```

Purpose:

```text
Status Briefing
Awareness
Direction
```

Home surfaces signals, not content objects.

---

## Today

Answers:

```text
What requires my attention today?
```

Purpose:

```text
Execution
Commitment Visibility
Prioritization Of Current Attention
```

---

## Inbox

Answers:

```text
What have I captured but not reviewed?
```

Purpose:

```text
Review Queue
```

---

## Tasks

Represents:

```text
Action Management
```

Owns:

```text
Tasks
Checklist Items
```

Checklist items are lightweight actions, not subtasks.

---

## Notes

Represents:

```text
Information Management
```

Owns:

```text
Independent Notes
```

Notes are information storage, not a knowledge management system.

---

## Search

Answers:

```text
Where is the information I need?
```

Purpose:

```text
Global Retrieval
```

Search is a capability, not a workspace.

---

## Trash

Answers:

```text
Can I recover something I deleted?
```

Purpose:

```text
Recovery
Safety
Confidence
```

---

# 7. Navigation Model

## Object Navigation Pattern

```text
List
↓
Side Panel
↓
Full Page
```

Applies to:

```text
Tasks
Notes
```

---

## Search Navigation Pattern

```text
Search
↓
Full Page
```

Search opens canonical destinations.

---

## Side Panel Philosophy

Side panels provide:

```text
Contextual Inspection
```

not navigation.

Closing a side panel returns the user to the originating context.

Examples:

```text
Inbox
↓
Task
↓
Close
↓
Inbox
```

```text
Search
↓
Task
↓
Close
↓
Search
```

---

## Full Page Philosophy

Full pages provide:

```text
More Space
More Focus
```

not additional functionality.

---

## Canonical Routes

```text
/tasks/{id}

/notes/{id}
```

Every content object owns a canonical route.

---

## Context Preservation

Browser history should preserve navigation context.

Search, Inbox, Today, and Workspaces remain valid origins for opening content.

---

# 8. Search Scope

## Searchable Content

Tasks:

```text
Title
Description
Checklist Item Titles
```

Notes:

```text
Title
Content
```

---

## Included Content

```text
Active Content
Archived Content
```

---

## Excluded Content

```text
Deleted Content
Tags
Lifecycle Metadata
Created Dates
Updated Dates
```

---

# 9. V1 Boundaries

Horizon V1 intentionally focuses on:

```text
Capture
Review
Execution
Information Storage
Retrieval
```

It does not attempt to become:

```text
Goal Management System
Habit Tracker
Project Manager
Knowledge Graph
Life Operating System
Analytics Platform
Automation Platform
Collaboration Platform
```

The objective of V1 is to establish a clean, maintainable foundation rather than solve every productivity problem.

---

# 10. Context Usage Guidance

This document exists to provide:

```text
Product Understanding
Shared Concepts
Navigation Rules
Scope Boundaries
Module Responsibilities
```

for future discussions.

It intentionally excludes:

```text
Detailed PRD Requirements
Acceptance Criteria
Edge Cases
UI Specifications
Implementation Details
```

Those remain in the external Horizon knowledge store and source specifications.