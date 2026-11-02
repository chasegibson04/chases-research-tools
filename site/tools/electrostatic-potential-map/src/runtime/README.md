`openchemlib-resources.json` is the resource file shipped with the `openchemlib` npm package (BSD-3-Clause, see
`openchemlib.LICENSE`). OpenChemLib needs it for 3D conformer generation and the MMFF94 force field. It is vendored here
(copy of `node_modules/openchemlib/dist/resources.json`) because the package's `exports` map hides it from bundlers.
When bumping `openchemlib`, copy the new file over this one: `cp site/node_modules/openchemlib/dist/resources.json
site/tools/electrostatic-potential-map/src/runtime/openchemlib-resources.json`.
