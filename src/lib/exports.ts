import 'server-only';
import ExcelJS from 'exceljs';
import type { PdfColumn } from './pdf';
import { fmtDate, fmtDateTime } from './dates';
import { num } from './money';

export interface ExportSheet {
  name: string;
  title?: string;
  subtitle?: string;
  columns: PdfColumn[];
  rows: any[];
  totals?: Record<string, any>;
}

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0E2340' } };
const TOTAL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEEF2F8' } };

/** Professional multi-sheet Excel workbook. */
export async function excelReport(opts: {
  orgName: string;
  reportTitle: string;
  filters?: string[];
  sheets: ExportSheet[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.orgName;
  wb.created = new Date();
  wb.title = opts.reportTitle;

  for (const sheet of opts.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31).replace(/[\\/*?:\[\]]/g, '-'));
    const colCount = sheet.columns.length;

    ws.mergeCells(1, 1, 1, Math.max(colCount, 3));
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `${opts.orgName} — ${sheet.title || opts.reportTitle}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF0E2340' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 24;

    ws.mergeCells(2, 1, 2, Math.max(colCount, 3));
    const subCell = ws.getCell(2, 1);
    subCell.value = [sheet.subtitle, ...(opts.filters || []), `Generated ${fmtDateTime(new Date())}`]
      .filter(Boolean)
      .join('   |   ');
    subCell.font = { size: 9, color: { argb: 'FF5B6472' } };
    ws.getRow(2).height = 16;

    const headerRow = ws.getRow(4);
    sheet.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: 'middle', horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8860B' } } };
    });
    headerRow.height = 22;

    ws.columns = sheet.columns.map((c) => ({ width: c.width ? Math.max(10, c.width / 6.4) : 26 }));

    sheet.rows.forEach((row, rIndex) => {
      const r = ws.getRow(5 + rIndex);
      sheet.columns.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        const raw = row[c.key];
        const text = c.format ? c.format(raw, row) : raw === null || raw === undefined ? '' : String(raw);
        cell.value = isNumericColumn(c, text) ? num(text) : text;
        cell.alignment = { horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', vertical: 'top' };
        cell.font = { size: 10 };
        if (isNumericColumn(c, text)) cell.numFmt = '#,##0.00';
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E9F0' } } };
      });
      if (rIndex % 2 === 1) {
        sheet.columns.forEach((_c, i) => {
          r.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
        });
      }
    });

    if (sheet.totals) {
      const t = ws.getRow(5 + sheet.rows.length);
      sheet.columns.forEach((c, i) => {
        const cell = t.getCell(i + 1);
        const v = sheet.totals![c.key];
        cell.value = v === undefined || v === null ? '' : isNumericColumn(c, String(v)) ? num(v) : String(v);
        cell.font = { bold: true, size: 10, color: { argb: 'FF0E2340' } };
        cell.fill = TOTAL_FILL;
        if (isNumericColumn(c, String(v ?? ''))) cell.numFmt = '#,##0.00';
      });
    }

    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: colCount } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function isNumericColumn(c: PdfColumn, text: string): boolean {
  if (c.align !== 'right') return false;
  const cleaned = String(text).replace(/[^0-9.\-]/g, '');
  return cleaned !== '' && cleaned !== '-' && !Number.isNaN(Number(cleaned));
}

/** CSV export (RFC 4180). */
export function csvReport(sheet: ExportSheet): string {
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(sheet.columns.map((c) => escape(c.label)).join(','));
  for (const row of sheet.rows) {
    lines.push(
      sheet.columns
        .map((c) => {
          const raw = row[c.key];
          return escape(c.format ? c.format(raw, row) : raw);
        })
        .join(','),
    );
  }
  if (sheet.totals) {
    lines.push(
      sheet.columns
        .map((c) => {
          const v = sheet.totals![c.key];
          return escape(v);
        })
        .join(','),
    );
  }
  return lines.join('\r\n');
}

export const dateColumn = (key: string, label: string, width = 84): PdfColumn => ({
  key,
  label,
  width,
  format: (v: any) => (v ? fmtDate(v, 'dd/MM/yyyy') : '—'),
});
