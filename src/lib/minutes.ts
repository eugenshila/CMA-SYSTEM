import 'server-only';

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { renderPdf, sectionTitle, keyValueGrid } from './pdf';
import { fmtDate, fmtTime } from './dates';
import type { OrganisationSettings } from './settings';

export type MeetingMinutes = {
  id: number;
  title: string;
  meeting_type?: string | null;
  meeting_date?: Date | string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue?: string | null;
  chairperson?: string | null;
  secretary?: string | null;
  parish_name?: string | null;
  church_name?: string | null;
  agenda?: string | null;
  minutes?: string | null;
};

export function minutesFileStem(meeting: MeetingMinutes) {
  const date = meeting.meeting_date ? String(meeting.meeting_date).slice(0, 10) : 'undated';
  return `cma-meeting-minutes-${date}-${meeting.id}`;
}

export function minutesPlainText(meeting: MeetingMinutes, org: OrganisationSettings) {
  const time = meeting.start_time
    ? `${fmtTime(meeting.start_time)}${meeting.end_time ? ` – ${fmtTime(meeting.end_time)}` : ''}`
    : '—';
  const meetingType = String(meeting.meeting_type || 'meeting').replace(/_/g, ' ');
  return [
    org.name,
    org.parish || '',
    '',
    'MEETING MINUTES',
    '',
    `Meeting: ${meeting.title}`,
    `Type: ${meetingType}`,
    `Date: ${meeting.meeting_date ? fmtDate(meeting.meeting_date) : '—'}`,
    `Time: ${time}`,
    `Venue: ${meeting.venue || '—'}`,
    `Chairperson: ${meeting.chairperson || '—'}`,
    `Secretary: ${meeting.secretary || '—'}`,
    '',
    'AGENDA',
    meeting.agenda || '—',
    '',
    'MINUTES',
    meeting.minutes || 'No minutes have been published for this meeting.',
  ].filter((line, index) => line || index > 0).join('\n');
}

/** Create a genuine Office Open XML .docx document for Microsoft Word. */
export async function meetingMinutesDocx(meeting: MeetingMinutes, org: OrganisationSettings): Promise<Buffer> {
  const time = meeting.start_time
    ? `${fmtTime(meeting.start_time)}${meeting.end_time ? ` – ${fmtTime(meeting.end_time)}` : ''}`
    : '—';
  const detail = (label: string, value: string) => new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value || '—' }),
    ],
    spacing: { after: 80 },
  });
  const textParagraphs = String(meeting.minutes || 'No minutes have been published for this meeting.')
    .split(/\r?\n/)
    .map((line) => new Paragraph({ text: line || ' ', spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED }));
  const document = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: org.name, bold: true, size: 30 })],
          spacing: { after: 80 },
        }),
        ...(org.parish ? [new Paragraph({ text: org.parish, alignment: AlignmentType.CENTER, spacing: { after: 220 } })] : []),
        new Paragraph({ text: 'MEETING MINUTES', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
        detail('Meeting', meeting.title),
        detail('Type', String(meeting.meeting_type || 'meeting').replace(/_/g, ' ')),
        detail('Date', meeting.meeting_date ? fmtDate(meeting.meeting_date) : '—'),
        detail('Time', time),
        detail('Venue', meeting.venue || '—'),
        detail('Chairperson', meeting.chairperson || '—'),
        detail('Secretary', meeting.secretary || '—'),
        new Paragraph({ text: 'AGENDA', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
        ...String(meeting.agenda || '—').split(/\r?\n/).map((line) => new Paragraph({ text: line || ' ', spacing: { after: 100 } })),
        new Paragraph({ text: 'MINUTES', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
        ...textParagraphs,
      ],
    }],
  });
  return Packer.toBuffer(document);
}

/**
 * A lightweight RTF fallback for integrations that explicitly require it.
 * Microsoft Word, LibreOffice and Google Docs all open this format.
 */
export function meetingMinutesRtf(meeting: MeetingMinutes, org: OrganisationSettings) {
  const escape = (value: string) => String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, '\\$&')
    .replace(/\r?\n/g, '\\par\n')
    .replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0)}?`);
  const text = minutesPlainText(meeting, org);
  const body = escape(text)
    .replace('MEETING MINUTES', '\\b\\fs32 MEETING MINUTES\\b0\\fs22')
    .replace('AGENDA', '\\b AGENDA\\b0')
    .replace('MINUTES', '\\b MINUTES\\b0');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\paperw11907\\paperh16840\\margl1134\\margr1134\\margt1134\\margb1134\\f0\\fs22\n${body}\n}`;
}

export async function meetingMinutesPdf(meeting: MeetingMinutes, org: OrganisationSettings) {
  const time = meeting.start_time
    ? `${fmtTime(meeting.start_time)}${meeting.end_time ? ` – ${fmtTime(meeting.end_time)}` : ''}`
    : '—';
  return renderPdf(
    {
      org,
      title: 'Meeting Minutes',
      subtitle: meeting.title,
      filters: [
        meeting.meeting_date ? `Date: ${fmtDate(meeting.meeting_date)}` : '',
        meeting.venue ? `Venue: ${meeting.venue}` : '',
      ].filter(Boolean),
      footer: `Official meeting minutes · ${org.name}`,
    },
    (doc) => {
      sectionTitle(doc, 'Meeting details');
      keyValueGrid(doc, [
        ['Meeting type', String(meeting.meeting_type || 'meeting').replace(/_/g, ' ')],
        ['Date', meeting.meeting_date ? fmtDate(meeting.meeting_date) : '—'],
        ['Time', time],
        ['Venue', meeting.venue || '—'],
        ['Chairperson', meeting.chairperson || '—'],
        ['Secretary', meeting.secretary || '—'],
      ]);
      if (meeting.agenda) {
        sectionTitle(doc, 'Agenda');
        doc.font('Helvetica').fontSize(9.5).fillColor('#1f2937').text(meeting.agenda, 40, doc.y, {
          width: doc.page.width - 80,
          lineGap: 3,
        });
      }
      sectionTitle(doc, 'Minutes');
      doc.font('Helvetica').fontSize(10).fillColor('#111827').text(
        meeting.minutes || 'No minutes have been published for this meeting.',
        40,
        doc.y,
        { width: doc.page.width - 80, lineGap: 4 },
      );
    },
  );
}
