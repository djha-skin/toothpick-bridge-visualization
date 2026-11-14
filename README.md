# Bridge Lab — Toothpick Evolution

A small, client-side genetic algorithm visualization: candidate toothpick trusses are tested under a rising center load, ranked by the load they hold, and bred into the next generation.

## Run locally

No build step, backend, package install, or runtime dependency is required. Python 3 is used only to serve the static files:

```sh
npm run dev
```

Open <http://localhost:8000>. Run the model and persistence tests with:

```sh
npm test
```

## Experiment controls

- **Start evolving / Pause evolution** — test the population and continue into later generations.
- **Step** — finish the current bridge test and move to the next candidate.
- **Fast-forward generation** — score the rest of the current generation immediately.
- **Test speed** — change how quickly the displayed load rises.
- **Mutation rate** — adjust per-gene mutation for subsequent generations.
- **Experiment seed / New run** — reset to a reproducible starting population. The same seed and settings produce the same genomes and scores.
- **Select a bridge / Replay test** — inspect a candidate or replay its recorded load-to-failure result.
- **Save run / Restore saved / Delete saved** — store a versioned snapshot in this browser's `localStorage`. No run data is uploaded.

The initial population has 24 candidates. Evolution uses tournament selection, uniform crossover, two elites, and a seeded pseudo-random generator.

## Bridge model and scoring

The simulator treats each candidate as a **2D, pin-jointed truss** on a triangular lattice. Each legal member represents one equal-length toothpick. Every candidate has the same span, support conditions, and maximum supply of 40 toothpicks. The left support is pinned, the right support can slide horizontally, and the load hangs from the center of the deck.

A linear-elastic truss solver calculates axial member forces. The load rises to the next member's failure threshold; an overloaded member is removed, and the solver redistributes the load across the remaining members. Compression capacity is reduced with member length to approximate buckling. If the remaining truss cannot maintain static equilibrium, it collapses. The visual load ramp interpolates between these deterministic failure events, so animation speed does not affect the score.

The genetic algorithm maximizes the **maximum stable load**. If loads tie, it prefers the bridge using fewer toothpicks. Loads are displayed as kg-equivalent using Earth gravity (9.81 m/s²).

## Important limitations

This is an **educational approximation**, not a structural-engineering or construction-safety tool. The starting member strengths (120 N in tension and 28 N in compression for a unit-length member) are tuning assumptions, not measured toothpick data. The model omits toothpick self-weight, glue/joint failure, three-dimensional bracing, out-of-plane twisting, material variation, dynamic vibration, and nonlinear bending. Real bridges may behave very differently. Do not use the displayed loads to design or certify a real structure.

## Manual smoke checks

After `npm run dev`, verify:

1. The initial bridge and candidate lineup appear; **Start**, **Pause**, and **Resume** preserve the current load progress.
2. **Step** advances one bridge, **Fast-forward generation** completes the lineup, and the next generation updates the history chart and rankings.
3. Selecting a tested bridge and replaying it shows the same failure sequence; resetting to the same seed reproduces the run.
4. Save, restore, and delete a run; confirm a partial test resumes paused and a completed generation remains inspectable.
5. At desktop and narrow widths (e.g. 1280 px and 375 px), controls and cards remain usable. Tab through the controls, activate them with Enter/Space, and check the page with reduced motion enabled.

## Inspiration and attribution

The interaction pattern was inspired by [HTML5 Genetic Cars](https://github.com/red42/HTML5_Genetic_Cars): seeded runs, population controls, replay, and generation history. This project does not reuse its source code, physics engine, or artwork.
