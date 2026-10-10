import type { DecisionRecordDetail } from './api';
import { POSTURES } from './format';

// Exports decision records as JSON, an Excel workbook, or a PDF report. Everything is built in the
// browser from the records the page already loaded; the PDF and Excel libraries load only when used.

export type ExportFormat = 'pdf' | 'xlsx' | 'json';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; detail: string }[] = [
    { id: 'pdf', label: 'PDF report', detail: 'Printable summary and timeline for after-action review' },
    { id: 'xlsx', label: 'Excel spreadsheet', detail: 'One sheet of records, one of every logged event' },
    { id: 'json', label: 'JSON', detail: 'Complete data, including source payloads and hashes' },
];

export async function exportDecisions(records: DecisionRecordDetail[], format: ExportFormat, name: string) {
    const exportedAt = new Date();
    switch (format) {
        case 'json':
            return save(
                new Blob([JSON.stringify({ exportedAt: exportedAt.toISOString(), records }, null, 2)], { type: 'application/json' }),
                `${name}.json`);
        case 'xlsx':
            return save(await workbook(records), `${name}.xlsx`);
        case 'pdf':
            return save(await report(records, exportedAt), `${name}.pdf`);
    }
}

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function when(value: string | null): string {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
        timeZone: ZONE, timeZoneName: 'short',
    }).format(new Date(value));
}

function outcome({ record }: DecisionRecordDetail): string {
    if (record.status === 'AwaitingDecision') return 'Awaiting decision';
    return `${record.action}: ${POSTURES[record.finalPosture!].label}`;
}

function integrity({ integrity }: DecisionRecordDetail): string {
    return integrity.valid
        ? `Verified (${integrity.eventCount} events)`
        : `Broken at event ${integrity.brokenAtSeq}`;
}

function save(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

async function workbook(records: DecisionRecordDetail[]): Promise<Blob> {
    const { default: ExcelJS } = await import('exceljs');
    const book = new ExcelJS.Workbook();
    book.created = new Date();

    const date = (value: string | null) => value ? new Date(value) : null;
    const style = (sheet: import('exceljs').Worksheet) => {
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    };

    // Excel shows dates in the viewer's local time, so the cells hold real dates rather than strings.
    const recordSheet = book.addWorksheet('Records');
    recordSheet.columns = [
        { header: 'Record ID', key: 'id', width: 20 },
        { header: 'Facility', key: 'facility', width: 36 },
        { header: 'Created', key: 'created', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
        { header: 'Recommended', key: 'recommended', width: 22 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Final posture', key: 'final', width: 22 },
        { header: 'Action', key: 'action', width: 12 },
        { header: 'Decided by', key: 'decidedBy', width: 16 },
        { header: 'Decided at', key: 'decidedAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
        { header: 'Ruleset', key: 'ruleset', width: 14 },
        { header: 'Recommendation reason', key: 'reason', width: 60 },
        { header: 'Integrity', key: 'integrity', width: 22 },
    ];
    for (const detail of records) {
        const { record } = detail;
        recordSheet.addRow({
            id: record.id,
            facility: record.facilityName,
            created: date(record.createdAt),
            recommended: POSTURES[record.recommendedPosture].label,
            status: record.status === 'Decided' ? 'Decided' : 'Awaiting decision',
            final: record.finalPosture ? POSTURES[record.finalPosture].label : '',
            action: record.action ?? '',
            decidedBy: record.decidedBy ?? '',
            decidedAt: date(record.decidedAt),
            ruleset: record.rulesetVersion,
            reason: record.recommendationReason,
            integrity: integrity(detail),
        });
    }
    style(recordSheet);

    const eventSheet = book.addWorksheet('Events');
    eventSheet.columns = [
        { header: 'Record ID', key: 'id', width: 20 },
        { header: 'Seq', key: 'seq', width: 6 },
        { header: 'Occurred', key: 'at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
        { header: 'Kind', key: 'kind', width: 24 },
        { header: 'Actor', key: 'actor', width: 16 },
        { header: 'Title', key: 'title', width: 36 },
        { header: 'Detail', key: 'detail', width: 70 },
        { header: 'Hash', key: 'hash', width: 66 },
        { header: 'Previous hash', key: 'prev', width: 66 },
    ];
    for (const { record, events } of records) {
        for (const event of events) {
            eventSheet.addRow({
                id: record.id,
                seq: event.seq,
                at: date(event.occurredAt),
                kind: event.kind,
                actor: event.actor,
                title: event.title,
                detail: event.detail,
                hash: event.hash,
                prev: event.prevHash ?? '',
            });
        }
    }
    style(eventSheet);

    const buffer = await book.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// jsPDF's built-in fonts only cover Windows-1252. A character outside it (an arrow, an emoji, non-Latin
// script typed into a rationale) makes jsPDF garble the whole line, so those are swapped before drawing.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const PDF_SUBSTITUTES: Record<string, string> = { '→': '->', '←': '<-', '−': '-', '≥': '>=', '≤': '<=' };

function pdfText(text: string): string {
    return Array.from(text, ch => {
        const code = ch.codePointAt(0)!;
        if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === '\n' || WIN_ANSI_EXTRAS.has(ch)) return ch;
        return PDF_SUBSTITUTES[ch] ?? '?';
    }).join('');
}

async function report(records: DecisionRecordDetail[], exportedAt: Date): Promise<Blob> {
    const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const margin = 48;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const navy: [number, number, number] = [20, 45, 70];
    // jspdf-autotable records where its last table ended on the document.
    const tableEnd = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    const safeCells = { didParseCell: (data: { cell: { text: string[] } }) => { data.cell.text = data.cell.text.map(pdfText); } };

    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...navy);
    doc.text('Decision record report', margin, margin + 6);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
    doc.text(
        `${records.length} ${records.length === 1 ? 'record' : 'records'} · exported ${when(exportedAt.toISOString())}`,
        margin, margin + 24);

    // One-line-per-record overview when the report covers more than one record.
    if (records.length > 1) {
        autoTable(doc, {
            startY: margin + 40,
            ...safeCells,
            margin: { left: margin, right: margin },
            head: [['Record', 'Created', 'Recommended', 'Outcome', 'Integrity']],
            body: records.map(detail => [
                detail.record.id,
                when(detail.record.createdAt),
                POSTURES[detail.record.recommendedPosture].label,
                outcome(detail),
                integrity(detail),
            ]),
            styles: { fontSize: 8, cellPadding: 4 },
            headStyles: { fillColor: navy },
        });
    }

    records.forEach((detail, index) => {
        const { record, events } = detail;
        if (records.length > 1 || index > 0) doc.addPage();
        let y = records.length > 1 || index > 0 ? margin : margin + 48;

        doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...navy);
        doc.text(pdfText(record.id), margin, y);
        y += 10;

        autoTable(doc, {
            startY: y,
            ...safeCells,
            margin: { left: margin, right: margin },
            theme: 'plain',
            body: [
                ['Facility', record.facilityName],
                ['Created', when(record.createdAt)],
                ['Recommended', `${POSTURES[record.recommendedPosture].label} (ruleset ${record.rulesetVersion})`],
                ['Reason', record.recommendationReason],
                ['Outcome', outcome(detail)],
                ['Decided by', record.decidedBy ? `${record.decidedBy}, ${when(record.decidedAt)}` : '—'],
                ['Integrity', `${integrity(detail)}. Each event is chained to the previous one by a SHA-256 hash.`],
            ],
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90, textColor: navy } },
        });

        autoTable(doc, {
            startY: tableEnd() + 14,
            ...safeCells,
            margin: { left: margin, right: margin },
            head: [['#', 'Time', 'Actor', 'Event']],
            body: events.map(event => [
                String(event.seq),
                when(event.occurredAt),
                event.actor,
                `${event.title}\n${event.detail}`,
            ]),
            styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
            headStyles: { fillColor: navy },
            columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 110 }, 2: { cellWidth: 70 } },
            tableWidth: width,
        });

        if (record.status === 'AwaitingDecision') {
            doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(120);
            doc.text('No human decision has been recorded yet.', margin, tableEnd() + 16);
        }
    });

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130);
        doc.text(`Page ${page} of ${pages}`, margin + width, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
    }

    return doc.output('blob');
}
