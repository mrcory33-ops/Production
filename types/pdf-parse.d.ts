declare module 'pdf-parse' {
    interface PdfData {
        numpages: number;
        numrender: number;
        info: Record<string, unknown>;
        metadata: unknown;
        text: string;
        version: string;
    }

    function pdf(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
    export = pdf;
}
