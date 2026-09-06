import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getOrganisation } from '@/lib/settings';
import { excelReport, csvReport } from '@/lib/exports';
import { reportPdf } from '@/lib/pdf';
import { buildExport, canExport } from '@/server/services/export-service';

export const dynamic = 'force-dynamic';

const MIME = {
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
} as const;

const EXT = { excel: 'xlsx', csv: 'csv', pdf: 'pdf' } as const;

/**
 * GET /api/exports/{report}?format=excel|csv|pdf&…filters
 *
 * Reports: members, contributions, outstanding, payments, receipts, statement,
 * cases, sacco, loans, financial, attendance, audit.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const { report } = await params;
  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'excel') as keyof typeof MIME;

  if (!canExport(user, report)) {
    return Response.json({ error: 'You do not have permission to export this report.' }, { status: 403 });
  }
  if (!(format in MIME)) {
    return Response.json({ error: `Unsupported format "${format}". Use excel, csv or pdf.` }, { status: 400 });
  }

  try {
    const definition = await buildExport(report, url.searchParams, user);
    const org = await getOrganisation();
    const fileName = `${definition.fileName}-${new Date().toISOString().slice(0, 10)}.${EXT[format]}`;
    const headers = {
      'Content-Type': MIME[format],
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    };

    let body: Buffer | string;
    if (format === 'excel') {
      body = await excelReport({ orgName: org.name, reportTitle: definition.title, filters: definition.filters, sheets: definition.sheets });
    } else if (format === 'csv') {
      // CSV is a flat format — concatenate the sheets with a title line each.
      body = definition.sheets
        .map((sheet) => `# ${sheet.title || definition.title}\n${csvReport(sheet)}`)
        .join('\n\n');
    } else {
      body = await reportPdf({
        org,
        title: definition.title,
        subtitle: org.parish ? `${org.parish}${org.diocese ? ` · ${org.diocese}` : ''}` : undefined,
        filters: definition.filters,
        sections: definition.sheets.map((sheet) => ({
          title: sheet.title,
          columns: sheet.columns,
          rows: sheet.rows,
          totals: sheet.totals,
          emptyText: 'No records for this selection.',
        })),
        notes: 'Generated from the live CMA ledger. Financial records are never deleted — corrections are made by reversal.',
      });
    }

    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'export.downloaded',
      entityType: report,
      description: `Exported ${definition.title} as ${format.toUpperCase()} (${definition.sheets.reduce((a, s) => a + s.rows.length, 0)} rows)`,
      severity: 'info',
    });

    return new Response(new Uint8Array(Buffer.from(body)), { headers });
  } catch (e: any) {
    console.error('[exports]', report, e?.message);
    return Response.json({ error: e?.message || 'Could not build the export.' }, { status: 500 });
  }
}
