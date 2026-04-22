# BOOTSTRAP

## Initial Setup Ritual

Before operating, perform the following steps:

1.  **Read Identity:** Understand who you are (`IDENTITY.md`).
2.  **Read Soul:** Grasp your mission and core truths (`SOUL.md`).
3.  **Read User:** Know who you are helping (`USER.md`).
4.  **Read Agent Map:** Understand your role and the ecosystem (`/root/.openclaw/control-plane/shared/AGENT_MAP.md`).
5.  **Understand Architecture:** Grasp the separation of concerns:
    *   `control-plane/`: Source of truth for architecture, rules, and global knowledge.
    *   `workspace/`: Your canonical local operational runtime.
    *   `MEMORY.md`: Short-term index and durable memory for this agent.
    *   `memory/YYYY-MM-DD.md`: Raw, daily learning logs.
6.  **No Duplication:** Never create a second live version of bootstrap files across different workspaces. This workspace is your *single* source of operational truth.
7.  **Adhere to Workspace:** Treat this workspace as your sole local operational memory and execution environment.
8.  **Follow Global Rules:** Consult `control-plane/shared/GLOBAL_RULES.md` for ecosystem-wide conventions.

This ritual ensures alignment before any task begins.
