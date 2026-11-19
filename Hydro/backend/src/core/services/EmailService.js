const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

class EmailService {
  constructor() {
    this.cachedTransporter = null;
    this.lastConfigHash = null;
    this.cachedResendClient = null;
    this.lastResendKey = null;
  }

  /**
   * Resolves storage directory for invoice receipts / payslips / attachments
   */
  getStoragePath() {
    return process.env.STORAGE_PATH || path.join(__dirname, '..', '..', '..', 'storage');
  }

  /**
   * Resolves Resend API Client and Sender Address
   */
  getResendConfig(customConfig = null) {
    if (customConfig && customConfig.resendApiKey) {
      return {
        apiKey: customConfig.resendApiKey.trim(),
        fromEmail: customConfig.resendFromEmail ? customConfig.resendFromEmail.trim() : 'Hydro HRMS <onboarding@resend.dev>'
      };
    }

    const apiKey = (process.env.RESEND_API_KEY || '').trim();
    const fromEmail = (process.env.RESEND_FROM_EMAIL || 'Hydro HRMS <onboarding@resend.dev>').trim();

    return { apiKey, fromEmail };
  }

  getResendClient(customConfig = null) {
    const { apiKey, fromEmail } = this.getResendConfig(customConfig);
    if (!apiKey) return null;

    if (!customConfig && this.cachedResendClient && this.lastResendKey === apiKey) {
      return { client: this.cachedResendClient, fromEmail };
    }

    const client = new Resend(apiKey);
    if (!customConfig) {
      this.cachedResendClient = client;
      this.lastResendKey = apiKey;
    }

    return { client, fromEmail };
  }

  /**
   * Retrieves active SMTP configuration from database Settings or .env fallback
   */
  async getSmtpConfig(customConfig = null) {
    if (customConfig && customConfig.user && customConfig.pass) {
      return {
        host: customConfig.host || 'smtp.gmail.com',
        port: parseInt(customConfig.port, 10) || 465,
        secure: customConfig.secure !== undefined ? Boolean(customConfig.secure) : (parseInt(customConfig.port, 10) === 465),
        user: customConfig.user.trim(),
        pass: customConfig.pass.trim(),
        fromName: customConfig.fromName || 'Hydro HRMS',
        fromEmail: customConfig.user.trim()
      };
    }

    try {
      const { Setting } = require('../../shared/models');
      if (Setting) {
        const setting = await Setting.findByPk(1) || await Setting.findOne();
        if (setting && setting.smtp_user && setting.smtp_pass) {
          const port = parseInt(setting.smtp_port, 10) || 465;
          return {
            host: setting.smtp_host || 'smtp.gmail.com',
            port: port,
            secure: setting.smtp_secure !== undefined ? Boolean(setting.smtp_secure) : (port === 465),
            user: setting.smtp_user.trim(),
            pass: setting.smtp_pass.trim(),
            fromName: setting.smtp_from_name || 'Hydro HRMS',
            fromEmail: setting.smtp_user.trim()
          };
        }
      }
    } catch (err) {
      // Database not ready or model missing, continue to .env
    }

    // Fallback to process.env
    const envUser = process.env.SMTP_USER || process.env.MAIL_USER || '';
    const envPass = process.env.SMTP_PASS || process.env.MAIL_PASS || '';
    const port = parseInt(process.env.SMTP_PORT, 10) || 465;

    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (port === 465),
      user: envUser.trim(),
      pass: envPass.trim(),
      fromName: process.env.SMTP_FROM_NAME || 'Hydro HRMS',
      fromEmail: envUser.trim()
    };
  }

  /**
   * Builds or returns cached Nodemailer transporter
   */
  async getTransporter(customConfig = null) {
    const config = await this.getSmtpConfig(customConfig);

    if (!config.user || !config.pass) {
      return { transporter: null, config, error: 'SMTP credentials not configured. Please configure in Admin Settings.' };
    }

    const configHash = `${config.host}:${config.port}:${config.user}:${config.pass}`;
    if (!customConfig && this.cachedTransporter && this.lastConfigHash === configHash) {
      return { transporter: this.cachedTransporter, config, error: null };
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000
    });

    if (!customConfig) {
      this.cachedTransporter = transporter;
      this.lastConfigHash = configHash;
    }

    return { transporter, config, error: null };
  }

  /**
   * Verifies SMTP connection directly
   */
  async verifySmtpConnection(customConfig = null) {
    try {
      const { transporter, config, error } = await this.getTransporter(customConfig);
      if (error || !transporter) {
        return { success: false, error: error || 'SMTP credentials missing.' };
      }
      await transporter.verify();
      return { success: true, message: `SMTP connected successfully to ${config.host} as ${config.user}` };
    } catch (err) {
      console.error('❌ [EmailService] SMTP Verification failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Unified Send Mail Method:
   * Prioritizes direct Gmail SMTP when user & pass are configured (e.g. hmplhrrecords@gmail.com);
   * seamlessly uses Resend API for cloud dispatch; cross-falls back if one provider encounters an error.
   */
  async sendMail({ to, subject, html, text, attachments = [], customConfig = null }) {
    if (!to) {
      return { success: false, error: 'Recipient email address is required.' };
    }

    const recipientList = Array.isArray(to) ? to : [to];
    const cleanTo = recipientList.map(e => String(e).trim()).filter(Boolean);

    if (cleanTo.length === 0) {
      return { success: false, error: 'No valid recipient email address provided.' };
    }

    // 1. If direct SMTP credentials (e.g. hmplhrrecords@gmail.com) are configured, attempt direct Gmail dispatch first
    const smtpConfig = await this.getSmtpConfig(customConfig);
    const hasValidSmtp = Boolean(smtpConfig.user && smtpConfig.pass);

    if (hasValidSmtp) {
      try {
        const { transporter, config, error } = await this.getTransporter(customConfig);
        if (transporter && !error) {
          const mailOptions = {
            from: `"${config.fromName}" <${config.fromEmail}>`,
            to: cleanTo.join(', '),
            subject,
            html,
            text: text || html.replace(/<[^>]*>?/gm, ''),
            attachments
          };

          const info = await transporter.sendMail(mailOptions);
          console.log(`✉️ [EmailService:Gmail-SMTP] Email dispatched to ${cleanTo.join(', ')} (MessageId: ${info.messageId})`);
          return { success: true, provider: 'smtp', messageId: info.messageId };
        }
      } catch (smtpErr) {
        console.warn(`⚠️ [EmailService:SMTP] Direct Gmail SMTP failed, attempting Resend fallback:`, smtpErr.message);
      }
    }

    // 2. Try Resend API Delivery
    const resendSetup = this.getResendClient(customConfig);
    if (resendSetup && resendSetup.client) {
      try {
        const formattedAttachments = attachments.map(att => {
          if (att.content) {
            return {
              filename: att.filename || 'attachment.pdf',
              content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content)
            };
          }
          if (att.path && fs.existsSync(att.path)) {
            return {
              filename: att.filename || path.basename(att.path),
              content: fs.readFileSync(att.path)
            };
          }
          return null;
        }).filter(Boolean);

        const payload = {
          from: resendSetup.fromEmail,
          to: cleanTo,
          subject,
          html,
          text: text || html.replace(/<[^>]*>?/gm, '')
        };

        if (formattedAttachments.length > 0) {
          payload.attachments = formattedAttachments;
        }

        const resendResponse = await resendSetup.client.emails.send(payload);

        if (resendResponse && resendResponse.data && resendResponse.data.id) {
          console.log(`✉️ [EmailService:Resend] Email dispatched to ${cleanTo.join(', ')} (ID: ${resendResponse.data.id})`);
          return {
            success: true,
            provider: 'resend',
            messageId: resendResponse.data.id
          };
        }

        if (resendResponse && resendResponse.error) {
          console.warn(`⚠️ [EmailService:Resend] API rejected dispatch:`, resendResponse.error.message || resendResponse.error);
          
          if (!hasValidSmtp) {
            return {
              success: false,
              provider: 'resend',
              error: resendResponse.error.message || 'Resend API dispatch failed.'
            };
          }
        }
      } catch (resendErr) {
        console.error('❌ [EmailService:Resend] Exception during send:', resendErr.message);
        if (!hasValidSmtp) {
          return { success: false, provider: 'resend', error: resendErr.message };
        }
      }
    }

    // 3. Fallback to Nodemailer SMTP (if not already attempted)
    if (!hasValidSmtp) {
      try {
        const { transporter, config, error } = await this.getTransporter(customConfig);
        if (error || !transporter) {
          return { success: false, error: error || 'No email transport configured. Please configure Gmail App Password or verify domain.' };
        }

        const mailOptions = {
          from: `"${config.fromName}" <${config.fromEmail}>`,
          to: cleanTo.join(', '),
          subject,
          html,
          text: text || html.replace(/<[^>]*>?/gm, ''),
          attachments
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✉️ [EmailService:SMTP] Email dispatched to ${cleanTo.join(', ')} (MessageId: ${info.messageId})`);
        return { success: true, provider: 'smtp', messageId: info.messageId };
      } catch (smtpErr) {
        console.error(`❌ [EmailService:SMTP] Error sending email to ${cleanTo.join(', ')}:`, smtpErr.message);
        return { success: false, error: smtpErr.message };
      }
    }

    return {
      success: false,
      error: 'Unable to deliver email via either direct Gmail SMTP or Resend API.'
    };
  }

  /**
   * Formats YYYY-MM into readable month name (e.g. 2026-10 -> October 2026)
   */
  formatMonthDisplay(monthStr) {
    if (!monthStr || !monthStr.includes('-')) return monthStr || '';
    const [year, m] = monthStr.split('-');
    const date = new Date(parseInt(year, 10), parseInt(m, 10) - 1, 1);
    if (isNaN(date.getTime())) return monthStr;
    return date.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  }

  /**
   * Resolves absolute path to Payslip PDF on disk across potential storage locations
   */
  resolvePayslipPdf(rawPath) {
    if (!rawPath) return null;

    const storageRoot = this.getStoragePath();
    const candidatePaths = [
      rawPath,
      path.join(storageRoot, rawPath),
      path.join(storageRoot, 'payslips', path.basename(rawPath)),
      path.join(__dirname, '..', '..', '..', 'storage', rawPath),
      path.join(__dirname, '..', '..', '..', 'storage', 'payslips', path.basename(rawPath)),
      path.join('D:/hydro-copy/Hydro/storage', rawPath),
      path.join('D:/hydro-copy/Hydro/storage/payslips', path.basename(rawPath)),
      path.join('C:/Users/Falcon/Desktop/hydro-copy/Hydro/storage', rawPath),
      path.join('C:/Users/Falcon/Desktop/hydro-copy/Hydro/storage/payslips', path.basename(rawPath))
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    }

    return null;
  }

  /**
   * Send Official Salary Slip / Payslip Email to Employee via Resend
   */
  async sendPayslipEmail({ to, employeeName, empCode, month, netPay, pdfPath, designation, payPeriod }) {
    if (!to) {
      return { success: false, error: 'Employee email address is missing.' };
    }

    const cleanMonth = month || new Date().toISOString().substring(0, 7);
    const monthDisplay = payPeriod || this.formatMonthDisplay(cleanMonth);
    const cleanName = employeeName || 'Employee';
    const cleanCode = empCode ? ` (${empCode})` : '';

    const formattedNetPay = netPay !== undefined && netPay !== null && !isNaN(Number(netPay))
      ? Number(netPay).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
      : null;

    const subject = `Payslip for ${monthDisplay} - ${cleanName}`;

    // Resolve and attach PDF
    const attachments = [];
    const resolvedPdf = this.resolvePayslipPdf(pdfPath);
    let attachedFileName = `Payslip_${cleanMonth}.pdf`;

    if (resolvedPdf) {
      try {
        const fileBuffer = fs.readFileSync(resolvedPdf);
        attachedFileName = `Payslip_${cleanMonth}_${(empCode || cleanName).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
        attachments.push({
          filename: attachedFileName,
          content: fileBuffer,
          path: resolvedPdf
        });
      } catch (readErr) {
        console.warn(`⚠️ [EmailService] Failed reading payslip PDF at ${resolvedPdf}:`, readErr.message);
      }
    } else {
      console.warn(`⚠️ [EmailService] Payslip PDF could not be found on disk for path: ${pdfPath}`);
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payslip for ${monthDisplay}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f6f8; padding: 32px 16px;">
        <tr>
          <td align="center">
            <!-- Main Email Container -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
              
              <!-- Company Header -->
              <tr>
                <td style="padding: 24px 32px; border-bottom: 1px solid #edf2f7;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle">
                        <div style="font-size: 15px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; text-transform: uppercase;">
                          Hydro Materials Management
                        </div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">
                          HR & Payroll Services
                        </div>
                      </td>
                      <td align="right" valign="middle">
                        <span style="display: inline-block; padding: 4px 10px; background-color: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; border-radius: 4px; letter-spacing: 0.5px;">
                          PAYSLIP
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Greeting & Body -->
              <tr>
                <td style="padding: 28px 32px 16px 32px;">
                  <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 10px;">
                    Hi ${cleanName},
                  </div>
                  <div style="font-size: 13.5px; line-height: 1.6; color: #475569;">
                    Your payslip for the month of <strong>${monthDisplay}</strong> has been generated and is attached to this email. A brief summary of your compensation is detailed below.
                  </div>
                </td>
              </tr>

              <!-- Salary Summary Card (Keka / Zoho Payroll style) -->
              ${formattedNetPay ? `
              <tr>
                <td style="padding: 0 32px 16px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px;">
                    <tr>
                      <td>
                        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b;">
                          Net Amount Disbursed
                        </div>
                        <div style="font-size: 26px; font-weight: 700; color: #0f172a; margin-top: 4px; letter-spacing: -0.5px;">
                          ${formattedNetPay}
                        </div>
                      </td>
                      <td align="right" valign="bottom">
                        <span style="display: inline-block; padding: 3px 8px; background-color: #ecfdf5; color: #047857; font-size: 11px; font-weight: 600; border-radius: 4px; border: 1px solid #a7f3d0;">
                          ✓ Disbursed
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ` : ''}

              <!-- Employee Details Table -->
              <tr>
                <td style="padding: 0 32px 20px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; border-top: 1px solid #f1f5f9;">
                    ${empCode ? `
                    <tr>
                      <td style="padding: 9px 0; color: #64748b; border-bottom: 1px solid #f1f5f9; width: 40%;">Employee ID</td>
                      <td style="padding: 9px 0; color: #0f172a; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${empCode}</td>
                    </tr>` : ''}
                    ${designation ? `
                    <tr>
                      <td style="padding: 9px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Designation</td>
                      <td style="padding: 9px 0; color: #0f172a; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${designation}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="padding: 9px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Pay Period</td>
                      <td style="padding: 9px 0; color: #0f172a; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${monthDisplay}</td>
                    </tr>
                    <tr>
                      <td style="padding: 9px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Disbursal Status</td>
                      <td style="padding: 9px 0; color: #0f172a; font-weight: 600; border-bottom: 1px solid #f1f5f9;">Processed &amp; Dispatched</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- PDF Attachment Note -->
              ${attachments.length > 0 ? `
              <tr>
                <td style="padding: 0 32px 24px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
                    <tr>
                      <td width="36" valign="middle">
                        <div style="width: 28px; height: 32px; background-color: #fee2e2; border-radius: 4px; font-size: 10px; font-weight: 800; color: #dc2626; text-align: center; line-height: 32px;">
                          PDF
                        </div>
                      </td>
                      <td valign="middle" style="padding-left: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #0f172a;">
                          ${attachedFileName}
                        </div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 1px;">
                          Itemized salary slip attached to this email
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ` : `
              <tr>
                <td style="padding: 0 32px 24px 32px;">
                  <div style="font-size: 12.5px; color: #64748b; background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    Your detailed payslip PDF is available for download in the Hydro HRMS employee portal.
                  </div>
                </td>
              </tr>
              `}

              <!-- Sign-off -->
              <tr>
                <td style="padding: 0 32px 28px 32px; font-size: 13px; color: #475569; line-height: 1.6;">
                  Regards,<br>
                  <strong style="color: #0f172a;">Payroll &amp; HR Department</strong><br>
                  Hydro Materials Management Pvt. Ltd.
                </td>
              </tr>

              <!-- Minimal Professional Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #edf2f7; font-size: 11.5px; color: #94a3b8; line-height: 1.6; text-align: center;">
                  This is an automated system email. Please do not reply directly.<br>
                  For questions regarding your salary, allowances, or deductions, please contact HR.<br><br>
                  <span style="color: #cbd5e1; font-size: 10.5px;">Confidentiality: This email and any attachments contain confidential compensation information intended solely for the designated recipient.</span>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    return this.sendMail({
      to,
      subject,
      html,
      attachments
    });
  }

  /**
   * Send 6-digit OTP email for password reset
   */
  async sendPasswordOtp({ to, name, otp, purpose = 'PASSWORD_RESET' }) {
    const greetingName = name || 'Employee';
    const subject = `Your Verification Code: ${otp} - Hydro HRMS`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verification Code</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f6f8; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
              
              <!-- Company Header -->
              <tr>
                <td style="padding: 24px 32px; border-bottom: 1px solid #edf2f7;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle">
                        <div style="font-size: 15px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; text-transform: uppercase;">
                          Hydro Materials Management
                        </div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">
                          Account Security &amp; Identity
                        </div>
                      </td>
                      <td align="right" valign="middle">
                        <span style="display: inline-block; padding: 4px 10px; background-color: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; border-radius: 4px; letter-spacing: 0.5px;">
                          VERIFICATION
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Greeting & Instructions -->
              <tr>
                <td style="padding: 28px 32px 16px 32px;">
                  <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 10px;">
                    Hi ${greetingName},
                  </div>
                  <div style="font-size: 13.5px; line-height: 1.6; color: #475569;">
                    We received a request to access or reset the password for your Hydro HRMS account. Enter the verification code below to verify your identity:
                  </div>
                </td>
              </tr>

              <!-- Clean Monospace OTP Box -->
              <tr>
                <td style="padding: 0 32px 16px 32px;">
                  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center; margin: 8px 0;">
                    <div style="font-size: 34px; font-weight: 700; letter-spacing: 10px; color: #0f172a; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; padding-left: 10px;">
                      ${otp}
                    </div>
                    <div style="font-size: 11.5px; color: #64748b; margin-top: 8px;">
                      This code is valid for 10 minutes and can only be used once.
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Security Information Note -->
              <tr>
                <td style="padding: 0 32px 24px 32px;">
                  <div style="font-size: 12px; color: #64748b; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                    If you did not initiate this request, you can safely ignore this email. No changes will be made to your account without this verification code.
                  </div>
                </td>
              </tr>

              <!-- Sign-off -->
              <tr>
                <td style="padding: 0 32px 28px 32px; font-size: 13px; color: #475569; line-height: 1.6;">
                  Regards,<br>
                  <strong style="color: #0f172a;">IT Security &amp; Operations</strong><br>
                  Hydro Materials Management Pvt. Ltd.
                </td>
              </tr>

              <!-- Minimal Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #edf2f7; font-size: 11.5px; color: #94a3b8; line-height: 1.6; text-align: center;">
                  This is an automated system email. Please do not reply directly.<br>
                  Hydro HRMS Security Service
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    return this.sendMail({ to, subject, html });
  }

  /**
   * Send Expense Claim Decision & Receipt Email to Employee
   */
  async sendExpenseDecisionEmail({ to, employeeName, expense, decision, actionBy, receiptPath }) {
    if (!to) {
      console.warn('⚠️ [EmailService] Cannot send expense email: missing recipient email');
      return { success: false, error: 'Missing employee email' };
    }

    const isApproved = String(decision).toLowerCase() === 'approved';
    const statusText = isApproved ? 'APPROVED' : 'REJECTED';
    const statusColor = isApproved ? '#16a34a' : '#dc2626';
    const statusBg = isApproved ? '#f0fdf4' : '#fef2f2';
    const statusBorder = isApproved ? '#bbf7d0' : '#fecaca';

    const formattedAmount = parseFloat(expense.amount || 0).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR'
    });

    const subject = `[Hydro HRMS] Expense Claim #${expense.id} has been ${statusText}`;

    const attachments = [];
    if (receiptPath) {
      let resolvedFile = null;
      if (path.isAbsolute(receiptPath) && fs.existsSync(receiptPath)) {
        resolvedFile = receiptPath;
      } else {
        const candidate1 = path.join(this.getStoragePath(), receiptPath);
        const candidate2 = path.join(this.getStoragePath(), 'invoices', path.basename(receiptPath));
        if (fs.existsSync(candidate1)) resolvedFile = candidate1;
        else if (fs.existsSync(candidate2)) resolvedFile = candidate2;
      }

      if (resolvedFile) {
        attachments.push({
          filename: `Receipt-EXP-${expense.id}${path.extname(resolvedFile)}`,
          path: resolvedFile
        });
      }
    }

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Expense Claim Status</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: #0f172a; padding: 28px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
        .header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; }
        .content { padding: 28px 24px; }
        .status-banner { background: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px; }
        .status-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: ${statusColor}; }
        .status-amount { font-size: 28px; font-weight: 800; color: #0f172a; margin-top: 4px; }
        .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; }
        .detail-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
        .detail-table td.label { color: #64748b; font-weight: 500; width: 40%; }
        .detail-table td.value { color: #0f172a; font-weight: 600; }
        .attachment-note { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 8px; }
        .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Expenses & Claims Notification</h1>
          <p>Hydro HRMS Management</p>
        </div>
        <div class="content">
          <p style="font-size: 15px; margin: 0 0 16px 0;">Hello <strong>${employeeName || 'Employee'}</strong>,</p>
          <p style="font-size: 13.5px; color: #475569; margin: 0 0 20px 0; line-height: 1.5;">
            Your submitted expense reimbursement claim has been reviewed by the administration.
          </p>

          <div class="status-banner">
            <div class="status-title">Claim Status: ${statusText}</div>
            <div class="status-amount">${formattedAmount}</div>
          </div>

          <table class="detail-table">
            <tr>
              <td class="label">Claim Reference:</td>
              <td class="value">#EXP-${expense.id}</td>
            </tr>
            <tr>
              <td class="label">Category:</td>
              <td class="value">${expense.category || 'General Expense'}</td>
            </tr>
            <tr>
              <td class="label">Bill / Invoice No:</td>
              <td class="value">${expense.billNo || 'N/A'}</td>
            </tr>
            <tr>
              <td class="label">Bill Date:</td>
              <td class="value">${expense.billDate || 'N/A'}</td>
            </tr>
            <tr>
              <td class="label">Site / Merchant:</td>
              <td class="value">${expense.siteName || expense.merchantName || 'N/A'}</td>
            </tr>
            <tr>
              <td class="label">Description / Remarks:</td>
              <td class="value">${expense.description || 'No description provided'}</td>
            </tr>
            <tr>
              <td class="label">Reviewed By:</td>
              <td class="value">${actionBy || 'Admin'}</td>
            </tr>
          </table>

          ${attachments.length > 0 ? `
          <div class="attachment-note">
            📎 <span>Your original uploaded invoice/receipt document is attached to this email for your financial records.</span>
          </div>
          ` : ''}
        </div>
        <div class="footer">
          Hydro HRMS • Automated Financial Claims Service<br>
          For any discrepancies, please contact your payroll department.
        </div>
      </div>
    </body>
    </html>
    `;

    return this.sendMail({
      to,
      subject,
      html,
      attachments
    });
  }

  /**
   * Send Live Test Email to verify email configuration
   */
  async sendTestEmail({ to, customConfig = null }) {
    const subject = `[Hydro HRMS] Email Integration Test`;
    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; color: #1e293b;">
      <div style="max-width: 480px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #16a34a; margin-top: 0;">✅ Email Service Connected!</h2>
        <p style="font-size: 14px; line-height: 1.5; color: #475569;">
          This is a verification email from your <strong>Hydro HRMS Portal</strong>. Your Resend API integration and outbound email pipeline are operational.
        </p>
        <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-size: 12px; color: #334155; margin: 16px 0;">
          <strong>Timestamp:</strong> ${new Date().toLocaleString('en-IN')}<br>
          <strong>Recipient:</strong> ${to}
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Hydro HRMS Automated Diagnostic</p>
      </div>
    </body>
    </html>
    `;

    return this.sendMail({ to, subject, html, customConfig });
  }
}

module.exports = new EmailService();
