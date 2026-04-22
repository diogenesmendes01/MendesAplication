---
name: knowledge-forge
description: Transform external sources into durable, practical, system-ready knowledge for the local OpenClaw environment. Use for deep learning from links, docs, repos, threads, and articles when the goal is synthesis, architectural adaptation, and file-level integration guidance.
---

# Knowledge Forge

## Purpose

Knowledge Forge exists to transform external sources into durable, practical, system-ready knowledge for the OpenClaw environment.

This skill does not produce shallow summaries.
Its job is to ingest source material, extract recurring concepts, identify patterns and tradeoffs, adapt the knowledge to the local architecture, and propose exact integration points in the system.

The final output must always be useful for decision-making, architecture, and implementation.

---

## When to use

Use this skill when the user wants to:

- learn deeply from links, articles, threads, repositories, papers, or documentation
- transform scattered information into structured knowledge
- extract practical patterns from external material
- adapt external ideas to the local OpenClaw system
- decide what should become shared knowledge, local knowledge, or rules
- convert research into architectural decisions
- generate a draft knowledge file for the system

Examples of valid requests:

- "Vex, learn about this topic"
- "Vex, absorb these links"
- "Vex, turn this into system knowledge"
- "Vex, consolidate this for our environment"
- "Vex, study this and tell me what changes in our architecture"

---

## When NOT to use

Do not use this skill when the user only wants:

- a quick summary
- a translation
- a casual opinion
- a simple comparison with no architectural consequence
- raw extraction without synthesis
- implementation code only

If the user only wants a short summary, use a simpler response path instead of this skill.

---

## Core mission

Always do all of the following:

1. Read and ingest the provided materials
2. Extract recurring concepts, principles, patterns, and disagreements
3. Distinguish theory from real-world practice
4. Translate the findings into practical guidance for the local OpenClaw environment
5. Recommend exact architectural implications
6. Suggest precise file updates
7. Produce durable knowledge, not disposable commentary

---

## Operating principles

### 1. Never stop at summary
A summary is not enough.
The goal is durable knowledge that can influence architecture, workflows, prompts, rules, or memory structure.

### 2. Optimize for reuse
Outputs must be reusable later by agents, not just useful in the current conversation.

### 3. Think like a systems architect
Reason about control-plane, runtime, workspaces, shared knowledge, memory boundaries, guardrails, and agent responsibilities whenever relevant.

### 4. Prefer applicability over completeness
Do not try to preserve every detail from the source material.
Preserve what changes decisions.

### 5. Separate insight from implementation
Keep principles, patterns, anti-patterns, architecture, and implementation recommendations clearly separated.

### 6. Respect the memory model
Do not dump long-form knowledge into `MEMORY.md`.
Durable topic knowledge belongs in shared or local knowledge files.
`MEMORY.md` should stay compact and index-like.

### 7. Be explicit about uncertainty
If sources disagree or a conclusion is inferred rather than directly stated, say so clearly.

---

## Required workflow

Always follow this exact sequence.

### Phase 1 — Ingestion
Read all provided sources carefully.

Extract:

- repeated ideas
- core principles
- patterns
- anti-patterns
- frameworks
- tradeoffs
- disagreements
- implementation signals
- claims grounded in production practice

Do not produce the final answer yet.

### Phase 2 — Synthesis
Distill the material into a compact set of:

- core principles
- practical patterns
- anti-patterns
- real-world lessons
- tradeoffs
- limits

Separate hype from proven practice.

### Phase 3 — System adaptation
Translate the synthesized knowledge into the local OpenClaw environment.

Answer questions such as:

- what applies directly to our system?
- what requires adaptation?
- what is overengineering for us right now?
- what should influence control-plane?
- what should influence runtime?
- what should become shared knowledge?
- what should remain local to a specific agent?
- what should become a rule?
- what should become a template?
- what should become a guardrail or script?

### Phase 4 — Integration guidance
Recommend exact changes.

Always specify:

- which file should be created or updated
- whether the knowledge belongs in shared or local scope
- whether the change is architectural, behavioral, or operational
- whether the change is immediate, optional, or future-facing

### Phase 5 — Knowledge artifact
Produce a clean draft knowledge file that can be saved into the system with minimal editing.

---

## Output format

The final answer must always use this structure.

## Topic
State the topic in one clear sentence.

## Core Principles
List the most important foundational ideas.

## Practical Patterns
Describe the most useful recurring patterns.

## Anti-Patterns
Describe the main mistakes, traps, or failure modes.

## What Applies to Our System
State what is directly relevant to the current OpenClaw environment.

## Recommended Architectural Decisions
Translate the knowledge into concrete architectural choices.

## Immediate Actions
State the first practical actions in priority order.

## Suggested File Updates
List the exact files that should be created or updated.

Use explicit paths when possible.

Examples:
- `control-plane/shared/knowledge/...`
- `control-plane/shared/GLOBAL_RULES.md`
- `control-plane/shared/AGENT_MAP.md`
- `workspace/AGENTS.md`
- `workspace/MEMORY.md`

## Draft Knowledge File
Provide a ready-to-save markdown draft for the most appropriate knowledge file.

---

## Quality bar

A good output must satisfy all of these:

- not generic
- not just a summary
- clearly adapted to the local system
- clearly separated into layers
- useful for future reuse
- explicit about what to change
- safe for long-term architecture

A weak output is one that:

- only paraphrases sources
- stays abstract
- avoids file-level recommendations
- mixes theory and implementation chaotically
- ignores the OpenClaw architecture
- bloats memory with raw notes

---

## File placement rules

Use these rules when recommending where knowledge should live.

### Shared knowledge
Recommend `control-plane/shared/knowledge/...` when:

- the topic is durable
- more than one agent may benefit
- it influences architecture, conventions, or reusable patterns
- it should become part of the common system understanding

### Local knowledge
Recommend an agent-local knowledge file when:

- the topic is specialized
- it belongs to one agent’s role
- it would pollute the understanding of unrelated agents
- it is operationally narrow

### Rules
Recommend `GLOBAL_RULES.md` when the knowledge should become a policy, law, or convention for multiple agents.

### Agent map
Recommend `AGENT_MAP.md` when the knowledge changes agent roles, handoffs, or responsibilities.

### Workspace files
Recommend `workspace/AGENTS.md`, `TOOLS.md`, or `MEMORY.md` only when the knowledge must affect active runtime behavior of the main agent.

---

## Decision rules

When converting knowledge into recommendations, always classify each recommendation as one of these:

- Immediate
- Next step
- Future
- Overkill for now

This prevents premature complexity.

---

## Architecture awareness

When the local environment uses this architecture:

- `/root/.openclaw/control-plane/` as architectural source of truth
- `/root/.openclaw/workspace/` as the canonical runtime of the main agent
- `/root/.openclaw/agents/` as future or derived agent workspaces
- `/root/.openclaw/skills/` as installed skill directory

you must preserve that separation.

Never assume the workspace contains the entire architecture.
Never conclude that a convention does not exist merely because it is not visible inside the local runtime workspace.

---

## Safety against bad outputs

Before finalizing, check:

1. Did I only summarize?
2. Did I clearly separate principles, patterns, anti-patterns, and implementation?
3. Did I adapt the material to the system instead of repeating it?
4. Did I recommend exact file updates?
5. Did I keep memory discipline intact?
6. Did I avoid proposing architecture that conflicts with the current control-plane/runtime split?
7. Did I identify what should happen now versus later?

If any answer is no, revise before returning the result.

---

## Preferred tone

Be:

- precise
- practical
- structured
- skeptical of hype
- architecture-aware
- implementation-oriented

Do not be:

- fluffy
- overly academic
- generic
- motivational
- vague
- impressed by terminology alone

---

## Example invocation

User request:
"Vex, learn about harness engineering from these links and turn it into system knowledge."

Expected behavior:
- read the sources
- synthesize patterns and anti-patterns
- adapt them to the current OpenClaw architecture
- recommend file updates
- produce a draft for `control-plane/shared/knowledge/harness-design.md`

---

## Final reminder

Your job is not to read.
Your job is not to summarize.
Your job is to forge knowledge that improves the system.
