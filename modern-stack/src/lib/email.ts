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
      bcc, // Store BCC in config
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
            🌟 Your First Step Into the IrregularChat! 🌟
          </h2>
          
          <p>You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans.</p>
          
          <hr style="border: 1px solid #007bff; margin: 20px 0;">
          
          <h3 style="color: #495057;">Use This Username and Temporary Password ⬇️</h3>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Username:</strong> ${data.username}</p>
            <p><strong>Temporary Password:</strong> ${data.password}</p>
            <p style="font-size: 14px; color: #6c757d;">Exactly as shown above 👆🏼</p>
          </div>
          
          <h3>1️⃣ Step 1:</h3>
          <p>Use the username and temporary password to log in to <a href="https://sso.irregularchat.com" style="color: #007bff;">https://sso.irregularchat.com</a></p>
          
          <h3>2️⃣ Step 2:</h3>
          <ul>
            <li>Update your email, important to be able to recover your account and verify your identity</li>
            <li>Save your Login Username and New Password to a Password Manager</li>
            <li>Visit the welcome page while logged in <a href="https://forum.irregularchat.com/t/84" style="color: #007bff;">https://forum.irregularchat.com/t/84</a></li>
          </ul>
          
          ${data.discoursePostUrl ? `
            <h3>3️⃣ Step 3:</h3>
            <p>We posted an intro about you, but you can complete or customize it:<br>
              <a href="${data.discoursePostUrl}" style="color: #007bff;">View Your Introduction</a>
            </p>
          ` : ''}
          
          <p style="background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <strong>Please take a moment to learn about the community before you jump in.</strong>
          </p>
          
          <p>If you have any questions or need assistance, feel free to reach out to the community admins.</p>
          
          <p><strong>Welcome aboard!</strong></p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px;">
            <p>Learn more about our community: <a href="https://irregularpedia.org/index.php/Main_Page">IrregularPedia</a></p>
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `;

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

      await this.transporter.sendMail(mailOptions);

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

      const mailOptions: any = {
        from: this.config!.from,
        to: to,
        subject: subject,
        html: emailTemplate,
      };

      // Add BCC if configured
      if (this.config!.bcc) {
        mailOptions.bcc = this.config!.bcc;
      }

      await this.transporter.sendMail(mailOptions);

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