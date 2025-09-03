const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.config = null;
    this.transporter = null;
    this.isActive = false;
    this.initializeFromEnv();
  }

  initializeFromEnv() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;
    const bcc = process.env.SMTP_BCC;

    console.log('SMTP Configuration Check:');
    console.log(`SMTP_HOST: ${host ? 'configured' : 'missing'}`);
    console.log(`SMTP_PORT: ${port ? 'configured' : 'missing'}`);
    console.log(`SMTP_USER: ${user ? 'configured' : 'missing'}`);
    console.log(`SMTP_PASS: ${pass ? 'configured' : 'missing'}`);
    console.log(`SMTP_FROM: ${from ? 'configured' : 'missing'}`);
    console.log(`SMTP_BCC: ${bcc ? 'configured' : 'not set'}`);

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
      bcc,
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

  isConfigured() {
    return this.isActive && !!this.transporter;
  }

  generateWelcomeEmailHTML(data) {
    const {
      fullName,
      username,
      password,
      discoursePostUrl,
    } = data;

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .content { background: #f4f4f4; padding: 20px; margin-top: 20px; }
        .credentials { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #2c3e50; }
        .footer { text-align: center; padding: 20px; color: #666; }
        a { color: #3498db; }
        .button { 
            display: inline-block; 
            padding: 10px 20px; 
            background: #3498db; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to IrregularChat!</h1>
        </div>
        
        <div class="content">
            <p>Dear ${fullName},</p>
            
            <p>Your IrregularChat account has been successfully created!</p>
            
            <div class="credentials">
                <h3>Your Login Credentials:</h3>
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>Temporary Password:</strong> ${password}</p>
                <p style="color: #e74c3c;"><em>Please change your password after your first login.</em></p>
            </div>
            
            <h3>Getting Started:</h3>
            <ol>
                <li><strong>Login to SSO:</strong> <a href="https://sso.irregularchat.com">https://sso.irregularchat.com</a></li>
                <li><strong>Access the Forum:</strong> <a href="https://forum.irregularchat.com">https://forum.irregularchat.com</a></li>
                <li><strong>Join Signal Groups:</strong> Follow the instructions in the forum's welcome section</li>
                <li><strong>Set up Matrix:</strong> Instructions available in the community resources</li>
            </ol>
            
            ${discoursePostUrl ? `
            <h3>Your Introduction Post:</h3>
            <p>Your introduction has been posted to the forum:</p>
            <a href="${discoursePostUrl}" class="button">View Your Introduction</a>
            ` : ''}
            
            <h3>Important Resources:</h3>
            <ul>
                <li><a href="https://irregularpedia.org">Community Wiki</a></li>
                <li><a href="https://forum.irregularchat.com/c/welcome">Welcome Guide</a></li>
                <li><a href="https://forum.irregularchat.com/t/community-guidelines">Community Guidelines</a></li>
            </ul>
            
            <h3>Need Help?</h3>
            <p>If you have any questions or need assistance:</p>
            <ul>
                <li>Post in the forum's help section</li>
                <li>Ask in the Signal Entry room</li>
                <li>Contact your inviter for guidance</li>
            </ul>
        </div>
        
        <div class="footer">
            <p>This is an automated message from the IrregularChat onboarding system.</p>
            <p>Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  async sendWelcomeEmail(data) {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      const welcomeTemplate = this.generateWelcomeEmailHTML({
        fullName: data.fullName,
        username: data.username,
        password: data.password,
        discoursePostUrl: data.discoursePostUrl,
      });

      const mailOptions = {
        from: this.config.from,
        to: data.to,
        subject: data.subject || 'Welcome to IrregularChat!',
        html: welcomeTemplate,
      };

      // Add BCC if configured
      if (this.config.bcc) {
        mailOptions.bcc = this.config.bcc;
      }

      console.log(`Attempting to send welcome email to ${data.to}`);
      await this.transporter.sendMail(mailOptions);
      console.log(`Welcome email sent successfully to ${data.to}`);
      return true;
    } catch (error) {
      console.error('Error sending welcome email:', error);
      return false;
    }
  }

  async sendNotificationEmail(to, subject, html) {
    if (!this.isActive || !this.transporter) {
      console.warn('Email service not configured');
      return false;
    }

    try {
      const mailOptions = {
        from: this.config.from,
        to,
        subject,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      console.log(`Notification email sent to ${to}`);
      return true;
    } catch (error) {
      console.error('Error sending notification email:', error);
      return false;
    }
  }
}

module.exports = new EmailService();