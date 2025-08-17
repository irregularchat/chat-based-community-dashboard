'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  User, 
  Shield, 
  Phone, 
  Mail, 
  CheckCircle, 
  XCircle,
  Settings,
  Key
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { toast } from 'sonner';

export default function ProfilePage() {
  const { data: session, update: updateSession } = useSession();
  const [phoneVerificationForm, setPhoneVerificationForm] = useState({
    phoneNumber: '',
    verificationCode: '',
    showVerificationInput: false,
  });

  // Get user profile data
  const { data: userProfile, refetch: refetchProfile } = trpc.user.getProfile.useQuery();

  // Phone verification mutations
  const requestVerificationMutation = trpc.user.requestPhoneVerification.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || 'Verification code sent!');
      setPhoneVerificationForm(prev => ({ 
        ...prev, 
        showVerificationInput: true 
      }));
      refetchProfile();
    },
    onError: (error) => {
      toast.error(`Verification request failed: ${error.message}`);
    },
  });

  const verifyPhoneMutation = trpc.user.verifyPhone.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || 'Phone number verified successfully!');
      setPhoneVerificationForm({
        phoneNumber: '',
        verificationCode: '',
        showVerificationInput: false,
      });
      refetchProfile();
    },
    onError: (error) => {
      toast.error(`Verification failed: ${error.message}`);
    },
  });

  const handlePhoneVerificationRequest = () => {
    if (!phoneVerificationForm.phoneNumber) {
      toast.error('Please enter a phone number');
      return;
    }
    requestVerificationMutation.mutate({
      phoneNumber: phoneVerificationForm.phoneNumber,
    });
  };

  const handlePhoneVerification = () => {
    if (!phoneVerificationForm.verificationCode) {
      toast.error('Please enter the verification code');
      return;
    }
    verifyPhoneMutation.mutate({
      phoneNumber: phoneVerificationForm.phoneNumber,
      verificationHash: phoneVerificationForm.verificationCode,
    });
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getUserDisplayName = () => {
    if (session?.user?.name) return session.user.name;
    if (session?.user?.username) return session.user.username;
    return session?.user?.email || 'User';
  };

  if (!session) {
    return (
      <div className="container mx-auto py-8">
        <Alert>
          <AlertDescription>
            Please sign in to view your profile.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const userAttributes = userProfile?.attributes as Record<string, unknown> || {};
  const verifiedPhoneNumber = (userAttributes.phoneNumber as string) || userProfile?.signalIdentity;
  const pendingPhoneNumber = (userAttributes.pendingPhoneVerification as any)?.phoneNumber;
  const phoneNumber = verifiedPhoneNumber || pendingPhoneNumber;
  const hasSignalVerification = !!verifiedPhoneNumber;

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Page Header */}
      <div className="flex items-center space-x-4">
        <Avatar className="h-16 w-16">
          <AvatarImage 
            src={session.user.image || undefined} 
            alt={`Profile picture of ${getUserDisplayName()}`} 
          />
          <AvatarFallback className="text-lg">
            {getInitials(getUserDisplayName())}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-3xl font-bold">{getUserDisplayName()}</h1>
          <p className="text-muted-foreground">{session.user.email}</p>
          <div className="flex items-center space-x-2 mt-2">
            {session.user.isAdmin && (
              <Badge variant="destructive" className="text-xs">
                <Shield className="w-3 h-3 mr-1" />
                Admin
              </Badge>
            )}
            {session.user.isModerator && !session.user.isAdmin && (
              <Badge variant="default" className="text-xs">
                <Shield className="w-3 h-3 mr-1" />
                Moderator
              </Badge>
            )}
            {!session.user.isAdmin && !session.user.isModerator && (
              <Badge variant="outline" className="text-xs">
                <User className="w-3 h-3 mr-1" />
                Member
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general" className="flex items-center gap-2">
            <User className="w-4 h-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="verification" className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Signal Verification
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile Information
              </CardTitle>
              <CardDescription>
                Your basic profile information and account details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Full Name</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    {session.user.name || 'Not set'}
                  </div>
                </div>
                <div>
                  <Label>Username</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    {session.user.username || 'Not set'}
                  </div>
                </div>
                <div>
                  <Label>Email Address</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    {session.user.email || 'Not set'}
                  </div>
                </div>
                <div>
                  <Label>Member Since</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md">
                    {userProfile?.dateJoined 
                      ? new Date(userProfile.dateJoined).toLocaleDateString()
                      : 'Unknown'
                    }
                  </div>
                </div>
              </div>
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  Profile information is managed through your authentication provider (Authentik). 
                  Contact an administrator to update these details.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Signal Verification Tab */}
        <TabsContent value="verification" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Signal Verification
              </CardTitle>
              <CardDescription>
                Verify your phone number with Signal to receive notifications and updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Current Status */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center space-x-3">
                    {hasSignalVerification ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <div>
                      <p className="font-medium">
                        Signal Verification Status
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {hasSignalVerification 
                          ? `Verified with ${verifiedPhoneNumber}`
                          : pendingPhoneNumber 
                            ? `Verification pending for ${pendingPhoneNumber}`
                            : 'Not verified'
                        }
                      </p>
                    </div>
                  </div>
                  <Badge variant={hasSignalVerification ? 'default' : pendingPhoneNumber ? 'outline' : 'destructive'}>
                    {hasSignalVerification ? 'Verified' : pendingPhoneNumber ? 'Pending' : 'Unverified'}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Verification Form */}
              <div className="space-y-4">
                <h4 className="font-semibold">
                  {hasSignalVerification ? 'Update Phone Number' : 'Verify Phone Number'}
                </h4>
                
                {!phoneVerificationForm.showVerificationInput ? (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="phoneNumber">Phone Number</Label>
                      <div className="flex space-x-2 mt-1">
                        <Input
                          id="phoneNumber"
                          type="tel"
                          placeholder="+1234567890"
                          value={phoneVerificationForm.phoneNumber}
                          onChange={(e) => setPhoneVerificationForm(prev => ({
                            ...prev,
                            phoneNumber: e.target.value
                          }))}
                          className="flex-1"
                        />
                        <Button
                          onClick={handlePhoneVerificationRequest}
                          disabled={requestVerificationMutation.isPending || !phoneVerificationForm.phoneNumber}
                          className="px-6"
                        >
                          {requestVerificationMutation.isPending ? 'Sending...' : 'Send Code'}
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Include country code (e.g., +1 for US, +44 for UK)
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Alert>
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>
                        Verification code sent to {phoneVerificationForm.phoneNumber}
                      </AlertDescription>
                    </Alert>
                    
                    <div>
                      <Label htmlFor="verificationCode">Verification Code</Label>
                      <div className="flex space-x-2 mt-1">
                        <Input
                          id="verificationCode"
                          type="text"
                          placeholder="123456"
                          maxLength={6}
                          value={phoneVerificationForm.verificationCode}
                          onChange={(e) => setPhoneVerificationForm(prev => ({
                            ...prev,
                            verificationCode: e.target.value
                          }))}
                          className="flex-1"
                        />
                        <Button
                          onClick={handlePhoneVerification}
                          disabled={verifyPhoneMutation.isPending || !phoneVerificationForm.verificationCode}
                          className="px-6"
                        >
                          {verifyPhoneMutation.isPending ? 'Verifying...' : 'Verify'}
                        </Button>
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPhoneVerificationForm(prev => ({
                        ...prev,
                        showVerificationInput: false,
                        verificationCode: ''
                      }))}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                <Alert>
                  <Phone className="h-4 w-4" />
                  <AlertDescription>
                    You'll receive a verification code via Signal Messenger. Make sure you have Signal installed 
                    and are registered with the phone number you're verifying.
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Account Security
              </CardTitle>
              <CardDescription>
                Manage your account security settings and authentication.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">Authentication Method</p>
                    <p className="text-sm text-muted-foreground">Single Sign-On (SSO) via Authentik</p>
                  </div>
                  <Badge variant="outline">SSO</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">Account Type</p>
                    <p className="text-sm text-muted-foreground">
                      {session.user.isAdmin ? 'Administrator' : 
                       session.user.isModerator ? 'Moderator' : 'Member'}
                    </p>
                  </div>
                  <Badge variant={session.user.isAdmin ? 'destructive' : 
                                 session.user.isModerator ? 'default' : 'outline'}>
                    {session.user.isAdmin ? 'Admin' : 
                     session.user.isModerator ? 'Moderator' : 'Member'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">Account Status</p>
                    <p className="text-sm text-muted-foreground">
                      {userProfile?.isActive ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                  <Badge variant={userProfile?.isActive ? 'default' : 'destructive'}>
                    {userProfile?.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>

              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  Security settings are managed through Authentik. Contact an administrator 
                  for password changes, two-factor authentication, or other security configurations.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}