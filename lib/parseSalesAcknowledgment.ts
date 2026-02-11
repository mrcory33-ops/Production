/**
 * Sales Acknowledgment PDF Parser
 *
 * Extracts structured data from Emjac / Culinary Depot sales acknowledgment PDFs.
 * The format is consistent across all orders:
 *   - Header: WO#, job name, order date, ship date, customer info
 *   - Line items: item#, part number, qty, description, unit price, extension
 *   - Footer: totals
 */

export interface ParsedLineItem {
    itemNumber: string;      // e.g. "001S"
    partNumber: string;      // e.g. "87834-001"
    quantity: number;
    description: string;     // e.g. "SOILED DISHTABLE"
    unitPrice: number;
    extension: number;       // qty × unitPrice
    detail?: string;         // e.g. "ITEM# 1-017"
}

export interface ParsedSalesAcknowledgment {
    salesOrder: string;      // e.g. "87834"
    workOrder: string;       // same as salesOrder in this format
    jobName: string;         // e.g. "CULINARY ACADEMY-LAS VEGAS"
    customerName: string;    // e.g. "CULINARY DEPOT"
    orderDate: string;       // e.g. "4/29/2025"
    scheduledDate: string;   // ship date, e.g. "7/17/2026"
    salesRep: string;
    customerPO: string;
    lineItems: ParsedLineItem[];
    orderSubTotal: number;
    totalQuantity: number;
}

/**
 * Parse raw text extracted from a sales acknowledgment PDF.
 * Uses the consistent format produced by the Emjac ERP system.
 */
export function parseSalesAcknowledgmentText(rawText: string): ParsedSalesAcknowledgment {
    // ─── Header extraction ───
    const jobNameMatch = rawText.match(/Job Name:\s*(.+)/i);
    const jobName = jobNameMatch?.[1]?.trim() || '';

    // WO# appears on its own line near the header
    const woMatch = rawText.match(/^\s*(\d{5})\s*$/m);
    const workOrder = woMatch?.[1] || '';

    // Sales order number (same as WO# in this format)
    const salesOrder = workOrder;

    // Customer name — first non-empty line
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const customerName = lines[0] || '';

    // Order date and scheduled date appear on the same line: "4/29/2025  7/17/2026"
    const dateMatch = rawText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    const orderDate = dateMatch?.[1] || '';
    const scheduledDate = dateMatch?.[2] || '';

    // Sales rep
    const repMatch = rawText.match(/([A-Z]{2,})\s+(?:EOMAR|[A-Z]+\s+[A-Z]+)(?:PO\d+|[A-Z]+\d+)/i);
    const salesRep = '';

    // Customer PO
    const poMatch = rawText.match(/(PO\d+)/i);
    const customerPO = poMatch?.[1] || '';

    // ─── Line item extraction ───
    // Pattern: "001S\n 1\nEA87834-001\n 12887.00\n 12887.00\nSOILED DISHTABLE\n\nITEM# 1-017"
    // We parse by finding all "NNNs" item markers and extracting subsequent fields
    const lineItems: ParsedLineItem[] = [];

    // Match line items using the item number pattern (e.g., "001S", "002S")
    // Format: "001S\n 1\nEA87834-001\n 12887.00\n 12887.00\nSOILED DISHTABLE\n\nITEM# 1-017"
    const itemRegex = /(\d{3}S)\s+(\d+)\s+EA(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+([^\n]+?)(?:\s*\n\s*\n\s*(ITEM#[^\n]*))?/g;

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(rawText)) !== null) {
        const quantity = parseInt(match[2]) || 1;
        const unitPrice = parseFloat(match[4].replace(/,/g, '')) || 0;
        const extension = parseFloat(match[5].replace(/,/g, '')) || 0;

        lineItems.push({
            itemNumber: match[1],
            partNumber: match[3],
            quantity,
            description: match[6].trim(),
            unitPrice,
            extension,
            detail: match[7]?.trim() || undefined,
        });
    }

    // If regex didn't capture items, try a more lenient approach
    // This handles cases where fields are separated by newlines
    if (lineItems.length === 0) {
        const altItemRegex = /(\d{3})S\s*\n\s*(\d+)\s*\n\s*EA(\S+)\s*\n\s*([\d,.]+)\s*\n\s*([\d,.]+)\s*\n\s*([^\n]+?)(?:\s*\n\s*\n\s*(ITEM#[^\n]*))?(?=\n\d{3}S\s|\n\s*\d[\d,]+\.\d{2}\s*(?:Order|Total|Page))/g;

        while ((match = altItemRegex.exec(rawText)) !== null) {
            const quantity = parseInt(match[2]) || 1;
            const unitPrice = parseFloat(match[4].replace(/,/g, '')) || 0;
            const extension = parseFloat(match[5].replace(/,/g, '')) || 0;

            lineItems.push({
                itemNumber: match[1] + 'S',
                partNumber: match[3],
                quantity,
                description: match[6].trim(),
                unitPrice,
                extension,
                detail: match[7]?.trim() || undefined,
            });
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
        // Fall back to summing extensions
        orderSubTotal = lineItems.reduce((sum, item) => sum + item.extension, 0);
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
