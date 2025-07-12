'use client';

import { useState } from 'react';
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
import { ArrowLeft, Edit3, Save, X, Plus, Trash2, Calendar, Mail, User, Shield, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

interface UserProfilePageProps {
  params: {
    id: string;
  };
}

export default function UserProfilePage({ params }: UserProfilePageProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const userId = parseInt(params.id);
  const [isEditing, setIsEditing] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');

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
    onError: (error: any) => {
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
      toast.error('Failed to add note');
    },
  });

  const updateNoteMutation = trpc.user.updateNote.useMutation({
    onSuccess: () => {
      toast.success('Note updated successfully');
      refetch();
      setEditingNote(null);
      setEditingNoteContent('');
    },
    onError: (error: any) => {
      toast.error('Failed to update note');
    },
  });

  const deleteNoteMutation = trpc.user.deleteNote.useMutation({
    onSuccess: () => {
      toast.success('Note deleted successfully');
      refetch();
    },
    onError: (error: any) => {
      toast.error('Failed to delete note');
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
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
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
            <CardDescription>The user you're looking for doesn't exist</CardDescription>
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
                            disabled={updateUserMutation.isLoading}
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
                      disabled={!newNote.trim() || addNoteMutation.isLoading}
                      className="flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Note
                    </Button>
                  </div>

                  {user.notes && user.notes.length > 0 ? (
                    <div className="space-y-4">
                      <Label>Existing Notes</Label>
                      <div className="space-y-3">
                        {user.notes.map((note: any) => (
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
                                    disabled={updateNoteMutation.isLoading}
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
        </Tabs>
      </div>
    </div>
  );
} 