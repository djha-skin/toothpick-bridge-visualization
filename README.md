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
- **Fast-forward generation** — reveal scores for the rest of the current generation immediately.
- **Surprise!** — toggle rapid, reduced-drawing evolution across successive generations; switch it off to return to the visual load tests.
- **Test speed** — change how quickly the displayed load rises, from 1× to 8×.
- **Mutation rate / strength** — adjust how often genes change and the maximum distance each changed geometry value can move in subsequent generations.
- **Selection pressure** — adjust tournament size; lower values preserve more varied parent choices, while higher values favor top-scoring bridges.
- **Diversity readout** — inspect unique genomes and average normalized gene distance in the current population.
- **Glue joint strength** — tune the nominal glue capacity from 0.44× to 1.44× the modeled wood tension strength; changing it restarts the same seeded population for a fair comparison.
- **Experiment seed / New run** — reset to a reproducible starting population. The same seed and settings produce the same genomes and scores.
- **Select a bridge / Replay test** — inspect a candidate or replay its recorded load-to-failure result.
- **Save run / Restore saved / Delete saved** — store a versioned snapshot in this browser's `localStorage`. No run data is uploaded.

The initial population has 24 candidates. Evolution uses tournament selection, uniform crossover, two elites, and a seeded pseudo-random generator. A genome contains 20 unsigned 16-bit genes: each of ten upper joints gets a horizontal offset and a height. Crossover and mutation change these coordinates, so triangle proportions vary while the bridge remains connected and triangulated. The population diversity readout reports the number of unique genomes and the mean normalized distance between their genes; it is a simple convergence indicator, not a measure of structural quality. The 24-member population is not split into species: mutation and selection controls provide a simpler first response to convergence, and the diversity metric can show whether more elaborate speciation is warranted.

## Bridge model and scoring

The simulator treats each candidate as a **2D, pin-jointed truss** with a fixed 8-toothpick support span, ten deck bays, and a centered load. The left support is pinned and the right support can slide horizontally. The ten upper joints move horizontally by at most 0.04 toothpick lengths. Eight lie between 0.18 and 0.55 toothpick lengths above the deck; the central pair form a raised ridge cap between 0.56 and 0.64, creating a partial second roof tier without adding joints. This uses 39 connected members while keeping all 19 triangles nondegenerate and every side shorter than one toothpick.

Each bridge has 39 member segments and a hard budget of 40 toothpicks. **Every segment costs one whole toothpick regardless of its length**; segments are not combined to reclaim unused lengths. The geometry bounds and validation keep every member and triangle side strictly shorter than one toothpick. The model uses each member's actual length in the force solver and length-sensitive compression/buckling estimate. The 21-node planar truss is minimally triangulated (39 members = 2V−3); adding a new free joint to this topology takes at least two more members, exceeding the budget. Instead, the two central existing joints rise above the other eight to form a partial raised roof cap without adding sticks; a full extra joint row would require a different topology.

A linear-elastic truss solver calculates axial member forces. Each member has a wood tension/compression capacity; tensile members also have a glue-bond capacity at each endpoint. The glue control scales its capacity relative to the 120 N reference wood-tension value; its conservative default is 0.44× (about 53 N), with an adjustable range of 0.44×–1.44×. Glue bonds use a simplified, fixed 0.4-inch lap-joint assumption, and axial tension is treated as the bond demand; compression is treated as direct wood bearing and limited by the buckling model. A failed bond removes its attached member; a wood failure removes the member directly. The solver attempts a new static equilibrium after each deterministic failure, and the visual load ramp interpolates between the recorded events, so animation speed does not affect the score.

The genetic algorithm maximizes the **maximum stable load** using full-precision force values; user-facing completed scores show kg-equivalent loads to hundredths using Earth gravity (9.81 m/s²). Display rounding does not affect ranking. If loads tie exactly, it prefers the bridge using fewer toothpicks (the current fixed topology uses 39).

## Important limitations

This is an **educational approximation**, not a structural-engineering or construction-safety tool. The starting member strengths (120 N in tension and 28 N in compression for a unit-length member) are tuning assumptions, not measured toothpick data. The glue setting is an illustrative calibration, not an authoritative Elmer's product specification: Pi Symphony's [white-glue test](http://www.pisymphony.com/toothpick/GLUETEST/gluetest.html) reports a 12–39 lbf range across 50 specimens and five products (including two Elmer's and three Titebond products), but does not publish per-product results. Those specimens used 0.4-inch overlaps and do not establish a school-glue strength. The simulation assumes identical lap joints and does not model glue area, peel, surface prep, cure variation, or joint-group interaction. It also omits toothpick self-weight, three-dimensional bracing, out-of-plane twisting, material variation, dynamic vibration, and nonlinear bending. Real bridges may behave very differently. Do not use the displayed loads to design or certify a real structure. Saved runs from the earlier fixed-lattice model and the previous variable-truss geometry are incompatible with this raised-ridge geometry version.

## Manual smoke checks

After `npm run dev`, verify:

1. The initial bridge and candidate lineup appear; **Start**, **Pause**, and **Resume** preserve the current load progress.
2. **Step** advances one bridge, **Fast-forward generation** completes the current lineup, and **Surprise!** runs through multiple generations with reduced drawing until toggled off. The next generation updates the history chart, diversity readout, and rankings.
3. Selecting a tested bridge and replaying it shows the same failure sequence; resetting to the same seed reproduces the run.
4. Save, restore, and delete a run; confirm speed, mutation, selection, and glue settings round-trip, a partial test resumes paused, and a completed generation remains inspectable.
5. At desktop and narrow widths (e.g. 1280 px and 375 px), controls and cards remain usable. Tab through the controls, activate them with Enter/Space, and check the page with reduced motion enabled.

## Inspiration and attribution

The interaction pattern was inspired by [HTML5 Genetic Cars](https://github.com/red42/HTML5_Genetic_Cars): seeded runs, population controls, replay, and generation history. This project does not reuse its source code, physics engine, or artwork.
