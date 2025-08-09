'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Settings, MessageCircle, Users, Mail, Bot, Database, CheckCircle, AlertTriangle, Plus, Edit } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function AdminConfigurationPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('matrix');

  // Dialog states
  const [showMatrixDialog, setShowMatrixDialog] = useState(false);
  const [showAuthentikDialog, setShowAuthentikDialog] = useState(false);
  const [showDiscourseDialog, setShowDiscourseDialog] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [showSMTPDialog, setShowSMTPDialog] = useState(false);

  // Form states
  const [matrixForm, setMatrixForm] = useState({
    homeserver: '',
    accessToken: '',
    userId: '',
    welcomeRoomId: '',
    enableEncryption: false,
  });

  const [authentikForm, setAuthentikForm] = useState({
    baseUrl: '',
    apiToken: '',
    clientId: '',
    clientSecret: '',
    issuer: '',
  });

  const [discourseForm, setDiscourseForm] = useState({
    baseUrl: '',
    apiKey: '',
    apiUsername: '',
    webhookSecret: '',
  });

  const [aiForm, setAIForm] = useState({
    provider: 'openai',
    openaiApiKey: '',
    claudeApiKey: '',
    localEndpoint: '',
    model: 'gpt-3.5-turbo',
  });

  const [smtpForm, setSMTPForm] = useState({
    host: '',
    port: '587',
    user: '',
    password: '',
    from: '',
    bcc: '',
    enableTLS: true,
  });

  // Fetch data
  const { data: allSettings, isLoading, refetch } = trpc.settings.getAllSettings.useQuery();

  // Mutations
  const updateSettingMutation = trpc.settings.updateDashboardSetting.useMutation({
    onSuccess: () => {
      toast.success('Configuration saved successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to save configuration: ${error.message}`);
    },
  });

  // Form handlers
  const resetMatrixForm = () => {
    setMatrixForm({
      homeserver: '',
      accessToken: '',
      userId: '',
      welcomeRoomId: '',
      enableEncryption: false,
    });
  };

  const handleSaveMatrixConfig = () => {
    const matrixConfig = {
      homeserver: matrixForm.homeserver,
      accessToken: matrixForm.accessToken,
      userId: matrixForm.userId,
      welcomeRoomId: matrixForm.welcomeRoomId,
      enableEncryption: matrixForm.enableEncryption,
    };

    updateSettingMutation.mutate({
      key: 'matrix_config',
      value: matrixConfig,
    });

    setShowMatrixDialog(false);
  };

  const handleSaveAuthentikConfig = () => {
    const authentikConfig = {
      baseUrl: authentikForm.baseUrl,
      apiToken: authentikForm.apiToken,
      clientId: authentikForm.clientId,
      clientSecret: authentikForm.clientSecret,
      issuer: authentikForm.issuer,
    };

    updateSettingMutation.mutate({
      key: 'authentik_config',
      value: authentikConfig,
    });

    setShowAuthentikDialog(false);
  };

  const handleSaveDiscourseConfig = () => {
    const discourseConfig = {
      baseUrl: discourseForm.baseUrl,
      apiKey: discourseForm.apiKey,
      apiUsername: discourseForm.apiUsername,
      webhookSecret: discourseForm.webhookSecret,
    };

    updateSettingMutation.mutate({
      key: 'discourse_config',
      value: discourseConfig,
    });

    setShowDiscourseDialog(false);
  };

  const handleSaveAIConfig = () => {
    const aiConfig = {
      provider: aiForm.provider,
      openaiApiKey: aiForm.openaiApiKey,
      claudeApiKey: aiForm.claudeApiKey,
      localEndpoint: aiForm.localEndpoint,
      model: aiForm.model,
    };

    updateSettingMutation.mutate({
      key: 'ai_config',
      value: aiConfig,
    });

    setShowAIDialog(false);
  };

  const handleSaveSMTPConfig = () => {
    const smtpConfig = {
      host: smtpForm.host,
      port: smtpForm.port,
      user: smtpForm.user,
      password: smtpForm.password,
      from: smtpForm.from,
      bcc: smtpForm.bcc,
      enableTLS: smtpForm.enableTLS,
    };

    updateSettingMutation.mutate({
      key: 'smtp_config',
      value: smtpConfig,
    });

    setShowSMTPDialog(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access configuration</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session.user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You need admin privileges to access this page</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Helper function to check if a service is configured
  const isServiceConfigured = (configKey: string, requiredFields: string[]) => {
    const config = allSettings?.settings?.[configKey];
    if (!config) return false;
    return requiredFields.every(field => config[field] && config[field] !== '');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">System Configuration</h1>
              <p className="text-sm text-gray-600">
                Configure integrations and services for the community dashboard
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={() => router.push('/admin')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Admin
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex w-full overflow-x-auto lg:grid lg:grid-cols-5 lg:overflow-x-visible">
            <TabsTrigger value="matrix" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Matrix</span>
            </TabsTrigger>
            <TabsTrigger value="authentik" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Users className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Authentik</span>
            </TabsTrigger>
            <TabsTrigger value="discourse" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Database className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Discourse</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Bot className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">AI APIs</span>
            </TabsTrigger>
            <TabsTrigger value="smtp" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Mail className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">SMTP</span>
            </TabsTrigger>
          </TabsList>

          {/* Matrix Configuration Tab */}
          <TabsContent value="matrix" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MessageCircle className="w-5 h-5" />
                      Matrix Integration
                    </CardTitle>
                    <CardDescription>
                      Configure Matrix homeserver connection for messaging and room management
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {isServiceConfigured('matrix_config', ['homeserver', 'accessToken', 'userId']) ? (
                      <Badge variant="default" className="bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Not Configured
                      </Badge>
                    )}
                    <Dialog open={showMatrixDialog} onOpenChange={setShowMatrixDialog}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          if (isServiceConfigured('matrix_config', ['homeserver', 'accessToken', 'userId'])) {
                            const config = allSettings?.settings?.matrix_config;
                            if (config) {
                              setMatrixForm({
                                homeserver: config.homeserver || '',
                                accessToken: config.accessToken || '',
                                userId: config.userId || '',
                                welcomeRoomId: config.welcomeRoomId || '',
                                enableEncryption: config.enableEncryption || false,
                              });
                            }
                          }
                        }}>
                          {isServiceConfigured('matrix_config', ['homeserver', 'accessToken', 'userId']) ? (
                            <>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Configuration
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure Matrix
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Matrix Configuration</DialogTitle>
                          <DialogDescription>
                            Set up your Matrix homeserver connection details
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="matrix-homeserver">Homeserver URL</Label>
                            <Input
                              id="matrix-homeserver"
                              value={matrixForm.homeserver}
                              onChange={(e) => setMatrixForm({ ...matrixForm, homeserver: e.target.value })}
                              placeholder="https://matrix.example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">The Matrix homeserver URL (e.g., https://matrix.org)</p>
                          </div>
                          <div>
                            <Label htmlFor="matrix-access-token">Access Token</Label>
                            <Input
                              id="matrix-access-token"
                              type="password"
                              value={matrixForm.accessToken}
                              onChange={(e) => setMatrixForm({ ...matrixForm, accessToken: e.target.value })}
                              placeholder="syt_..."
                            />
                            <p className="text-xs text-gray-500 mt-1">Bot user access token for Matrix API</p>
                          </div>
                          <div>
                            <Label htmlFor="matrix-user-id">Bot User ID</Label>
                            <Input
                              id="matrix-user-id"
                              value={matrixForm.userId}
                              onChange={(e) => setMatrixForm({ ...matrixForm, userId: e.target.value })}
                              placeholder="@botuser:example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Matrix user ID of the bot account</p>
                          </div>
                          <div>
                            <Label htmlFor="matrix-welcome-room">Welcome Room ID (Optional)</Label>
                            <Input
                              id="matrix-welcome-room"
                              value={matrixForm.welcomeRoomId}
                              onChange={(e) => setMatrixForm({ ...matrixForm, welcomeRoomId: e.target.value })}
                              placeholder="!roomid:example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Default room for welcoming new users</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="matrix-encryption"
                              checked={matrixForm.enableEncryption}
                              onCheckedChange={(checked) => setMatrixForm({ ...matrixForm, enableEncryption: checked })}
                            />
                            <Label htmlFor="matrix-encryption">Enable End-to-End Encryption</Label>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowMatrixDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleSaveMatrixConfig} disabled={updateSettingMutation.isPending}>
                              {updateSettingMutation.isPending ? 'Saving...' : 'Save Configuration'}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isServiceConfigured('matrix_config', ['homeserver', 'accessToken', 'userId']) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Homeserver</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.matrix_config?.homeserver}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Bot User ID</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.matrix_config?.userId}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Welcome Room</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.matrix_config?.welcomeRoomId || 'Not configured'}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Encryption</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.matrix_config?.enableEncryption ? 'Enabled' : 'Disabled'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Matrix integration is not configured. Click "Configure Matrix" to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Add placeholders for other tabs */}
          <TabsContent value="authentik" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Authentik Identity Provider
                    </CardTitle>
                    <CardDescription>
                      Configure Authentik for user authentication and identity management
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Coming Soon
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  Authentik configuration interface will be available in the next update.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="discourse" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5" />
                      Discourse Forum
                    </CardTitle>
                    <CardDescription>
                      Configure Discourse forum integration for community discussions
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Coming Soon
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  Discourse configuration interface will be available in the next update.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="w-5 h-5" />
                      AI API Configuration
                    </CardTitle>
                    <CardDescription>
                      Configure AI providers (OpenAI, Claude, Local) for automated responses
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Coming Soon
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  AI API configuration interface will be available in the next update.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="smtp" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Mail className="w-5 h-5" />
                      SMTP Email Configuration
                    </CardTitle>
                    <CardDescription>
                      Configure SMTP settings for sending emails and notifications
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Coming Soon
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  SMTP configuration interface will be available in the next update.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}