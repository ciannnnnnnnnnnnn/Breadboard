# IC Breadboard Lab

A browser-based 3D breadboard simulator built around logic ICs.

```
npm install
npm run dev      # start the app
npm test         # unit tests (Vitest)
npm run build    # type-check + production build
```

## Using it

| Action | How |
| --- | --- |
| Place a part | Drag it from the palette, or click it and then click the board |
| Wire | Click a hole, click another hole. Shift+click adds a bend. Esc cancels |
| Move a wire end | Select the wire and drag a blue handle |
| Move / rotate / delete | Drag / `R` / `Delete` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Start / stop | `Space` or the toolbar |
| Switches while running | Click them (hold the push button) |

The circuit is edited while stopped. Values, switches and display options can change live.
Work is autosaved in the browser; Export / Import move projects as JSON.

## Code layout

- `src/data` – breadboard geometry, part catalogue, **`ics.ts`** (one entry per IC), gate geometry, examples
- `src/simulation` – netlist (union-find), three-valued logic, DC solver, `simulate.ts` ties them together
- `src/store` – Zustand store: circuit, undo history, run state, project parsing
- `src/components/scene` – 3D; `src/components/ui` – panels and schematic

### Adding an IC

Add one `chip(...)` line to `src/data/ics.ts` with its gate type, pin mapping and gate symbol positions.
The palette, 3D model, internals view, pinout tooltip, schematic, truth table and simulator all read that entry.

## Simulation model

- Supplies and IC outputs are ideal sources (HIGH = VCC, LOW = GND, 20 mA output limit). All supplies share a ground unless wired in series.
- LEDs are a fixed forward drop, so `I = (Vs − Vf) / R`. Above 30 mA they gain a 10 Ω slope, which is what makes "Without resistor" a finite number (a red LED on 5 V shows 330 mA). A resistor with nothing else in its path shows `∞ short`.
- An LED above 20 mA burns open until the simulation is stopped.
- Gate inputs read solved node voltages, so pull-up and pull-down resistors work. Floating inputs are unknown (Z), not the implicit HIGH of real TTL.
- ICs run between 3 V and 7 V.
- Feedback works: latches hold state. Loops that never settle are reported as oscillation.
- Wire currents assume jumpers of equal resistance. ICs' own quiescent current is ignored.
- The simulation is a steady-state solve: there are no propagation delays, capacitors or clocks.

## Finding problems

Problems are listed while the simulation runs, or any time with **Check Circuit**, which keeps updating as you edit.
Open one to see why it matters and how to fix it; the camera flies there and the parts, pins and wires involved pulse
(red = error, amber = warning) in the 3D view and schematic. The rules live in `src/simulation/diagnose.ts`.

## Building from a manual

**Build from Manual** reads a .docx, .txt or .md lab sheet in the browser (nothing is uploaded) and looks for, in order:
a ripple-carry adder/subtractor, a complete truth table, or Boolean equations. It shows what it found next to editable
logic, compares the chip count with the parts list, and simulates the finished board against the manual's test cases
before you build. It is rule-based: schematics in pictures, sequential circuits, decoders and displays are not understood,
but any gate logic can be typed into the box. Code: `src/manual`.
