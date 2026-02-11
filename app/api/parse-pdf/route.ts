import { NextRequest, NextResponse } from 'next/server';
import { parseSalesAcknowledgmentText } from '@/lib/parseSalesAcknowledgment';

export const runtime = 'nodejs';

// Workaround: pdf-parse uses CommonJS and its top-level code
// reads a test PDF file, which can break Next.js bundlers.
// Using eval('require') hides the call from static analysis.
let pdfParse: ((buffer: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

function getPdfParse() {
    if (!pdfParse) {
        // eslint-disable-next-line no-eval
        const _require = eval('require');
        pdfParse = _require('pdf-parse');
    }
    return pdfParse!;
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        if (!file.name.toLowerCase().endsWith('.pdf')) {
            return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
        }

        // Convert File to Buffer for pdf-parse
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Extract text from PDF
        const pdf = getPdfParse();
        const pdfData = await pdf(buffer);
        const rawText = pdfData.text;

        if (!rawText || rawText.trim().length === 0) {
            return NextResponse.json(
                { error: 'Could not extract text from PDF. The file may be image-based.' },
                { status: 422 }
            );
        }

        // Parse the extracted text into structured data
        const parsed = parseSalesAcknowledgmentText(rawText);

        // Validate we got meaningful data
        if (!parsed.orderSubTotal && parsed.lineItems.length === 0) {
            return NextResponse.json(
                { error: 'Could not find sales acknowledgment data in the PDF. Please check the file format.' },
                { status: 422 }
            );
        }

        return NextResponse.json({
            success: true,
            data: parsed,
            pages: pdfData.numpages,
        });
    } catch (error) {
        console.error('PDF parse error:', error);
        return NextResponse.json(
            { error: 'Failed to parse PDF file' },
            { status: 500 }
        );
    }
}
