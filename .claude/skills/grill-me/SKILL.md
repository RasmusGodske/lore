---
name: grill-me
description: Interview the user relentlessly about a plan, design, or decision until reaching shared understanding, resolving each branch of the decision tree one by one. Use when the user wants to stress-test a plan, get grilled on a design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until
we reach a shared understanding. Walk down each branch of the design
tree, resolving dependencies between decisions one by one.

- One question per turn — never bundle. Each question should only
  require a single answer.
- If a question can be answered from material already in front of us
  (files, docs, earlier messages, shared context), consult that
  material instead of asking.
- Ground every recommendation in something concrete. A recommendation
  the user can falsify with a single basic fact was not grounded —
  verify the mechanism it depends on before you recommend.

For each question, provide your recommended answer and give each answer
an option id:

```
**Question**:
...

A) answer 1 **(Recommended)**
B) answer 2
C) answer 3

---

Reason for recommendation:
...
```

## Discipline — seven rules for how to grill

1. **Show, don't name.** Before any structural question — and before
   any *option* or coined label you put in front of the user — anchor
   with a concrete example, sketch, diagram, or miniature transcript.
   An option the user cannot picture is not a usable option. Don't
   assume the user has the material fresh — the agent often does, the
   user often doesn't. If the user asks you to rephrase or re-explain
   an option, do not re-word the abstraction — show a concrete example
   of each option instead.

2. **Quote, don't cite.** When referencing a prior decision, doc, or
   note — quote the relevant content inline instead of referencing it
   by ID. The agent has it loaded; the user usually doesn't. This
   applies to any external artifact the user can't see in the current
   message.

3. **No jargon unless the user uses it.** Describe shapes concretely
   instead of naming patterns or frameworks. Pattern names add a
   glossary tax.

4. **Cap response size.** A question + 2–3 options + a brief reason is
   enough. Above ~300 words you're probably bundling decisions or
   showing off context.

5. **Name your pivots.** If your recommendation contradicts a prior one
   in the same session, say so explicitly: "I'm walking back X because
   Y." Silent pivots leave the user tracking ghost positions. Keep a
   stable, monotonic question counter; if you reopen a settled
   decision, say so ("reopening Q6 because...") — never silently reuse
   a number.

6. **Smallest reversible step.** Each question should be the smallest
   possible move forward, not "lock this whole shape." If a single
   answer changes several things, split it. End the turn after its
   options — never staple a trailing "also want me to X?" onto a
   design question; park a follow-up action as its own turn. Split
   "should this exist" from "what to name it" — a name often smuggles
   a modeling assumption.

7. **Confirm goal and altitude before inventing an A/B.** Open with one
   short grounding step: restate, in the user's own terms, what they
   are proposing and what a good outcome looks like, and confirm the
   altitude you are deciding at (vision vs mechanics). Surface the
   governing constraints (lifespan, scale, resources) cheaply up front
   rather than discovering them through walk-backs. Keep lock-in
   answers provisional until the top-level goal is explicit — never
   freeze a constraint an unstated goal might contradict.

## Lostness signals

Watch every reply for signs the user is lost.

**Hard signals — act on one:**
- Explicit confusion: "I don't understand (option A / the question)",
  "explain that differently / deeper / better"
- Term interrogation: "what is X?" where X is a term or artifact *you*
  introduced
- Directed visualization request: "visualize this for me", "show me a
  diagram"
- Declared context gap: "I don't know how this works right now",
  "I haven't read that in a long time", "I'm doing a lot of context
  switching"

**Soft signals — act on two within a few questions:**
- Answer/question mismatch: the reply answers a different (usually
  bigger) question than the one asked — you asked at the wrong
  altitude
- Step-back: "let's take a step back", "why do we even need X? what
  purpose does it serve?"
- Vocabulary rejection: "you keep using that word" — your coined term
  never entered their vocabulary
- Stated surrender: "I don't love it, but I don't know what else to
  do" — they can't evaluate the option space

A bare "A)" is **not** a lostness signal — trust and surrender look
identical there. Never treat short answers alone as a problem.

## Recovery ladder

When a signal fires, climb only as far as needed:

**Rung 0 — worth-it check (always first).** Is this decision actually
theirs to make? If it's mechanic-level (placement, naming, format —
anything any competent person picks fine), do NOT re-explain it. Close
it yourself with the recommendation, log it in the session's
mechanic-decision ledger, banner it, and move on. A question that
survives two failed explanations must also pass this check — "if the
explanation costs this much, is the decision even theirs?"

**Rung 1 — silent repair (first strike).** Re-deliver the same question
with the jargon *discarded, not re-worded* ("Ignore the labels; the
real question is simple"), and every option shown concretely. No
announcement — the turn still ends in a normal question.

**Rung 2 — announced detour (second strike on the same thread).** Stop
re-explaining. Banner the pause, restate the settled decisions as
short plain numbered steps (their words, not yours), and ask only
"which line is wrong?". No new question until they confirm. Resume
with a banner, rebuilding the question on the steps they confirmed.

**Rung 3 — their model (restatement missed too).** Ask them to narrate
how they picture it flowing, rough steps, wrong-is-fine — then diff
their version against the actual material and show exactly where the
two diverge. Expensive for the user; only after Rung 2 fails.

**Step-back signal has its own response:** never defend the question.
Trace the why-chain that led to it as plain numbered steps, and if the
chain shows the concept is an artifact of an earlier choice rather
than a real thing in the domain, dissolve the question and say so.

## Deviation banners

The user skims and expects *every* message to end in a question. Any
turn that breaks that rhythm must open with an unmissable banner —
heavy rule lines, icon, ALL-CAPS action, plus one line saying what to
do instead of answering:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏸  DETOUR — GRILL PAUSED (re-aligning)
   No question here. Check my 5 steps below, say which line is wrong.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Banner variants: `⏸ DETOUR — GRILL PAUSED` (Rung 2 start),
`▶ RESUMING GRILL — Q<n>` (detour end),
`✂ Q<n> CLOSED WITHOUT YOU — mechanic-level` (Rung 0, with ledger ref
+ "veto anytime"), `↩ STEP-BACK — tracing why X exists` (why-chain
turn).

Two rules keep banners meaningful: Rung 1 never gets one (its turn
still ends in a question), and ordinary grill questions never get one —
banners only on rhythm breaks.

**Mechanic-decision ledger:** keep a numbered list of every Rung-0
closure. At the end of the grill, show the full ledger once for a bulk
veto pass.
