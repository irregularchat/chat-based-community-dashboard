'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  ArrowLeft, 
  Send, 
  MessageCircle, 
  Users, 
  Phone, 
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Copy,
  Hash
} from 'lucide-react';
import { toast } from 'sonner';

export default function CommunityManagementPage() {
  const { data: session } = useSession();
  const router = useRouter();
  
  // State for different tabs
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  // API queries
  const { data: signalConfig, isLoading: configLoading } = trpc.signal.getConfig.useQuery();
  
  const { data: signalUsers, isLoading: usersLoading, refetch: refetchUsers } = trpc.signal.getUsers.useQuery({}, {
    enabled: !!signalConfig?.isConfigured,
  });

  const { data: signalGroups, isLoading: groupsLoading, refetch: refetchGroups } = trpc.signal.getGroups.useQuery({}, {
    enabled: !!signalConfig?.isConfigured,
  });

  // Mutations
  const sendMessageMutation = trpc.signal.sendMessage.useMutation({
    onSuccess: () => {
      toast.success('Signal message sent successfully');
      setMessage('');
      setSelectedUsers([]);
      setSelectedGroups([]);
    },
    onError: (error) => {
      toast.error(`Failed to send Signal message: ${error.message}`);
    },
  });

  const clearCacheMutation = trpc.signal.clearCache.useMutation({
    onSuccess: () => {
      toast.success('Signal cache cleared successfully');
      refetchUsers();
      refetchGroups();
    },
    onError: (error) => {
      toast.error(`Failed to clear cache: ${error.message}`);
    },
  });

  const handleSendMessage = async () => {
    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    const recipients = [...selectedUsers, ...selectedGroups];
    if (recipients.length === 0) {
      toast.error('Please select users or groups');
      return;
    }

    await sendMessageMutation.mutateAsync({
      recipients,
      message,
    });
  };

  const copyToClipboard = async (text: string, itemName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${itemName} copied to clipboard`);
    } catch (err) {
      toast.error(`Failed to copy ${itemName}`);
    }
  };

  // Filter functions
  const filteredUsers = signalUsers?.filter(user =>
    user.displayName.toLowerCase().includes(userSearch.toLowerCase()) ||
    user.id.toLowerCase().includes(userSearch.toLowerCase())
  ) || [];

  const filteredGroups = signalGroups?.filter(group =>
    group.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
    group.id.toLowerCase().includes(groupSearch.toLowerCase())
  ) || [];

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access community management</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session.user.isModerator && !session.user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You need moderator or admin privileges to access this page</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading Signal configuration...</p>
        </div>
      </div>
    );
  }

  if (!signalConfig?.isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-6 h-6 text-yellow-500" />
              Signal Integration Not Configured
            </CardTitle>
            <CardDescription>
              Signal integration is not currently active. Please contact your administrator to enable Signal functionality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-gray-600">
              <p><strong>Configuration needed:</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>SIGNAL_CLI_REST_API_BASE_URL</li>
                <li>SIGNAL_PHONE_NUMBER</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Signal Community Management</h1>
              <p className="text-sm text-gray-600">
                Manage Signal messaging and community groups with enhanced profile names
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-green-50 text-green-700">
                <CheckCircle className="w-3 h-3 mr-1" />
                Signal Active
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearCacheMutation.mutate()}
                disabled={clearCacheMutation.isPending}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${clearCacheMutation.isPending ? 'animate-spin' : ''}`} />
                Refresh Cache
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="groups" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="groups" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Signal Groups
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Signal Users
            </TabsTrigger>
            <TabsTrigger value="messaging" className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Send Messages
            </TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Signal Groups
                  {signalGroups && (
                    <Badge variant="secondary">
                      {signalGroups.length} groups
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  View and manage Signal groups with enhanced member display names
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Group Search */}
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search groups..."
                    className="pl-8"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                  />
                </div>

                {/* Groups List */}
                {groupsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : filteredGroups.length > 0 ? (
                  <div className="space-y-4">
                    {filteredGroups.map((group) => (
                      <div key={group.id} className="border rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h4 className="font-medium text-lg">{group.name}</h4>
                              <Badge variant="secondary">
                                {group.memberCount} members
                              </Badge>
                            </div>
                            
                            {group.description && (
                              <p className="text-sm text-gray-600 mb-3">{group.description}</p>
                            )}

                            {/* Group Members with Enhanced Names */}
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-gray-700">Members:</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {group.displayMembers?.slice(0, 6).map((member) => (
                                  <div key={member.id} className="flex items-center gap-2 text-sm">
                                    <span className="font-medium">{member.displayName}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => copyToClipboard(member.id, 'Member ID')}
                                    >
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                              {group.displayMembers && group.displayMembers.length > 6 && (
                                <p className="text-xs text-gray-500">
                                  ... and {group.displayMembers.length - 6} more members
                                </p>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(group.id, 'Group ID')}
                            >
                              <Hash className="w-4 h-4 mr-1" />
                              Copy ID
                            </Button>
                            <Checkbox
                              checked={selectedGroups.includes(group.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedGroups([...selectedGroups, group.id]);
                                } else {
                                  setSelectedGroups(selectedGroups.filter(id => id !== group.id));
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No groups found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  Signal Users
                  {signalUsers && (
                    <Badge variant="secondary">
                      {signalUsers.length} users
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  View Signal users with enhanced profile display names
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* User Search */}
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users..."
                    className="pl-8"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>

                {/* Users List */}
                {usersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : filteredUsers.length > 0 ? (
                  <div className="grid gap-3">
                    {filteredUsers.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg bg-white hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedUsers.includes(user.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedUsers([...selectedUsers, user.id]);
                              } else {
                                setSelectedUsers(selectedUsers.filter(id => id !== user.id));
                              }
                            }}
                          />
                          <div>
                            <p className="font-medium">{user.displayName}</p>
                            <p className="text-sm text-gray-500">{user.phoneNumber || user.id}</p>
                            {user.isRegistered && (
                              <Badge variant="outline" className="text-xs mt-1">
                                Registered
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(user.id, 'User ID')}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No users found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messaging">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  Send Signal Messages
                </CardTitle>
                <CardDescription>
                  Send messages to selected Signal users and groups
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Selection Summary */}
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Selected Recipients</h4>
                  <div className="space-y-1 text-sm text-blue-800">
                    <p>Users: {selectedUsers.length}</p>
                    <p>Groups: {selectedGroups.length}</p>
                    <p>Total: {selectedUsers.length + selectedGroups.length}</p>
                  </div>
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Enter your Signal message..."
                    rows={6}
                  />
                  <p className="text-xs text-gray-500">
                    Message will be sent to all selected users and groups
                  </p>
                </div>

                {/* Send Button */}
                <Button
                  onClick={handleSendMessage}
                  disabled={!message.trim() || (selectedUsers.length + selectedGroups.length) === 0 || sendMessageMutation.isPending}
                  className="w-full"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {sendMessageMutation.isPending ? 'Sending...' : `Send Message to ${selectedUsers.length + selectedGroups.length} Recipients`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}