'use client';

import { useState, useEffect } from 'react';
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

  const initializeFromEnvMutation = trpc.settings.initializeFromEnv.useMutation({
    onSuccess: (data) => {
      toast.success(`Initialized ${data.initialized} settings from environment variables`);
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to initialize from environment: ${error.message}`);
    },
  });

  // Auto-populate forms from settings
  useEffect(() => {
    if (allSettings) {
      // Populate Authentik form
      setAuthentikForm({
        baseUrl: allSettings.authentik_base_url || '',
        apiToken: allSettings.authentik_api_token || '',
        clientId: allSettings.authentik_client_id || '',
        clientSecret: allSettings.authentik_client_secret || '',
        issuer: allSettings.authentik_issuer || '',
      });

      // Populate Matrix form if settings exist
      setMatrixForm(prev => ({
        ...prev,
        homeserver: allSettings.matrix_homeserver || '',
        accessToken: allSettings.matrix_access_token || '',
        userId: allSettings.matrix_user_id || '',
        welcomeRoomId: allSettings.matrix_welcome_room_id || '',
      }));

      // Populate SMTP form if settings exist
      setSMTPForm(prev => ({
        ...prev,
        host: allSettings.smtp_host || '',
        port: allSettings.smtp_port || '587',
        user: allSettings.smtp_user || '',
        from: allSettings.smtp_from || '',
        bcc: allSettings.smtp_bcc || '',
      }));
    }
  }, [allSettings]);

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
                variant="secondary"
                onClick={() => initializeFromEnvMutation.mutate()}
                disabled={initializeFromEnvMutation.isLoading}
              >
                <Database className="w-4 h-4 mr-2" />
                {initializeFromEnvMutation.isLoading ? 'Initializing...' : 'Load from Environment'}
              </Button>
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

          {/* Authentik Configuration Tab */}
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
                  <div className="flex items-center gap-2">
                    {isServiceConfigured('authentik_config', ['baseUrl', 'apiToken', 'clientId', 'clientSecret', 'issuer']) ? (
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
                    <Dialog open={showAuthentikDialog} onOpenChange={setShowAuthentikDialog}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          if (isServiceConfigured('authentik_config', ['baseUrl', 'apiToken', 'clientId', 'clientSecret', 'issuer'])) {
                            const config = allSettings?.settings?.authentik_config;
                            if (config) {
                              setAuthentikForm({
                                baseUrl: config.baseUrl || '',
                                apiToken: config.apiToken || '',
                                clientId: config.clientId || '',
                                clientSecret: config.clientSecret || '',
                                issuer: config.issuer || '',
                              });
                            }
                          }
                        }}>
                          {isServiceConfigured('authentik_config', ['baseUrl', 'apiToken', 'clientId', 'clientSecret', 'issuer']) ? (
                            <>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Configuration
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure Authentik
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Authentik Configuration</DialogTitle>
                          <DialogDescription>
                            Set up your Authentik identity provider connection details
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="authentik-base-url">Base URL</Label>
                            <Input
                              id="authentik-base-url"
                              value={authentikForm.baseUrl}
                              onChange={(e) => setAuthentikForm({ ...authentikForm, baseUrl: e.target.value })}
                              placeholder="https://sso.example.com/api/v3"
                            />
                            <p className="text-xs text-gray-500 mt-1">Authentik API base URL (e.g., https://sso.example.com/api/v3)</p>
                          </div>
                          <div>
                            <Label htmlFor="authentik-api-token">API Token</Label>
                            <Input
                              id="authentik-api-token"
                              type="password"
                              value={authentikForm.apiToken}
                              onChange={(e) => setAuthentikForm({ ...authentikForm, apiToken: e.target.value })}
                              placeholder="API token for Authentik"
                            />
                            <p className="text-xs text-gray-500 mt-1">API token with read permissions for user data</p>
                          </div>
                          <div>
                            <Label htmlFor="authentik-client-id">Client ID</Label>
                            <Input
                              id="authentik-client-id"
                              value={authentikForm.clientId}
                              onChange={(e) => setAuthentikForm({ ...authentikForm, clientId: e.target.value })}
                              placeholder="OAuth2 Client ID"
                            />
                            <p className="text-xs text-gray-500 mt-1">OAuth2/OpenID Connect client identifier</p>
                          </div>
                          <div>
                            <Label htmlFor="authentik-client-secret">Client Secret</Label>
                            <Input
                              id="authentik-client-secret"
                              type="password"
                              value={authentikForm.clientSecret}
                              onChange={(e) => setAuthentikForm({ ...authentikForm, clientSecret: e.target.value })}
                              placeholder="OAuth2 Client Secret"
                            />
                            <p className="text-xs text-gray-500 mt-1">OAuth2/OpenID Connect client secret</p>
                          </div>
                          <div>
                            <Label htmlFor="authentik-issuer">Issuer URL</Label>
                            <Input
                              id="authentik-issuer"
                              value={authentikForm.issuer}
                              onChange={(e) => setAuthentikForm({ ...authentikForm, issuer: e.target.value })}
                              placeholder="https://sso.example.com/application/o/dashboard/"
                            />
                            <p className="text-xs text-gray-500 mt-1">OpenID Connect issuer URL</p>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowAuthentikDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleSaveAuthentikConfig} disabled={updateSettingMutation.isPending}>
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
                {isServiceConfigured('authentik_config', ['baseUrl', 'apiToken', 'clientId', 'clientSecret', 'issuer']) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Base URL</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.authentik_config?.baseUrl}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Issuer</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.authentik_config?.issuer}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Client ID</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.authentik_config?.clientId}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Status</h4>
                      <p className="text-sm text-gray-600">Connected and configured</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Authentik identity provider is not configured. Click "Configure Authentik" to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Discourse Configuration Tab */}
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
                  <div className="flex items-center gap-2">
                    {isServiceConfigured('discourse_config', ['baseUrl', 'apiKey', 'apiUsername']) ? (
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
                    <Dialog open={showDiscourseDialog} onOpenChange={setShowDiscourseDialog}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          if (isServiceConfigured('discourse_config', ['baseUrl', 'apiKey', 'apiUsername'])) {
                            const config = allSettings?.settings?.discourse_config;
                            if (config) {
                              setDiscourseForm({
                                baseUrl: config.baseUrl || '',
                                apiKey: config.apiKey || '',
                                apiUsername: config.apiUsername || '',
                                webhookSecret: config.webhookSecret || '',
                              });
                            }
                          }
                        }}>
                          {isServiceConfigured('discourse_config', ['baseUrl', 'apiKey', 'apiUsername']) ? (
                            <>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Configuration
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure Discourse
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Discourse Configuration</DialogTitle>
                          <DialogDescription>
                            Set up your Discourse forum integration details
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="discourse-base-url">Forum URL</Label>
                            <Input
                              id="discourse-base-url"
                              value={discourseForm.baseUrl}
                              onChange={(e) => setDiscourseForm({ ...discourseForm, baseUrl: e.target.value })}
                              placeholder="https://forum.example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Your Discourse forum base URL</p>
                          </div>
                          <div>
                            <Label htmlFor="discourse-api-key">API Key</Label>
                            <Input
                              id="discourse-api-key"
                              type="password"
                              value={discourseForm.apiKey}
                              onChange={(e) => setDiscourseForm({ ...discourseForm, apiKey: e.target.value })}
                              placeholder="API key from Discourse admin"
                            />
                            <p className="text-xs text-gray-500 mt-1">API key generated in Discourse admin settings</p>
                          </div>
                          <div>
                            <Label htmlFor="discourse-api-username">API Username</Label>
                            <Input
                              id="discourse-api-username"
                              value={discourseForm.apiUsername}
                              onChange={(e) => setDiscourseForm({ ...discourseForm, apiUsername: e.target.value })}
                              placeholder="system or admin username"
                            />
                            <p className="text-xs text-gray-500 mt-1">Username associated with the API key</p>
                          </div>
                          <div>
                            <Label htmlFor="discourse-webhook-secret">Webhook Secret (Optional)</Label>
                            <Input
                              id="discourse-webhook-secret"
                              type="password"
                              value={discourseForm.webhookSecret}
                              onChange={(e) => setDiscourseForm({ ...discourseForm, webhookSecret: e.target.value })}
                              placeholder="Webhook secret for secure callbacks"
                            />
                            <p className="text-xs text-gray-500 mt-1">Secret for validating webhook payloads</p>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowDiscourseDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleSaveDiscourseConfig} disabled={updateSettingMutation.isPending}>
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
                {isServiceConfigured('discourse_config', ['baseUrl', 'apiKey', 'apiUsername']) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Forum URL</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.discourse_config?.baseUrl}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">API Username</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.discourse_config?.apiUsername}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Webhook Secret</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.discourse_config?.webhookSecret ? 'Configured' : 'Not set'}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Status</h4>
                      <p className="text-sm text-gray-600">Connected and configured</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Discourse forum is not configured. Click "Configure Discourse" to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI API Configuration Tab */}
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
                  <div className="flex items-center gap-2">
                    {isServiceConfigured('ai_config', ['provider']) ? (
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
                    <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          if (isServiceConfigured('ai_config', ['provider'])) {
                            const config = allSettings?.settings?.ai_config;
                            if (config) {
                              setAIForm({
                                provider: config.provider || 'openai',
                                openaiApiKey: config.openaiApiKey || '',
                                claudeApiKey: config.claudeApiKey || '',
                                localEndpoint: config.localEndpoint || '',
                                model: config.model || 'gpt-3.5-turbo',
                              });
                            }
                          }
                        }}>
                          {isServiceConfigured('ai_config', ['provider']) ? (
                            <>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Configuration
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure AI APIs
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>AI API Configuration</DialogTitle>
                          <DialogDescription>
                            Set up your AI provider for automated responses and content generation
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="ai-provider">AI Provider</Label>
                            <Select value={aiForm.provider} onValueChange={(value) => setAIForm({ ...aiForm, provider: value })}>
                              <SelectTrigger id="ai-provider">
                                <SelectValue placeholder="Select AI provider" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                                <SelectItem value="local">Local/Self-hosted</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-gray-500 mt-1">Choose your preferred AI provider</p>
                          </div>
                          {aiForm.provider === 'openai' && (
                            <>
                              <div>
                                <Label htmlFor="openai-api-key">OpenAI API Key</Label>
                                <Input
                                  id="openai-api-key"
                                  type="password"
                                  value={aiForm.openaiApiKey}
                                  onChange={(e) => setAIForm({ ...aiForm, openaiApiKey: e.target.value })}
                                  placeholder="sk-..."
                                />
                                <p className="text-xs text-gray-500 mt-1">Your OpenAI API key</p>
                              </div>
                              <div>
                                <Label htmlFor="openai-model">Model</Label>
                                <Select value={aiForm.model} onValueChange={(value) => setAIForm({ ...aiForm, model: value })}>
                                  <SelectTrigger id="openai-model">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                                    <SelectItem value="gpt-4">GPT-4</SelectItem>
                                    <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500 mt-1">OpenAI model to use</p>
                              </div>
                            </>
                          )}
                          {aiForm.provider === 'claude' && (
                            <div>
                              <Label htmlFor="claude-api-key">Claude API Key</Label>
                              <Input
                                id="claude-api-key"
                                type="password"
                                value={aiForm.claudeApiKey}
                                onChange={(e) => setAIForm({ ...aiForm, claudeApiKey: e.target.value })}
                                placeholder="sk-ant-..."
                              />
                              <p className="text-xs text-gray-500 mt-1">Your Anthropic Claude API key</p>
                            </div>
                          )}
                          {aiForm.provider === 'local' && (
                            <div>
                              <Label htmlFor="local-endpoint">Local API Endpoint</Label>
                              <Input
                                id="local-endpoint"
                                value={aiForm.localEndpoint}
                                onChange={(e) => setAIForm({ ...aiForm, localEndpoint: e.target.value })}
                                placeholder="http://localhost:11434/api/generate"
                              />
                              <p className="text-xs text-gray-500 mt-1">Local AI API endpoint (e.g., Ollama, LocalAI)</p>
                            </div>
                          )}
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowAIDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleSaveAIConfig} disabled={updateSettingMutation.isPending}>
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
                {isServiceConfigured('ai_config', ['provider']) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Provider</h4>
                      <p className="text-sm text-gray-600 capitalize">{allSettings?.settings?.ai_config?.provider}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Model/Endpoint</h4>
                      <p className="text-sm text-gray-600">
                        {allSettings?.settings?.ai_config?.provider === 'openai' && allSettings?.settings?.ai_config?.model}
                        {allSettings?.settings?.ai_config?.provider === 'claude' && 'Claude API'}
                        {allSettings?.settings?.ai_config?.provider === 'local' && allSettings?.settings?.ai_config?.localEndpoint}
                      </p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">API Key</h4>
                      <p className="text-sm text-gray-600">
                        {(allSettings?.settings?.ai_config?.openaiApiKey || allSettings?.settings?.ai_config?.claudeApiKey) ? 'Configured' : 'Not set'}
                      </p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Status</h4>
                      <p className="text-sm text-gray-600">Ready for use</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    AI API is not configured. Click "Configure AI APIs" to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SMTP Configuration Tab */}
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
                  <div className="flex items-center gap-2">
                    {isServiceConfigured('smtp_config', ['host', 'port', 'user', 'password', 'from']) ? (
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
                    <Dialog open={showSMTPDialog} onOpenChange={setShowSMTPDialog}>
                      <DialogTrigger asChild>
                        <Button onClick={() => {
                          if (isServiceConfigured('smtp_config', ['host', 'port', 'user', 'password', 'from'])) {
                            const config = allSettings?.settings?.smtp_config;
                            if (config) {
                              setSMTPForm({
                                host: config.host || '',
                                port: config.port || '587',
                                user: config.user || '',
                                password: config.password || '',
                                from: config.from || '',
                                bcc: config.bcc || '',
                                enableTLS: config.enableTLS ?? true,
                              });
                            }
                          }
                        }}>
                          {isServiceConfigured('smtp_config', ['host', 'port', 'user', 'password', 'from']) ? (
                            <>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Configuration
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Configure SMTP
                            </>
                          )}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>SMTP Configuration</DialogTitle>
                          <DialogDescription>
                            Set up your email server settings for sending notifications and emails
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="smtp-host">SMTP Host</Label>
                              <Input
                                id="smtp-host"
                                value={smtpForm.host}
                                onChange={(e) => setSMTPForm({ ...smtpForm, host: e.target.value })}
                                placeholder="smtp.gmail.com"
                              />
                              <p className="text-xs text-gray-500 mt-1">SMTP server hostname</p>
                            </div>
                            <div>
                              <Label htmlFor="smtp-port">Port</Label>
                              <Input
                                id="smtp-port"
                                value={smtpForm.port}
                                onChange={(e) => setSMTPForm({ ...smtpForm, port: e.target.value })}
                                placeholder="587"
                              />
                              <p className="text-xs text-gray-500 mt-1">SMTP port (587, 465, 25)</p>
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="smtp-user">Username</Label>
                            <Input
                              id="smtp-user"
                              value={smtpForm.user}
                              onChange={(e) => setSMTPForm({ ...smtpForm, user: e.target.value })}
                              placeholder="your-email@example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">SMTP authentication username</p>
                          </div>
                          <div>
                            <Label htmlFor="smtp-password">Password</Label>
                            <Input
                              id="smtp-password"
                              type="password"
                              value={smtpForm.password}
                              onChange={(e) => setSMTPForm({ ...smtpForm, password: e.target.value })}
                              placeholder="your-password or app-password"
                            />
                            <p className="text-xs text-gray-500 mt-1">SMTP authentication password</p>
                          </div>
                          <div>
                            <Label htmlFor="smtp-from">From Email</Label>
                            <Input
                              id="smtp-from"
                              value={smtpForm.from}
                              onChange={(e) => setSMTPForm({ ...smtpForm, from: e.target.value })}
                              placeholder="noreply@example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Email address for outgoing messages</p>
                          </div>
                          <div>
                            <Label htmlFor="smtp-bcc">BCC Email (Optional)</Label>
                            <Input
                              id="smtp-bcc"
                              value={smtpForm.bcc}
                              onChange={(e) => setSMTPForm({ ...smtpForm, bcc: e.target.value })}
                              placeholder="admin@example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">BCC all emails to this address</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="smtp-tls"
                              checked={smtpForm.enableTLS}
                              onCheckedChange={(checked) => setSMTPForm({ ...smtpForm, enableTLS: checked })}
                            />
                            <Label htmlFor="smtp-tls">Enable TLS/SSL</Label>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowSMTPDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={handleSaveSMTPConfig} disabled={updateSettingMutation.isPending}>
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
                {isServiceConfigured('smtp_config', ['host', 'port', 'user', 'password', 'from']) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">SMTP Host</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.smtp_config?.host}:{allSettings?.settings?.smtp_config?.port}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Username</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.smtp_config?.user}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">From Email</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.smtp_config?.from}</p>
                    </div>
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Security</h4>
                      <p className="text-sm text-gray-600">{allSettings?.settings?.smtp_config?.enableTLS ? 'TLS Enabled' : 'TLS Disabled'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    SMTP email is not configured. Click "Configure SMTP" to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}