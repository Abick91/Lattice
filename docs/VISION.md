# 🌀 Lattice — Vision, Use Cases & Roadmap

> Where Lattice fits in the 2026 AI landscape, what you can build with it today,
> and where it can scale.

Lattice is a **deterministic, symbolic action-planning engine** (the GOAP + HTN
family, born in game AI and robotics). You declare *what state you want*, not the
steps to get there, and Lattice's Rust A\* core computes the optimal, verifiable
sequence of actions — replanning automatically when the world changes.

---

## 1. How you use it

Three declarations and one call:

```typescript
// 1. STATE — a snapshot of the world as key/value pairs
interface LedgerState { balance: number; invoiceApproved: boolean; fundsDisbursed: boolean; }

// 2. TOOLS — what they require (preconditions), how they change the world
//    (effects), and the real work (execute)
const ApproveInvoice: ToolDefinition<LedgerState> = {
    id: "ApproveInvoice",
    preconditions: { balance: { $gte: 100 }, invoiceApproved: false },
    effects:       { invoiceApproved: true },
    execute: async (state) => { /* real API call */ return { invoiceApproved: true }; }
};

// 3. GOAL — the state you want (not the steps)
const agent = new LatticeAgent({ initialState, tools: [...], goal: { fundsDisbursed: true } });

// 4. Run — Lattice discovers the optimal sequence by itself
await agent.run();
```

You declare **the "what", never the "how"**. At runtime `run()` also:

- **Senses** the world between tiers (state can change externally),
- **Replans** when a precondition fails (self-correction, up to `maxReplans`),
- Executes each independent DAG **tier in parallel** via `Promise.all`.

---

## 2. Where it fits in the 2026 AI landscape

**The unsolved problem of LLM agents:** most agent frameworks delegate *planning*
to the LLM itself. That is non-deterministic, non-auditable and non-guaranteeable —
the model hallucinates steps, skips preconditions, repeats actions, and its
cost/latency are unpredictable. Fine for a demo; unacceptable for money, health
records, or infrastructure.

The industry is converging on **neurosymbolic** architectures: use the LLM for what
it's good at (understanding ambiguous language, extracting intent, generating text)
and a **deterministic symbolic engine for the critical reasoning** (the plan, the
guarantees, the safety).

**Lattice is that symbolic piece.** Its natural role is the *verifiable planner
underneath* the LLM:

```
User (natural language)
      │
      ▼
   LLM  ──── translates intent → state + goal + tool selection
      │
      ▼
  LATTICE ── plans the OPTIMAL, GUARANTEED, AUDITABLE sequence
      │
      ▼
Execution (your real tools, in parallel)
```

The LLM decides *what is wanted*; Lattice decides *how to achieve it safely*.

---

## 3. Use cases

| Domain | Why it fits |
| :--- | :--- |
| **Financial / fintech workflows** | The repo's own example. Reconciliation, invoice approval, disbursement — domains where "the plan must be correct and auditable" is non-negotiable. Determinism *is* the feature. |
| **Enterprise agent orchestration** | The deterministic "foreman" coordinating micro-agents/tools, with preconditions verified before every step. |
| **DevOps / IaC / runbooks** | Infrastructure states (deployed, migrated, healthcheck OK) with dependencies. The parallel DAG scheduler maps directly onto "these steps are independent, these are not". |
| **Robotics / IoT / physical automation** | Its origin. Sensors + replanning against a changing world = the `runSensors → replan` loop. The WASM build runs it embedded. |
| **Game AI / NPCs** | Its historical niche. Emergent behavior without giant decision trees. |
| **Data pipelines with dependencies** | The RAW/WAW/WAR hazard analysis that groups tasks into parallel tiers is an Airflow-like scheduler — but *derived automatically* from preconditions/effects instead of a hand-written DAG. |

---

## 4. Is it "just a base"? — The honest ceiling

Today Lattice is a **solid but minimal base (v0.1.0)**, not a finished product.

**Strengths already in the code:**

- Correct A\* with canonical states and O(1) plan caching.
- Rich operators (`$gt/$lt/$eq`…) and mutators (`$add/$sub/$set`).
- Parallel DAG scheduler derived from hazards.
- Sensor + replanning loop (a reactive agent, not just a planner).
- HTN (hierarchical compound tasks).
- Dual transport: persistent TCP daemon **and** in-process WASM.

**Structural limits of the current core (its ceiling, today):**

1. **Symbolic / discrete state.** The search explores node by node. Many
   wide-range numeric variables → combinatorial explosion. It is not a
   continuous-space optimizer (not LP/MILP).
2. **Weak heuristic.** Roughly "count of unmet goal predicates" — admissible but
   uninformed; A\* slows down on large domains.
3. **Pure determinism = no uncertainty.** No probabilistic planning (MDP/POMDP),
   no learned costs, no partial-observability solving (sensors re-perceive, they
   don't reason under uncertainty).
4. **Single agent, single machine, in-memory.** No coordinated multi-agent
   planning, no distributed state, no persistence beyond the disk cache.
5. **No semantic layer.** It doesn't understand natural language — something (you
   or an LLM) must translate the world into `{key: value}`.

None of these are bugs; they are the design frontiers of a classic GOAP/HTN
planner. They define where "the engine" ends and "what you build on top" begins.

---

## 5. Where it scales — what to build on top

The engine is the kernel; the value layers are built above it:

- **Layer 1 — Intent compiler (LLM → Lattice).** A layer that takes natural
  language and uses an LLM to generate the `initialState`, the `goal`, and to
  select/parameterize tools. Lattice becomes the *safe reasoning backend* of any
  agentic chatbot. The most monetizable layer today.
- **Layer 2 — Tool registry / marketplace.** Tools as versioned, reusable plugins
  with verified schemas — an "MCP-like" ecosystem where every tool declares formal
  preconditions/effects, so composition is guaranteed.
- **Layer 3 — Multi-agent orchestration platform.** Several `LatticeAgent`s
  coordinated by a higher-level planner that distributes goals — competing with the
  "orchestrator" of agentic frameworks, but with formal guarantees.
- **Layer 4 — Observability & audit.** The DevTools visualizer is the seed. Scaled
  up: a "why did the agent decide this" panel, plan replay, compliance/traceability
  — huge value in regulated sectors where LLM non-determinism is *prohibited*.
- **Layer 5 — Stronger reasoning core.** Complement/replace A\* with learned
  heuristics, deeper hierarchical planning, or a hybrid MDP mode for uncertainty —
  pushing the core's own ceiling.
- **Layer 6 — Formal verification.** Because the plan is symbolic and
  deterministic, it is *verifiable*: you can **prove** that no plan ever reaches a
  forbidden state (e.g. "never disburse without verified identity"). A decisive
  differentiator over LLM agents, which can offer *no* formal guarantee.

---

## 6. Verdict

- **What it is today:** a correct, fast, deterministic GOAP/HTN planning kernel
  (v0.1.0). A quality *base*, not a finished product.
- **What it's for:** being the "brain that picks the correct sequence of actions"
  in any system where order matters, actions have dependencies, and the world
  changes.
- **Its 2026 relevance:** exactly when the industry realizes you *cannot* trust
  critical planning to an LLM, Lattice is the deterministic symbolic piece missing
  from the neurosymbolic stack. Its value is not competing with LLMs, but being the
  **verifiable planner underneath them**.
- **Is this its ceiling?** No. The core has a clear frontier (symbolic,
  deterministic, single-agent), but it is precisely the kind of kernel that
  platforms are built on: the LLM intent compiler, the tool marketplace,
  multi-agent orchestration, and — the ace — **formal proof that the agent will
  never do something forbidden**, which no purely LLM-based agent can offer.

> In a world of agents that *improvise*, Lattice is the engine that *guarantees*.
