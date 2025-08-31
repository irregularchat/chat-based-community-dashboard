'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Copy, Plus, Send, Users } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc/client';

export default function InvitesPage() {
  const { data: session } = useSession();

  // State for create invite form
  const [createForm, setCreateForm] = useState({
    label: '',
    expiryDays: 7,
    selectedGroups: [] as string[],
  });

  // State for send invite form
  const [sendForm, setSendForm] = useState({
    name: '',
    email: '',
    expiryDays: 7,
    selectedGroups: [] as string[],
  });

  // State for created invite results
  const [createdInvite, setCreatedInvite] = useState<{
    inviteLink: string;
    expiry: string;
    message?: string;
  } | null>(null);

  // State for invite message modal
  const [showMessage, setShowMessage] = useState(false);

  // API queries
  const { data: groups = [], isLoading: groupsLoading } = trpc.invite.getGroups.useQuery();
  const { data: invites, isLoading: invitesLoading, refetch: refetchInvites } = trpc.invite.getInvites.useQuery({
    page: 1,
    limit: 10,
  });

  // API mutations
  const createInviteMutation = trpc.invite.createInvite.useMutation({
    onSuccess: (data) => {
      toast.success('Invite created successfully!');
      setCreatedInvite({
        inviteLink: data.inviteLink,
        expiry: data.expiry,
      });
      setCreateForm({ label: '', expiryDays: 7, selectedGroups: [] });
      refetchInvites();
    },
    onError: (error) => {
      toast.error(`Failed to create invite: ${error.message}`);
    },
  });

  const sendInviteMutation = trpc.invite.createAndSendInvite.useMutation({
    onSuccess: (data) => {
      if (data.emailSent) {
        toast.success(`Invite created and sent to ${sendForm.email}!`);
      } else {
        toast.warning('Invite created but email could not be sent. Check SMTP settings.');
        setCreatedInvite({
          inviteLink: data.inviteLink,
          expiry: data.expiry,
        });
      }
      setSendForm({ name: '', email: '', expiryDays: 7, selectedGroups: [] });
      refetchInvites();
    },
    onError: (error) => {
      toast.error(`Failed to send invite: ${error.message}`);
    },
  });

  const generateMessageMutation = trpc.invite.generateInviteMessage.useMutation({
    onSuccess: (data) => {
      setCreatedInvite(prev => prev ? { ...prev, message: data.message } : null);
      setShowMessage(true);
    },
  });

  const handleCreateInvite = () => {
    if (!createForm.label.trim()) {
      toast.error('Please enter a label for the invite');
      return;
    }

    createInviteMutation.mutate({
      label: createForm.label,
      expiryDays: createForm.expiryDays,
      groups: createForm.selectedGroups,
    });
  };

  const handleSendInvite = () => {
    if (!sendForm.name.trim() || !sendForm.email.trim()) {
      toast.error('Please enter both name and email');
      return;
    }

    sendInviteMutation.mutate({
      name: sendForm.name,
      email: sendForm.email,
      expiryDays: sendForm.expiryDays,
      groups: sendForm.selectedGroups,
    });
  };

  const handleCopyLink = () => {
    if (createdInvite?.inviteLink) {
      navigator.clipboard.writeText(createdInvite.inviteLink);
      toast.success('Invite link copied to clipboard!');
    }
  };

  const handleGenerateMessage = () => {
    if (!createdInvite) return;

    generateMessageMutation.mutate({
      inviteLink: createdInvite.inviteLink,
      expiryDate: createdInvite.expiry,
    });
  };

  const handleCopyMessage = () => {
    if (createdInvite?.message) {
      navigator.clipboard.writeText(createdInvite.message);
      toast.success('Invite message copied to clipboard!');
    }
  };

  const handleGroupToggle = (groupId: string, formType: 'create' | 'send') => {
    if (formType === 'create') {
      setCreateForm(prev => ({
        ...prev,
        selectedGroups: prev.selectedGroups.includes(groupId)
          ? prev.selectedGroups.filter(id => id !== groupId)
          : [...prev.selectedGroups, groupId],
      }));
    } else {
      setSendForm(prev => ({
        ...prev,
        selectedGroups: prev.selectedGroups.includes(groupId)
          ? prev.selectedGroups.filter(id => id !== groupId)
          : [...prev.selectedGroups, groupId],
      }));
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access invite management</CardDescription>
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

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Invite Management</h1>
          <p className="text-muted-foreground">Create and manage invitation links for new users</p>
        </div>
      </div>

      <Tabs defaultValue="create" className="space-y-6">
        <TabsList className="flex w-full overflow-x-auto lg:grid lg:grid-cols-3 lg:overflow-x-visible">
          <TabsTrigger value="create" className="flex-shrink-0">Create Invite</TabsTrigger>
          <TabsTrigger value="send" className="flex-shrink-0">Send Invite</TabsTrigger>
          <TabsTrigger value="manage" className="flex-shrink-0">Manage Invites</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Create Invite Link
              </CardTitle>
              <CardDescription>
                Create a general invitation link that can be shared with anyone
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  placeholder="e.g., New Member Invite"
                  value={createForm.label}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, label: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiryDays">Expiry (days)</Label>
                <Select
                  value={createForm.expiryDays.toString()}
                  onValueChange={(value) => setCreateForm(prev => ({ ...prev, expiryDays: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Pre-assign to Groups</Label>
                {groupsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading groups...</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {groups.map((group) => (
                      <Badge
                        key={group.pk}
                        variant={createForm.selectedGroups.includes(group.pk) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => handleGroupToggle(group.pk, 'create')}
                      >
                        {group.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Button 
                onClick={handleCreateInvite} 
                disabled={createInviteMutation.isPending}
                className="w-full"
              >
                {createInviteMutation.isPending ? 'Creating...' : 'Create Invite'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="send" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Create & Send Invite
              </CardTitle>
              <CardDescription>
                Create a personalized invitation and send it directly via email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., John Doe"
                    value={sendForm.name}
                    onChange={(e) => setSendForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="e.g., john.doe@example.com"
                    value={sendForm.email}
                    onChange={(e) => setSendForm(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sendExpiryDays">Expiry (days)</Label>
                <Select
                  value={sendForm.expiryDays.toString()}
                  onValueChange={(value) => setSendForm(prev => ({ ...prev, expiryDays: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Pre-assign to Groups</Label>
                {groupsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading groups...</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {groups.map((group) => (
                      <Badge
                        key={group.pk}
                        variant={sendForm.selectedGroups.includes(group.pk) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => handleGroupToggle(group.pk, 'send')}
                      >
                        {group.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Button 
                onClick={handleSendInvite} 
                disabled={sendInviteMutation.isPending}
                className="w-full"
              >
                {sendInviteMutation.isPending ? 'Sending...' : 'Create & Send Invite'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Manage Invites
              </CardTitle>
              <CardDescription>
                View and manage existing invitation links
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <div className="text-center text-muted-foreground">Loading invites...</div>
              ) : invites?.invites.length ? (
                <div className="space-y-4">
                  {invites.invites.map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="font-medium">{invite.label}</div>
                        <div className="text-sm text-muted-foreground">
                          Created by {invite.createdBy} • Expires {new Date(invite.expiresAt).toLocaleDateString()}
                        </div>
                        {invite.email && (
                          <div className="text-sm text-blue-600">Sent to: {invite.email}</div>
                        )}
                        {invite.groups?.length > 0 && (
                          <div className="flex gap-1">
                            {invite.groups.map((groupId: string) => {
                              const group = groups.find(g => g.pk === groupId);
                              return group ? (
                                <Badge key={groupId} variant="outline" className="text-xs">
                                  {group.name}
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={invite.isUsed ? "secondary" : invite.expiresAt < new Date() ? "destructive" : "default"}>
                          {invite.isUsed ? "Used" : invite.expiresAt < new Date() ? "Expired" : "Active"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground">No invites created yet</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invite Result Modal */}
      {createdInvite && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Invite Created Successfully!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Invite Link</Label>
              <div className="flex gap-2">
                <Input
                  value={createdInvite.inviteLink}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button onClick={handleCopyLink} size="sm">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Expires</Label>
              <div className="text-sm text-muted-foreground">
                {new Date(createdInvite.expiry).toLocaleString()}
              </div>
            </div>

            {!showMessage ? (
              <Button onClick={handleGenerateMessage} variant="outline" className="w-full">
                Generate Copy/Paste Message
              </Button>
            ) : (
              <div className="space-y-2">
                <Label>Copy/Paste Message</Label>
                <Textarea
                  value={createdInvite.message || ''}
                  readOnly
                  rows={10}
                  className="font-mono text-sm"
                />
                <Button onClick={handleCopyMessage} className="w-full">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Message
                </Button>
              </div>
            )}

            <Button
              onClick={() => setCreatedInvite(null)}
              variant="outline"
              className="w-full"
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 