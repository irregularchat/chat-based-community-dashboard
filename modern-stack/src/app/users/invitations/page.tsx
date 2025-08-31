'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Search, Filter, Clock, CheckCircle, XCircle, AlertCircle, Mail, Plus, Copy, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function InvitationsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'pending' | 'accepted' | 'expired' | 'cancelled' | undefined>(undefined);
  const [limit] = useState(25);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());

  // Form states for invite creation
  const [createInviteForm, setCreateInviteForm] = useState({
    label: '',
    expiryDays: 7,
    groups: [] as string[],
  });

  const [sendInviteForm, setSendInviteForm] = useState({
    name: '',
    email: '',
    expiryDays: 7,
    groups: [] as string[],
  });

  const { data: invitationsData, isLoading, refetch } = trpc.user.getInvitationTimeline.useQuery({
    page,
    limit,
    status,
  });

  const { data: groups } = trpc.invite.getGroups.useQuery();

  const cancelInvitationMutation = trpc.user.cancelInvitation.useMutation({
    onSuccess: () => {
      toast.success('Invitation cancelled successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to cancel invitation: ${error.message}`);
    },
  });

  const createInviteMutation = trpc.invite.createInvite.useMutation({
    onSuccess: (_data) => {
      toast.success('Invite link created successfully!');
      setCreateInviteForm({ label: '', expiryDays: 7, groups: [] });
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to create invite: ${error.message}`);
    },
  });

  const sendInviteMutation = trpc.invite.createAndSendInvite.useMutation({
    onSuccess: (data) => {
      toast.success(data.emailSent ? 'Invitation sent successfully!' : 'Invitation created (email sending failed)');
      setSendInviteForm({ name: '', email: '', expiryDays: 7, groups: [] });
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to send invitation: ${error.message}`);
    },
  });

  const handleCancelInvitation = (id: number) => {
    if (confirm('Are you sure you want to cancel this invitation?')) {
      cancelInvitationMutation.mutate({ id });
    }
  };

  const handleCreateInvite = () => {
    if (!createInviteForm.label.trim()) {
      toast.error('Label is required');
      return;
    }
    createInviteMutation.mutate(createInviteForm);
  };

  const handleSendInvite = () => {
    if (!sendInviteForm.name.trim() || !sendInviteForm.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    sendInviteMutation.mutate(sendInviteForm);
  };

  const copyToClipboard = async (text: string, itemName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems(prev => new Set([...prev, itemName]));
      toast.success(`${itemName} copied to clipboard!`);
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev);
          newSet.delete(itemName);
          return newSet;
        });
      }, 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'accepted':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'expired':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-gray-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'accepted':
        return 'bg-green-100 text-green-800';
      case 'expired':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access user invitations</CardDescription>
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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">User Invitations Timeline</h1>
              <p className="text-sm text-gray-600">
                View and manage user invitations sent by community members
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Invite
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create Invitation</DialogTitle>
                    <DialogDescription>
                      Create invite links or send personalized invitations to new users
                    </DialogDescription>
                  </DialogHeader>
                  
                  <Tabs defaultValue="create" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="create">Create Invite Link</TabsTrigger>
                      <TabsTrigger value="send">Create & Send Invite</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="create" className="space-y-4">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="label">Label</Label>
                          <Input
                            id="label"
                            placeholder="e.g., New Member Invite"
                            value={createInviteForm.label}
                            onChange={(e) => setCreateInviteForm(prev => ({ ...prev, label: e.target.value }))}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="expiryDays">Expiry (days)</Label>
                          <Input
                            id="expiryDays"
                            type="number"
                            min="1"
                            max="30"
                            value={createInviteForm.expiryDays}
                            onChange={(e) => setCreateInviteForm(prev => ({ ...prev, expiryDays: parseInt(e.target.value) || 7 }))}
                          />
                        </div>
                        
                        {groups && groups.length > 0 && (
                          <div className="space-y-2">
                            <Label>Pre-assign to Groups (Optional)</Label>
                            <div className="space-y-2">
                              {groups.map((group) => (
                                <div key={group.pk} className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    id={`group-${group.pk}`}
                                    checked={createInviteForm.groups.includes(group.pk)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setCreateInviteForm(prev => ({ ...prev, groups: [...prev.groups, group.pk] }));
                                      } else {
                                        setCreateInviteForm(prev => ({ ...prev, groups: prev.groups.filter(g => g !== group.pk) }));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`group-${group.pk}`}>{group.name}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex justify-end space-x-2">
                          <Button
                            variant="outline"
                            onClick={() => setShowCreateDialog(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleCreateInvite}
                            disabled={createInviteMutation.isPending}
                          >
                            {createInviteMutation.isPending ? 'Creating...' : 'Create Invite'}
                          </Button>
                        </div>
                        
                        {createInviteMutation.data && (
                          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <h4 className="font-medium text-green-900 mb-2">Invite Created Successfully!</h4>
                            <div className="flex items-center space-x-2">
                              <Input
                                readOnly
                                value={createInviteMutation.data.inviteLink}
                                className="font-mono text-sm"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyToClipboard(createInviteMutation.data!.inviteLink, 'Invite Link')}
                              >
                                {copiedItems.has('Invite Link') ? (
                                  <CheckCircle className="w-4 h-4 text-green-600" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                            <p className="text-sm text-green-700 mt-2">
                              Expires: {formatDate(createInviteMutation.data.expiry)}
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="send" className="space-y-4">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="name">Name</Label>
                          <Input
                            id="name"
                            placeholder="e.g., John Doe"
                            value={sendInviteForm.name}
                            onChange={(e) => setSendInviteForm(prev => ({ ...prev, name: e.target.value }))}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="email">Email Address</Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="e.g., john.doe@example.com"
                            value={sendInviteForm.email}
                            onChange={(e) => setSendInviteForm(prev => ({ ...prev, email: e.target.value }))}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="sendExpiryDays">Expiry (days)</Label>
                          <Input
                            id="sendExpiryDays"
                            type="number"
                            min="1"
                            max="30"
                            value={sendInviteForm.expiryDays}
                            onChange={(e) => setSendInviteForm(prev => ({ ...prev, expiryDays: parseInt(e.target.value) || 7 }))}
                          />
                        </div>
                        
                        {groups && groups.length > 0 && (
                          <div className="space-y-2">
                            <Label>Pre-assign to Groups (Optional)</Label>
                            <div className="space-y-2">
                              {groups.map((group) => (
                                <div key={group.pk} className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    id={`send-group-${group.pk}`}
                                    checked={sendInviteForm.groups.includes(group.pk)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSendInviteForm(prev => ({ ...prev, groups: [...prev.groups, group.pk] }));
                                      } else {
                                        setSendInviteForm(prev => ({ ...prev, groups: prev.groups.filter(g => g !== group.pk) }));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`send-group-${group.pk}`}>{group.name}</Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex justify-end space-x-2">
                          <Button
                            variant="outline"
                            onClick={() => setShowCreateDialog(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleSendInvite}
                            disabled={sendInviteMutation.isPending}
                          >
                            <Send className="w-4 h-4 mr-2" />
                            {sendInviteMutation.isPending ? 'Sending...' : 'Create & Send'}
                          </Button>
                        </div>
                        
                        {sendInviteMutation.data && (
                          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <h4 className="font-medium text-green-900 mb-2">
                              {sendInviteMutation.data.emailSent ? 'Invitation Sent Successfully!' : 'Invitation Created (Email Failed)'}
                            </h4>
                            <div className="flex items-center space-x-2">
                              <Input
                                readOnly
                                value={sendInviteMutation.data.inviteLink}
                                className="font-mono text-sm"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyToClipboard(sendInviteMutation.data!.inviteLink, 'Sent Invite Link')}
                              >
                                {copiedItems.has('Sent Invite Link') ? (
                                  <CheckCircle className="w-4 h-4 text-green-600" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                            <p className="text-sm text-green-700 mt-2">
                              Expires: {formatDate(sendInviteMutation.data.expiry)}
                            </p>
                            {!sendInviteMutation.data.emailSent && (
                              <p className="text-sm text-yellow-700 mt-1">
                                Email sending failed, but invite link is ready to share manually.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
              
              <Button
                variant="outline"
                onClick={() => router.push('/users')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Users
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Invitations
              {invitationsData && (
                <Badge variant="secondary">
                  {invitationsData.total} total
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Track and manage user invitations from community members
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search invitations..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status || 'all'} onValueChange={(value) => {
                setStatus(value === 'all' ? undefined : value as 'pending' | 'accepted' | 'expired' | 'cancelled');
              }}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => refetch()}
              >
                <Search className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : (
              <div className="space-y-4">
                {invitationsData?.invitations?.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No invitations found matching the current filters.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invitee</TableHead>
                        <TableHead>Invited By</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitationsData?.invitations?.map((invitation) => (
                        <TableRow key={invitation.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{invitation.inviteeName}</div>
                              <div className="text-sm text-gray-500">{invitation.inviteeEmail}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {invitation.inviter?.firstName} {invitation.inviter?.lastName}
                              </div>
                              <div className="text-sm text-gray-500">@{invitation.inviter?.username}</div>
                              <div className="text-sm text-gray-500">{invitation.inviter?.email}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`flex items-center gap-1 ${getStatusColor(invitation.status)}`}>
                              {getStatusIcon(invitation.status)}
                              {invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {formatDate(invitation.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {formatDate(invitation.expiresAt)}
                            </div>
                          </TableCell>
                          <TableCell>
                            {invitation.message ? (
                              <div className="max-w-xs truncate text-sm">
                                {invitation.message}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">No message</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {invitation.status === 'pending' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancelInvitation(invitation.id)}
                                disabled={cancelInvitationMutation.isPending}
                              >
                                Cancel
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}

            {/* Pagination */}
            {invitationsData && invitationsData.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-gray-700">
                  Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, invitationsData.total)} of {invitationsData.total} invitations
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600">
                    Page {page} of {invitationsData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.min(invitationsData.totalPages, page + 1))}
                    disabled={page === invitationsData.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 