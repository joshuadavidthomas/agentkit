---
name: diataxis
description: Structure and write documentation using the Diataxis framework. Use when writing docs, README files, guides, tutorials, API references, or organizing documentation architecture. Classifies content into tutorials, how-to guides, reference, and explanation.
---

# Diátaxis Documentation Framework

Write and organize documentation using the Diátaxis systematic framework by Daniele Procida.

## The Four Documentation Types

Diátaxis identifies exactly four types of documentation, defined by two axes:

|  | **Acquisition** (study) | **Application** (work) |
|---|---|---|
| **Action** (doing) | **Tutorial** | **How-to guide** |
| **Cognition** (thinking) | **Explanation** | **Reference** |

### 1. Tutorials — learning-oriented

A lesson that takes a learner by the hand through a practical experience. The learner acquires skills by doing.

- Use first-person plural ("We will...")
- Show where they're going up front
- Deliver visible results early and often
- Ruthlessly minimize explanation — link to it instead
- Focus on the concrete, ignore options and alternatives
- Aspire to perfect reliability

**Load `references/tutorials.md` for full tutorial-writing guidance.**

### 2. How-to guides — goal-oriented

Practical directions for an already-competent user to achieve a specific real-world goal.

- Name clearly: "How to [achieve X]"
- Use conditional imperatives ("If you want x, do y")
- Assume competence — don't teach
- Omit the unnecessary; practical usability > completeness
- Allow flexibility with alternatives

**Load `references/how-to-guides.md` for full how-to guide guidance.**

### 3. Reference — information-oriented

Technical description of the machinery. Austere, authoritative, consulted not read.

- Describe and only describe — neutral tone
- Adopt standard, consistent patterns
- Mirror the structure of the product
- Provide examples to illustrate, not explain

**Load `references/reference.md` for full reference-writing guidance.**

### 4. Explanation — understanding-oriented

Discursive treatment that deepens understanding. Answers "Can you tell me about...?"

- Make connections to related topics
- Provide context: why things are so
- Talk *about* the subject (title: "About X")
- Admit opinion and perspective
- Keep closely bounded — don't absorb other types

**Load `references/explanation.md` for full explanation-writing guidance.**

## The Compass — When In Doubt

Ask two questions:

1. **Action or cognition?** Is this about doing, or thinking?
2. **Acquisition or application?** Is this for learning, or for working?

The intersection tells you which type you're writing.

## How To Apply

1. Pick any piece of documentation
2. Assess: what type is it? What type *should* it be?
3. Identify one improvement
4. Make the change
5. Repeat

Do NOT create empty four-section structures and try to fill them. Let structure emerge from content.

## Critical Rules

- **Never mix types.** A tutorial that explains too much stops being a tutorial. A reference guide that instructs stops being reference. Each type has its own purpose, tone, and form.
- **The user's mode matters.** Study vs. work is the fundamental distinction. Tutorials and explanation serve study. How-to guides and reference serve work.
- **Link between types** rather than embedding one inside another. A tutorial can link to explanation. A how-to guide can link to reference. But they must not absorb each other.

## Deep Dives

Load reference files on demand for detailed guidance:

| Topic | File |
|---|---|
| Site overview | `references/index.md` |
| Quick start | `references/start-here.md` |
| Applying Diátaxis | `references/application.md` |
| Writing tutorials | `references/tutorials.md` |
| Writing how-to guides | `references/how-to-guides.md` |
| Writing reference | `references/reference.md` |
| Writing explanation | `references/explanation.md` |
| The compass tool | `references/compass.md` |
| Workflow methodology | `references/how-to-use-diataxis.md` |
| Theory overview | `references/theory.md` |
| Why it works | `references/foundations.md` |
| The two-dimensional map | `references/map.md` |
| Quality theory | `references/quality.md` |
| Tutorials vs how-to | `references/tutorials-how-to.md` |
| Reference vs explanation | `references/reference-explanation.md` |
| Complex hierarchies | `references/complex-hierarchies.md` |
| About Diátaxis | `references/colophon.md` |
