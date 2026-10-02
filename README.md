# intheglobe

A polished interactive educational globe for exploring how Earth's geography and tectonic systems changed through geological time.

## Included

- Interactive WebGL Earth with drag rotation, wheel/touch zoom, atmosphere, lighting, graticules and event markers.
- Geological timeline from the present to about 1.8 billion years ago.
- Live reconstruction requests using the public GPlates Web Service.
- Simplified plate-boundary overlay with divergent, convergent and transform examples.
- Search across periods, events and major plate regions.
- Contextual educational panels and reduced-motion support.
- Responsive desktop/tablet/mobile layouts.

## Run locally

    npm install
    npm run dev

Then open the local URL printed by Vite.

## Production

    npm run build
    npm run preview

## Data and references

Runtime geometry is derived from Natural Earth through the public world-atlas dataset. Natural Earth publishes its vector data as public domain.

The 3D globe uses React bindings for Three.js. Public globe projects used as engineering references include:

- https://github.com/vasturiano/three-globe
- https://github.com/vasturiano/react-globe.gl
- https://github.com/larrybuckalew/living-planet

Historical reconstruction requests use the GPlates Web Service. The app chooses a model based on age:
- MULLER2022 for the recent Paleozoic/Mesozoic range
- MERDITH2021 for deeper time
- CAO2024 for the oldest part of this visual journey

These models have different time coverage and reference-frame choices. The UI therefore describes the output as reconstruction rather than exact historical imagery.

## Scientific framing

The app is designed to build intuition without implying false precision. Older continental positions are increasingly uncertain. Plate boundaries in the educational overlay are intentionally simplified for readability and are not presented as a complete GIS layer.

## GitHub Pages

A workflow in .github/workflows/deploy.yml builds the Vite site and deploys the dist folder to GitHub Pages.

Project code is MIT licensed.
