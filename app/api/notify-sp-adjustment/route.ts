import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { SP_ADMIN_EMAIL, SP_CC_EMAILS, getSalesRepEmail } from '@/lib/salesRepEmails';
import { requireFirebaseAuth } from '@/lib/server/requireFirebaseAuth';

export const runtime = 'nodejs';

interface NotifyPayload {
    jobId: string;
    jobName: string;
    salesRepCode?: string;
    oldDueDate?: string;
    newDueDate: string;
    reason: string;
    daysNeededAfterPO?: number;
    adjustmentStrategy?: string;
}

export async function POST(request: NextRequest) {
    try {
        const authResult = await requireFirebaseAuth(request);
        if (!authResult.ok) {
            return authResult.response;
        }

        const body: NotifyPayload = await request.json();
        const { jobId, jobName, salesRepCode, oldDueDate, newDueDate, reason, daysNeededAfterPO, adjustmentStrategy } = body;

        if (!jobId || !newDueDate) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const smtpHost = process.env.SMTP_HOST;
        const smtpPort = Number(process.env.SMTP_PORT || 587);
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        if (!smtpHost || !smtpUser || !smtpPass) {
            console.warn('SMTP not configured - skipping email notification');
            return NextResponse.json({ success: true, skipped: true, reason: 'SMTP not configured' });
        }

        const toAddresses: string[] = [SP_ADMIN_EMAIL];
        if (salesRepCode) {
            const repEmail = getSalesRepEmail(salesRepCode);
            if (repEmail) toAddresses.push(repEmail);
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass }
        });

        const formattedOld = oldDueDate
            ? new Date(oldDueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
            : 'N/A';
        const formattedNew = new Date(newDueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        const subject = `Special Purchase Adjustment - ${jobId} (${jobName})`;

        const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <div style="background: #0f172a; border-radius: 12px; padding: 24px; color: #e2e8f0;">
                    <h2 style="margin: 0 0 4px 0; color: #38bdf8; font-size: 18px;">
                        Special Purchase Adjustment Approved
                    </h2>
                    <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 13px;">
                        A schedule adjustment has been approved for a job with a special purchase hold.
                    </p>

                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                            <td style="padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Work Order</td>
                            <td style="padding: 8px 12px; color: #f1f5f9; font-weight: 600; border-bottom: 1px solid #1e293b;">${jobId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Job Name</td>
                            <td style="padding: 8px 12px; color: #f1f5f9; border-bottom: 1px solid #1e293b;">${jobName}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Previous Due Date</td>
                            <td style="padding: 8px 12px; color: #f1f5f9; border-bottom: 1px solid #1e293b;">${formattedOld}</td>
                        </tr>
                        <tr style="background: #1e3a5f;">
                            <td style="padding: 8px 12px; color: #7dd3fc; font-weight: 600; border-bottom: 1px solid #1e293b;">New Due Date</td>
                            <td style="padding: 8px 12px; color: #7dd3fc; font-weight: 700; font-size: 15px; border-bottom: 1px solid #1e293b;">${formattedNew}</td>
                        </tr>
                        ${daysNeededAfterPO ? `
                        <tr>
                            <td style="padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Days Needed After PO</td>
                            <td style="padding: 8px 12px; color: #f1f5f9; border-bottom: 1px solid #1e293b;">${daysNeededAfterPO} business days</td>
                        </tr>` : ''}
                        ${adjustmentStrategy ? `
                        <tr>
                            <td style="padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #1e293b;">Strategy</td>
                            <td style="padding: 8px 12px; color: #f1f5f9; border-bottom: 1px solid #1e293b;">${adjustmentStrategy}</td>
                        </tr>` : ''}
                    </table>

                    <div style="margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px;">
                        <p style="margin: 0 0 4px 0; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Reason</p>
                        <p style="margin: 0; color: #e2e8f0; font-size: 13px; line-height: 1.5;">${reason}</p>
                    </div>

                    <p style="margin: 20px 0 0 0; color: #475569; font-size: 11px; text-align: center;">
                        Please update the due date in Global Shop accordingly.
                    </p>
                </div>
            </div>
        `;

        const info = await transporter.sendMail({
            from: `"EMJAC Production Scheduler" <${smtpUser}>`,
            to: toAddresses.join(', '),
            cc: SP_CC_EMAILS.join(', '),
            subject,
            html: htmlBody
        });

        console.log(`SP adjustment email sent: ${info.messageId} -> ${toAddresses.join(', ')}`);
        return NextResponse.json({ success: true, messageId: info.messageId, recipients: toAddresses });
    } catch (error) {
        console.error('Failed to send SP notification email:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
