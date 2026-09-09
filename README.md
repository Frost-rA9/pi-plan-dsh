# pi-plan-dsh

A pi extension that ports dsh's **plan collaboration state** to pi as **soft guidance** — the **guidance axis** of the plan/enforcement split. Modeled on a single reference source: [dsh](https://github.com/deepseek-ai/deepseek-harness).

## Model

**Guidance axis only — not a security boundary.**

- `/plan` enters plan mode; `/plan off` leaves it; `/plan <message>` enters and steers the message in.
- While active, a `plan:policy` prompt section is injected at each agent start — only the prompt changes, never the tool catalog.
- `exit_plan_mode` stays registered whether or not plan mode is active, so entering/leaving changes only the prompt section; a complete markdown plan starting with a `#` heading is presented for user review; approval exits plan mode, "keep planning" sends feedback back to the model.
- State is a log-only whole-value-replace event `plan/mode: { active }` — the last one wins; resume/fork/compaction restore via fold. It is **never** an in-memory source of truth.

## Orthogonality

The plan/enforcement split mirrors dsh and is fully orthogonal:

| Axis | Extension | State | Role |
|---|---|---|---|
| Guidance | `pi-plan-dsh` | `plan/mode` | soft prompt guidance |
| Enforcement | `pi-sandbox-dsh` | `sandbox/mode` | write-boundary OS sandbox |

`plan` never reads or writes `sandbox` state (and vice-versa); the two are independent and configured separately. This mirrors dsh's own split: *"Plan mode is soft guidance. Sandbox mode and approval policy enforce restrictions independently; neither reads nor writes plan state."* Together this pair **replaces the deprecated `pi-plan-mode`**.

## Design rules

1. Plan mode is guidance — no tool filtering, no write caps.
2. State is the log fold of `plan/mode` — never an in-memory source.
3. The model cannot switch mode on its own; only the user's `/plan` decides.
4. Approval interaction never enters the model context; results come back via the tool result / a failed call.
5. **Fail closed**: no interactive channel, a reload during review, or a dismissed review → `exit_plan_mode` fails, leaving `/plan off` as the escape hatch.
6. Fully orthogonal to `pi-sandbox-dsh` — no shared state or types.

## Backends

None — this is a guidance-only extension (no OS sandbox, no preview/question capability seam). See the local `AGENTS.md` (gitignored) for the design rationale and the known trade-offs.

## License

MIT
