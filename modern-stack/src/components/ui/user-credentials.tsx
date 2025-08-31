'use client';

import { useState } from 'react';
import { Copy, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { MessageTemplates, WelcomeMessageData } from '@/lib/message-templates';

interface UserCredentials {
  username: string;
  password: string;
  resetLink?: string;
  ssoUserId?: string;
}

interface UserCredentialDisplayProps {
  credentials: UserCredentials;
  userEmail: string;
  onClose?: () => void;
}

export function UserCredentialDisplay({ credentials, userEmail, onClose }: UserCredentialDisplayProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedFields, setCopiedFields] = useState<Set<string>>(new Set());

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFields(prev => new Set(prev).add(fieldName));
      toast.success(`${fieldName} copied to clipboard`);
      
      // Remove the copied indicator after 2 seconds
      setTimeout(() => {
        setCopiedFields(prev => {
          const newSet = new Set(prev);
          newSet.delete(fieldName);
          return newSet;
        });
      }, 2000);
    } catch {
      toast.error(`Failed to copy ${fieldName}`);
    }
  };

  const formatMessageForUser = () => {
    // Use the proper legacy-style welcome message template
    const welcomeData: WelcomeMessageData = {
      username: credentials.username,
      fullName: credentials.username, // We don't have fullName in this context
      tempPassword: credentials.password,
      discoursePostUrl: undefined, // No discourse post URL in this context
      passwordResetSuccessful: !!credentials.password,
    };
    
    return MessageTemplates.createWelcomeMessage(welcomeData);
  };

  const copyFullMessage = () => {
    copyToClipboard(formatMessageForUser(), 'Full welcome message');
  };

  return (
    <div className="space-y-6 p-6 bg-white dark:bg-gray-900 rounded-lg border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Account Created Successfully
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            User credentials for {userEmail}
          </p>
        </div>
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle className="w-3 h-3 mr-1" />
          Created
        </Badge>
      </div>

      <div className="space-y-4">
        {/* Username Field */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Username
          </label>
          <div className="flex items-center space-x-2">
            <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border font-mono text-sm">
              {credentials.username}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(credentials.username, 'Username')}
              className="shrink-0"
            >
              {copiedFields.has('Username') ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Email Field */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Email
          </label>
          <div className="flex items-center space-x-2">
            <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border font-mono text-sm">
              {userEmail}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(userEmail, 'Email')}
              className="shrink-0"
            >
              {copiedFields.has('Email') ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Temporary Password
          </label>
          <div className="flex items-center space-x-2">
            <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border font-mono text-sm">
              {showPassword ? credentials.password : '•'.repeat(credentials.password.length)}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPassword(!showPassword)}
              className="shrink-0"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(credentials.password, 'Password')}
              className="shrink-0"
            >
              {copiedFields.has('Password') ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Password Reset Link */}
        {credentials.resetLink && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Password Reset Link
            </label>
            <div className="flex items-center space-x-2">
              <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border font-mono text-sm break-all">
                {credentials.resetLink}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(credentials.resetLink!, 'Reset Link')}
                className="shrink-0"
              >
                {copiedFields.has('Reset Link') ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* SSO User ID */}
        {credentials.ssoUserId && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              SSO User ID
            </label>
            <div className="flex items-center space-x-2">
              <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border font-mono text-sm">
                {credentials.ssoUserId}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(credentials.ssoUserId!, 'SSO User ID')}
                className="shrink-0"
              >
                {copiedFields.has('SSO User ID') ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Welcome Message Section */}
      <div className="border-t pt-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Welcome Message (Ready to send to user)
          </label>
          <div className="space-y-2">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans">
                {formatMessageForUser()}
              </pre>
            </div>
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={copyFullMessage}
                className="w-full"
              >
                {copiedFields.has('Full welcome message') ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                    Copied Welcome Message
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Welcome Message
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-2 pt-4 border-t">
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
        <Button 
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Create Another User
        </Button>
      </div>
    </div>
  );
}