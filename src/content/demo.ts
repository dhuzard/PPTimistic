import { deckSchema } from '../core/model.js';

export function demoDeck(title: string) {
  const rows = [
    { id: 'S001', layout: 'title', en: [title, 'Clear ideas. Editable slides.', 'A local-first studio for scientific communication.'], fr: [title, 'Des idées claires. Des diapositives modifiables.', 'Un studio local pour la communication scientifique.'] },
    { id: 'S002', layout: 'text-image', en: ['Give each slide one clear message', 'Make the idea easy to see.', 'Keep the explanation in your notes. Give the audience space to think.'], fr: ['Une idée claire par diapositive', 'Rendre le message visible.', 'Gardez les explications dans les notes. Laissez au public le temps de réfléchir.'] },
    { id: 'S003', layout: 'workflow', en: ['From sources to a shared understanding', 'A deliberate, reviewable process.', 'Every step is a native, editable PowerPoint shape.'], fr: ['Des sources à une compréhension partagée', 'Un processus réfléchi, ouvert à la relecture.', 'Chaque étape est une forme PowerPoint native et modifiable.'] },
    { id: 'S004', layout: 'chart', en: ['Show the data. State the limits.', 'Fictional example data — no scientific inference.', 'This editable chart demonstrates the format, not a research result.'], fr: ['Montrer les données et leurs limites', 'Données fictives — aucune inférence scientifique.', 'Ce graphique modifiable illustre le format, pas un résultat de recherche.'] },
    { id: 'S005', layout: 'conclusion', en: ['Start with the evidence', 'Build a clear story.\nKeep every claim traceable.', 'Add your documents, review the source, then build your next presentation.'], fr: ['Partir des preuves', 'Construire un récit clair.\nDocumenter chaque affirmation.', 'Ajoutez vos documents, relisez les sources, puis créez votre présentation.'] }
  ];
  return deckSchema.parse({ version: 1, slides: rows.map(r => ({
    id: r.id, layout: r.layout, evidence: 'conceptual',
    content: Object.fromEntries([['en-US', r.en], ['fr-FR', r.fr]].map(([locale, parts]) => {
      const p = parts as string[];
      return [locale, { title: p[0], message: p[1], body: p[2], notes: p[2],
        caption: r.id === 'S004' ? p[1] : '',
        alt: r.id === 'S002' ? (locale === 'fr-FR' ? 'Illustration conceptuelle : une idée centrale relie trois éléments.' : 'Conceptual illustration: one central idea connects three elements.') : '',
        labels: r.id === 'S003' ? (locale === 'fr-FR' ? ['Sources', 'Structure', 'Relecture', 'Partage'] : ['Sources', 'Structure', 'Review', 'Share']) : r.id === 'S004' ? (locale === 'fr-FR' ? ['Exemple A', 'Exemple B', 'Exemple C'] : ['Example A', 'Example B', 'Example C']) : [],
        seriesNames: r.id === 'S004' ? [locale === 'fr-FR' ? 'Valeurs fictives' : 'Fictional values'] : [], review: 'draft' }];
    })),
    ...(r.id === 'S004' ? { chart: { fictional: true, series: [{ values: [12, 19, 15] }] } } : {}),
    ...(r.id === 'S002' ? { visual: { asset: 'assets/reference/idea.svg', brief: 'Conceptual network, one central idea, restrained teal, no text.', accepted: true } } : {})
  })) });
}

export const ideaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="#EEF4F3"/><g stroke="#225E63" stroke-width="4" fill="none"><path d="M450 350 L260 200 M450 350 L680 260 M450 350 L480 560"/></g><g fill="#FFFFFF" stroke="#225E63" stroke-width="4"><circle cx="260" cy="200" r="60"/><circle cx="680" cy="260" r="78"/><circle cx="480" cy="560" r="48"/></g><circle cx="450" cy="350" r="100" fill="#225E63"/></svg>`;
