/** Reads a manual into paragraphs and tables. Runs entirely in the browser. */
import { strFromU8, unzipSync } from 'fflate'

export interface Doc { lines: string[]; tables: string[][][] }
const MAX_FILE = 25e6
const MAX_XML = 40e6

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
function textOf(xml: string): string {
  let s = ''
  for (const m of xml.matchAll(/<(?:w|m):t(?:\s[^>]*)?>([^<]*)<\/(?:w|m):t>|<w:tab\/>|<w:br\/>|<\/w:p>/g)) s += m[1] !== undefined ? decode(m[1]) : ' '
  return s.replace(/\s+/g, ' ').trim()
}

export function readDocx(bytes: Uint8Array): Doc {
  if (bytes.length > MAX_FILE) throw new Error('The file is larger than 25 MB')
  let xml: string | undefined
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_XML })
    if (files['word/document.xml']) xml = strFromU8(files['word/document.xml'])
  } catch { /* reported below */ }
  if (!xml) throw new Error('This is not a readable Word (.docx) file')
  const doc: Doc = { lines: [], tables: [] }
  for (const m of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (!m[0].startsWith('<w:tbl')) {
      const t = textOf(m[0])
      if (t) doc.lines.push(t)
      continue
    }
    const rows = [...m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => textOf(c[0])))
    if (rows.length) doc.tables.push(rows)
    for (const r of rows) doc.lines.push(r.join(' | '))
  }
  return doc
}

/** plain text / markdown: lines with | or tabs form tables */
export function readText(text: string): Doc {
  if (text.length > MAX_FILE) throw new Error('The file is larger than 25 MB')
  const doc: Doc = { lines: [], tables: [] }
  let table: string[][] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const cells = line.includes('|') ? line.replace(/^\||\|$/g, '').split('|') : line.includes('\t') ? line.split('\t') : null
    if (cells && cells.length > 1) {
      if (cells.every((c) => /^[\s:-]+$/.test(c))) continue // markdown rule
      if (!table) doc.tables.push((table = []))
      table.push(cells.map((c) => c.trim()))
    } else table = null
    if (line) doc.lines.push(line)
  }
  return doc
}

export async function readManual(file: File): Promise<Doc> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'docx') return readDocx(new Uint8Array(await file.arrayBuffer()))
  if (ext === 'txt' || ext === 'md') return readText(await file.text())
  if (ext === 'doc' || ext === 'pdf') throw new Error(`.${ext} files cannot be read yet. Open it in Word and save it as .docx`)
  throw new Error('Choose a .docx, .txt or .md file')
}
