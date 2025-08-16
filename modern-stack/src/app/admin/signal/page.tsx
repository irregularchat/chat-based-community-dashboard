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
import { ArrowLeft, Phone, MessageCircle, Settings, Activity, QrCode, CheckCircle, AlertTriangle, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
  });

  // Queries
  const { data: healthStatus, refetch: refetchHealth } = trpc.signal.getHealth.useQuery();
  const { data: config, refetch: refetchConfig } = trpc.signal.getConfig.useQuery();
  const { data: accountInfo, refetch: refetchAccount } = trpc.signal.getAccountInfo.useQuery();

  // Mutations
  const registerMutation = trpc.signal.registerPhoneNumber.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setRegistrationForm({ phoneNumber: '', useVoice: false, captcha: '' });
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
      toast.error(`Verification failed: ${error.message}`);
    },
  });

  const sendMessageMutation = trpc.signal.sendMessage.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setMessagingForm({ recipients: '', message: '' });
    },
    onError: (error) => {
      toast.error(`Message failed: ${error.message}`);
    },
  });

  const generateQRMutation = trpc.signal.generateQRCode.useMutation({
    onSuccess: (data) => {
      if (data.qrCode) {
        // Display QR code (could open in modal or new tab)
        window.open(data.qrCode, '_blank');
      }
    },
    onError: (error) => {
      toast.error(`QR code generation failed: ${error.message}`);
    },
  });

  // Auto-refresh health status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetchHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetchHealth]);

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
      toast.error('Recipients and message are required');
      return;
    }
    
    const recipients = messagingForm.recipients
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);
    
    if (recipients.length === 0) {
      toast.error('At least one recipient is required');
      return;
    }

    sendMessageMutation.mutate({
      recipients,
      message: messagingForm.message,
    });
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
          <TabsList className="grid w-full grid-cols-4">
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  Register Phone Number
                </CardTitle>
                <CardDescription>
                  Register a new phone number with Signal CLI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone">Phone Number</Label>
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="+1234567890"
                      value={registrationForm.phoneNumber}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, phoneNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-captcha">Captcha (Optional)</Label>
                    <Input
                      id="reg-captcha"
                      placeholder="Captcha response"
                      value={registrationForm.captcha}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, captcha: e.target.value })}
                    />
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
                <Button 
                  onClick={handleRegister}
                  disabled={registerMutation.isPending}
                  className="w-full md:w-auto"
                >
                  {registerMutation.isPending ? 'Registering...' : 'Send Registration Code'}
                </Button>
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
                      value={verificationForm.phoneNumber}
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
                    <Label htmlFor="verify-pin">PIN (Optional)</Label>
                    <Input
                      id="verify-pin"
                      type="password"
                      placeholder="Signal PIN"
                      value={verificationForm.pin}
                      onChange={(e) => setVerificationForm({ ...verificationForm, pin: e.target.value })}
                    />
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="w-5 h-5" />
                  Send Message
                </CardTitle>
                <CardDescription>
                  Send a message to one or more recipients via Signal
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="recipients">Recipients</Label>
                  <Input
                    id="recipients"
                    placeholder="+1234567890, +0987654321"
                    value={messagingForm.recipients}
                    onChange={(e) => setMessagingForm({ ...messagingForm, recipients: e.target.value })}
                  />
                  <div className="text-xs text-muted-foreground">
                    Enter phone numbers separated by commas
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
                <Button 
                  onClick={handleSendMessage}
                  disabled={sendMessageMutation.isPending || !config?.hasPhoneNumber}
                  className="w-full md:w-auto"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {sendMessageMutation.isPending ? 'Sending...' : 'Send Message'}
                </Button>
                {!config?.hasPhoneNumber && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    A phone number must be registered before sending messages
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5" />
                  Device Linking
                </CardTitle>
                <CardDescription>
                  Generate QR code for linking Signal CLI as a secondary device
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Generate a QR code to link Signal CLI as a secondary device to an existing Signal account.
                  This is an alternative to phone number registration.
                </div>
                <Button 
                  onClick={() => generateQRMutation.mutate()}
                  disabled={generateQRMutation.isPending}
                  variant="outline"
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  {generateQRMutation.isPending ? 'Generating...' : 'Generate QR Code'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}