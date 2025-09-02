'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Phone, MessageCircle, Settings, Activity, QrCode, CheckCircle, AlertTriangle, Send, Download, User, Upload, RefreshCw, MessageSquare, AtSign, HelpCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import QRCode from 'qrcode';

export default function AdminSignalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('status');

  // Registration form state
  const [registrationForm, setRegistrationForm] = useState({
    phoneNumber: '',
    useVoice: false,
    captcha: '',
  });

  // Verification form state
  const [verificationForm, setVerificationForm] = useState({
    phoneNumber: '',
    verificationCode: '',
    pin: '',
  });

  // Messaging form state
  const [messagingForm, setMessagingForm] = useState({
    recipients: '',
    message: '',
    isUsername: false,
  });

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    avatarBase64: '',
  });

  // Conversation state
  const [selectedConversation, setSelectedConversation] = useState('');
  const [conversationLimit, setConversationLimit] = useState(50);

  // QR code state
  const [qrCodes, setQrCodes] = useState({
    adminInterface: '',
    captchaGenerator: '',
  });

  // Device linking QR code state
  const [deviceLinkingQR, setDeviceLinkingQR] = useState<string | null>(null);

  // Queries
  const { data: healthStatus, refetch: refetchHealth } = trpc.signal.getHealth.useQuery();
  const { data: config, refetch: refetchConfig } = trpc.signal.getConfig.useQuery();
  const { data: accountInfo, refetch: refetchAccount } = trpc.signal.getAccountInfo.useQuery();
  const { data: groups, refetch: refetchGroups } = trpc.signal.getGroups.useQuery({});
  // TODO: Implement getConversation API if needed
  // const { data: conversation, refetch: refetchConversation } = trpc.signal.getConversation.useQuery(
  //   { recipient: selectedConversation, limit: conversationLimit },
  //   { enabled: !!selectedConversation }
  // );

  // Mutations
  const registerMutation = trpc.signal.registerPhoneNumber.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      // Keep the phone number for verification
      const phoneUsed = registrationForm.phoneNumber;
      setRegistrationForm({ phoneNumber: '', useVoice: false, captcha: '' });
      // Pre-fill the verification form with the same phone number
      setVerificationForm(prev => ({ ...prev, phoneNumber: phoneUsed }));
      // Switch to verification tab
      setActiveTab('registration');
      refetchHealth();
      refetchConfig();
    },
    onError: (error) => {
      toast.error(`Registration failed: ${error.message}`);
    },
  });

  const verifyMutation = trpc.signal.verifyRegistration.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setVerificationForm({ phoneNumber: '', verificationCode: '', pin: '' });
      refetchHealth();
      refetchConfig();
      refetchAccount();
    },
    onError: (error) => {
      // Handle specific PIN lock errors with helpful guidance
      if (error.message.includes('PIN locked') || error.message.includes('pin data has been deleted')) {
        toast.error('Account is PIN locked. Please start over with a new registration and fresh captcha token.', {
          duration: 8000,
        });
        // Reset forms to encourage fresh start
        setRegistrationForm({ 
          phoneNumber: config?.phoneNumber || '+19108471202', 
          useVoice: false, 
          captcha: '' 
        });
        setVerificationForm({ phoneNumber: '', verificationCode: '', pin: '' });
        // Switch to registration tab
        setActiveTab('registration');
      } else {
        toast.error(`Verification failed: ${error.message}`);
      }
    },
  });

  const sendMessageMutation = trpc.signal.sendMessage.useMutation({
    onSuccess: (data) => {
      toast.success('Message sent successfully');
      setMessagingForm({ recipients: '', message: '', isUsername: false });
    },
    onError: (error) => {
      toast.error(`Message failed: ${error.message}`);
    },
  });

  // TODO: Implement updateProfile API
  // const updateProfileMutation = trpc.signal.updateProfile.useMutation({
  //   onSuccess: (data) => {
  //     toast.success(data.message || 'Profile updated successfully');
  //     setProfileForm({ displayName: '', avatarBase64: '' });
  //     refetchAccount();
  //   },
  //   onError: (error) => {
  //     toast.error(`Profile update failed: ${error.message}`);
  //   },
  // });

  const generateQRMutation = trpc.signal.generateQRCode.useMutation({
    onSuccess: (data) => {
      if (data.qrCode) {
        // Display QR code inline
        setDeviceLinkingQR(data.qrCode);
        toast.success('QR code generated! Scan with Signal app to link device.');
      } else {
        toast.error('No QR code returned from Signal CLI');
      }
    },
    onError: (error) => {
      toast.error(`QR code generation failed: ${error.message}`);
      setDeviceLinkingQR(null);
    },
  });

  const syncMessagesMutation = trpc.signal.syncMessages.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || `Synced ${data.syncedCount} messages`);
      refetchConversation();
    },
    onError: (error) => {
      toast.error(`Message sync failed: ${error.message}`);
    },
  });

  // Auto-refresh health status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetchHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetchHealth]);

  // Generate QR codes on component mount
  useEffect(() => {
    const generateQRCodes = async () => {
      try {
        const adminUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost:3002/admin/signal';
        const captchaUrl = 'https://signalcaptchas.org/registration/generate.html';

        const adminQR = await QRCode.toDataURL(adminUrl, {
          width: 120,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });

        const captchaQR = await QRCode.toDataURL(captchaUrl, {
          width: 120,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });

        setQrCodes({
          adminInterface: adminQR,
          captchaGenerator: captchaQR,
        });
      } catch (error) {
        console.error('Failed to generate QR codes:', error);
      }
    };

    generateQRCodes();
  }, []);

  const handleRegister = () => {
    if (!registrationForm.phoneNumber) {
      toast.error('Phone number is required');
      return;
    }
    registerMutation.mutate(registrationForm);
  };

  const handleVerify = () => {
    if (!verificationForm.phoneNumber || !verificationForm.verificationCode) {
      toast.error('Phone number and verification code are required');
      return;
    }
    verifyMutation.mutate(verificationForm);
  };

  const handleSendMessage = () => {
    if (!messagingForm.recipients || !messagingForm.message) {
      toast.error('Recipient and message are required');
      return;
    }

    sendMessageMutation.mutate({
      recipient: messagingForm.recipients.trim(),
      message: messagingForm.message,
      isUsername: messagingForm.isUsername,
    });
  };

  const handleProfileUpdate = () => {
    if (!profileForm.displayName && !profileForm.avatarBase64) {
      toast.error('Please provide a display name or avatar to update');
      return;
    }
    updateProfileMutation.mutate(profileForm);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image must be less than 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result?.toString().split(',')[1];
        if (base64) {
          setProfileForm({ ...profileForm, avatarBase64: base64 });
          toast.success('Avatar loaded');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800';
      case 'disabled': return 'bg-gray-100 text-gray-800';
      case 'unhealthy': return 'bg-red-100 text-red-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getRegistrationStatusColor = (status: string) => {
    switch (status) {
      case 'registered': return 'bg-green-100 text-green-800';
      case 'unregistered': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/admin')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Admin
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  <Phone className="w-6 h-6" />
                  Signal CLI Management
                </h1>
                <p className="text-muted-foreground">
                  Manage Signal CLI integration and messaging services
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchHealth();
                refetchConfig();
                refetchAccount();
              }}
            >
              <Activity className="w-4 h-4 mr-2" />
              Refresh Status
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="status" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Status
            </TabsTrigger>
            <TabsTrigger value="registration" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Registration
            </TabsTrigger>
            <TabsTrigger value="messaging" className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Messaging
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-2">
              <QrCode className="w-4 h-4" />
              Tools
            </TabsTrigger>
          </TabsList>

          {/* Status Tab */}
          <TabsContent value="status" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Service Health Status
                </CardTitle>
                <CardDescription>
                  Current status of Signal CLI REST API service
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Service Status</Label>
                    <Badge className={getStatusColor(healthStatus?.status || 'unknown')}>
                      {healthStatus?.status?.toUpperCase() || 'UNKNOWN'}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Container Status</Label>
                    <Badge variant="outline">
                      {healthStatus?.containerStatus?.toUpperCase() || 'UNKNOWN'}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Registration Status</Label>
                    <Badge className={getRegistrationStatusColor(healthStatus?.registrationStatus || 'unknown')}>
                      {healthStatus?.registrationStatus?.toUpperCase() || 'UNKNOWN'}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">API Response Time</Label>
                    <div className="text-sm text-muted-foreground">
                      {healthStatus?.apiResponseTime ? `${healthStatus.apiResponseTime}ms` : 'N/A'}
                    </div>
                  </div>
                </div>
                
                {healthStatus?.messagesSentToday !== undefined && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Messages Sent Today</Label>
                      <div className="text-sm text-muted-foreground">
                        {healthStatus.messagesSentToday} messages
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  Configuration Status
                </CardTitle>
                <CardDescription>
                  Current Signal CLI configuration settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Service Enabled</Label>
                    <Badge variant={config?.enabled ? 'default' : 'secondary'}>
                      {config?.enabled ? 'ENABLED' : 'DISABLED'}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">API URL</Label>
                    <div className="text-sm text-muted-foreground font-mono">
                      {config?.apiUrl || 'Not configured'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Phone Number</Label>
                    <div className="text-sm text-muted-foreground">
                      {config?.hasPhoneNumber ? (config.phoneNumber || 'Registered') : 'Not registered'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Device Name</Label>
                    <div className="text-sm text-muted-foreground">
                      {config?.deviceName || 'Not configured'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {accountInfo && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="w-5 h-5" />
                    Account Information
                  </CardTitle>
                  <CardDescription>
                    Details about the registered Signal account
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Phone Number</Label>
                      <div className="text-sm text-muted-foreground">
                        {accountInfo.phoneNumber}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">UUID</Label>
                      <div className="text-sm text-muted-foreground font-mono">
                        {accountInfo.uuid || 'Not available'}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Device ID</Label>
                      <div className="text-sm text-muted-foreground">
                        {accountInfo.deviceId || 'Not available'}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Registration Time</Label>
                      <div className="text-sm text-muted-foreground">
                        {accountInfo.registrationTime ? 
                          new Date(accountInfo.registrationTime).toLocaleString() : 
                          'Not available'
                        }
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Registration Tab */}
          <TabsContent value="registration" className="space-y-6">
            {/* Quick Setup Card */}
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-800">
                  <QrCode className="w-5 h-5" />
                  Quick Setup Guide
                </CardTitle>
                <CardDescription className="text-blue-700">
                  Follow these steps to register your Signal CLI bot
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-blue-800">Step 1: Get Captcha Token</h4>
                    <p className="text-sm text-blue-700">
                      Signal requires a captcha for new registrations. Click below to get your captcha token:
                    </p>
                    <Button 
                      variant="outline" 
                      className="w-full border-blue-300 text-blue-800 hover:bg-blue-100"
                      onClick={() => window.open('https://signalcaptchas.org/registration/generate.html', '_blank')}
                    >
                      🔗 Open Signal Captcha Generator
                    </Button>
                    <div className="text-xs text-blue-600 p-3 bg-blue-100 rounded-md">
                      <strong>Instructions:</strong>
                      <ol className="list-decimal list-inside mt-1 space-y-1">
                        <li>Solve the captcha puzzle</li>
                        <li>Right-click "Open Signal" button</li>
                        <li>Copy the link address</li>
                        <li>Paste it in the captcha field below</li>
                      </ol>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h4 className="font-semibold text-blue-800">Step 2: Current Configuration</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-700">Phone Number:</span>
                        <span className="font-mono bg-blue-100 px-2 py-1 rounded">
                          {config?.phoneNumber || '+19108471202'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-700">Device Name:</span>
                        <span className="font-mono bg-blue-100 px-2 py-1 rounded">
                          {config?.deviceName}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-700">Status:</span>
                        <Badge className={healthStatus?.registrationStatus === 'registered' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {healthStatus?.registrationStatus?.toUpperCase() || 'UNKNOWN'}
                        </Badge>
                      </div>
                    </div>
                    
                    {healthStatus?.registrationStatus === 'registered' && (
                      <div className="p-3 bg-green-100 rounded-md border border-green-200">
                        <div className="flex items-center gap-2 text-green-800">
                          <CheckCircle className="w-4 h-4" />
                          <span className="font-semibold">Registration Complete!</span>
                        </div>
                        <p className="text-sm text-green-700 mt-1">
                          Your Signal CLI bot is ready to send messages.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Registration Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  Register Phone Number
                </CardTitle>
                <CardDescription>
                  Register your phone number with Signal CLI service
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone">Phone Number</Label>
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="+1234567890"
                      value={registrationForm.phoneNumber || config?.phoneNumber || '+19108471202'}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, phoneNumber: e.target.value })}
                    />
                    <div className="text-xs text-muted-foreground">
                      Use international format (e.g., +1234567890)
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="reg-captcha">Captcha Token</Label>
                    <Textarea
                      id="reg-captcha"
                      placeholder="Paste the captcha link here (starts with signalcaptcha://...)"
                      value={registrationForm.captcha}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, captcha: e.target.value })}
                      rows={3}
                      className="font-mono text-sm"
                    />
                    <div className="text-xs text-muted-foreground">
                      Get this from: <a href="https://signalcaptchas.org/registration/generate.html" target="_blank" className="text-blue-600 hover:underline">signalcaptchas.org</a>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="use-voice"
                    checked={registrationForm.useVoice}
                    onCheckedChange={(checked) => setRegistrationForm({ ...registrationForm, useVoice: checked })}
                  />
                  <Label htmlFor="use-voice">Use voice call instead of SMS</Label>
                </div>
                
                <div className="flex gap-2">
                  <Button 
                    onClick={handleRegister}
                    disabled={registerMutation.isPending || !registrationForm.captcha}
                    className="flex-1"
                  >
                    {registerMutation.isPending ? 'Registering...' : 'Send Registration Code'}
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setRegistrationForm({ 
                      phoneNumber: config?.phoneNumber || '+19108471202', 
                      useVoice: false, 
                      captcha: '' 
                    })}
                  >
                    Reset Form
                  </Button>
                </div>
                
                {!registrationForm.captcha && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <div className="flex items-center gap-2 text-yellow-800">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-semibold">Captcha Required</span>
                    </div>
                    <p className="text-sm text-yellow-700 mt-1">
                      You need to get a captcha token before registering. Click the link above to generate one.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Verify Registration
                </CardTitle>
                <CardDescription>
                  Complete registration with the verification code received via SMS/voice
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="verify-phone">Phone Number</Label>
                    <Input
                      id="verify-phone"
                      type="tel"
                      placeholder="+1234567890"
                      value={verificationForm.phoneNumber || registrationForm.phoneNumber || config?.phoneNumber || ''}
                      onChange={(e) => setVerificationForm({ ...verificationForm, phoneNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="verify-code">Verification Code</Label>
                    <Input
                      id="verify-code"
                      placeholder="123456"
                      maxLength={6}
                      value={verificationForm.verificationCode}
                      onChange={(e) => setVerificationForm({ ...verificationForm, verificationCode: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="verify-pin">PIN (Optional)</Label>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" title="If you've set up a Signal PIN before, enter it here. Leave blank if you haven't set one or want to reset it." />
                    </div>
                    <Input
                      id="verify-pin"
                      type="password"
                      placeholder="Signal PIN (if you have one)"
                      value={verificationForm.pin}
                      onChange={(e) => setVerificationForm({ ...verificationForm, pin: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Only needed if you've previously set a PIN for this number
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleVerify}
                  disabled={verifyMutation.isPending}
                  className="w-full md:w-auto"
                >
                  {verifyMutation.isPending ? 'Verifying...' : 'Verify Registration'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Messaging Tab */}
          <TabsContent value="messaging" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Send Message Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="w-5 h-5" />
                    Send Message
                  </CardTitle>
                  <CardDescription>
                    Send a message via phone number or Signal username
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="use-username"
                      checked={messagingForm.isUsername}
                      onCheckedChange={(checked) => setMessagingForm({ ...messagingForm, isUsername: checked })}
                    />
                    <Label htmlFor="use-username" className="flex items-center gap-2">
                      <AtSign className="w-4 h-4" />
                      Use Signal Username
                    </Label>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="recipient">
                      {messagingForm.isUsername ? 'Signal Username' : 'Phone Number'}
                    </Label>
                    <Input
                      id="recipient"
                      placeholder={messagingForm.isUsername ? 'username.123' : '+1234567890'}
                      value={messagingForm.recipients}
                      onChange={(e) => setMessagingForm({ ...messagingForm, recipients: e.target.value })}
                    />
                    <div className="text-xs text-muted-foreground">
                      {messagingForm.isUsername 
                        ? 'Enter Signal username (format: username.123, e.g., sac.159)'
                        : 'Enter phone number in international format'
                      }
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Enter your message here..."
                      rows={4}
                      value={messagingForm.message}
                      onChange={(e) => setMessagingForm({ ...messagingForm, message: e.target.value })}
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleSendMessage}
                      disabled={sendMessageMutation.isPending || !config?.hasPhoneNumber}
                      className="flex-1"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {sendMessageMutation.isPending ? 'Sending...' : 'Send Message'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (messagingForm.recipients && !messagingForm.isUsername) {
                          console.log('Setting conversation to:', messagingForm.recipients);
                          setSelectedConversation(messagingForm.recipients);
                          // refetchConversation();
                        }
                      }}
                      disabled={!messagingForm.recipients || messagingForm.isUsername}
                      title="View conversation"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {!config?.hasPhoneNumber && (
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      A phone number must be registered before sending messages
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Conversation View Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    Conversation Thread
                  </CardTitle>
                  <CardDescription>
                    {selectedConversation 
                      ? `Messages with ${selectedConversation}` 
                      : 'Select a recipient to view conversation'
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedConversation ? (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Input
                            placeholder="Enter phone number to view conversation"
                            value={selectedConversation}
                            onChange={(e) => setSelectedConversation(e.target.value)}
                            className="flex-1 mr-2"
                          />
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => syncMessagesMutation.mutate()}
                              disabled={syncMessagesMutation.isPending}
                              title="Sync new messages from Signal"
                            >
                              <RefreshCw className={`w-4 h-4 ${syncMessagesMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => refetchConversation()}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {/* Groups Display */}
                        {groups?.groups && groups.groups.length > 0 && (
                          <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950">
                            <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">Signal Groups</h4>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {groups.groups.map((group: any) => (
                                <div key={group.id} className="text-sm text-blue-700 dark:text-blue-300">
                                  <strong>{group.name}</strong> ({group.members?.length || 0} members)
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="border rounded-lg p-4 h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                        {false && false ? ( // TODO: Enable when conversation API is implemented
                          <div className="space-y-3">
                            {[].map((msg: any) => (
                              <div
                                key={msg.id}
                                className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                                    msg.direction === 'outgoing'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  <p className="text-sm">{msg.message}</p>
                                  <p className="text-xs opacity-75 mt-1">
                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                    {msg.isDelivered && ' ✓'}
                                    {msg.isRead && '✓'}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full text-gray-500">
                            <div className="text-center">
                              <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                              <p>No messages found</p>
                              <p className="text-sm mt-1">Send a message to start the conversation</p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Label htmlFor="limit">Messages to load:</Label>
                        <Input
                          id="limit"
                          type="number"
                          min="10"
                          max="100"
                          value={conversationLimit}
                          onChange={(e) => setConversationLimit(parseInt(e.target.value))}
                          className="w-20"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                      <div className="text-center">
                        <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No conversation selected</p>
                        <p className="text-sm mt-1">Enter a phone number above or click the conversation icon after entering a recipient</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Bot Profile Management
                </CardTitle>
                <CardDescription>
                  Update the display name and avatar for your Signal bot
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Current Profile Info */}
                {accountInfo && (
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h4 className="font-semibold mb-3">Current Profile</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Phone Number</Label>
                        <div className="text-sm text-muted-foreground">
                          {accountInfo.phoneNumber || 'Not set'}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Display Name</Label>
                        <div className="text-sm text-muted-foreground">
                          {(accountInfo as any).displayName || 'Community Dashboard Bot'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Update Form */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Display Name</Label>
                    <Input
                      id="display-name"
                      placeholder="Community Dashboard Bot"
                      value={profileForm.displayName}
                      onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                    />
                    <div className="text-xs text-muted-foreground">
                      This name will appear in Signal conversations
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="avatar">Profile Avatar</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        id="avatar"
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="flex-1"
                      />
                      {profileForm.avatarBase64 && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          Avatar loaded
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Upload an image (max 5MB) to use as the bot's avatar
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleProfileUpdate}
                      disabled={updateProfileMutation.isPending || (!profileForm.displayName && !profileForm.avatarBase64)}
                      className="flex-1"
                    >
                      <User className="w-4 h-4 mr-2" />
                      {updateProfileMutation.isPending ? 'Updating...' : 'Update Profile'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setProfileForm({ displayName: '', avatarBase64: '' })}
                    >
                      Reset
                    </Button>
                  </div>
                </div>

                {/* Profile Tips */}
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Profile Tips
                  </h4>
                  <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                    <li>• A clear display name helps users identify your bot</li>
                    <li>• Use a recognizable avatar (e.g., your community logo)</li>
                    <li>• Profile updates are visible to all Signal contacts</li>
                    <li>• Changes may take a few moments to propagate</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="space-y-6">
            {/* Quick Access QR Codes */}
            <Card className="border-purple-200 bg-purple-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-800">
                  <QrCode className="w-5 h-5" />
                  Quick Access QR Codes
                </CardTitle>
                <CardDescription className="text-purple-700">
                  QR codes for easy access to important links
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-purple-800">Admin Interface</h4>
                    <div className="p-4 bg-white rounded-lg border border-purple-200">
                      <div className="text-center space-y-2">
                        <div className="inline-block p-2 bg-white border border-gray-300 rounded">
                          {qrCodes.adminInterface ? (
                            <img 
                              src={qrCodes.adminInterface} 
                              alt="Admin Interface QR Code" 
                              className="w-[120px] h-[120px]"
                            />
                          ) : (
                            <div className="w-[120px] h-[120px] bg-gray-100 flex items-center justify-center">
                              <QrCode className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-purple-700">Scan to access Signal CLI Admin</p>
                        <p className="text-xs text-purple-600 font-mono break-all">
                          {typeof window !== 'undefined' ? window.location.href : 'http://localhost:3002/admin/signal'}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h4 className="font-semibold text-purple-800">Signal Captcha Generator</h4>
                    <div className="p-4 bg-white rounded-lg border border-purple-200">
                      <div className="text-center space-y-2">
                        <div className="inline-block p-2 bg-white border border-gray-300 rounded">
                          {qrCodes.captchaGenerator ? (
                            <img 
                              src={qrCodes.captchaGenerator} 
                              alt="Captcha Generator QR Code" 
                              className="w-[120px] h-[120px]"
                            />
                          ) : (
                            <div className="w-[120px] h-[120px] bg-gray-100 flex items-center justify-center">
                              <QrCode className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-purple-700">Scan to get captcha token</p>
                        <p className="text-xs text-purple-600 font-mono break-all">
                          https://signalcaptchas.org/registration/generate.html
                        </p>
                      </div>
                    </div>
                    
                    <Button 
                      variant="outline" 
                      className="w-full border-purple-300 text-purple-800 hover:bg-purple-100"
                      onClick={() => window.open('https://signalcaptchas.org/registration/generate.html', '_blank')}
                    >
                      🔗 Open Captcha Generator
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Device Linking */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5" />
                  Device Linking (Alternative Method)
                </CardTitle>
                <CardDescription>
                  Generate QR code for linking Signal CLI as a secondary device
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center gap-2 text-blue-800 mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="font-semibold">Alternative Registration Method</span>
                  </div>
                  <p className="text-sm text-blue-700">
                    Instead of registering a new phone number, you can link Signal CLI as a secondary device to an existing Signal account. 
                    This is useful if you want to use an existing Signal account rather than registering a new phone number.
                  </p>
                </div>
                
                <div className="space-y-3">
                  <h4 className="font-semibold">How Device Linking Works:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Generate a QR code on this device</li>
                    <li>Open Signal app on your phone</li>
                    <li>Go to Settings → Linked Devices → Link New Device</li>
                    <li>Scan the QR code with your phone</li>
                    <li>Signal CLI will be linked to your existing account</li>
                  </ol>
                </div>
                
                <Button 
                  onClick={() => generateQRMutation.mutate()}
                  disabled={generateQRMutation.isPending}
                  variant="outline"
                  className="w-full md:w-auto"
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  {generateQRMutation.isPending ? 'Generating...' : 'Generate Device Linking QR Code'}
                </Button>
                
                {/* Display generated QR code */}
                {deviceLinkingQR && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex flex-col items-center space-y-3">
                      <h4 className="font-semibold text-green-800">Scan with Signal App</h4>
                      <img 
                        src={deviceLinkingQR} 
                        alt="Signal Device Linking QR Code" 
                        className="w-64 h-64 border-2 border-green-300 rounded"
                      />
                      <p className="text-sm text-green-700 text-center">
                        Open Signal on your phone → Settings → Linked Devices → Link New Device
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setDeviceLinkingQR(null)}
                      >
                        Close QR Code
                      </Button>
                    </div>
                  </div>
                )}
                
                {generateQRMutation.isError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-center gap-2 text-red-800">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-semibold">QR Generation Failed</span>
                    </div>
                    <p className="text-sm text-red-700 mt-1">
                      Device linking QR code generation is not available. Use phone number registration instead.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Configuration Export */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Configuration Export
                </CardTitle>
                <CardDescription>
                  Export current Signal CLI configuration for backup or replication
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Current Configuration</Label>
                  <Textarea
                    readOnly
                    value={JSON.stringify({
                      enabled: config?.enabled,
                      apiUrl: config?.apiUrl,
                      phoneNumber: config?.phoneNumber || '+19108471202',
                      deviceName: config?.deviceName,
                      registrationStatus: healthStatus?.registrationStatus,
                      containerStatus: healthStatus?.containerStatus,
                    }, null, 2)}
                    rows={8}
                    className="font-mono text-sm"
                  />
                </div>
                <Button 
                  variant="outline"
                  onClick={() => {
                    const config_export = {
                      signal_cli_enabled: true,
                      signal_cli_api_url: config?.apiUrl,
                      signal_cli_phone_number: config?.phoneNumber || '+19108471202',
                      signal_cli_device_name: config?.deviceName,
                      exported_at: new Date().toISOString(),
                    };
                    const blob = new Blob([JSON.stringify(config_export, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `signal-cli-config-${new Date().toISOString().split('T')[0]}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Configuration
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}