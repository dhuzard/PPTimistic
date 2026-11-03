import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import { buildProject } from '../core/build.js';
import { artifactIssues, inspectArtifacts } from '../core/artifacts.js';
import { doctor } from '../core/doctor.js';
import { createProject, availableName } from '../core/projects.js';
import { exists, hash, loadProject, projectDir, readYaml, safePath, stamp, writeYaml, atomicWrite, root } from '../core/io.js';
import { localeSchema, localizedSchema, deckSchema, projectSchema } from '../core/model.js';
import { ingest } from '../content/ingest.js';
import { translationRequest, consistency, fictionalDataDisclosure } from '../localization/index.js';
import { validateContent, validatePptx } from '../validation/index.js';
import { renderProject } from '../rendering/index.js';
import { applyRevision } from '../feedback/index.js';
import { prepareImages, attachImage } from '../images/index.js';

const cli=new Command().name('pptimistic').description('Create editable presentations locally. No API key required.').version('0.1.0');
const defaults=projectSchema.parse({title:'PPTimistic',...await readYaml(path.join(root,'config/defaults.yaml'))});
const language=(value?:string) => (value??process.env.LC_ALL??process.env.LANG??Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith('fr')?'fr':'en';
const split=(s:string)=>s.split(',').map(s=>s.trim()).filter(Boolean);
function projectOption(c:Command) {
  c.argument('[projectName]','Project folder under projects/ (also accepted when npm drops --project)')
    .option('-p, --project <name>','Project folder under projects/','demo');
  c.hook('preAction',command=>{
    const name=command.processedArgs[0] as string|undefined;
    if (!name) return;
    if (command.getOptionValueSource('project')==='cli') throw new Error('Specify the project once, using --project or a positional name.');
    command.setOptionValue('project',name);
  });
  return c;
}
function print(value:unknown) { console.log(typeof value==='string'?value:JSON.stringify(value,null,2)); }

for (const command of ['setup','new','demo']) {
  cli.command(command).description(command==='setup'?'Guided first-run setup (English/French)':command==='demo'?'Create or rebuild the five-slide bilingual demo':'Create an independent presentation project')
    .option('-p, --project <name>','New project name (existing projects are preserved)')
    .option('--title <text>','Presentation title','PPTimistic')
    .option('--source <locale>','Original content language',defaults.source_locale)
    .option('--locales <list>','Comma-separated output languages',defaults.output_locales.join(','))
    .option('--theme <name>','editorial-minimal, scientific-technical, illustrated-minimal',defaults.theme)
    .option('--inputs <folder>','Local folder of source documents')
    .option('--from-plan','Import exactly one Markdown plan, using ## headings as slide titles')
    .option('--ui <language>','CLI interface language: en or fr')
    .option('--yes','Noninteractive defaults; never approves overwriting')
    .option('--no-render','Skip optional preview generation')
    .action(async o=>{
      const fr=language(o.ui)==='fr';
      print(fr?'Bienvenue dans PPTimistic. Vos documents restent sur cet ordinateur.':'Welcome to PPTimistic. Your documents stay on this computer.');
      const diagnostics=await doctor();
      if (!diagnostics.nodeOk||!diagnostics.writable||diagnostics.dependencies.some(d=>!d.available)) throw new Error('Environment check failed. Run npm run doctor.');
      print(fr?'Création de diapositives PowerPoint modifiables, sans service payant.':'Creating editable PowerPoint slides, without paid services.');
      print({rendering:diagnostics.rendering,fonts:diagnostics.fonts});
      let title=o.title,source=o.source,locales=o.locales,theme=o.theme,inputs=o.inputs;
      const interactive=!o.yes&&process.stdin.isTTY&&command!=='demo';
      if (interactive) {
        title=await input({message:fr?'Titre de la présentation':'Presentation title',default:title});
        source=await select({message:fr?'Langue du contenu original':'Original content language',choices:[{name:'English',value:'en-US'},{name:'Français',value:'fr-FR'}],default:source});
        locales=await input({message:fr?'Langues de sortie (séparées par des virgules)':'Output languages (comma-separated)',default:locales});
        theme=await select({message:fr?'Style visuel':'Visual preset',choices:['editorial-minimal','scientific-technical','illustrated-minimal'].map(value=>({name:value,value})),default:theme});
        inputs=await input({message:fr?'Dossier de documents (facultatif)':'Document folder (optional)',default:inputs??''});
      }
      localeSchema.parse(source); const outputs=split(locales).map(l=>localeSchema.parse(l));
      // Validate settings before creating any directory.
      if (!['en-US','fr-FR'].includes(source)) throw new Error('The starter supports en-US/fr-FR. Other languages can be authored manually after setup.');
      if (!['editorial-minimal','scientific-technical','illustrated-minimal'].includes(theme)) throw new Error(`Unknown theme: ${theme}`);
      if (inputs && !(await exists(path.resolve(inputs)))) throw new Error(`Input folder not found: ${inputs}`);
      const name=o.project??(command==='demo'?'demo':await availableName('my-presentation'));
      if (command==='demo'&&await exists(projectDir(name))) print(`Rebuilding existing ${name}; its source content is preserved.`);
      else await createProject({name,title,source,locales:outputs,theme,inputs:inputs||undefined,fromPlan:o.fromPlan});
      if (inputs) {
        const sources=(await readYaml(path.join(projectDir(name),'content/sources.yaml'))).sources;
        const failures=sources.filter((s:{error?:string})=>s.error);
        if(failures.length) print({extractionWarnings:failures});
      }
      if (inputs && !o.fromPlan) print(fr?'Documents importés. Le contenu actuel est une démonstration fictive, pas un résumé de vos documents.':'Documents imported. The current content is a fictional demonstration, not a summary of your documents.');
      const result=await buildProject(name); print({powerpoints:result.files});
      if (o.render) print(await renderProject(name));
      print(fr?`Prêt. Demandez à votre agent de modifier projects/${name}/content/slides.yaml, puis lancez npm run build -- --project ${name}.`:`Ready. Ask your agent to edit projects/${name}/content/slides.yaml, then run npm run build -- --project ${name}.`);
    });
}
cli.command('doctor').description('Check Node, dependencies, fonts, writable storage and optional renderers').option('--ui <language>','Interface language').action(async o=>{
  if(language(o.ui)==='fr') print('Diagnostic : les composants facultatifs manquants ne bloquent pas la création PowerPoint.');
  const d=await doctor();print(d); if(!d.nodeOk||!d.writable||d.dependencies.some(d=>!d.available)) process.exitCode=1;
});
projectOption(cli.command('build').description('Validate and build independent PPTX files; preserve earlier outputs'))
  .option('--locale <locale>','Build one language').option('--authorize <ids>','Explicitly allow changes to these approved/locked slide IDs (comma-separated)')
  .action(async (_name,o)=>{const r=await buildProject(o.project,{locale:o.locale,authorize:split(o.authorize??'')});print({files:r.files,changedSlides:r.report.changedSlides,warnings:r.report.issues});});
projectOption(cli.command('validate').description('Validate source, translations, layout and current PPTX outputs'))
  .option('--source-only','Validate authored source without requiring current PPTX outputs')
  .action(async (_name,o)=>{
  const {dir,config,deck,theme}=await loadProject(o.project);
  const issues=await validateContent(dir,config,deck,theme);
  const {drawSlide,validateGeometry}=await import('../layouts/index.js');
  const {default:PptxGenJS}=await import('pptxgenjs');
  for(const locale of config.output_locales) {
    const p=new PptxGenJS();p.layout='LAYOUT_WIDE';
    for(const [i,s] of deck.slides.entries()) if(s.content[locale]) {
      try {issues.push(...validateGeometry(await drawSlide(p,s,s.content[locale],theme,locale,dir,i)));}
      catch(e) {issues.push({severity:'error',code:'render-object',slide:s.id,locale,message:(e as Error).message});}
    }
    if (!o.sourceOnly) {
      const file=await safePath(dir,`output/presentation.${locale}.pptx`);
      if(await exists(file)) {try {await validatePptx(file,deck.slides.length);} catch(e) {issues.push({severity:'error',code:'pptx',locale,message:(e as Error).message});}}
    }
  }
  if (!o.sourceOnly) issues.push(...artifactIssues(await inspectArtifacts(o.project)));
  print({issues,errors:issues.filter(i=>i.severity==='error').length});
  if(issues.some(i=>i.severity==='error')) process.exitCode=1;
});
projectOption(cli.command('claims').description('Print a local read-only claim provenance report (excerpt text is withheld)')).action(async (_name,o)=>{
  const {dir,config,deck,theme}=await loadProject(o.project);
  const sourceIndex=await safePath(dir,'content/sources.yaml');
  const sourceRecords=await exists(sourceIndex)?((await readYaml(sourceIndex)).sources as {id:string;path:string;sha256:string;extracted?:string;extracted_sha256?:string}[]):[];
  const issues=await validateContent(dir,config,deck,theme);
  const report={project:o.project,source_locale:config.source_locale,claims:deck.slides.flatMap(slide=>(slide.claims??[]).map(claim=>{
    const source=sourceRecords.find(record=>record.id===claim.source_ref);
    const localizedText=Object.fromEntries(Object.entries(slide.content).map(([locale,content])=>[locale,content[claim.field]]));
    const validationIssues=issues.filter(issue=>issue.claim===claim.id||(issue.code==='source-integrity'&&issue.slide===slide.id));
    return {slide_id:slide.id,claim_id:claim.id,field:claim.field,localized_text:localizedText,source_ref:claim.source_ref,source_path:source?.path,source_sha256:source?.sha256,extracted_path:source?.extracted,extracted_sha256:source?.extracted_sha256,locator:claim.locator,excerpt_sha256:hash(claim.excerpt),excerpt_length:[...claim.excerpt].length,validation_issues:validationIssues.map(({severity,code,message})=>({severity,code,message}))};
  }))};
  print(report);
  if(report.claims.some(claim=>claim.validation_issues.some(issue=>issue.severity==='error'))) process.exitCode=1;
});
projectOption(cli.command('render').description('Create real slide PNG previews, PDF and a contact sheet with a local renderer'))
  .option('--locale <locale>','Render one language').option('--renderer <name>','auto, libreoffice or powerpoint','auto')
  .action(async (_name,o)=>{if(!['auto','libreoffice','powerpoint'].includes(o.renderer))throw new Error('Unknown renderer');print(await renderProject(o.project,o.locale,o.renderer));});
projectOption(cli.command('ingest').description('Retain and extract local documents with hashes; does not invent slide summaries'))
  .option('--inputs <folder>','Folder to import (defaults to project inputs/)')
  .action(async (_name,o)=>{const {dir}=await loadProject(o.project);const records=await ingest(dir,o.inputs);print(records);if(records.some(r=>r.error))process.exitCode=1;});
projectOption(cli.command('translate').description('Export a manual translation request, or validate and import completed translations'))
  .requiredOption('--to <locale>','Target BCP 47 language').option('--file <path>','YAML translation request with translation objects filled in')
  .option('--authorize <ids>','Allow edits to protected slide translations').action(async (_name,o)=>{
    const to=localeSchema.parse(o.to),{dir,config,deck}=await loadProject(o.project);
    if(to===config.source_locale) throw new Error('Target must differ from source locale.');
    const request=translationRequest(deck,config.source_locale,to,config.glossary);
    if(!o.file) {const dest=await safePath(dir,`content/translation-request.${to}.${stamp()}.yaml`);await writeYaml(dest,request);print(`No translation provider configured. Fill in translation fields in ${dest}, then rerun with --file. Missing slides: ${request.slides.length}`);return;}
    const batch=await readYaml(path.resolve(o.file));
    if(batch.to!==to||batch.from!==config.source_locale||!Array.isArray(batch.slides))throw new Error('Translation file must declare matching from/to locales and slides.');
    const authorized=split(o.authorize??'');const seen=new Set<string>();
    for(const entry of batch.slides) {
      const s=deck.slides.find(s=>s.id===entry.id);if(!s||seen.has(entry.id))throw new Error(`Unknown or duplicate slide ID: ${entry.id}`);seen.add(entry.id);
      const c=localizedSchema.parse(entry.translation);
      if((s.locked||['approved','locked'].includes(s.status)||['approved','locked'].includes(s.content[to]?.review))&&!authorized.includes(s.id))throw new Error(`${s.id}: protected translation requires --authorize ${s.id}`);
      const problems=consistency(s.content[config.source_locale],c,config.glossary);if(problems.length)throw new Error(`${s.id}: ${problems.join('; ')}`);
      if(s.chart?.fictional&&!fictionalDataDisclosure(to,c.fictionalNotice))throw new Error(`${s.id}: fictional chart requires a reviewed localized fictionalNotice for ${to}; translation import was not saved.`);
      s.content[to]=c;
    }
    if(deck.slides.some(s=>!s.content[to]))throw new Error('Translation import is incomplete; no changes saved.');
    const contentFile=await safePath(dir,config.content);
    await atomicWrite(path.join(dir,`feedback/${stamp()}.translation-before.yaml`),await fs.readFile(contentFile));
    await writeYaml(contentFile,deckSchema.parse(deck));
    if(!config.output_locales.includes(to))config.output_locales.push(to);
    await writeYaml(path.join(dir,'project.yaml'),config);print(`Imported ${to}. Review translations, then build.`);
  });
projectOption(cli.command('revise').description('Log natural-language feedback or apply a structured, auditable revision'))
  .option('--slide <id>','Stable slide ID').option('--message <text>','Feedback for an agent; logged without automatic interpretation')
  .option('--category <type>','content, layout, typography, illustration, translation, scientific-correction, global-theme','content')
  .option('--file <path>','YAML revision: slide, locale, category, message, patch/layout/status')
  .option('--authorize <ids>','Allow a specific approved/locked slide to change').action(async (_name,o)=>{
    if(!o.file&&(!o.slide||!o.message))throw new Error('Provide --file or both --slide and --message.');
    print(await applyRevision(o.project,o.file?await readYaml(path.resolve(o.file)):{slide:o.slide,category:o.category,message:o.message},split(o.authorize??'')));
  });
projectOption(cli.command('images').description('Prepare per-slide prompts and provenance; reuse accepted local assets'))
  .option('--slide <id>','Only one stable slide ID').option('--asset <file>','Attach a local image (requires --slide)')
  .option('--authorize <ids>','Approve replacing an accepted/protected asset').action(async (_name,o)=>{
    if(o.asset&&!o.slide)throw new Error('--asset requires --slide.');
    print(o.asset?await attachImage(o.project,o.slide,o.asset,split(o.authorize??'')):await prepareImages(o.project,o.slide));
  });

cli.showHelpAfterError();
cli.parseAsync().catch(error=>{console.error(`Error: ${error.message}`);process.exitCode=1;});
