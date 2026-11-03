import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { hash, readYaml, safePath } from '../core/io.js';
import type { Slide } from '../core/model.js';

/** Resolve a reviewed selection against the original CSV, never its extracted summary. */
export async function resolveChartData(dir: string, slide: Slide) {
  const chart = slide.chart;
  if (!chart?.binding || !chart.data_ref || !slide.source_refs.includes(chart.data_ref)) throw new Error('A CSV binding and data_ref in source_refs are required.');
  if (chart.fictional || chart.series.length) throw new Error('CSV-bound charts cannot also declare fictional or inline series data.');
  const binding = chart.binding;
  const index = await readYaml(await safePath(dir, path.join('content', 'sources.yaml')));
  const matches = (index.sources as { id:string; path:string; sha256:string; kind:string; error?:string }[]).filter(s => s.id === chart.data_ref);
  if (matches.length !== 1 || matches[0].kind !== 'csv' || matches[0].error) throw new Error('data_ref must identify one successfully ingested CSV source.');
  const source = matches[0];
  const bytes = await fs.readFile(await safePath(dir, source.path));
  const digest = hash(bytes);
  if (digest !== source.sha256 || digest !== binding.source_sha256) throw new Error('CSV source changed since selection or ingestion; review and update the binding before rebuilding.');
  const rows: string[][] = parse(bytes, { bom: true, columns: false, skip_empty_lines: false });
  if (!rows.length || !rows[0].length || new Set(rows[0]).size !== rows[0].length) throw new Error('CSV must have unique column headers.');
  const headers = rows[0];
  const selected = [binding.category_column, ...binding.value_columns];
  if (new Set(selected).size !== selected.length || selected.some(name => !headers.includes(name))) throw new Error('Selected CSV columns must be distinct existing headers.');
  if (new Set(binding.rows).size !== binding.rows.length || binding.rows.some(n => n > rows.length)) throw new Error('Selected CSV row numbers must be unique existing data records (header is row 1).');
  const category = headers.indexOf(binding.category_column);
  const columns = binding.value_columns.map(name => headers.indexOf(name));
  const labels: string[] = [];
  const series = columns.map(() => ({ values: [] as number[] }));
  for (const n of binding.rows) {
    const row = rows[n - 1];
    if (!row || row.length !== headers.length || !row[category].trim()) throw new Error(`CSV row ${n} must have all columns and a non-empty category.`);
    labels.push(row[category]);
    for (const [i, column] of columns.entries()) {
      const cell = row[column].trim();
      // Limit precision to what spreadsheet numeric cells can faithfully represent.
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell) || cell.split(/[eE]/)[0].replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15) throw new Error(`CSV row ${n}, column ${binding.value_columns[i]} is not a supported numeric value.`);
      const value = Number(cell);
      if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(cell.split(/[eE]/)[0]))) throw new Error(`CSV row ${n}, column ${binding.value_columns[i]} is outside the supported numeric range.`);
      series[i].values.push(value);
    }
  }
  return { labels, series, selection: { source_id: chart.data_ref, ...binding } };
}
