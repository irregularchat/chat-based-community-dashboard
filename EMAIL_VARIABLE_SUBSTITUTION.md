# Email Variable Substitution Feature

## Overview

The admin email system now supports **variable substitution** to personalize emails sent to users. This allows admins to create dynamic, personalized email content that automatically fills in user-specific information.

## Available Variables

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `$Username` | User's username | `john-doe` |
| `$DisplayName` | User's full name | `John Doe` |
| `$FirstName` | User's first name | `John` |
| `$LastName` | User's last name | `Doe` |
| `$Email` | User's email address | `john@example.com` |
| `$MatrixUsername` | User's Matrix username | `@john:matrix.org` |

## Usage Examples

### Email Subject with Variables
```
Subject: Welcome $DisplayName to IrregularChat!
Result: Welcome John Doe to IrregularChat!
```

### Email Message with Variables
```
Message: Hi $FirstName,

Your account $Username has been created successfully.
You can contact us at support@irregularchat.com.

Best regards,
Admin Team

Result: Hi John,

Your account john-doe has been created successfully.
You can contact us at support@irregularchat.com.

Best regards,
Admin Team
```

### Complex Personalization
```
Subject: Account Update for $DisplayName
Message: Dear $FirstName $LastName,

We're writing to inform you about updates to your account:
- Username: $Username
- Email: $Email
- Matrix ID: $MatrixUsername

If you have any questions, please reply to this email.

Best,
IrregularChat Administration
```

## Features

1. **Works in Both Subject and Message**: Variables can be used in email subjects and message content
2. **Automatic Fallback**: If a variable value is not available, the variable remains unchanged
3. **Safe Processing**: Only replaces variables when actual user data is available
4. **Case Sensitive**: Variables are case-sensitive (must use exact format like `$Username`)
5. **Multiple Variables**: You can use multiple variables in the same message

## Where It Works

### Bulk Email Sending
- **Admin Dashboard** → User Management → Select Users → Send Email
- Uses variable substitution for each individual user

### Individual User Emails
- **Admin Dashboard** → User Details → Send Email Tab
- Shows preview of what variables will be replaced with

### Forms Interface
- **Forms** → User Actions → Send Email
- Includes help text with available variables

## UI Enhancements

All email forms now include:
- **Variable Substitution Help**: Expandable section explaining available variables
- **Live Preview**: Individual user emails show what variables will resolve to
- **Enhanced Placeholders**: Input fields include hints about variable usage
- **Example Usage**: Documentation with real examples

## Email Template Improvements

The email template has been enhanced with:
- **Better Formatting**: Improved spacing and layout
- **Professional Styling**: Clean white message area with proper typography
- **Consistent Branding**: IrregularChat color scheme throughout
- **Responsive Design**: Works well across different email clients

## Implementation Details

### Function Signatures Updated
```python
def admin_user_email(to, subject, admin_message, is_local_account=False, attachments=None, user_data=None):
    # Now supports user_data parameter for variable substitution

def send_admin_email_to_users(selected_users, subject, message, attachments=None):
    # Automatically passes user data for each recipient
```

### Variable Processing
- Variables are processed for both subject and message content
- Only replaces variables when user data is available
- Handles missing data gracefully
- Supports both dictionary key formats (`'Username'` and `'username'`)

## Testing the Feature

1. **Go to Admin Dashboard**
2. **Select a user or multiple users**
3. **Click on email action**
4. **Use variables in your message**: `Hello $FirstName, your username is $Username`
5. **Send the email**
6. **Check received email** - variables should be replaced with actual user data

## Benefits

- **Personalized Communication**: Each user receives a customized message
- **Time Saving**: No need to manually customize each email
- **Professional Appearance**: Consistent, branded email template
- **Reduced Errors**: Automatic data insertion eliminates manual typing mistakes
- **Scalable**: Works for both individual and bulk email sending

## Troubleshooting

**Variables not being replaced?**
- Check that you're using the correct variable format: `$Username` (case-sensitive)
- Ensure user data is available in the system
- Verify the user has the required fields populated

**Email formatting issues?**
- The new template uses white-space: pre-wrap for proper line break handling
- The professional template maintains consistent formatting across email clients

This feature significantly enhances the admin email capabilities, making communication more personal and efficient while maintaining the professional appearance of all outgoing emails. 