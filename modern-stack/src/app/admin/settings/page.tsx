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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit, Trash2, Save, X, ArrowUp, ArrowDown, Settings, MessageSquare, Bookmark, Bell, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('bookmarks');
  const [isEditing, setIsEditing] = useState<{ type: string; id?: number } | null>(null);

  // Dialog states
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);
  const [showRoomCardDialog, setShowRoomCardDialog] = useState(false);
  const [showAnnouncementDialog, setShowAnnouncementDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showMatrixDialog, setShowMatrixDialog] = useState(false);

  // Form states
  const [bookmarkForm, setBookmarkForm] = useState({
    title: '',
    description: '',
    url: '',
    icon: '',
    category: 'general',
    order: 0,
    isActive: true,
  });

  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    type: 'info' as 'info' | 'warning' | 'success' | 'error',
    isActive: true,
    priority: 0,
    expiresAt: '',
  });

  const [roomCardForm, setRoomCardForm] = useState({
    title: '',
    description: '',
    category: 'general',
    image: '',
    matrixRoomId: '',
    directLink: '',
    forumLink: '',
    wikiLink: '',
    memberCount: 0,
    order: 0,
    isActive: true,
  });

  const [settingsForm, setSettingsForm] = useState({
    key: '',
    value: '',
  });

  const [matrixForm, setMatrixForm] = useState({
    homeserver: '',
    accessToken: '',
    userId: '',
    welcomeRoomId: '',
    enableEncryption: false,
  });

  // Fetch data
  const { data: allSettings, isLoading, refetch } = trpc.settings.getAllSettings.useQuery();

  // Mutations
  const createBookmarkMutation = trpc.settings.createCommunityBookmark.useMutation({
    onSuccess: () => {
      toast.success('Bookmark created successfully');
      refetch();
      setShowBookmarkDialog(false);
      resetBookmarkForm();
    },
    onError: (error) => {
      toast.error(`Failed to create bookmark: ${error.message}`);
    },
  });

  const updateBookmarkMutation = trpc.settings.updateCommunityBookmark.useMutation({
    onSuccess: () => {
      toast.success('Bookmark updated successfully');
      refetch();
      setIsEditing(null);
    },
    onError: (error) => {
      toast.error(`Failed to update bookmark: ${error.message}`);
    },
  });

  const deleteBookmarkMutation = trpc.settings.deleteCommunityBookmark.useMutation({
    onSuccess: () => {
      toast.success('Bookmark deleted successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to delete bookmark: ${error.message}`);
    },
  });

  const createAnnouncementMutation = trpc.settings.createDashboardAnnouncement.useMutation({
    onSuccess: () => {
      toast.success('Announcement created successfully');
      refetch();
      setShowAnnouncementDialog(false);
      resetAnnouncementForm();
    },
    onError: (error) => {
      toast.error(`Failed to create announcement: ${error.message}`);
    },
  });

  const updateAnnouncementMutation = trpc.settings.updateDashboardAnnouncement.useMutation({
    onSuccess: () => {
      toast.success('Announcement updated successfully');
      refetch();
      setIsEditing(null);
    },
    onError: (error) => {
      toast.error(`Failed to update announcement: ${error.message}`);
    },
  });

  const deleteAnnouncementMutation = trpc.settings.deleteDashboardAnnouncement.useMutation({
    onSuccess: () => {
      toast.success('Announcement deleted successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to delete announcement: ${error.message}`);
    },
  });

  const updateSettingMutation = trpc.settings.updateDashboardSetting.useMutation({
    onSuccess: () => {
      toast.success('Setting updated successfully');
      refetch();
      setShowSettingsDialog(false);
      resetSettingsForm();
    },
    onError: (error) => {
      toast.error(`Failed to update setting: ${error.message}`);
    },
  });

  const reorderBookmarksMutation = trpc.settings.reorderCommunityBookmarks.useMutation({
    onSuccess: () => {
      toast.success('Bookmarks reordered successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to reorder bookmarks: ${error.message}`);
    },
  });

  // Room Card Mutations
  const createRoomCardMutation = trpc.settings.createRoomCard.useMutation({
    onSuccess: () => {
      toast.success('Room card created successfully');
      refetch();
      setShowRoomCardDialog(false);
      resetRoomCardForm();
    },
    onError: (error) => {
      toast.error(`Failed to create room card: ${error.message}`);
    },
  });

  const updateRoomCardMutation = trpc.settings.updateRoomCard.useMutation({
    onSuccess: () => {
      toast.success('Room card updated successfully');
      refetch();
      setIsEditing(null);
    },
    onError: (error) => {
      toast.error(`Failed to update room card: ${error.message}`);
    },
  });

  const deleteRoomCardMutation = trpc.settings.deleteRoomCard.useMutation({
    onSuccess: () => {
      toast.success('Room card deleted successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to delete room card: ${error.message}`);
    },
  });

  const reorderRoomCardsMutation = trpc.settings.reorderRoomCards.useMutation({
    onSuccess: () => {
      toast.success('Room cards reordered successfully');
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to reorder room cards: ${error.message}`);
    },
  });

  // Form handlers
  const resetBookmarkForm = () => {
    setBookmarkForm({
      title: '',
      description: '',
      url: '',
      icon: '',
      category: 'general',
      order: 0,
      isActive: true,
    });
  };

  const resetAnnouncementForm = () => {
    setAnnouncementForm({
      title: '',
      content: '',
      type: 'info',
      isActive: true,
      priority: 0,
      expiresAt: '',
    });
  };

  const resetSettingsForm = () => {
    setSettingsForm({
      key: '',
      value: '',
    });
  };

  const resetMatrixForm = () => {
    setMatrixForm({
      homeserver: '',
      accessToken: '',
      userId: '',
      welcomeRoomId: '',
      enableEncryption: false,
    });
  };

  const resetRoomCardForm = () => {
    setRoomCardForm({
      title: '',
      description: '',
      category: 'general',
      image: '',
      matrixRoomId: '',
      directLink: '',
      forumLink: '',
      wikiLink: '',
      memberCount: 0,
      order: 0,
      isActive: true,
    });
  };

  const handleCreateBookmark = () => {
    createBookmarkMutation.mutate(bookmarkForm);
  };

  const handleUpdateBookmark = (id: number) => {
    updateBookmarkMutation.mutate({
      id,
      ...bookmarkForm,
    });
  };

  const handleDeleteBookmark = (id: number) => {
    if (confirm('Are you sure you want to delete this bookmark?')) {
      deleteBookmarkMutation.mutate({ id });
    }
  };

  const handleCreateRoomCard = () => {
    createRoomCardMutation.mutate(roomCardForm);
  };

  const handleUpdateRoomCard = (id: number) => {
    updateRoomCardMutation.mutate({
      id,
      ...roomCardForm,
    });
  };

  const handleDeleteRoomCard = (id: number) => {
    if (confirm('Are you sure you want to delete this room card?')) {
      deleteRoomCardMutation.mutate({ id });
    }
  };

  const handleCreateAnnouncement = () => {
    const data = {
      ...announcementForm,
      expiresAt: announcementForm.expiresAt ? new Date(announcementForm.expiresAt) : undefined,
    };
    createAnnouncementMutation.mutate(data);
  };

  const handleUpdateAnnouncement = (id: number) => {
    const data = {
      id,
      ...announcementForm,
      expiresAt: announcementForm.expiresAt ? new Date(announcementForm.expiresAt) : undefined,
    };
    updateAnnouncementMutation.mutate(data);
  };

  const handleDeleteAnnouncement = (id: number) => {
    if (confirm('Are you sure you want to delete this announcement?')) {
      deleteAnnouncementMutation.mutate({ id });
    }
  };

  const handleUpdateSetting = () => {
    let value: any = settingsForm.value;
    
    // Try to parse as JSON, fallback to string
    try {
      value = JSON.parse(settingsForm.value);
    } catch {
      // Keep as string if not valid JSON
    }

    updateSettingMutation.mutate({
      key: settingsForm.key,
      value,
    });
  };

  const handleSaveMatrixConfig = () => {
    // Save Matrix configuration to dashboard settings
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
    toast.success('Matrix configuration saved! Please redeploy the service with environment variables.');
  };

  const handleReorderBookmarks = (direction: 'up' | 'down', bookmark: any) => {
    const bookmarks = [...(allSettings?.bookmarks || [])];
    const currentIndex = bookmarks.findIndex(b => b.id === bookmark.id);
    
    if (direction === 'up' && currentIndex > 0) {
      [bookmarks[currentIndex], bookmarks[currentIndex - 1]] = [bookmarks[currentIndex - 1], bookmarks[currentIndex]];
    } else if (direction === 'down' && currentIndex < bookmarks.length - 1) {
      [bookmarks[currentIndex], bookmarks[currentIndex + 1]] = [bookmarks[currentIndex + 1], bookmarks[currentIndex]];
    }

    // Update order values
    const updates = bookmarks.map((bookmark, index) => ({
      id: bookmark.id,
      order: index,
    }));

    reorderBookmarksMutation.mutate({ bookmarks: updates });
  };

  const startEditing = (type: string, item?: any) => {
    setIsEditing({ type, id: item?.id });
    
    if (type === 'bookmark' && item) {
      setBookmarkForm({
        title: item.title,
        description: item.description || '',
        url: item.url,
        icon: item.icon || '',
        category: item.category,
        order: item.order,
        isActive: item.isActive,
      });
    } else if (type === 'roomcard' && item) {
      setRoomCardForm({
        title: item.title,
        description: item.description || '',
        category: item.category,
        image: item.image || '',
        matrixRoomId: item.matrixRoomId || '',
        directLink: item.directLink || '',
        forumLink: item.forumLink || '',
        wikiLink: item.wikiLink || '',
        memberCount: item.memberCount || 0,
        order: item.order,
        isActive: item.isActive,
      });
    } else if (type === 'announcement' && item) {
      setAnnouncementForm({
        title: item.title,
        content: item.content,
        type: item.type,
        isActive: item.isActive,
        priority: item.priority,
        expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16) : '',
      });
    }
  };

  const cancelEditing = () => {
    setIsEditing(null);
    resetBookmarkForm();
    resetRoomCardForm();
    resetAnnouncementForm();
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access admin settings</CardDescription>
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard Settings</h1>
              <p className="text-sm text-gray-600">
                Manage user dashboard content and configuration
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={() => router.push('/admin')}
              >
                ← Back to Admin
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex w-full overflow-x-auto lg:grid lg:grid-cols-5 lg:overflow-x-visible">
            <TabsTrigger value="bookmarks" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Bookmark className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Community Bookmarks</span>
            </TabsTrigger>
            <TabsTrigger value="rooms" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Room Cards</span>
            </TabsTrigger>
            <TabsTrigger value="announcements" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Bell className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Announcements</span>
            </TabsTrigger>
            <TabsTrigger value="matrix" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Matrix Config</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Settings className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">General Settings</span>
            </TabsTrigger>
          </TabsList>

          {/* Community Bookmarks Tab */}
          <TabsContent value="bookmarks" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Community Bookmarks</CardTitle>
                    <CardDescription>
                      Manage the links that appear in the user dashboard Quick Links section
                    </CardDescription>
                  </div>
                  <Dialog open={showBookmarkDialog} onOpenChange={setShowBookmarkDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Bookmark
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Community Bookmark</DialogTitle>
                        <DialogDescription>
                          Create a new bookmark for the user dashboard
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="title">Title</Label>
                          <Input
                            id="title"
                            value={bookmarkForm.title}
                            onChange={(e) => setBookmarkForm({ ...bookmarkForm, title: e.target.value })}
                            placeholder="e.g., Community Forum"
                          />
                        </div>
                        <div>
                          <Label htmlFor="description">Description</Label>
                          <Input
                            id="description"
                            value={bookmarkForm.description}
                            onChange={(e) => setBookmarkForm({ ...bookmarkForm, description: e.target.value })}
                            placeholder="Brief description of the link"
                          />
                        </div>
                        <div>
                          <Label htmlFor="url">URL</Label>
                          <Input
                            id="url"
                            type="url"
                            value={bookmarkForm.url}
                            onChange={(e) => setBookmarkForm({ ...bookmarkForm, url: e.target.value })}
                            placeholder="https://..."
                          />
                        </div>
                        <div>
                          <Label htmlFor="icon">Icon (optional)</Label>
                          <Input
                            id="icon"
                            value={bookmarkForm.icon}
                            onChange={(e) => setBookmarkForm({ ...bookmarkForm, icon: e.target.value })}
                            placeholder="📖 or lucide icon name"
                          />
                        </div>
                        <div>
                          <Label htmlFor="category">Category</Label>
                          <Select value={bookmarkForm.category} onValueChange={(value) => setBookmarkForm({ ...bookmarkForm, category: value })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">General</SelectItem>
                              <SelectItem value="resources">Resources</SelectItem>
                              <SelectItem value="tools">Tools</SelectItem>
                              <SelectItem value="communication">Communication</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="active"
                            checked={bookmarkForm.isActive}
                            onCheckedChange={(checked) => setBookmarkForm({ ...bookmarkForm, isActive: checked })}
                          />
                          <Label htmlFor="active">Active</Label>
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={() => setShowBookmarkDialog(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleCreateBookmark} disabled={createBookmarkMutation.isPending}>
                            {createBookmarkMutation.isPending ? 'Creating...' : 'Create'}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {allSettings?.bookmarks?.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No bookmarks configured yet. Click "Add Bookmark" to get started.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>URL</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allSettings?.bookmarks?.map((bookmark, index) => (
                            <TableRow key={bookmark.id}>
                              <TableCell>
                                <div className="flex items-center space-x-1">
                                  <span className="text-sm text-gray-500">{index + 1}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleReorderBookmarks('up', bookmark)}
                                    disabled={index === 0}
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleReorderBookmarks('down', bookmark)}
                                    disabled={index === (allSettings?.bookmarks?.length || 0) - 1}
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  {bookmark.icon && <span>{bookmark.icon}</span>}
                                  <span className="font-medium">{bookmark.title}</span>
                                </div>
                                {bookmark.description && (
                                  <p className="text-sm text-gray-500">{bookmark.description}</p>
                                )}
                              </TableCell>
                              <TableCell>
                                <a
                                  href={bookmark.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 text-sm"
                                >
                                  {bookmark.url}
                                </a>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">
                                  {bookmark.category}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={bookmark.isActive ? 'default' : 'secondary'}>
                                  {bookmark.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => startEditing('bookmark', bookmark)}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteBookmark(bookmark.id)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Announcements Tab */}
          <TabsContent value="announcements" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Dashboard Announcements</CardTitle>
                    <CardDescription>
                      Manage announcements that appear at the top of the user dashboard
                    </CardDescription>
                  </div>
                  <Dialog open={showAnnouncementDialog} onOpenChange={setShowAnnouncementDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Announcement
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Add Dashboard Announcement</DialogTitle>
                        <DialogDescription>
                          Create a new announcement for the user dashboard
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="announcement-title">Title</Label>
                          <Input
                            id="announcement-title"
                            value={announcementForm.title}
                            onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                            placeholder="Announcement title"
                          />
                        </div>
                        <div>
                          <Label htmlFor="announcement-content">Content</Label>
                          <Textarea
                            id="announcement-content"
                            value={announcementForm.content}
                            onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                            placeholder="Announcement content..."
                            rows={4}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="announcement-type">Type</Label>
                            <Select value={announcementForm.type} onValueChange={(value: any) => setAnnouncementForm({ ...announcementForm, type: value })}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="info">Info</SelectItem>
                                <SelectItem value="warning">Warning</SelectItem>
                                <SelectItem value="success">Success</SelectItem>
                                <SelectItem value="error">Error</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="announcement-priority">Priority</Label>
                            <Input
                              id="announcement-priority"
                              type="number"
                              value={announcementForm.priority}
                              onChange={(e) => setAnnouncementForm({ ...announcementForm, priority: parseInt(e.target.value) || 0 })}
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="announcement-expires">Expires At (optional)</Label>
                          <Input
                            id="announcement-expires"
                            type="datetime-local"
                            value={announcementForm.expiresAt}
                            onChange={(e) => setAnnouncementForm({ ...announcementForm, expiresAt: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="announcement-active"
                            checked={announcementForm.isActive}
                            onCheckedChange={(checked) => setAnnouncementForm({ ...announcementForm, isActive: checked })}
                          />
                          <Label htmlFor="announcement-active">Active</Label>
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={() => setShowAnnouncementDialog(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleCreateAnnouncement} disabled={createAnnouncementMutation.isPending}>
                            {createAnnouncementMutation.isPending ? 'Creating...' : 'Create'}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {allSettings?.announcements?.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No announcements configured yet. Click "Add Announcement" to get started.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Content</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Priority</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Expires</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allSettings?.announcements?.map((announcement) => (
                            <TableRow key={announcement.id}>
                              <TableCell className="font-medium">{announcement.title}</TableCell>
                              <TableCell>
                                <div className="max-w-xs truncate">{announcement.content}</div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    announcement.type === 'error' ? 'destructive' :
                                    announcement.type === 'warning' ? 'outline' :
                                    announcement.type === 'success' ? 'default' : 'secondary'
                                  }
                                  className="capitalize"
                                >
                                  {announcement.type}
                                </Badge>
                              </TableCell>
                              <TableCell>{announcement.priority}</TableCell>
                              <TableCell>
                                <Badge variant={announcement.isActive ? 'default' : 'secondary'}>
                                  {announcement.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {announcement.expiresAt ? (
                                  <span className="text-sm text-gray-500">
                                    {new Date(announcement.expiresAt).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-400">Never</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => startEditing('announcement', announcement)}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteAnnouncement(announcement.id)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Matrix Configuration Tab */}
          <TabsContent value="matrix" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Matrix Integration Configuration</CardTitle>
                    <CardDescription>
                      Configure Matrix homeserver connection and settings. These will be deployed as environment variables.
                    </CardDescription>
                  </div>
                  <Dialog open={showMatrixDialog} onOpenChange={setShowMatrixDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Configure Matrix
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
                        <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200">
                          <div className="flex">
                            <div className="text-yellow-800 text-sm">
                              <strong>Important:</strong> After saving these settings, you'll need to update the deployment with the corresponding environment variables and restart the service for Matrix integration to work.
                            </div>
                          </div>
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
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {!allSettings?.settings?.matrix_config ? (
                      <div className="text-center py-8">
                        <div className="mx-auto flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-4">
                          <MessageCircle className="w-6 h-6 text-red-600" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Matrix Not Configured</h3>
                        <p className="text-gray-500 mb-4">
                          Matrix integration is not currently active. Click "Configure Matrix" to set up your Matrix homeserver connection.
                        </p>
                        <div className="text-sm text-gray-600">
                          <p className="font-medium">Required configuration:</p>
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>MATRIX_HOMESERVER - Your Matrix homeserver URL</li>
                            <li>MATRIX_ACCESS_TOKEN - Bot user access token</li>
                            <li>MATRIX_USER_ID - Bot Matrix user ID</li>
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-green-50 p-4 rounded-md border border-green-200">
                          <div className="flex items-center">
                            <MessageCircle className="w-5 h-5 text-green-600 mr-2" />
                            <span className="text-green-800 font-medium">Matrix Configuration Found</span>
                          </div>
                          <p className="text-green-700 text-sm mt-1">
                            Matrix integration settings are configured. Make sure the environment variables are deployed.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="border rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Homeserver</h4>
                            <p className="text-sm text-gray-600">{allSettings.settings.matrix_config.homeserver || 'Not configured'}</p>
                          </div>
                          <div className="border rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Bot User ID</h4>
                            <p className="text-sm text-gray-600">{allSettings.settings.matrix_config.userId || 'Not configured'}</p>
                          </div>
                          <div className="border rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Welcome Room</h4>
                            <p className="text-sm text-gray-600">{allSettings.settings.matrix_config.welcomeRoomId || 'Not configured'}</p>
                          </div>
                          <div className="border rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-2">Encryption</h4>
                            <p className="text-sm text-gray-600">{allSettings.settings.matrix_config.enableEncryption ? 'Enabled' : 'Disabled'}</p>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <Button
                            variant="outline"
                            onClick={() => {
                              const config = allSettings.settings.matrix_config;
                              setMatrixForm({
                                homeserver: config.homeserver || '',
                                accessToken: config.accessToken || '',
                                userId: config.userId || '',
                                welcomeRoomId: config.welcomeRoomId || '',
                                enableEncryption: config.enableEncryption || false,
                              });
                              setShowMatrixDialog(true);
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Configuration
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* General Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>
                      Configure general dashboard settings and custom values
                    </CardDescription>
                  </div>
                  <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Setting
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Dashboard Setting</DialogTitle>
                        <DialogDescription>
                          Add a new key-value setting for the dashboard
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="setting-key">Key</Label>
                          <Input
                            id="setting-key"
                            value={settingsForm.key}
                            onChange={(e) => setSettingsForm({ ...settingsForm, key: e.target.value })}
                            placeholder="e.g., welcome_message"
                          />
                        </div>
                        <div>
                          <Label htmlFor="setting-value">Value (JSON or text)</Label>
                          <Textarea
                            id="setting-value"
                            value={settingsForm.value}
                            onChange={(e) => setSettingsForm({ ...settingsForm, value: e.target.value })}
                            placeholder='{"message": "Welcome to the dashboard!"} or simple text'
                            rows={4}
                          />
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleUpdateSetting} disabled={updateSettingMutation.isPending}>
                            {updateSettingMutation.isPending ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {!allSettings?.settings || Object.keys(allSettings.settings).length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No settings configured yet. Click "Add Setting" to get started.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Key</TableHead>
                            <TableHead>Value</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(allSettings.settings).map(([key, value]) => (
                            <TableRow key={key}>
                              <TableCell className="font-medium">{key}</TableCell>
                              <TableCell>
                                <div className="max-w-xs truncate">
                                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {typeof value}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSettingsForm({
                                      key,
                                      value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
                                    });
                                    setShowSettingsDialog(true);
                                  }}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Inline Edit Dialogs */}
      {isEditing?.type === 'bookmark' && (
        <Dialog open={true} onOpenChange={cancelEditing}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Bookmark</DialogTitle>
              <DialogDescription>
                Update the bookmark information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={bookmarkForm.title}
                  onChange={(e) => setBookmarkForm({ ...bookmarkForm, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={bookmarkForm.description}
                  onChange={(e) => setBookmarkForm({ ...bookmarkForm, description: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-url">URL</Label>
                <Input
                  id="edit-url"
                  type="url"
                  value={bookmarkForm.url}
                  onChange={(e) => setBookmarkForm({ ...bookmarkForm, url: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-icon">Icon</Label>
                <Input
                  id="edit-icon"
                  value={bookmarkForm.icon}
                  onChange={(e) => setBookmarkForm({ ...bookmarkForm, icon: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-category">Category</Label>
                <Select value={bookmarkForm.category} onValueChange={(value) => setBookmarkForm({ ...bookmarkForm, category: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="resources">Resources</SelectItem>
                    <SelectItem value="tools">Tools</SelectItem>
                    <SelectItem value="communication">Communication</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-active"
                  checked={bookmarkForm.isActive}
                  onCheckedChange={(checked) => setBookmarkForm({ ...bookmarkForm, isActive: checked })}
                />
                <Label htmlFor="edit-active">Active</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={cancelEditing}>
                  Cancel
                </Button>
                <Button onClick={() => handleUpdateBookmark(isEditing.id!)} disabled={updateBookmarkMutation.isPending}>
                  {updateBookmarkMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isEditing?.type === 'announcement' && (
        <Dialog open={true} onOpenChange={cancelEditing}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Announcement</DialogTitle>
              <DialogDescription>
                Update the announcement information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-announcement-title">Title</Label>
                <Input
                  id="edit-announcement-title"
                  value={announcementForm.title}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-announcement-content">Content</Label>
                <Textarea
                  id="edit-announcement-content"
                  value={announcementForm.content}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-announcement-type">Type</Label>
                  <Select value={announcementForm.type} onValueChange={(value: any) => setAnnouncementForm({ ...announcementForm, type: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="edit-announcement-priority">Priority</Label>
                  <Input
                    id="edit-announcement-priority"
                    type="number"
                    value={announcementForm.priority}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, priority: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-announcement-expires">Expires At</Label>
                <Input
                  id="edit-announcement-expires"
                  type="datetime-local"
                  value={announcementForm.expiresAt}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, expiresAt: e.target.value })}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-announcement-active"
                  checked={announcementForm.isActive}
                  onCheckedChange={(checked) => setAnnouncementForm({ ...announcementForm, isActive: checked })}
                />
                <Label htmlFor="edit-announcement-active">Active</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={cancelEditing}>
                  Cancel
                </Button>
                <Button onClick={() => handleUpdateAnnouncement(isEditing.id!)} disabled={updateAnnouncementMutation.isPending}>
                  {updateAnnouncementMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
} 