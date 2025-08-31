import nodemailer from 'nodemailer';
import { MessageTemplates } from './message-templates';
import { prisma } from './prisma';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  bcc?: string; // Add BCC support
}

interface UserData {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  matrixUsername?: string;
}

interface WelcomeEmailData {
  to: string;
  subject: string;
  fullName: string;
  username: string;
  password: string;
  topicId?: string;
  discoursePostUrl?: string;
}

interface EmailTrackingData {
  recipientEmail: string;
  senderUsername: string;
  subject: string;
  emailType: 'welcome' | 'admin_message' | 'invite' | 'password_reset' | 'custom';
  messagePreview?: string;
  recipientId?: number;
}

class EmailService {
  private config: EmailConfig | null = null;
  private transporter: nodemailer.Transporter | null = null;
  private isActive = false;

  constructor() {
    this.initializeFromEnv();
  }

  private initializeFromEnv() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;
    const bcc = process.env.SMTP_BCC; // Add BCC from environment

    console.log('SMTP Configuration Check:');
    console.log(`SMTP_HOST: ${host ? 'configured' : 'missing'}`);
    console.log(`SMTP_PORT: ${port ? 'configured' : 'missing'}`);
    console.log(`SMTP_USER: ${user ? 'configured' : 'missing'}`);
    console.log(`SMTP_PASS: ${pass ? 'configured' : 'missing'}`);
    console.log(`SMTP_FROM: ${from ? 'configured' : 'missing'}`);
    console.log(`SMTP_BCC: ${bcc ? 'configured' : 'not set'}`);

    if (!host || !port || !user || !pass || !from) {
      console.warn('SMTP not configured. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM');
      console.warn('Missing variables:', {
        SMTP_HOST: !host,
        SMTP_PORT: !port,
        SMTP_USER: !user,
        SMTP_PASS: !pass,
        SMTP_FROM: !from
      });
      return;
    }

    this.config = {
      host,
      port: parseInt(port),
      secure: parseInt(port) === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
      from,
      bcc, // Store BCC in config
    };

    try {
      this.transporter = nodemailer.createTransport(this.config);
      this.isActive = true;
      console.log('Email service initialized successfully');
      console.log(`SMTP Server: ${host}:${port}`);
      console.log(`From Address: ${from}`);
      console.log(`BCC Address: ${bcc || 'none'}`);
    } catch (error) {
      console.error('Failed to create SMTP transporter:', error);
      this.isActive = false;
    }
  }

  private substituteVariables(message: string, userData: UserData): string {
    if (!userData) return message;

    const substitutions: Record<string, string> = {
      '$Username': userData.username || '',
      '$DisplayName': userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      '$FirstName': userData.firstName || '',
      '$LastName': userData.lastName || '',
      '$Email': userData.email || '',
      '$MatrixUsername': userData.matrixUsername || '',
    };

    let result = message;
    Object.entries(substitutions).forEach(([variable, value]) => {
      result = result.replace(new RegExp(variable.replace('$', '\\$'), 'g'), value);
    });

    return result;
  }

  private async trackEmail(
    trackingData: EmailTrackingData,
    status: 'sent' | 'failed' = 'sent',
    errorMessage?: string
  ): Promise<void> {
    try {
      // Create message preview (first 200 chars)
      const messagePreview = trackingData.messagePreview
        ? trackingData.messagePreview.substring(0, 200)
        : undefined;

      await prisma.emailHistory.create({
        data: {
          recipientEmail: trackingData.recipientEmail,
          senderUsername: trackingData.senderUsername,
          subject: trackingData.subject,
          emailType: trackingData.emailType,
          status,
          errorMessage,
          messagePreview,
          recipientId: trackingData.recipientId,
        },
      });
    } catch (error) {
      console.error('Failed to track email:', error);
      // Don't throw - email tracking failure shouldn't block email sending
    }
  }

  public async sendWelcomeEmail(data: WelcomeEmailData): Promise<boolean> {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      // Debug logging for email template data
      console.log('Email template data:', {
        fullName: data.fullName,
        username: data.username,
        password: '[REDACTED]',
        topicId: data.topicId,
        discoursePostUrl: data.discoursePostUrl,
        isLocalAccount: false,
      });

      // Use the new MessageTemplates to generate the HTML content
      const welcomeTemplate = MessageTemplates.generateWelcomeEmailHTML({
        fullName: data.fullName,
        username: data.username,
        password: data.password,
        topicId: data.topicId,
        discoursePostUrl: data.discoursePostUrl,
        isLocalAccount: false, // Default to SSO account
      });

      const mailOptions: any = {
        from: this.config!.from,
        to: data.to,
        subject: data.subject,
        html: welcomeTemplate,
      };

      // Add BCC if configured
      if (this.config!.bcc) {
        mailOptions.bcc = this.config!.bcc;
      }

      console.log(`Attempting to send welcome email to ${data.to}`);
      console.log(`SMTP Config: ${this.config!.host}:${this.config!.port}`);
      console.log(`From: ${this.config!.from}`);
      console.log(`BCC: ${this.config!.bcc || 'none'}`);

      await this.transporter.sendMail(mailOptions);

      // Track the email
      await this.trackEmail({
        recipientEmail: data.to,
        senderUsername: 'system',
        subject: data.subject,
        emailType: 'welcome',
        messagePreview: `Welcome ${data.fullName}! Username: ${data.username}`,
      });

      console.log(`Welcome email sent successfully to ${data.to}`);
      return true;
    } catch (error) {
      console.error('Error sending welcome email:', error);
      console.error('SMTP Configuration:', {
        host: this.config?.host,
        port: this.config?.port,
        secure: this.config?.secure,
        from: this.config?.from,
        user: this.config?.auth?.user,
        hasPassword: !!this.config?.auth?.pass
      });

      // Track failed email
      await this.trackEmail({
        recipientEmail: data.to,
        senderUsername: 'system',
        subject: data.subject,
        emailType: 'welcome',
        messagePreview: `Welcome ${data.fullName}! Username: ${data.username}`,
      }, 'failed', error instanceof Error ? error.message : 'Unknown error');

      return false;
    }
  }

  public async sendAdminEmail(
    to: string,
    subject: string,
    adminMessage: string,
    userData?: UserData,
    _isLocalAccount = false
  ): Promise<boolean> {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    // Process variable substitution for the subject
    const processedSubject = this.substituteVariables(subject, userData || {});

    try {
      // Use the new MessageTemplates to generate the HTML content
      const emailTemplate = MessageTemplates.generateAdminEmailHTML({
        adminMessage,
        subject,
        userData: userData ? {
          username: userData.username,
          displayName: userData.displayName,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          matrixUsername: userData.matrixUsername,
        } : undefined,
      });


      const mailOptions: any = {
        from: this.config!.from,
        to: to,
        subject: processedSubject,
        html: emailTemplate,
      };

      // Add BCC if configured
      if (this.config!.bcc) {
        mailOptions.bcc = this.config!.bcc;
      }

      await this.transporter.sendMail(mailOptions);

      // Track the email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'admin',
        subject: processedSubject,
        emailType: 'admin_message',
        messagePreview: adminMessage.substring(0, 200),
        recipientId: userData?.username ? undefined : undefined, // Would need user lookup
      });

      console.log(`Admin email sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('Error sending admin email:', error);

      // Track failed email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'admin',
        subject: processedSubject,
        emailType: 'admin_message',
        messagePreview: adminMessage.substring(0, 200),
      }, 'failed', error instanceof Error ? error.message : 'Unknown error');

      return false;
    }
  }

  public async sendEmail(
    to: string,
    subject: string,
    htmlContent: string,
    textContent?: string
  ): Promise<boolean> {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      const mailOptions: any = {
        from: this.config!.from,
        to: to,
        subject: subject,
        html: htmlContent,
        text: textContent,
      };

      // Add BCC if configured
      if (this.config!.bcc) {
        mailOptions.bcc = this.config!.bcc;
      }

      await this.transporter.sendMail(mailOptions);

      // Track the email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'system',
        subject: subject,
        emailType: 'custom',
        messagePreview: htmlContent ? htmlContent.replace(/<[^>]*>/g, '').substring(0, 200) : textContent?.substring(0, 200),
      });

      console.log(`Email sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);

      // Track failed email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'system',
        subject: subject,
        emailType: 'custom',
        messagePreview: htmlContent ? htmlContent.replace(/<[^>]*>/g, '').substring(0, 200) : textContent?.substring(0, 200),
      }, 'failed', error instanceof Error ? error.message : 'Unknown error');

      return false;
    }
  }

  public async sendInviteEmail(
    to: string,
    subject: string,
    fullName: string,
    inviteLink: string
  ): Promise<boolean> {
    if (!this.isActive || !this.transporter || !this.config) {
      console.error('Email service is not active or transporter not configured');
      return false;
    }

    try {
      // Use the new MessageTemplates to generate the HTML content
      const htmlContent = MessageTemplates.generateInviteEmailHTML(fullName, inviteLink);

      // Create plain text version
      const textContent = `
        You're Invited to Join Our Community!
        
        Hello ${fullName},
        
        You've been invited to join our community platform! Click the link below to create your account and get started:
        
        ${inviteLink}
        
        We're excited to have you join our community and look forward to your participation!
        
        Best regards,
        The Community Team
        
        This invitation was sent to ${to}. If you didn't expect this invitation, you can safely ignore this email.
      `;

      const mailOptions = {
        from: this.config.from,
        to,
        subject,
        html: htmlContent,
        text: textContent,
        ...(this.config.bcc && { bcc: this.config.bcc }),
      };

      await this.transporter.sendMail(mailOptions);

      // Track the email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'system',
        subject: subject,
        emailType: 'invite',
        messagePreview: `Invitation for ${fullName}`,
      });

      console.log(`Invite email sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('Failed to send invite email:', error);

      // Track failed email
      await this.trackEmail({
        recipientEmail: to,
        senderUsername: 'system',
        subject: subject,
        emailType: 'invite',
        messagePreview: `Invitation for ${fullName}`,
      }, 'failed', error instanceof Error ? error.message : 'Unknown error');

      return false;
    }
  }

  public async sendPasswordResetEmail(data: {
    to: string;
    subject: string;
    fullName: string;
    username: string;
    newPassword: string;
  }): Promise<boolean> {
    if (!this.isActive || !this.transporter || !this.config) {
      console.error('Email service is not active or transporter not configured');
      return false;
    }

    try {
      // Create HTML email content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
            .content { background-color: #f8f9fa; padding: 20px; }
            .footer { background-color: #e5e7eb; padding: 15px; text-align: center; font-size: 12px; }
            .password-box { 
              background-color: #fef3c7; 
              border: 1px solid #f59e0b; 
              padding: 15px; 
              border-radius: 5px; 
              margin: 20px 0;
              font-family: monospace;
              font-size: 16px;
              text-align: center;
            }
            .warning { 
              background-color: #fee2e2; 
              border: 1px solid #dc2626; 
              padding: 15px; 
              border-radius: 5px; 
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔒 Password Reset</h1>
            </div>
            <div class="content">
              <p>Hello ${data.fullName},</p>
              
              <p>Your password has been reset by an administrator. Here are your new login credentials:</p>
              
              <p><strong>Username:</strong> ${data.username}</p>
              <p><strong>New Password:</strong></p>
              <div class="password-box">
                ${data.newPassword}
              </div>
              
              <div class="warning">
                <strong>⚠️ Important:</strong> Please change this password immediately after your next login for security reasons.
              </div>
              
              <p>If you did not request this password reset, please contact an administrator immediately.</p>
              
              <p>Best regards,<br>The Community Team</p>
            </div>
            <div class="footer">
              <p>This password reset was sent to ${data.to}. If you didn't request this reset, please contact support.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Create plain text version
      const textContent = `
        Password Reset
        
        Hello ${data.fullName},
        
        Your password has been reset by an administrator. Here are your new login credentials:
        
        Username: ${data.username}
        New Password: ${data.newPassword}
        
        ⚠️ Important: Please change this password immediately after your next login for security reasons.
        
        If you did not request this password reset, please contact an administrator immediately.
        
        Best regards,
        The Community Team
        
        This password reset was sent to ${data.to}. If you didn't request this reset, please contact support.
      `;

      const mailOptions = {
        from: this.config.from,
        to: data.to,
        subject: data.subject,
        html: htmlContent,
        text: textContent,
        ...(this.config.bcc && { bcc: this.config.bcc }),
      };

      await this.transporter.sendMail(mailOptions);

      // Track the email
      await this.trackEmail({
        recipientEmail: data.to,
        senderUsername: 'admin',
        subject: data.subject,
        emailType: 'password_reset',
        messagePreview: `Password reset for ${data.fullName} (${data.username})`,
      });

      console.log(`Password reset email sent successfully to ${data.to}`);
      return true;
    } catch (error) {
      console.error('Failed to send password reset email:', error);

      // Track failed email
      await this.trackEmail({
        recipientEmail: data.to,
        senderUsername: 'admin',
        subject: data.subject,
        emailType: 'password_reset',
        messagePreview: `Password reset for ${data.fullName} (${data.username})`,
      }, 'failed', error instanceof Error ? error.message : 'Unknown error');

      return false;
    }
  }

  public isConfigured(): boolean {
    return this.isActive && this.transporter !== null;
  }

  public getConfig(): EmailConfig | null {
    return this.config;
  }
}

// Export singleton instance
export const emailService = new EmailService(); 