/**
 * Sales Acknowledgment PDF Parser
 *
 * Extracts structured data from Emjac / S.A. Morman sales acknowledgment PDFs.
 * Handles both FAB and DOORS/Frames acknowledgement formats.
 *
 * PDF text is extracted line-by-line. Each line item block follows this pattern:
 *   001S           ← item number (3 digits + "S")
 *    1             ← quantity
 *   EA89074-001    ← "EA" + part number
 *    1061.00       ← unit price
 *    1061.00       ← extension (qty × unit price)
 *   89074-001      ← (optional) repeated part number
 *   FRAME, 14GA SS304 #4   ← description
 *                  ← whitespace
 *   TAG#  F-101    ← (optional) tag identifier
 */

export interface ParsedLineItem {
    itemNumber: string;      // e.g. "001S"
    partNumber: string;      // e.g. "87834-001"
    quantity: number;
    description: string;     // e.g. "DOOR, SEAMLESS, 16GA SS304 #4"
    unitPrice: number;
    extension: number;       // qty × unitPrice
    detail?: string;         // e.g. "ITEM# 1-017" (legacy)
    tag?: string;            // e.g. "F-101", "D-102B"
}

export interface ParsedSalesAcknowledgment {
    salesOrder: string;      // e.g. "87834"
    workOrder: string;       // same as salesOrder in this format
    jobName: string;         // e.g. "KING MILLING TRUCK WASH"
    customerName: string;    // e.g. "S.A. MORMAN & CO."
    orderDate: string;       // e.g. "2/10/2026"
    scheduledDate: string;   // ship date, e.g. "3/10/2026"
    salesRep: string;
    customerPO: string;
    lineItems: ParsedLineItem[];
    orderSubTotal: number;
    totalQuantity: number;
}

/**
 * Parse raw text extracted from a sales acknowledgment PDF.
 * Uses a line-by-line approach to handle the multi-line item format.
 */
export function parseSalesAcknowledgmentText(rawText: string): ParsedSalesAcknowledgment {
    const lines = rawText.split('\n').map(l => l.trimEnd());

    // ─── Header extraction ───
    const jobNameMatch = rawText.match(/Job Name:\s*(.+)/i);
    const jobName = jobNameMatch?.[1]?.trim() || '';

    // WO# appears on its own line near the header
    const woMatch = rawText.match(/^\s*(\d{5})\s*$/m);
    const workOrder = woMatch?.[1] || '';
    const salesOrder = workOrder;

    // Customer name — first non-empty line
    const cleanLines = lines.map(l => l.trim()).filter(Boolean);
    const customerName = cleanLines[0] || '';

    // Order date and scheduled date appear on the same line: "2/10/2026  3/10/2026"
    const dateMatch = rawText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    const orderDate = dateMatch?.[1] || '';
    const scheduledDate = dateMatch?.[2] || '';

    // Sales rep
    const salesRep = '';

    // Customer PO
    const poMatch = rawText.match(/(PO\d+)/i);
    const customerPO = poMatch?.[1] || '';

    // ─── Line item extraction (line-by-line) ───
    const lineItems: ParsedLineItem[] = [];

    // Find all item number positions (lines matching \d{3}S pattern)
    const itemStartIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\d{3}S$/.test(lines[i].trim())) {
            itemStartIndices.push(i);
        }
    }

    for (const startIdx of itemStartIndices) {
        try {
            const itemNumber = lines[startIdx].trim(); // e.g. "001S"

            // Next lines: quantity, EA+partNumber, unitPrice, extension
            // Each on its own line
            let cursor = startIdx + 1;
            const quantityStr = lines[cursor]?.trim() || '1';
            const quantity = parseInt(quantityStr) || 1;
            cursor++;

            const partLine = lines[cursor]?.trim() || '';
            const partNumber = partLine.startsWith('EA') ? partLine.substring(2) : partLine;
            cursor++;

            const unitPriceStr = lines[cursor]?.trim() || '0';
            const unitPrice = parseFloat(unitPriceStr.replace(/,/g, '')) || 0;
            cursor++;

            const extensionStr = lines[cursor]?.trim() || '0';
            const extension = parseFloat(extensionStr.replace(/,/g, '')) || 0;
            cursor++;

            // Now look for description — skip optional repeated part number line
            // Description is the first "real text" line (not a part number, not whitespace, not TAG#)
            let description = '';
            let tag = '';

            // Scan forward for description and tag (within reasonable range)
            const scanLimit = Math.min(cursor + 5, lines.length);
            for (let j = cursor; j < scanLimit; j++) {
                const line = lines[j].trim();

                // Skip empty/whitespace lines
                if (!line || /^\s*$/.test(line)) continue;

                // TAG# (DOORS) or ITEM# (FAB) line
                if (/^(TAG#|ITEM#)/i.test(line)) {
                    const tagMatch = line.match(/(?:TAG#|ITEM#)\s+(.+)/i);
                    tag = tagMatch?.[1]?.trim() || '';
                    break; // TAG/ITEM is always last in a block
                }

                // Skip lines that look like a repeated part number (digits-digits pattern)
                if (/^\d{5}-\d{3}$/.test(line)) continue;

                // If we haven't found description yet, this is it
                if (!description) {
                    description = line;
                }
            }

            // Skip items with negative extensions (discounts/promos)
            // They'll still be in the array but with negative values
            lineItems.push({
                itemNumber,
                partNumber,
                quantity,
                description,
                unitPrice,
                extension,
                tag: tag || undefined,
            });
        } catch (e) {
            // Skip malformed items
            console.warn(`Failed to parse item at line ${startIdx}:`, e);
        }
    }

    // Also try to pick up freight (800F pattern) — still useful for total tracking
    for (let i = 0; i < lines.length; i++) {
        if (/^\d{3}F$/.test(lines[i].trim())) {
            try {
                let cursor = i + 1;
                const quantity = parseInt(lines[cursor]?.trim() || '1') || 1;
                cursor++;
                const partLine = lines[cursor]?.trim() || '';
                cursor++;
                const unitPrice = parseFloat(lines[cursor]?.trim().replace(/,/g, '') || '0') || 0;
                cursor++;
                const extension = parseFloat(lines[cursor]?.trim().replace(/,/g, '') || '0') || 0;
                cursor++;

                // Find description
                let description = '';
                const scanLimit = Math.min(cursor + 3, lines.length);
                for (let j = cursor; j < scanLimit; j++) {
                    const line = lines[j].trim();
                    if (!line) continue;
                    if (/^TAG#/i.test(line)) break;
                    if (!description) description = line;
                }

                lineItems.push({
                    itemNumber: lines[i].trim(),
                    partNumber: partLine,
                    quantity,
                    description,
                    unitPrice,
                    extension,
                });
            } catch (e) {
                // Skip
            }
        }
    }

    // ─── Totals ───
    const totalMatch = rawText.match(/Order SubTotal\s*([\d,.]+)/i)
        || rawText.match(/Total Order Amount:\s*\$?\s*([\d,.]+)/i)
        || rawText.match(/([\d,]+\.\d{2})(?:Order SubTotal|Total Order)/i);

    let orderSubTotal = 0;
    if (totalMatch) {
        orderSubTotal = parseFloat(totalMatch[1].replace(/,/g, '')) || 0;
    } else if (lineItems.length > 0) {
        // Fall back to summing positive extensions only
        orderSubTotal = lineItems
            .filter(item => item.extension > 0)
            .reduce((sum, item) => sum + item.extension, 0);
    }

    const totalQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);

    return {
        salesOrder,
        workOrder,
        jobName,
        customerName,
        orderDate,
        scheduledDate,
        salesRep,
        customerPO,
        lineItems,
        orderSubTotal,
        totalQuantity,
    };
}
