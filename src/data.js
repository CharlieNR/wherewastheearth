export const PERIODS = [
  { key: 'present', label: 'Present day', short: 'NOW', ma: 0, era: 'Cenozoic', color: '#78c9a0', description: 'Modern geography — the reference point for the journey.' },
  { key: 'pleistocene', label: 'Pleistocene', short: '2.6 Ma', ma: 2.6, era: 'Cenozoic', color: '#8bc6b4', description: 'Ice-age Earth, with changing ice sheets and sea levels.' },
  { key: 'miocene', label: 'Miocene', short: '15 Ma', ma: 15, era: 'Cenozoic', color: '#6fb69b', description: 'Continents were recognisable, but oceans and mountain belts were still evolving.' },
  { key: 'paleogene', label: 'Paleogene', short: '50 Ma', ma: 50, era: 'Cenozoic', color: '#64ad91', description: 'India was moving rapidly north toward Eurasia and the Atlantic was widening.' },
  { key: 'cretaceous', label: 'Cretaceous', short: '100 Ma', ma: 100, era: 'Mesozoic', color: '#e8b86b', description: 'A high sea-level world after the early stages of Pangaea breakup.' },
  { key: 'jurassic', label: 'Jurassic', short: '170 Ma', ma: 170, era: 'Mesozoic', color: '#dca861', description: 'Pangaea was splitting apart as the Central Atlantic opened.' },
  { key: 'triassic', label: 'Triassic', short: '230 Ma', ma: 230, era: 'Mesozoic', color: '#c89158', description: 'Most continental crust was assembled in Pangaea, surrounded by Panthalassa.' },
  { key: 'permian', label: 'Permian', short: '280 Ma', ma: 280, era: 'Paleozoic', color: '#a87555', description: 'The supercontinent cycle was drawing the continents together.' },
  { key: 'carboniferous', label: 'Carboniferous', short: '330 Ma', ma: 330, era: 'Paleozoic', color: '#7f6d63', description: 'Large continental collisions built the late Paleozoic supercontinent architecture.' },
  { key: 'devonian', label: 'Devonian', short: '390 Ma', ma: 390, era: 'Paleozoic', color: '#72877e', description: 'Major oceans separated large continental blocks as plate rearrangement accelerated.' },
  { key: 'silurian', label: 'Silurian', short: '430 Ma', ma: 430, era: 'Paleozoic', color: '#64857f', description: 'A world of broad shallow seas and moving continental fragments.' },
  { key: 'ordovician', label: 'Ordovician', short: '470 Ma', ma: 470, era: 'Paleozoic', color: '#5c7a79', description: 'Gondwana occupied high southern latitudes while other continents moved around it.' },
  { key: 'cambrian', label: 'Cambrian', short: '520 Ma', ma: 520, era: 'Paleozoic', color: '#55706f', description: 'Early Paleozoic continental blocks and a very different ocean configuration.' },
  { key: 'tonian', label: 'Tonian / Neoproterozoic', short: '720 Ma', ma: 720, era: 'Proterozoic', color: '#53696f', description: 'Deep-time reconstructions become increasingly uncertain as evidence gets sparse.' },
  { key: 'mesoproterozoic', label: 'Mesoproterozoic', short: '1.2 Ga', ma: 1200, era: 'Proterozoic', color: '#4f626d', description: 'Ancient continental assemblies represented by long-range plate-model reconstructions.' },
  { key: 'paleoproterozoic', label: 'Paleoproterozoic', short: '1.8 Ga', ma: 1800, era: 'Proterozoic', color: '#4b5d69', description: 'The oldest end of the visual plate-reconstruction journey in this edition.' },
];

export const EVENTS = [
  { id: 'modern', ma: 0, name: 'Present day', tag: 'Reference', lat: 0, lng: 20, summary: 'The familiar Earth — use this as the anchor for comparing every earlier view.' },
  { id: 'india-impact', ma: 50, name: 'India closes on Eurasia', tag: 'Collision', lat: 29, lng: 78, summary: 'India was moving north rapidly before colliding with Eurasia, helping build the Himalaya.' },
  { id: 'atlantic', ma: 170, name: 'Central Atlantic opening', tag: 'Ocean opens', lat: 27, lng: -43, summary: 'The breakup of Pangaea progressively separated North America from Africa and South America.' },
  { id: 'pangaea', ma: 230, name: 'Pangaea assembled', tag: 'Supercontinent', lat: 16, lng: 26, summary: 'Most major continental blocks were joined into a single supercontinent surrounded by Panthalassa.' },
  { id: 'gondwana', ma: 520, name: 'Gondwana dominates the south', tag: 'Continental assembly', lat: -40, lng: 20, summary: 'A huge southern continental assembly sat across high southern latitudes during the early Paleozoic.' },
  { id: 'rodinia', ma: 850, name: 'Rodinia cycle', tag: 'Deep time', lat: 5, lng: 65, summary: 'Rodinia is a reconstructed Neoproterozoic supercontinent; its exact arrangement remains debated.' },
  { id: 'nuna', ma: 1650, name: 'Nuna / Columbia', tag: 'Deep time', lat: 10, lng: -40, summary: 'Ancient supercontinent hypotheses link several cratons into a long-lived Paleoproterozoic assembly.' },
  { id: 'deep-time', ma: 1800, name: 'Deep-time boundary', tag: '1.8 billion years', lat: 0, lng: 0, summary: 'This is the oldest end of the reconstruction window used here. Earlier Earth history is more uncertain and is not rendered as a precise plate map.' },
];

export const PLATES = [
  { name: 'Pacific Plate', code: 'PAC', lat: 0, lng: -145, summary: 'The large oceanic plate at the centre of the modern Pacific basin.' },
  { name: 'North American Plate', code: 'NAM', lat: 35, lng: -105, summary: 'Carries North America and surrounding oceanic lithosphere.' },
  { name: 'South American Plate', code: 'SAM', lat: -15, lng: -58, summary: 'Moves west from the Mid-Atlantic Ridge, creating new ocean floor along the ridge.' },
  { name: 'African Plate', code: 'AFR', lat: 5, lng: 20, summary: 'A major continental-oceanic plate with active rifting in East Africa.' },
  { name: 'Eurasian Plate', code: 'EUR', lat: 52, lng: 75, summary: 'Carries much of Europe and Asia, excluding several surrounding plate fragments.' },
  { name: 'Indo-Australian region', code: 'IND', lat: -18, lng: 120, summary: 'A large plate region commonly subdivided into Indian and Australian plates in modern models.' },
  { name: 'Antarctic Plate', code: 'ANT', lat: -80, lng: 15, summary: 'Surrounds Antarctica and much of the Southern Ocean.' },
  { name: 'Southwest Pacific fragments', code: 'SWP', lat: -35, lng: 165, summary: 'A complex region of smaller plates and active convergent boundaries.' },
];

export const PLATE_BOUNDARIES = [
  { name: 'Mid-Atlantic Ridge', type: 'Divergent', points: [[-46, 75], [-34, 55], [-30, 30], [-25, 8], [-24, -15], [-18, -35], [-12, -55]] },
  { name: 'East Pacific Rise', type: 'Divergent', points: [[-112, 30], [-115, 10], [-110, -10], [-105, -30], [-102, -50]] },
  { name: 'Andean margin', type: 'Convergent', points: [[-78, 8], [-77, -10], [-74, -30], [-72, -48], [-70, -55]] },
  { name: 'Cascadia-Alaska arc', type: 'Convergent', points: [[-125, 48], [-145, 55], [-165, 58]] },
  { name: 'San Andreas system', type: 'Transform', points: [[-130, 49], [-124, 38], [-121, 33]] },
  { name: 'Himalayan collision', type: 'Convergent', points: [[62, 33], [76, 32], [90, 29], [103, 27]] },
  { name: 'Sumatra-Java arc', type: 'Convergent', points: [[95, 6], [105, -2], [115, -7], [125, -9]] },
  { name: 'Aleutian arc', type: 'Convergent', points: [[-170, 53], [-155, 52], [-140, 50]] },
  { name: 'East African Rift', type: 'Divergent', points: [[29, 13], [36, 2], [40, -10], [32, -22]] },
];

export const GEOLOGIC_FACTS = [
  { label: 'Why do plates move?', text: 'Plate motion is driven by a mixture of mantle convection, sinking slabs, and gravity-driven forces at ridges and plate edges.' },
  { label: 'What is uncertain?', text: 'Older reconstructions rely on indirect evidence such as palaeomagnetism, geological correlations, and the surviving shapes of ancient crust.' },
  { label: 'How old is this map?', text: 'The age is measured in millions of years before present (Ma). A larger number means deeper into Earth’s past.' },
];
