import PptxGenJS from 'pptxgenjs';
import { measureText } from './text-fit.js';
import sharp from 'sharp';
import path from 'node:path';
import { safePath } from '../core/io.js';
import { type Slide, type Theme, type Localized } from '../core/model.js';
import { type Issue } from '../validation/index.js';
import { resolveChartData } from '../content/chart-data.js';
import { fictionalDataDisclosure } from '../localization/index.js';

export const WIDTH = 13.333333, HEIGHT = 7.5;
export type Box = { x: number; y: number; w: number; h: number; role: string; font?: number; text?: string };
export type SlideGeometry = { id: string; locale: string; boxes: Box[] };

// Public compatibility helper; geometry uses the same glyph-aware estimate.
export function textLines(text: string, width: number, font: number) {
  return measureText(text, width, font).lines;
}
export function validateGeometry(g: SlideGeometry): Issue[] {
  const issues: Issue[]=[];
  const issue=(code: string,message: string) => issues.push({severity:'error',code,message,slide:g.id,locale:g.locale});
  for (const b of g.boxes) {
    if (b.x<0 || b.y<0 || b.x+b.w>WIDTH+.01 || b.y+b.h>HEIGHT+.01) issue('bounds',`${b.role} falls outside slide boundaries.`);
    if (b.text && b.font && textLines(b.text,b.w,b.font)*b.font*1.22/72>b.h+.025) issue('text-overflow',`${b.role} may overflow (${textLines(b.text,b.w,b.font)} estimated lines; conservative glyph estimate). Shorten the text or change composition; font ${b.font} pt. Verify with a local render.`);
    if (b.font && b.font<16 && b.role!=='footer' && b.role!=='citation') issue('small-text',`${b.role} uses less than 16 pt.`);
  }
  for (let i=0;i<g.boxes.length;i++) for (let j=i+1;j<g.boxes.length;j++) {
    const a=g.boxes[i], b=g.boxes[j];
    const overlap=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.03 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.03;
    if (overlap) issue('overlap',`${a.role} overlaps ${b.role}.`);
  }
  return issues;
}

export async function drawSlide(pptx: PptxGenJS, model: Slide, c: Localized, theme: Theme, locale: string, dir: string, index: number): Promise<SlideGeometry> {
  const slide=pptx.addSlide();
  slide.background={color:theme.background};
  const g: SlideGeometry={id:model.id,locale,boxes:[]};
  const m=theme.margin, inner=WIDTH-2*m;
  const text=(value: string,x:number,y:number,w:number,h:number,font=theme.body,role='text',color=theme.foreground,bold=false) => {
    if (!value) return;
    g.boxes.push({x,y,w,h,font,role,text:value});
    slide.addText(value,{x,y,w,h,fontFace:theme.font,fontSize:font,color,bold,margin:0,breakLine:false,valign:'top',paraSpaceAfter:0,lang:locale});
  };
  const rect=(x:number,y:number,w:number,h:number,color=theme.pale) => slide.addShape(pptx.ShapeType.rect,{x,y,w,h,line:{color,transparency:100},fill:{color}});
  const footerY=7.13;
  text(`${String(index+1).padStart(2,'0')}   /   ${model.id}`,m,footerY,1.5,.2,10,'footer',theme.secondary);
  text(model.citations.join(' · '),2.4,footerY,WIDTH-m-2.4,.22,10,'citation',theme.secondary);
  const claimLinks=(model.claims??[]).map(claim=>`${claim.id}: field=${claim.field}; source=${claim.source_ref}${claim.locator?`; locator=${claim.locator}`:''}`).join('\n');
  slide.addNotes(`[${model.id}] ${c.notes}\nEvidence: ${model.evidence}\nSources: ${model.source_refs.join(', ')}\nCitations: ${model.citations.join('; ')}${claimLinks?`\nClaims:\n${claimLinks}`:''}`);
  if (['title','conclusion'].includes(model.layout)) {
    rect(m,1.04,.6,.06,theme.accent);
    text(c.title,m,1.45,inner,1.25,theme.heading+4,'title',theme.foreground,true);
    text(c.message,m,3.08,inner,1.45,theme.body+4,'message',theme.accent);
    text(c.body,m,5.14,inner,1.05,20,'body',theme.secondary);
    return g;
  }
  text(c.title,m,.53,inner,1.2,theme.heading,'title',theme.foreground,true);
  const asset = async (x:number,y:number,w:number,h:number) => {
    g.boxes.push({x,y,w,h,role:'illustration'});
    if (model.visual?.asset) {
      const file=await safePath(dir,model.visual.asset);
      // Rasterize only the separate illustration for broad Office compatibility.
      const buffer=await sharp(file).resize({width:1600,height:1200,fit:'inside'}).png().toBuffer();
      const meta=await sharp(buffer).metadata();
      const scale=Math.min(w/meta.width!,h/meta.height!);
      const iw=meta.width!*scale, ih=meta.height!*scale;
      slide.addImage({data:`image/png;base64,${buffer.toString('base64')}`,x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih,altText:c.alt});
    } else {
      rect(x,y,w,h);
      slide.addText(locale.startsWith('fr') ? 'Illustration à fournir' : 'Illustration pending',{x:x+.3,y:y+h/2-.2,w:w-.6,h:.5,fontSize:20,fontFace:theme.font,color:theme.secondary,margin:0});
    }
  };
  if (model.layout==='text-image') {
    text(c.message,m,2.08,5.35,1.25,theme.body+2,'message',theme.accent);
    text(c.body,m,3.75,5.35,2.15,theme.body,'body');
    await asset(7.02,2.04,5.6,4.36);
  } else if (model.layout==='full-image') {
    await asset(m,1.94,inner,3.95);
    text(c.caption||c.message,m,6.12,inner,.65,18,'caption',theme.secondary);
  } else if (model.layout==='workflow' || model.layout==='diagram') {
    text(c.message,m,1.98,inner,.83,theme.body,'message',theme.accent);
    const count=c.labels.length, gap=.48, w=(inner-(count-1)*gap)/count;
    c.labels.forEach((label,i)=>{
      const x=m+i*(w+gap);
      rect(x,3.22,w,1.42);
      text(label,x+.15,3.52,w-.3,.8,22,`node-${i}`);
      if (i<count-1) slide.addShape(pptx.ShapeType.line,{x:x+w+.08,y:3.93,w:gap-.16,h:0,line:{color:theme.accent,width:1.6,beginArrowType:'none',endArrowType:'triangle'}});
    });
    text(c.body,m,5.32,inner,1.05,20,'body',theme.secondary);
  } else if (model.layout==='chart' && model.chart) {
    text(c.message,m,1.95,inner,.75,20,'message',theme.secondary);
    const box={x:m,y:2.9,w:inner,h:3.05,role:'chart'};
    g.boxes.push(box);
    const series=model.chart.fictional ? model.chart.series : (await resolveChartData(dir,model)).series;
    slide.addChart(pptx.ChartType.bar,series.map((s,i)=>({name:c.seriesNames[i],labels:c.labels,values:s.values})),{
      ...box,barDir:'col',catAxisLabelFontFace:theme.font,catAxisLabelFontSize:18,valAxisLabelFontFace:theme.font,valAxisLabelFontSize:16,
      chartColors:series.length>1?[theme.accent,'849DA0','BBCACC']:[theme.accent],showLegend:series.length>1,showTitle:false,showValue:true,dataLabelFormatCode:'General',
      dataLabelPosition:'outEnd',dataLabelColor:theme.foreground,dataLabelFontFace:theme.font,dataLabelFontSize:16,
      valGridLine:{color:'E4E4E7'},
      catAxisLineColor:theme.secondary,valAxisLineColor:theme.background,
      altText:c.alt||c.caption,legendFontFace:theme.font,legendFontSize:16
    });
    if (model.chart.fictional) {
      const disclosure=fictionalDataDisclosure(locale,c.fictionalNotice);
      if (!disclosure) throw new Error(`No fictional-data disclosure is available for locale ${locale}.`);
      text(disclosure,m,6.03,inner,.3,16,'fictional-disclosure',theme.secondary,true);
      text(c.caption,m,6.4,inner,.48,16,'caption',theme.secondary);
    } else text(c.caption,m,6.4,inner,.48,16,'caption',theme.secondary);
  } else if (model.layout==='comparison') {
    const gap=.7, w=(inner-gap)/2;
    [c.message,c.body].forEach((value,i)=>{
      const x=m+i*(w+gap);
      text(c.labels[i]||'',x,2.15,w,.75,26,`comparison-heading-${i}`,theme.accent,true);
      text(value,x,3.24,w,2.8,theme.body,`comparison-body-${i}`);
    });
  } else {
    text(c.message,m,2.15,inner,1.35,theme.body+4,'message',theme.accent);
    text(c.body,m,3.98,inner,2.55,theme.body,'body');
  }
  return g;
}
