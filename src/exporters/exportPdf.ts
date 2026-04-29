import PDFDocument from 'pdfkit';
import { Token, Tokens } from 'marked';
import { inlineToText, MdToken, tokenize } from './markdownTokens';

interface PdfStyles {
  base: number;
  monoBase: number;
  margin: number;
  lineGap: number;
}

const STYLES: PdfStyles = {
  base: 11,
  monoBase: 10,
  margin: 56,
  lineGap: 4,
};

export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: STYLES.margin,
      info: { Title: title, Producer: 'Mark It Down', Creator: 'Mark It Down' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const tokens = tokenize(markdown);
      for (const token of tokens) {
        renderBlock(doc, token, 0);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderBlock(doc: PDFKit.PDFDocument, token: MdToken, indent: number): void {
  const t = token as Tokens.Generic;
  const indentLeft = indent * 18;
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      const sizes = [22, 18, 15, 13, 12, 11];
      const size = sizes[Math.max(0, Math.min(5, h.depth - 1))];
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#111').text(inlineToText(h.tokens), { lineGap: STYLES.lineGap });
      doc.moveDown(0.3);
      return;
    }
    case 'paragraph':
      doc.font('Helvetica').fontSize(STYLES.base).fillColor('#222').text(inlineToText((t as Tokens.Paragraph).tokens), {
        indent: indentLeft,
        align: 'left',
        lineGap: STYLES.lineGap,
      });
      doc.moveDown(0.4);
      return;
    case 'blockquote': {
      const inner = (t as Tokens.Blockquote).tokens ?? [];
      doc.save();
      doc.fillColor('#666').font('Helvetica-Oblique');
      for (const tok of inner) renderBlock(doc, tok as MdToken, indent + 1);
      doc.restore();
      return;
    }
    case 'list': {
      const list = t as Tokens.List;
      list.items.forEach((item, i) => {
        const start = typeof list.start === 'number' ? list.start : 1;
        const number = start + i;
        const bullet = list.ordered ? `${number}.` : '•';
        const item_ = item as Tokens.ListItem;
        const text = inlineToText(item_.tokens);
        doc.font('Helvetica').fontSize(STYLES.base).fillColor('#222').text(`${bullet}  ${text}`, {
          indent: indentLeft,
          lineGap: STYLES.lineGap,
        });
        for (const child of item_.tokens ?? []) {
          if ((child as Tokens.Generic).type === 'list') {
            renderBlock(doc, child as MdToken, indent + 1);
          }
        }
      });
      doc.moveDown(0.3);
      return;
    }
    case 'code': {
      const code = (t as Tokens.Code).text ?? '';
      const lang = (t as Tokens.Code).lang ?? '';
      doc.moveDown(0.2);
      if (lang) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888').text(lang, { indent: indentLeft });
      }
      const startY = doc.y;
      doc.font('Courier').fontSize(STYLES.monoBase).fillColor('#222').text(code, {
        indent: indentLeft,
        lineGap: 2,
      });
      const endY = doc.y;
      // Light grey background — drawn AFTER text so we backfill the area
      doc.save();
      doc.fillColor('#F5F5F5').rect(STYLES.margin + indentLeft - 6, startY - 2, doc.page.width - 2 * STYLES.margin - indentLeft + 12, endY - startY + 4).fill();
      doc.restore();
      // Re-render text on top
      doc.font('Courier').fontSize(STYLES.monoBase).fillColor('#222').text(code, {
        indent: indentLeft,
        lineGap: 2,
        continued: false,
      });
      doc.moveDown(0.4);
      return;
    }
    case 'table': {
      const tbl = t as Tokens.Table;
      const headers = tbl.header.map(c => inlineToText((c as Tokens.TableCell).tokens) || (c as Tokens.TableCell).text || '');
      const rows = tbl.rows.map(row =>
        row.map(c => inlineToText((c as Tokens.TableCell).tokens) || (c as Tokens.TableCell).text || ''),
      );
      const colCount = headers.length;
      const tableWidth = doc.page.width - 2 * STYLES.margin - indentLeft;
      const colWidth = tableWidth / colCount;
      doc.font('Helvetica-Bold').fontSize(STYLES.base).fillColor('#111');
      const y = doc.y;
      headers.forEach((h, i) => {
        doc.text(h, STYLES.margin + indentLeft + i * colWidth, y, {
          width: colWidth - 8,
          continued: false,
        });
      });
      doc.moveDown(0.2);
      doc.moveTo(STYLES.margin + indentLeft, doc.y).lineTo(STYLES.margin + indentLeft + tableWidth, doc.y).strokeColor('#bbb').stroke();
      doc.font('Helvetica').fillColor('#222');
      for (const row of rows) {
        const rowY = doc.y + 4;
        row.forEach((cell, i) => {
          doc.text(cell, STYLES.margin + indentLeft + i * colWidth, rowY, {
            width: colWidth - 8,
          });
        });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
      return;
    }
    case 'hr':
      doc.moveDown(0.3);
      doc.moveTo(STYLES.margin, doc.y).lineTo(doc.page.width - STYLES.margin, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.3);
      return;
    case 'space':
    case 'html':
      return;
    default:
      if ((t as Tokens.Generic).tokens) {
        for (const tok of (t as Tokens.Generic).tokens as Token[]) {
          renderBlock(doc, tok as MdToken, indent);
        }
      }
  }
}
