import { NextRequest, NextResponse } from 'next/server';
import { parseSalesAcknowledgmentText } from '@/lib/parseSalesAcknowledgment';
import { requireFirebaseAuth } from '@/lib/server/requireFirebaseAuth';


export const runtime = 'nodejs';

// Import pdf-parse/lib/pdf-parse directly to avoid the top-level test
// code in pdf-parse/index.js that reads a test PDF file and breaks bundlers.
async function getPdfParse() {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    return mod.default || mod;
}

export async function POST(request: NextRequest) {
    try {
        const authResult = await requireFirebaseAuth(request);
        if (!authResult.ok) {
            return authResult.response;
        }

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
        const pdf = await getPdfParse();
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
