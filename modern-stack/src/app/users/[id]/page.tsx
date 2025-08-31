'use client';

import { useState, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Edit3, Save, X, Plus, Trash2, Calendar, User, Shield, MessageCircle, Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface UserProfilePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function UserProfilePage({ params }: UserProfilePageProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const { id } = use(params);
  const userId = parseInt(id);
  const [isEditing, setIsEditing] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  
  // Signal verification state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const { data: user, isLoading, refetch } = trpc.user.getUser.useQuery(
    { id: userId },
    { enabled: !isNaN(userId) }
  );

  const updateUserMutation = trpc.user.updateUser.useMutation({
    onSuccess: () => {
      toast.success('User updated successfully');
      refetch();
      setIsEditing(false);
    },
    onError: (_error: unknown) => {
      toast.error('Failed to update user');
    },
  });

  const addNoteMutation = trpc.user.addNote.useMutation({
    onSuccess: () => {
      toast.success('Note added successfully');
      refetch();
      setNewNote('');
    },
    onError: (error: any) => {
      if (error?.message?.includes('Matrix users')) {
        toast.error('Cannot add notes to Matrix users. Please sync the user first.');
      } else {
        toast.error('Failed to add note');
      }
    },
  });

  const updateNoteMutation = trpc.user.updateNote.useMutation({
    onSuccess: () => {
      toast.success('Note updated successfully');
      refetch();
      setEditingNote(null);
      setEditingNoteContent('');
    },
    onError: (_error: unknown) => {
      toast.error('Failed to update note');
    },
  });

  const deleteNoteMutation = trpc.user.deleteNote.useMutation({
    onSuccess: () => {
      toast.success('Note deleted successfully');
      refetch();
    },
    onError: (_error: unknown) => {
      toast.error('Failed to delete note');
    },
  });

  // Signal verification queries and mutations
  const { data: signalStatus, refetch: refetchSignalStatus } = trpc.user.getSignalVerificationStatus.useQuery(
    undefined,
    { enabled: session?.user?.id === userId }
  );

  const initiateSignalVerificationMutation = trpc.user.initiateSignalVerification.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setIsVerifying(true);
      refetchSignalStatus();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to send verification code');
    },
  });

  const verifySignalCodeMutation = trpc.user.verifySignalCode.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setIsVerifying(false);
      setPhoneNumber('');
      setVerificationCode('');
      refetchSignalStatus();
    },
    onError: (error) => {
      toast.error(error.message || 'Invalid verification code');
    },
  });

  const removeSignalVerificationMutation = trpc.user.removeSignalVerification.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchSignalStatus();
    },
    onError: () => {
      toast.error('Failed to remove Signal verification');
    },
  });

  const [editForm, setEditForm] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    isActive: false,
    isAdmin: false,
    isModerator: false,
  });

  const handleEdit = () => {
    if (user) {
      setEditForm({
        username: user.username || '',
        email: user.email || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        isActive: user.isActive,
        isAdmin: user.isAdmin,
        isModerator: user.isModerator,
      });
      setIsEditing(true);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    await updateUserMutation.mutateAsync({
      id: user.id,
      ...editForm,
    });
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    await addNoteMutation.mutateAsync({
      userId: userId,
      content: newNote.trim(),
    });
  };

  const handleUpdateNote = async (noteId: number) => {
    if (!editingNoteContent.trim()) return;

    await updateNoteMutation.mutateAsync({
      id: noteId,
      content: editingNoteContent.trim(),
    });
  };

  const handleDeleteNote = async (noteId: number) => {
    if (confirm('Are you sure you want to delete this note?')) {
      await deleteNoteMutation.mutateAsync({ id: noteId });
    }
  };

  const startEditingNote = (noteId: number, content: string) => {
    setEditingNote(noteId);
    setEditingNoteContent(content);
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access this page</CardDescription>
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading user profile...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>User Not Found</CardTitle>
            <CardDescription>The user you&apos;re looking for doesn&apos;t exist</CardDescription>
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
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => router.push('/users')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Users
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {user.firstName} {user.lastName}
                </h1>
                <p className="text-sm text-gray-600">@{user.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={user.isActive ? 'default' : 'secondary'}>
                {user.isActive ? 'Active' : 'Inactive'}
              </Badge>
              {user.isAdmin && (
                <Badge variant="destructive">Admin</Badge>
              )}
              {user.isModerator && (
                <Badge variant="outline">Moderator</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="notes">Notes ({user.notes?.length || 0})</TabsTrigger>
            <TabsTrigger value="matrix">Matrix</TabsTrigger>
            {session?.user?.id === userId && (
              <TabsTrigger value="signal">Signal</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <User className="w-5 h-5" />
                      User Profile
                    </CardTitle>
                    <CardDescription>
                      View and manage user information
                    </CardDescription>
                  </div>
                  {session.user.isAdmin && (
                    <div className="flex gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => setIsEditing(false)}
                            className="flex items-center gap-2"
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </Button>
                          <Button
                            onClick={handleSave}
                            disabled={updateUserMutation.isPending}
                            className="flex items-center gap-2"
                          >
                            <Save className="w-4 h-4" />
                            Save
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={handleEdit}
                          variant="outline"
                          className="flex items-center gap-2"
                        >
                          <Edit3 className="w-4 h-4" />
                          Edit
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      {isEditing ? (
                        <Input
                          id="firstName"
                          value={editForm.firstName}
                          onChange={(e) => setEditForm(prev => ({ ...prev, firstName: e.target.value }))}
                        />
                      ) : (
                        <p className="text-sm border rounded-md px-3 py-2 bg-gray-50">{user.firstName}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      {isEditing ? (
                        <Input
                          id="lastName"
                          value={editForm.lastName}
                          onChange={(e) => setEditForm(prev => ({ ...prev, lastName: e.target.value }))}
                        />
                      ) : (
                        <p className="text-sm border rounded-md px-3 py-2 bg-gray-50">{user.lastName}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      {isEditing ? (
                        <Input
                          id="username"
                          value={editForm.username}
                          onChange={(e) => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                        />
                      ) : (
                        <p className="text-sm border rounded-md px-3 py-2 bg-gray-50">{user.username}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      {isEditing ? (
                        <Input
                          id="email"
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                        />
                      ) : (
                        <p className="text-sm border rounded-md px-3 py-2 bg-gray-50">{user.email}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Account Status</Label>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-600">
                          Joined {new Date(user.dateJoined).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {isEditing && session.user.isAdmin && (
                      <div className="space-y-4">
                        <Label>Permissions</Label>
                        <div className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="isActive"
                              checked={editForm.isActive}
                              onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked === true }))}
                            />
                            <Label htmlFor="isActive" className="text-sm">
                              Active User
                            </Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="isModerator"
                              checked={editForm.isModerator}
                              onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isModerator: checked === true }))}
                            />
                            <Label htmlFor="isModerator" className="text-sm">
                              Moderator
                            </Label>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="isAdmin"
                              checked={editForm.isAdmin}
                              onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isAdmin: checked === true }))}
                            />
                            <Label htmlFor="isAdmin" className="text-sm">
                              Administrator
                            </Label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  User Notes
                </CardTitle>
                <CardDescription>
                  Add and manage notes about this user
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {user.attributes?.source === 'matrix' ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800">
                        📝 Notes are not available for Matrix users. Sync this user to the database to enable notes.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="newNote">Add New Note</Label>
                      <Textarea
                        id="newNote"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Enter a note about this user..."
                        rows={3}
                      />
                      <Button
                        onClick={handleAddNote}
                        disabled={!newNote.trim() || addNoteMutation.isPending}
                        className="flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add Note
                      </Button>
                    </div>
                  )}

                  {user.notes && user.notes.length > 0 ? (
                    <div className="space-y-4">
                      <Label>Existing Notes</Label>
                      <div className="space-y-3">
                        {user.notes.map((note: { id: number; content: string; createdAt: Date }) => (
                          <div key={note.id} className="border rounded-md p-4 bg-gray-50">
                            <div className="flex justify-between items-start mb-2">
                              <div className="text-xs text-gray-500">
                                By {note.createdBy} on {new Date(note.createdAt).toLocaleDateString()}
                                {note.lastEditedBy && (
                                  <span> • Edited by {note.lastEditedBy}</span>
                                )}
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => startEditingNote(note.id, note.content)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteNote(note.id)}
                                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                            {editingNote === note.id ? (
                              <div className="space-y-2">
                                <Textarea
                                  value={editingNoteContent}
                                  onChange={(e) => setEditingNoteContent(e.target.value)}
                                  rows={3}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => handleUpdateNote(note.id)}
                                    disabled={updateNoteMutation.isPending}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingNote(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm">{note.content}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <MessageCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No notes yet. Add a note to get started.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matrix">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Matrix Integration
                </CardTitle>
                <CardDescription>
                  Matrix rooms and connections (Coming soon)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  <Shield className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>Matrix integration features are coming soon.</p>
                  <p className="text-sm">This will show Matrix rooms, connections, and activity.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {session?.user?.id === userId && (
            <TabsContent value="signal">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Phone className="w-5 h-5" />
                        Signal Verification
                      </CardTitle>
                      <CardDescription>
                        Connect and verify your Signal account for secure messaging
                      </CardDescription>
                    </div>
                    {signalStatus?.isVerified && (
                      <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Verified
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {signalStatus?.isVerified ? (
                    <div className="space-y-4">
                      <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                          <div className="space-y-1">
                            <p className="font-medium text-green-900 dark:text-green-100">
                              Signal Account Verified
                            </p>
                            <p className="text-sm text-green-700 dark:text-green-300">
                              Phone: {signalStatus.phoneNumber}
                            </p>
                            {signalStatus.signalIdentity && (
                              <p className="text-xs text-green-600 dark:text-green-400 font-mono">
                                ID: {signalStatus.signalIdentity}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (confirm('Are you sure you want to remove your Signal verification?')) {
                            removeSignalVerificationMutation.mutate();
                          }
                        }}
                        className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Remove Verification
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {signalStatus?.pendingVerification ? (
                        <div className="space-y-4">
                          <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-lg">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                              <div className="space-y-1">
                                <p className="font-medium text-amber-900 dark:text-amber-100">
                                  Verification Code Sent
                                </p>
                                <p className="text-sm text-amber-700 dark:text-amber-300">
                                  Check your Signal messages for the 6-digit code
                                </p>
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  {signalStatus.pendingVerification.remainingAttempts} attempts remaining
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="verification-code">Verification Code</Label>
                              <Input
                                id="verification-code"
                                type="text"
                                placeholder="Enter 6-digit code"
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                maxLength={6}
                                className="font-mono text-lg tracking-widest"
                              />
                            </div>
                            
                            <div className="flex gap-2">
                              <Button
                                onClick={() => verifySignalCodeMutation.mutate({ code: verificationCode })}
                                disabled={verificationCode.length !== 6 || verifySignalCodeMutation.isPending}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Verify Code
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setIsVerifying(false);
                                  setVerificationCode('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="phone-number">Phone Number</Label>
                            <Input
                              id="phone-number"
                              type="tel"
                              placeholder="+1234567890"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value)}
                            />
                            <p className="text-sm text-muted-foreground">
                              Enter your Signal phone number with country code
                            </p>
                          </div>
                          
                          <Button
                            onClick={() => initiateSignalVerificationMutation.mutate({ phoneNumber })}
                            disabled={!phoneNumber || phoneNumber.length < 10 || initiateSignalVerificationMutation.isPending}
                          >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Send Verification Code
                          </Button>
                          
                          <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
                            <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                              How it works:
                            </h4>
                            <ol className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                              <li>1. Enter your Signal phone number</li>
                              <li>2. We'll send you a 6-digit verification code via Signal</li>
                              <li>3. Enter the code to verify your account</li>
                              <li>4. Your Signal account will be linked to your profile</li>
                            </ol>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
} 