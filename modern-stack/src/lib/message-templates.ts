/**
 * Message templates for the community dashboard
 * Based on legacy Streamlit system format for consistency
 */

export interface WelcomeMessageData {
  username: string;
  fullName: string;
  tempPassword: string;
  discoursePostUrl?: string;
  passwordResetSuccessful?: boolean;
}

export interface InviteMessageData {
  inviteLink: string;
  expiresAt: number;
  recipientName?: string;
}

export interface RecoveryMessageData {
  username: string;
  newPassword: string;
}

export interface UserSummaryData {
  username: string;
  displayName: string;
  organization?: string;
  email: string;
  interests?: string;
  sendWelcome: boolean;
}

export interface WelcomeEmailData {
  fullName: string;
  username: string;
  password: string;
  topicId?: string;
  discoursePostUrl?: string;
  isLocalAccount?: boolean;
}

export interface AdminEmailData {
  adminMessage: string;
  subject: string;
  userData?: {
    username?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    matrixUsername?: string;
  };
}

export class MessageTemplates {
  /**
   * Create a welcome message for a new user - based on legacy create_user_message
   */
  static createWelcomeMessage(data: WelcomeMessageData): string {
    const { username, tempPassword, discoursePostUrl, passwordResetSuccessful = true } = data;
    
    // Debug logging for Matrix welcome message
    console.log('Matrix welcome message data:', {
      username,
      tempPassword: '[REDACTED]',
      discoursePostUrl,
      passwordResetSuccessful,
    });

    // Special case for failed password reset
    if (!tempPassword || !passwordResetSuccessful) {
      return `🌟 User Created But Password Reset Failed 🌟

Your account has been created. Please set your password using the steps below:

Username: ${username}

To set your password:

1️⃣ Go to https://sso.irregularchat.com/if/flow/password-reset/
2️⃣ Enter the username: ${username}
3️⃣ Click "Reset Password" and follow the instructions

For admin assistance, please contact the system administrator.`;
    }

    // Normal case with successful password reset
    let welcomeMessage = `🌟 Your First Step Into the IrregularChat! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, 
and supporting service members and veterans.
---
Use This Username and Temporary Password ⬇️
Username: ${username}
Temporary Password: ${tempPassword}
Exactly as shown above 👆🏼

1️⃣ Step 1:
- Use the username and temporary password to log in to https://sso.irregularchat.com

2️⃣ Step 2:
- Update your email, important to be able to recover your account and verify your identity
- Save your Login Username and New Password to a Password Manager
- Visit the welcome page while logged in https://forum.irregularchat.com/t/84`;

    // Add forum post URL to welcome message if available
    if (discoursePostUrl) {
      welcomeMessage += `

3️⃣ Step 3:
- We posted an intro about you, but you can complete or customize it:
${discoursePostUrl}`;
    }

    welcomeMessage += `

Please take a moment to learn about the community before you jump in.

If you have any questions or need assistance, feel free to reach out to the community admins.

Welcome aboard!`;

    return welcomeMessage;
  }

  /**
   * Create an invite message with expiration time - based on legacy create_invite_message
   */
  static createInviteMessage(data: InviteMessageData): string {
    const { inviteLink, expiresAt, recipientName } = data;

    // Format expiration time
    let expiresFormatted = "Unknown";
    try {
      const expiresDate = new Date(expiresAt * 1000);
      expiresFormatted = expiresDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch (error) {
      console.error("Error formatting expiration time:", error);
    }

    const greeting = recipientName ? `Hi ${recipientName}!` : 'Hi there!';

    return `🌟 Welcome to IrregularChat! 🌟

${greeting}

You're invited to join our community. Please use the link below to create your account:

${inviteLink}

This invite expires on ${expiresFormatted}.

Looking forward to seeing you in the community!`;
  }

  /**
   * Create a recovery message - based on legacy create_recovery_message
   */
  static createRecoveryMessage(data: RecoveryMessageData): string {
    const { username, newPassword } = data;

    return `Account recovery Details
**Username**: ${username}
**New Password**: ${newPassword}

Use the credentials above to recover your account. Make sure you update your email address 
after recovering your account so you can recover your account in the future.

If you have any issues, please reach out to the admin team.
Once Logged in, see all the chats and services: https://forum.irregularchat.com/t/84`;
  }

  /**
   * Create a user creation summary - based on legacy create_user_summary
   */
  static createUserSummary(data: UserSummaryData): string {
    const { username, displayName, organization, email, interests, sendWelcome } = data;

    return `📋 User Creation Summary:

👤 Username: ${username}
📛 Name: ${displayName}
🏢 Organization: ${organization || 'Not specified'}
📧 Email: ${email}
🔍 Interests: ${interests || 'Not specified'}
📨 Send Welcome: ${sendWelcome ? 'Yes' : 'No'}`;
  }

  /**
   * Generate HTML content for welcome email - based on legacy get_email_html_content
   */
  static generateWelcomeEmailHTML(data: WelcomeEmailData): string {
    const { fullName, username, password, discoursePostUrl, isLocalAccount = false } = data;

    // Create Discourse post link section if URL is available
    const discourseSection = discoursePostUrl ? `
      <p>Your introduction post: <a href="${discoursePostUrl}">View your introduction post</a></p>
    ` : '';

    // Different login instructions based on account type
    const loginInstructions = isLocalAccount ? `
      <h3>Next Steps:</h3>
      
      <ol>
        <li>Log in to the <strong>Community Dashboard</strong> at <a href="http://localhost:8503">http://localhost:8503</a> (or your dashboard URL)</li>
        <li>Use the "Local Account Login" option</li>
        <li>Change your temporary password after your first login</li>
        <li>Explore the dashboard features available to you</li>
      </ol>
      
      <p><strong>Note:</strong> This is a local dashboard account. You can access community management features through the dashboard interface.</p>
      
      <a href="http://localhost:8503" class="button">Access Dashboard</a>
    ` : `
      <h3>Next Steps:</h3>
      
      <ol>
        <li>Log in at <a href="https://sso.irregularchat.com">https://sso.irregularchat.com</a></li>
        <li>Change your temporary password to something secure</li>
        <li>Join our Signal groups to connect with the community</li>
        <li>Explore our community resources and events</li>
      </ol>
      
      <h3>Community Resources:</h3>
      
      <ul>
        <li><a href="https://forum.irregularchat.com">Community Forum</a> - Discussions, announcements, and resources</li>
        <li><a href="https://irregularpedia.org">Community Wiki</a> - Knowledge base and documentation</li>
        <li><a href="https://event.irregularchat.com">Community Calendar</a> - Upcoming events and activities</li>
      </ul>
      
      <a href="https://sso.irregularchat.com" class="button">Log in Now</a>
    `;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
            }
            .email-container {
                max-width: 600px;
                margin: auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
            }
            h1 {
                color: #2a6496;
                border-bottom: 2px solid #eee;
                padding-bottom: 10px;
            }
            .credentials {
                background-color: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
                border-left: 4px solid #2a6496;
            }
            .button {
                display: inline-block;
                padding: 10px 20px;
                background-color: #2a6496;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
            }
            .footer {
                margin-top: 30px;
                padding-top: 15px;
                border-top: 1px solid #eee;
                font-size: 0.9em;
                color: #777;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>Welcome to IrregularChat, ${fullName}!</h1>
            
            <p>Thank you for joining our community. We're excited to have you with us!</p>
            
            <div class="credentials">
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>Temporary Password:</strong> ${password}</p>
                <p><em>Please change your password after your first login.</em></p>
            </div>
            
            ${loginInstructions}

            ${discourseSection}

            <div class="footer">
                If you have any questions, feel free to reach out to our <a href="https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve">admin signal group</a>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate HTML content for admin email - based on legacy admin_user_email
   */
  static generateAdminEmailHTML(data: AdminEmailData): string {
    const { adminMessage, subject, userData } = data;

    // Process variable substitution
    let processedMessage = adminMessage;
    let processedSubject = subject;

    if (userData) {
      const variables = {
        '$Username': userData.username || '',
        '$DisplayName': userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        '$FirstName': userData.firstName || '',
        '$LastName': userData.lastName || '',
        '$Email': userData.email || '',
        '$MatrixUsername': userData.matrixUsername || '',
      };

      // Replace variables in both message and subject
      Object.entries(variables).forEach(([variable, value]) => {
        if (value) {
          processedMessage = processedMessage.replace(new RegExp(variable.replace('$', '\\$'), 'g'), value);
          processedSubject = processedSubject.replace(new RegExp(variable.replace('$', '\\$'), 'g'), value);
        }
      });
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
            }
            .email-container {
                max-width: 600px;
                margin: auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
            }
            h1 {
                color: #2a6496;
                border-bottom: 2px solid #eee;
                padding-bottom: 10px;
                margin-bottom: 20px;
            }
            .message {
                background-color: #ffffff;
                padding: 20px;
                border-radius: 5px;
                margin: 20px 0;
                border-left: 4px solid #2a6496;
                white-space: pre-wrap;
                font-size: 14px;
                line-height: 1.6;
            }
            .footer {
                margin-top: 30px;
                padding-top: 15px;
                border-top: 1px solid #eee;
                font-size: 0.9em;
                color: #777;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>Message from IrregularChat Administration</h1>
            
            <div class="message">${processedMessage}</div>
            
            <div class="footer">
                <p>This message was sent by a community administrator.</p>
                <p>If you have questions about this message, please contact our <a href="https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve">admin signal group</a></p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate HTML content for invite email - based on legacy send_invite_email
   */
  static generateInviteEmailHTML(fullName: string, inviteLink: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
            }
            .email-container {
                max-width: 600px;
                margin: auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
            }
            h1 {
                color: #2a6496;
                border-bottom: 2px solid #eee;
                padding-bottom: 10px;
            }
            .invite-section {
                background-color: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
                border-left: 4px solid #2a6496;
            }
            .button {
                display: inline-block;
                padding: 10px 20px;
                background-color: #2a6496;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
            }
            .footer {
                margin-top: 30px;
                padding-top: 15px;
                border-top: 1px solid #eee;
                font-size: 0.9em;
                color: #777;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>You've Been Invited to IrregularChat!</h1>
            
            <p>Hello ${fullName},</p>
            
            <p>You've been invited to join the IrregularChat community. We're excited to welcome you!</p>
            
            <div class="invite-section">
                <p><strong>Your personal invitation link:</strong></p>
                <p><a href="${inviteLink}">${inviteLink}</a></p>
                <p><em>This link will expire after a limited time, so please use it soon.</em></p>
            </div>
            
            <h3>What is IrregularChat?</h3>
            <p>IrregularChat is a community where members connect, share ideas, and collaborate. After joining, you'll have access to our forum, wiki, messaging platforms, and other services.</p>
            
            <h3>Getting Started:</h3>
            <ol>
                <li>Click the invitation link above</li>
                <li>Create your account with a secure password</li>
                <li>Complete your profile</li>
                <li>Explore our community resources</li>
            </ol>
            
            <a href="${inviteLink}" class="button">Accept Invitation</a>
            
            <div class="footer">
                <p>If you have any questions, please contact the person who invited you.</p>
                <p>If you received this invitation by mistake, you can safely ignore it.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Create a simple formatted message for user credentials display
   */
  static createUserCredentialsMessage(username: string, email: string, password: string, resetLink?: string): string {
    return `Your new account has been created successfully!

Account Details:
• Username: ${username}
• Email: ${email}
• Temporary Password: ${password}

Next Steps:
1. Use these credentials to log in to the community portal
2. You will be prompted to change your password on first login
3. Complete your profile setup
4. Join relevant community rooms

${resetLink ? `Password Reset Link: ${resetLink}` : ''}

Welcome to the community! If you have any questions, please reach out to the admin team.`;
  }
} 