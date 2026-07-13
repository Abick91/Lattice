# 🧭 Lattice — Strategy (Architect & CTO view)

> With the current engine (v0.1.0), what should we do next?
> Improve the engine, build a project **using** it, or build a project **on top** of it?

This document captures the strategic direction for Lattice: a comparison of the
three paths, a recommendation, and a phased plan from an Architect + CTO
perspective.

---

## Part 1 — Comparing the three strategies

| Dimension | **A. Improve the engine**<br>(deepen the core) | **B. Project USING the engine**<br>(a vertical/app) | **C. Project ON TOP**<br>(platform/layer) |
|---|---|---|---|
| **What you build** | Better heuristics, MDP/uncertainty, multi-agent, distributed planner | A product for one concrete domain (e.g. fintech reconciliation, DevOps runbooks) | The "intent compiler" LLM→Lattice + tool registry + orchestration |
| **Nature** | R&D / infrastructure library | Vertical SaaS application | Horizontal platform / dev-tool |
| **Time-to-value** | 🔴 Slow (months without a user) | 🟢 Fast (weeks to a real demo) | 🟡 Medium (MVP in 1-2 months) |
| **Technical risk** | 🔴 High (research may not converge) | 🟢 Low (the engine already works) | 🟡 Medium (LLM integration + guarantees) |
| **Market risk** | 🔴 High (who buys a planner?) | 🟡 Medium (a single vertical) | 🟢 Low (the 2026 AI-agent TAM) |
| **Validates the engine** | ❌ No (improves without proving demand) | ✅ Yes, in 1 real case | ✅✅ Yes, as a generic case |
| **Competitive moat** | Weak (competes with academic planners) | Medium (domain + data) | 🟢 Strong (the neurosymbolic thesis) |
| **Cost / team** | 🔴 High (PhD-planning profiles) | 🟢 Low (1-2 full-stack) | 🟡 Medium (full-stack + AI) |
| **Revenue potential** | Low direct (open-core) | Medium (niche SaaS) | 🟢 High (infra for many) |
| **What it proves** | "The engine is more powerful" | "The engine solves a real problem" | "The engine is the missing piece of the AI stack" |
| **Main trap** | *Premature optimization*: polishing something nobody uses | *Niche lock-in*: the engine stays hidden | *Scope creep*: trying to do everything at once |

**Key read:** Option A is the most tempting to an engineer and the worst for an
early-stage CTO — you invest in power before validating demand. Engine
improvements must be **pulled** by real needs, never **pushed** speculatively.

---

## Part 2 — Recommendation

> **Don't pick one. Sequence them: C validated by B, and A only on demand.**
>
> Build a **thin platform layer (C)** — the LLM→Lattice intent compiler —
> **validated with a concrete vertical (B)** as the first use case and living
> proof. Engine improvements **(A)** enter only when B/C demand them.

Why this combination:

- **B** gives fast traction and proof (something that works, demonstrable).
- **C** gives the large TAM and the moat (the "deterministic planner beneath the
  LLM" thesis is exactly the 2026 gap).
- **A** becomes your long-term defensive advantage, without burning cash early.

The classic mistake would be jumping to A ("let's make the engine multi-agent with
MDP") — 6 months of R&D without a single user.

---

## Part 3 — Plan (Architect + CTO)

### 🎯 North Star
> *"The deterministic, verifiable reasoning backend for AI agents."*
> The LLM understands; **Lattice guarantees.**

### 🏛️ Architect view — target layered architecture

```
┌─────────────────────────────────────────────────────────┐
│  L4  Vertical/App (B)   — Reconciliation SaaS / demo      │  ← proof
├─────────────────────────────────────────────────────────┤
│  L3  Orchestration      — multi-agent, queues, state      │  ← future
├─────────────────────────────────────────────────────────┤
│  L2  Intent Compiler (C)— LLM → {state, goal, tools}      │  ← the business core
│      + Guardrails       — schema validation + ACL         │
├─────────────────────────────────────────────────────────┤
│  L1  Tool Registry (C)  — versioned, verified tools       │
├─────────────────────────────────────────────────────────┤
│  L0  LATTICE ENGINE     — A* planner (already exists)     │  ← your asset
└─────────────────────────────────────────────────────────┘
```

Architecture principles:

1. **The engine stays untouched as a stable kernel** (clear JSON contract).
   Everything new is built *around* it, not *inside* it.
2. **Hard LLM↔symbolic boundary**: the LLM *never* executes actions or bypasses
   the planner; it only produces inputs the engine validates. That boundary **is**
   the safety product.
3. **First-class verifiability**: every plan is auditable and reproducible from day
   one (leveraging the existing DevTools/telemetry).

### 📅 CTO roadmap — phases with decision gates

**Phase 0 — Harden the kernel (2-3 weeks).** *Before building on top.*
- Package the engine as a real consumable (npm publish the TS client, daemon
  binaries, maybe a crate on crates.io).
- Reproducible test + benchmark suite (validate the README numbers).
- Stable, versioned planning-contract API.
- *Gate:* is the engine a reliable dependency? → continue.

**Phase 1 — Intent Compiler MVP + one vertical (4-6 weeks).** *The key experiment.*
- L2: an LLM layer translating natural language → `initialState/goal/tools`, with
  **schema validation** (reject if the LLM produces garbage) and guardrails.
- L4: **one** narrow vertical as a living case — recommended: **financial
  reconciliation** (already the repo's example; high-value, audit-obsessed domain).
- *Go/no-go gate:* does a real user prefer this over a pure LLM agent?
  Metric: % correct plans + auditability. → decide whether to scale.

**Phase 2 — Tool Registry + formal verification (6-8 weeks).** *The moat.*
- L1: tools as versioned plugins with formal preconditions/effects → guaranteed
  composition.
- Invariant proof: *prove* no plan reaches a forbidden state ("never disburse
  without verified identity"). **No LLM agent can offer this** — it's your sellable
  differentiator.
- *Gate:* is formal verification a real commercial argument? → decide if it's the
  central pitch.

**Phase 3 — Scaling (pull-driven).** Only now, and only what Phase 1-2 demand:
- Multi-agent orchestration (L3), or
- Engine improvements (A): learned heuristics, hybrid MDP mode for uncertainty —
  each justified by a real customer need, not technical ambition.

### 👥 Minimum team
- 1 architect/full-stack (you) — engine + L1/L2.
- 1 AI engineer — L2 (LLM integration, prompting, evals).
- (Phase 2+) 1 domain specialist for the vertical.

### 📊 Decision metrics
- **Correctness:** % of valid plans generated from NL intent.
- **Reliability:** guaranteed plans vs. an LLM-agent baseline on the same problem.
- **Latency/cost:** the README's performance argument, actually measured.
- **Auditability:** can a human/regulator understand *why* the agent did X?

### ⚠️ Risks & mitigation

| Risk | Mitigation |
|---|---|
| Diving into engine R&D (A) before validating | Hard rule: A only *pull-driven* after Phase 1 |
| The LLM produces invalid inputs | Strict schema validation in L2 (guardrails); the engine rejects, never guesses |
| State explosion in large domains | Start with bounded-state verticals; heuristics only if it hurts |
| Competing head-on with LangGraph/CrewAI | Don't compete on "orchestration"; position on "**guarantee/verification**", their blind spot |

---

## TL;DR
- **Don't** invest in the engine first (A) — it's premature optimization.
- **Do** build a thin platform layer (C: intent compiler + tool registry)
  validated by a concrete vertical (B: fintech reconciliation).
- Reserve engine improvements (A) for when a real customer demands them.
- Your unique, sellable differentiator: **formal proof that the agent will never
  do something forbidden** — the blind spot of every LLM agent in 2026.
