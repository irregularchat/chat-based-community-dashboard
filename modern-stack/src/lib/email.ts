import nodemailer from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
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

    if (!host || !port || !user || !pass || !from) {
      console.warn('SMTP not configured. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM');
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
    };

    this.transporter = nodemailer.createTransport(this.config);
    this.isActive = true;
    console.log('Email service initialized successfully');
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

  public async sendWelcomeEmail(data: WelcomeEmailData): Promise<boolean> {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      const welcomeTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
            Welcome to IrregularChat!
          </h2>
          
          <p>Hi ${data.fullName},</p>
          
          <p>Welcome to our community! Your account has been successfully created.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #495057;">Your Login Credentials</h3>
            <p><strong>Username:</strong> ${data.username}</p>
            <p><strong>Temporary Password:</strong> ${data.password}</p>
          </div>
          
          <p style="background-color: #fff3cd; padding: 10px; border-radius: 5px; border-left: 4px solid #ffc107;">
            <strong>Important:</strong> Please change your password after your first login for security.
          </p>
          
          ${data.discoursePostUrl ? `
            <p>Your introduction post has been created in our forum: 
              <a href="${data.discoursePostUrl}" style="color: #007bff;">View Your Introduction</a>
            </p>
          ` : ''}
          
          <div style="margin-top: 30px;">
            <h3>Next Steps:</h3>
            <ol>
              <li>Log in to the community dashboard</li>
              <li>Complete your profile</li>
              <li>Join relevant Matrix rooms</li>
              <li>Introduce yourself to the community</li>
            </ol>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
            <p>Learn more about our community: <a href="https://irregularpedia.org/index.php/Main_Page">IrregularPedia</a></p>
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `;

      await this.transporter.sendMail({
        from: this.config!.from,
        to: data.to,
        subject: data.subject,
        html: welcomeTemplate,
      });

      console.log(`Welcome email sent successfully to ${data.to}`);
      return true;
    } catch (error) {
      console.error('Error sending welcome email:', error);
      return false;
    }
  }

  public async sendAdminEmail(
    to: string,
    subject: string,
    adminMessage: string,
    userData?: UserData,
    isLocalAccount = false
  ): Promise<boolean> {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      // Substitute variables in the admin message
      const processedMessage = this.substituteVariables(adminMessage, userData || {});

      const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">
            Message from Community Administration
          </h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; white-space: pre-wrap;">
            ${processedMessage.replace(/\n/g, '<br>')}
          </div>
          
          ${isLocalAccount ? `
            <div style="background-color: #e9ecef; padding: 10px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0; font-size: 12px; color: #6c757d;">
                This message is regarding your local dashboard account.
              </p>
            </div>
          ` : ''}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
            <p>This message was sent by the community administration team.</p>
            <p>Please do not reply to this email address. Contact administrators through the proper channels.</p>
          </div>
        </div>
      `;

      await this.transporter.sendMail({
        from: this.config!.from,
        to: to,
        subject: subject,
        html: emailTemplate,
      });

      console.log(`Admin email sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('Error sending admin email:', error);
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
      await this.transporter.sendMail({
        from: this.config!.from,
        to: to,
        subject: subject,
        html: htmlContent,
        text: textContent,
      });

      console.log(`Email sent successfully to ${to}`);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  public isConfigured(): boolean {
    return this.isActive;
  }
}

// Export singleton instance
export const emailService = new EmailService(); 