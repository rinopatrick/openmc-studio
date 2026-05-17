# OpenMC-Native Model Builder Direction

## Principle

The GUI must not invent a separate reactor drawing model. It should be a visual editor for OpenMC concepts:

- Material definitions
- Surfaces and half-spaces
- Boolean regions
- Cells
- Universes
- Rectangular and hexagonal lattices
- Sources, settings, tallies, and plots

The authoritative preview should come from OpenMC plotting (`plots.xml` plus `openmc --plot`) because OpenMC colors pixels by using its internal geometry lookup.

## User Flow

1. User chooses modeling intent: custom geometry, reactor core, assembly/pin, shielding/source, or import existing.
2. GUI opens an OpenMC concept workspace, not a template-only flow.
3. User creates surfaces using visual tools: plane, cylinder, sphere, box/slab, hex prism, boundary.
4. User combines surface half-spaces into cells via visual region rules: inside, outside, between, intersect, union, subtract.
5. User assigns material or universe/lattice fill to each cell.
6. User optionally creates lattices from repeated cells/universes.
7. User adds source, tallies, settings, and plot definitions.
8. GUI exports OpenMC XML and renders a native OpenMC plot for verification.

## UI Implication

The canvas is an editing aid. It can show handles, surfaces, and regions, but it must not claim to be a 1:1 simulation preview. The 1:1 preview panel is the PNG produced by OpenMC.

## First Implementation Target

Build a custom CSG editor for common OpenMC geometry:

- Surfaces: `x-plane`, `y-plane`, `z-plane`, `z-cylinder`, `sphere`, rectangular slab helper, hex prism helper.
- Cells: material fill, void fill, universe/lattice fill.
- Regions: generated from helper recipes first, then editable Boolean expressions.
- Plots: xy/xz/yz slice plot with color by material/cell.

This supports pin cells, assemblies, shielding slabs, simple vessels, and non-reactor fixed-source models before any reactor-specific templates.
