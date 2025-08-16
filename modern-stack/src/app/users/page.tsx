'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { MoreHorizontal, Search, UserPlus, Filter, RefreshCw, Mail, Key, MessageSquare, Edit, Trash2, Users, Copy, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import SearchHelp from '@/components/ui/search-help';

interface UserWithRelations {
  id: number;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  dateJoined: Date;
  groups: Array<{
    group: {
      id: number;
      name: string;
    };
  }>;
  notes: Array<{
    id: number;
    content: string;
    createdAt: Date;
  }>;
};

export default function UsersPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);
  const [limit] = useState(25);
  const [source, setSource] = useState<'authentik' | 'local' | 'both'>('both');
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showMatrixDialog, setShowMatrixDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  
  // Dialog states
  const [emailForm, setEmailForm] = useState({ subject: '', message: '' });
  const [passwordForm, setPasswordForm] = useState({ generatePassword: true, sendEmail: true });
  const [matrixForm, setMatrixForm] = useState({ matrixUsername: '' });
  const [generatedPassword, setGeneratedPassword] = useState<string>('');

  const { data: usersData, isLoading, refetch } = trpc.user.getUsers.useQuery({
    page,
    limit,
    search: search || undefined,
    isActive,
    source,
  });

  const { data: syncStatus, refetch: refetchSyncStatus } = trpc.user.getSyncStatus.useQuery();

  const { data: matrixUsers } = trpc.matrix.getUsers.useQuery({
    includeSignalUsers: true,
    includeRegularUsers: true,
  });

  const deleteUserMutation = trpc.user.deleteUser.useMutation({
    onSuccess: () => {
      toast.success('User deleted successfully');
      refetch();
    },
    onError: (_error) => {
      toast.error('Failed to delete user');
    },
  });

  const updateUserMutation = trpc.user.updateUser.useMutation({
    onSuccess: () => {
      toast.success('User updated successfully');
      refetch();
    },
    onError: (_error) => {
      toast.error('Failed to update user');
    },
  });

  const syncUsersMutation = trpc.user.syncUsers.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Sync completed: ${result.created} created, ${result.updated} updated`
      );
      refetch();
      refetchSyncStatus();
    },
    onError: (_error) => {
      toast.error(`Sync failed: ${error.message}`);
    },
  });

  const resetPasswordMutation = trpc.user.resetPassword.useMutation({
    onSuccess: (data) => {
      toast.success('Password reset successfully');
      setGeneratedPassword(data.temporaryPassword);
      setShowPasswordDialog(false);
      refetch();
    },
    onError: (_error) => {
      toast.error('Failed to reset password');
    },
  });

  const sendEmailMutation = trpc.user.sendEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`Email sent to ${data.successfulEmails} users`);
      if (data.failedEmails > 0) {
        toast.warning(`Failed to send to ${data.failedEmails} users`);
      }
      setShowEmailDialog(false);
      setEmailForm({ subject: '', message: '' });
    },
    onError: (_error) => {
      toast.error('Failed to send email');
    },
  });

  const connectMatrixMutation = trpc.user.connectMatrixAccount.useMutation({
    onSuccess: () => {
      toast.success('Matrix account connected successfully');
      setShowMatrixDialog(false);
      setMatrixForm({ matrixUsername: '' });
      refetch();
    },
    onError: (_error) => {
      toast.error('Failed to connect Matrix account');
    },
  });

  const bulkUpdateMutation = trpc.user.bulkUpdateUsers.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.action} ${data.successfulUpdates} users successfully`);
      if (data.failedUpdates > 0) {
        toast.warning(`Failed to update ${data.failedUpdates} users`);
      }
      setSelectedUsers([]);
      setShowBulkActions(false);
      refetch();
    },
    onError: (_error) => {
      toast.error('Failed to perform bulk action');
    },
  });

  const handleUserAction = (action: string, userId: number) => {
    setSelectedUserId(userId);
    setCurrentAction(action);
    
    switch (action) {
      case 'reset_password':
        setShowPasswordDialog(true);
        break;
      case 'send_email':
        setShowEmailDialog(true);
        break;
      case 'connect_matrix':
        setShowMatrixDialog(true);
        break;
      case 'toggle_active':
        handleToggleActive(userId);
        break;
      case 'toggle_admin':
        handleToggleAdmin(userId);
        break;
      case 'toggle_moderator':
        handleToggleModerator(userId);
        break;
      case 'delete':
        handleDeleteUser(userId);
        break;
    }
  };

  const handleBulkAction = (action: string) => {
    if (selectedUsers.length === 0) {
      toast.error('Please select users first');
      return;
    }

    switch (action) {
      case 'send_email':
        setShowEmailDialog(true);
        break;
      case 'activate':
      case 'deactivate':
      case 'makeAdmin':
      case 'removeAdmin':
      case 'makeModerator':
      case 'removeModerator':
      case 'delete':
        bulkUpdateMutation.mutate({
          userIds: selectedUsers,
          action: action as 'activate' | 'deactivate' | 'makeAdmin' | 'removeAdmin' | 'makeModerator' | 'removeModerator' | 'delete',
        });
        break;
    }
  };

  const handleResetPassword = () => {
    if (!selectedUserId) return;
    
    resetPasswordMutation.mutate({
      userId: selectedUserId,
      generatePassword: passwordForm.generatePassword,
      sendEmail: passwordForm.sendEmail,
    });
  };

  const handleSendEmail = () => {
    if (!emailForm.subject || !emailForm.message) {
      toast.error('Please fill in all fields');
      return;
    }

    const userIds = selectedUsers.length > 0 ? selectedUsers : selectedUserId ? [selectedUserId] : [];
    
    sendEmailMutation.mutate({
      userIds,
      subject: emailForm.subject,
      message: emailForm.message,
    });
  };

  const handleConnectMatrix = () => {
    if (!selectedUserId || !matrixForm.matrixUsername) {
      toast.error('Please select a Matrix user');
      return;
    }
    
    connectMatrixMutation.mutate({
      userId: selectedUserId,
      matrixUsername: matrixForm.matrixUsername,
    });
  };

  const handleDeleteUser = async (userId: number) => {
    if (confirm('Are you sure you want to delete this user?')) {
      await deleteUserMutation.mutateAsync({ id: userId });
    }
  };

  const handleToggleActive = async (userId: number) => {
    const user = usersData?.users.find(u => u.id === userId);
    if (user) {
      await updateUserMutation.mutateAsync({
        id: userId,
        isActive: !user.isActive,
      });
    }
  };

  const handleToggleAdmin = async (userId: number) => {
    const user = usersData?.users.find(u => u.id === userId);
    if (user) {
      await updateUserMutation.mutateAsync({
        id: userId,
        isAdmin: !user.isAdmin,
      });
    }
  };

  const handleToggleModerator = async (userId: number) => {
    const user = usersData?.users.find(u => u.id === userId);
    if (user) {
      await updateUserMutation.mutateAsync({
        id: userId,
        isModerator: !user.isModerator,
      });
    }
  };

  const handleUserSelect = (userId: number, checked: boolean) => {
    if (checked) {
      setSelectedUsers([...selectedUsers, userId]);
    } else {
      setSelectedUsers(selectedUsers.filter(id => id !== userId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && usersData?.users) {
      setSelectedUsers(usersData.users.map(user => user.id));
    } else {
      setSelectedUsers([]);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access user management</CardDescription>
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-8 h-8" />
                User Management
              </h1>
              <p className="text-gray-600 mt-2">
                Manage community members and their permissions
              </p>
              {syncStatus && (
                <div className="mt-3 flex items-center gap-2">
                  {syncStatus.authentikConfigured ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        syncStatus.inSync 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {syncStatus.inSync ? '✅ In Sync' : '⚠️ Out of Sync'}
                      </span>
                      <span className="text-gray-600">
                        Local: {syncStatus.localCount} | Authentik: {syncStatus.authentikCount}
                      </span>
                    </div>
                  ) : (
                    <span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                      ❌ Authentik Not Configured
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {syncStatus?.authentikConfigured && (
                <Button
                  variant="outline"
                  onClick={() => syncUsersMutation.mutate({ forceSync: true })}
                  disabled={syncUsersMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${syncUsersMutation.isPending ? 'animate-spin' : ''}`} />
                  {syncUsersMutation.isPending ? 'Syncing...' : 'Sync Users'}
                </Button>
              )}
              <Button
                onClick={() => router.push('/users/create')}
                className="flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Add User
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/users/invitations')}
                className="flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Invitation Timeline
              </Button>
            </div>
          </div>
        </div>

        {/* SSO Unavailable Banner */}
        {usersData?.fallbackToMatrix && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <div>
                <h3 className="text-sm font-medium text-amber-800">
                  SSO Directory Unavailable
                </h3>
                <p className="text-sm text-amber-700 mt-1">
                  Authentik SSO service is currently unavailable ({usersData.authentikError}). 
                  Showing Matrix users instead. Load time: {usersData.loadTime}ms
                </p>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              👥 Users
              {usersData && (
                <>
                  <Badge variant="secondary">
                    {usersData.total} total
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {usersData.source} source
                  </Badge>
                </>
              )}
              {selectedUsers.length > 0 && (
                <Badge variant="outline">
                  {selectedUsers.length} selected
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Search, filter, and manage your community members
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users... Try: user:admin, email:gmail.com, active:true, gmail OR irregularchat"
                  className="pl-8 pr-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="absolute right-2 top-1.5">
                  <SearchHelp onSuggestionClick={setSearch} />
                </div>
              </div>
              <Select value={source} onValueChange={(value: 'authentik' | 'local' | 'both') => {
                setSource(value);
              }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="authentik">Authentik SSO</SelectItem>
                  <SelectItem value="local">Local DB</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
              <Select value={isActive?.toString() || 'all'} onValueChange={(value) => {
                setIsActive(value === 'all' ? undefined : value === 'true');
              }}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>

            {/* Bulk Actions */}
            {selectedUsers.length > 0 && (
              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">
                      {selectedUsers.length} user(s) selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkAction('send_email')}
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Send Email
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          Bulk Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleBulkAction('activate')}>
                          Activate Users
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleBulkAction('deactivate')}>
                          Deactivate Users
                        </DropdownMenuItem>
                        {session?.user.isAdmin && (
                          <>
                            <DropdownMenuItem onClick={() => handleBulkAction('makeAdmin')}>
                              Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkAction('removeAdmin')}>
                              Remove Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkAction('makeModerator')}>
                              Make Moderator
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBulkAction('removeModerator')}>
                              Remove Moderator
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleBulkAction('delete')}
                              className="text-red-600"
                            >
                              Delete Users
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUsers([])}
                    >
                      Clear Selection
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <TableRowSkeleton key={i} columns={7} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedUsers.length === usersData?.users.length && selectedUsers.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Matrix</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersData?.users.map((user: UserWithRelations) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedUsers.includes(user.id)}
                              onCheckedChange={(checked) => handleUserSelect(user.id, checked as boolean)}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {user.firstName || ''} {user.lastName || ''}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                @{user.username || 'no-username'}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{user.email || 'No email'}</TableCell>
                          <TableCell>
                            <Badge variant={user.isActive ? 'default' : 'secondary'}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {user.isAdmin && (
                                <Badge variant="destructive" className="text-xs">
                                  Admin
                                </Badge>
                              )}
                              {user.isModerator && (
                                <Badge variant="outline" className="text-xs">
                                  Moderator
                                </Badge>
                              )}
                              {!user.isAdmin && !user.isModerator && (
                                <Badge variant="secondary" className="text-xs">
                                  User
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {user.matrixUsername ? (
                              <Badge variant="outline" className="text-xs">
                                {user.matrixUsername}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not connected</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {new Date(user.dateJoined).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => router.push(`/users/${user.id}`)}
                                >
                                  <Edit className="w-4 h-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleUserAction('reset_password', user.id)}
                                >
                                  <Key className="w-4 h-4 mr-2" />
                                  Reset Password
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleUserAction('send_email', user.id)}
                                >
                                  <Mail className="w-4 h-4 mr-2" />
                                  Send Email
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleUserAction('connect_matrix', user.id)}
                                >
                                  <MessageSquare className="w-4 h-4 mr-2" />
                                  Connect Matrix
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleUserAction('toggle_active', user.id)}
                                >
                                  {user.isActive ? 'Deactivate' : 'Activate'}
                                </DropdownMenuItem>
                                {session?.user.isAdmin && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction('toggle_moderator', user.id)}
                                    >
                                      {user.isModerator ? 'Remove Moderator' : 'Make Moderator'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction('toggle_admin', user.id)}
                                    >
                                      {user.isAdmin ? 'Remove Admin' : 'Make Admin'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleUserAction('delete', user.id)}
                                      className="text-red-600"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Delete User
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {usersData && (
                  <div className="flex items-center justify-between px-2 py-4">
                    <div className="text-sm text-muted-foreground">
                      {usersData.total === 0 ? (
                        'No users found'
                      ) : (
                        `Showing ${((page - 1) * limit) + 1} to ${Math.min(page * limit, usersData.total)} of ${usersData.total} users`
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(page - 1)}
                        disabled={page === 1 || usersData.total === 0}
                      >
                        Previous
                      </Button>
                      <div className="text-sm">
                        {usersData.total === 0 ? (
                          'No pages'
                        ) : (
                          `Page ${page} of ${usersData.totalPages}`
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(page + 1)}
                        disabled={page === usersData.totalPages || usersData.total === 0}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Reset the password for the selected user
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="generate-password"
                checked={passwordForm.generatePassword}
                onCheckedChange={(checked) => 
                  setPasswordForm({...passwordForm, generatePassword: checked as boolean})
                }
              />
              <Label htmlFor="generate-password">Generate secure password</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="send-email"
                checked={passwordForm.sendEmail}
                onCheckedChange={(checked) => 
                  setPasswordForm({...passwordForm, sendEmail: checked as boolean})
                }
              />
              <Label htmlFor="send-email">Send password via email</Label>
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleResetPassword} disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generated Password Display */}
      {generatedPassword && (
        <Dialog open={!!generatedPassword} onOpenChange={() => setGeneratedPassword('')}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Password Reset Complete</DialogTitle>
              <DialogDescription>
                The password has been reset successfully
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 mb-2">
                  Temporary Password:
                </p>
                <div className="flex items-center space-x-2">
                  <code className="px-2 py-1 bg-yellow-100 text-yellow-900 rounded text-sm font-mono">
                    {generatedPassword}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(generatedPassword)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center space-x-2 text-sm text-amber-600">
                <AlertTriangle className="w-4 h-4" />
                <span>Please provide this password to the user securely</span>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setGeneratedPassword('')}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Send Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Email</DialogTitle>
            <DialogDescription>
              Send an email to {selectedUsers.length > 0 ? `${selectedUsers.length} selected users` : 'the selected user'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailForm.subject}
                onChange={(e) => setEmailForm({...emailForm, subject: e.target.value})}
                placeholder="Enter email subject..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-message">Message</Label>
              <Textarea
                id="email-message"
                value={emailForm.message}
                onChange={(e) => setEmailForm({...emailForm, message: e.target.value})}
                placeholder="Enter your message..."
                rows={6}
              />
              <div className="text-xs text-muted-foreground">
                You can use variables: $Username, $DisplayName, $FirstName, $LastName, $Email
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowEmailDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSendEmail} disabled={sendEmailMutation.isPending}>
                {sendEmailMutation.isPending ? 'Sending...' : 'Send Email'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Connect Matrix Dialog */}
      <Dialog open={showMatrixDialog} onOpenChange={setShowMatrixDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Matrix Account</DialogTitle>
            <DialogDescription>
              Connect a Matrix account to the selected user
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matrix-username">Matrix Username</Label>
              <Select
                value={matrixForm.matrixUsername}
                onValueChange={(value) => setMatrixForm({...matrixForm, matrixUsername: value})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a Matrix user" />
                </SelectTrigger>
                <SelectContent>
                  {matrixUsers?.map((user: { id: string; displayName: string; username: string }) => (
                    <SelectItem key={user.user_id} value={user.user_id}>
                      {user.display_name} ({user.user_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowMatrixDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleConnectMatrix} disabled={connectMatrixMutation.isPending}>
                {connectMatrixMutation.isPending ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 