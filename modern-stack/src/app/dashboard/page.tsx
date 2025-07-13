'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Users, 
  Settings, 
  MessageSquare, 
  ExternalLink, 
  Phone, 
  Mail, 
  Lock, 
  User,
  Hash,
  Copy,
  CheckCircle,
  AlertCircle,
  Shield,
  BarChart3,
  UserPlus
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { toast } from 'sonner';

interface MatrixRoom {
  room_id: string;
  name: string;
  topic?: string;
  member_count: number;
  category?: string;
  configured?: boolean;
}

interface CommunityLink {
  name: string;
  url: string;
  description: string;
  icon: string;
}

export default function UserDashboard() {
  const { data: session } = useSession();
  
  // Set default tab based on user role
  const getDefaultTab = () => {
    if (!session?.user) return 'links';
    if (session.user.isAdmin) return 'admin';
    if (session.user.isModerator) return 'moderation';
    return 'links'; // Regular users land on quick links
  };
  
  const [selectedTab, setSelectedTab] = useState(getDefaultTab());
  const [messageToAdmin, setMessageToAdmin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [verificationHash, setVerificationHash] = useState('');
  const [pendingVerification, setPendingVerification] = useState<'phone' | 'email' | null>(null);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  
  // Quicklinks admin editing state
  const [isEditingQuicklinks, setIsEditingQuicklinks] = useState(false);
  const [quicklinkForm, setQuicklinkForm] = useState({
    title: '',
    url: '',
    description: '',
    icon: '🔗',
  });
  
  // Get available Matrix rooms
  const { data: matrixRooms, isLoading: roomsLoading } = trpc.matrix.getRooms.useQuery({});
  
  // Get user profile data
  const { data: userProfile, refetch: refetchProfile } = trpc.user.getProfile.useQuery();

  // Get dashboard settings
  const { data: dashboardSettings } = trpc.settings.getDashboardSettings.useQuery({});
  
  // Invitation form state
  const [inviteForm, setInviteForm] = useState({
    inviteeEmail: '',
    inviteeName: '',
    inviteePhone: '',
    roomIds: [] as string[],
    message: '',
    expiryDays: 1, // Default fallback
  });

  // Update invite form when dashboard settings load
  useEffect(() => {
    const defaultInviteExpiry = (dashboardSettings as any)?.default_invite_expiry_days || 1;
    setInviteForm(prev => ({ ...prev, expiryDays: defaultInviteExpiry }));
  }, [dashboardSettings]);

  // Update selected tab when session changes (for role-based navigation)
  useEffect(() => {
    if (session?.user) {
      setSelectedTab(getDefaultTab());
    }
  }, [session?.user?.isAdmin, session?.user?.isModerator]);
  
  // Get community bookmarks
  const { data: communityBookmarks } = trpc.settings.getCommunityBookmarks.useQuery({
    isActive: true,
  });

  // Get dashboard announcements
  const { data: dashboardAnnouncements } = trpc.settings.getDashboardAnnouncements.useQuery({
    isActive: true,
  });

  // Get user's sent invitations
  const { data: myInvitations } = trpc.user.getMyInvitations.useQuery({
    page: 1,
    limit: 5,
  });

  // Mutations
  const sendAdminMessageMutation = trpc.user.sendAdminMessage.useMutation({
    onSuccess: (result) => {
      toast.success(result.message || 'Message sent to admin successfully!');
      setMessageToAdmin('');
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const changePasswordMutation = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      toast.success('Password changed successfully!');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error) => {
      toast.error(`Failed to change password: ${error.message}`);
    },
  });

  const requestPhoneVerificationMutation = trpc.user.requestPhoneVerification.useMutation({
    onSuccess: () => {
      toast.success('Verification code sent! Check your Matrix messages for the hash.');
      setPendingVerification('phone');
    },
    onError: (error) => {
      toast.error(`Failed to send verification: ${error.message}`);
    },
  });

  const verifyPhoneMutation = trpc.user.verifyPhone.useMutation({
    onSuccess: () => {
      toast.success('Phone number verified and updated!');
      setNewPhone('');
      setVerificationHash('');
      setPendingVerification(null);
      refetchProfile();
    },
    onError: (error) => {
      toast.error(`Verification failed: ${error.message}`);
    },
  });

  const updateEmailMutation = trpc.user.updateEmail.useMutation({
    onSuccess: () => {
      toast.success('Email updated successfully!');
      setNewEmail('');
      refetchProfile();
    },
    onError: (error) => {
      toast.error(`Failed to update email: ${error.message}`);
    },
  });

  const createInvitationMutation = trpc.user.createUserInvitation.useMutation({
    onSuccess: () => {
      toast.success('Invitation sent successfully!');
      setInviteForm({
        inviteeEmail: '',
        inviteeName: '',
        inviteePhone: '',
        roomIds: [],
        message: '',
        expiryDays: (dashboardSettings as any)?.default_invite_expiry_days || 1,
      });
      // Refetch invitations to update the list
      if (myInvitations) {
        // This would trigger a refetch in a real implementation
      }
    },
    onError: (error) => {
      toast.error(`Failed to send invitation: ${error.message}`);
    },
  });

  // Community quick links (these would ideally come from environment variables)
  const communityLinks: CommunityLink[] = [
    {
      name: 'Community Forum',
      url: 'https://forum.irregularchat.com',
      description: 'Join discussions and find announcements',
      icon: '📋'
    },
    {
      name: 'Wiki (Irregularpedia)',
      url: 'https://irregularpedia.org',
      description: 'Community knowledge base and documentation',
      icon: '📚'
    },
    {
      name: 'Community Calendar',
      url: 'https://event.irregularchat.com',
      description: 'Upcoming events and activities',
      icon: '📅'
    },
    {
      name: 'Signal Admin Group',
      url: 'https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve',
      description: 'Get help from administrators',
      icon: '🆘'
    },
                {
              name: 'Welcome Guide',
              url: 'https://forum.irregularchat.com/t/84',
              description: 'Essential information for new members',
              icon: '🌟'
            },
            {
              name: 'Community Timeline',
              url: '/community',
              description: 'View recent community events and activities',
              icon: '🏘️'
            }
  ];

  const copyToClipboard = async (text: string, itemName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems(prev => new Set(prev).add(itemName));
      toast.success(`${itemName} copied to clipboard`);
      
      // Remove the copied indicator after 2 seconds
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev);
          newSet.delete(itemName);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      toast.error(`Failed to copy ${itemName}`);
    }
  };

  const handlePasswordChange = () => {
    if (!newPassword || !confirmPassword) {
      toast.error('Please fill in both password fields');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }

    changePasswordMutation.mutate({
      newPassword,
      confirmPassword
    });
  };

  const handlePhoneVerification = () => {
    if (!newPhone) {
      toast.error('Please enter a phone number');
      return;
    }

    requestPhoneVerificationMutation.mutate({
      phoneNumber: newPhone
    });
  };

  const handleVerifyHash = () => {
    if (!verificationHash) {
      toast.error('Please enter the verification hash');
      return;
    }

    verifyPhoneMutation.mutate({
      phoneNumber: newPhone,
      verificationHash
    });
  };

  const handleSendAdminMessage = () => {
    if (!messageToAdmin.trim()) {
      toast.error('Please enter a message');
      return;
    }

    sendAdminMessageMutation.mutate({
      message: messageToAdmin,
      subject: 'User Dashboard Message'
    });
  };

  const handleSendInvitation = () => {
    if (!inviteForm.inviteeEmail || !inviteForm.inviteeName) {
      toast.error('Please fill in email and name fields');
      return;
    }

    createInvitationMutation.mutate({
      inviteeEmail: inviteForm.inviteeEmail,
      inviteeName: inviteForm.inviteeName,
      inviteePhone: inviteForm.inviteePhone || undefined,
      roomIds: inviteForm.roomIds,
      message: inviteForm.message || undefined,
      expiryDays: Math.min(Math.max(inviteForm.expiryDays, 1), 3), // Enforce 1-3 days
    });
  };

  const getRoomsByCategory = (category: string) => {
    if (!matrixRooms) return [];
    return matrixRooms.filter(room => 
      room.category?.toLowerCase().includes(category.toLowerCase()) ||
      room.topic?.toLowerCase().includes(category.toLowerCase())
    );
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access your dashboard</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Community Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.user.name || session.user.username}!
          </p>
        </div>
        <div className="flex gap-2">
          {session.user.isAdmin && (
            <Badge 
              variant="default" 
              className="px-3 py-1 bg-red-600 hover:bg-red-700 cursor-pointer transition-colors"
              onClick={() => setSelectedTab('account')}
            >
              <User className="w-4 h-4 mr-2" />
              Administrator
            </Badge>
          )}
          {session.user.isModerator && !session.user.isAdmin && (
            <Badge 
              variant="default" 
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors"
              onClick={() => setSelectedTab('account')}
            >
              <User className="w-4 h-4 mr-2" />
              Moderator
            </Badge>
          )}
          {!session.user.isAdmin && !session.user.isModerator && (
            <Badge 
              variant="outline" 
              className="px-3 py-1 hover:bg-muted cursor-pointer transition-colors"
              onClick={() => setSelectedTab('account')}
            >
              <User className="w-4 h-4 mr-2" />
              Member
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className={`grid w-full ${session.user.isAdmin || session.user.isModerator ? 'grid-cols-7' : 'grid-cols-5'}`}>
          {/* Admin gets Admin tab first */}
          {session.user.isAdmin && (
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Admin
            </TabsTrigger>
          )}
          {/* Moderators get Moderation tab first (after Admin if admin) */}
          {(session.user.isModerator || session.user.isAdmin) && (
            <TabsTrigger value="moderation" className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Moderation
            </TabsTrigger>
          )}
          {/* Quick Links comes first for regular users, earlier for admin/mods */}
          <TabsTrigger value="links" className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Quick Links
          </TabsTrigger>
          <TabsTrigger value="rooms" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Rooms
          </TabsTrigger>
          <TabsTrigger value="account" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="invite" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Invite Friends
          </TabsTrigger>
          <TabsTrigger value="contact" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Contact
          </TabsTrigger>
        </TabsList>

        {/* Matrix Rooms Tab */}
        <TabsContent value="rooms">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Available Community Rooms
              </CardTitle>
              <CardDescription>
                Join Matrix rooms based on your interests and expertise
              </CardDescription>
            </CardHeader>
            <CardContent>
              {roomsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : matrixRooms && matrixRooms.length > 0 ? (
                <div className="space-y-6">
                  {/* Tech Rooms */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      💻 Technology & Development
                    </h3>
                    <div className="grid gap-3">
                      {getRoomsByCategory('tech').map((room) => (
                        <div key={room.room_id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{room.name}</h4>
                              <Badge variant="secondary" className="text-xs">
                                {room.member_count} members
                              </Badge>
                            </div>
                            {room.topic && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {room.topic}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(room.room_id, `${room.name} Room ID`)}
                            >
                              {copiedItems.has(`${room.name} Room ID`) ? (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* General Rooms */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      💬 General Discussion
                    </h3>
                    <div className="grid gap-3">
                      {getRoomsByCategory('general').map((room) => (
                        <div key={room.room_id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{room.name}</h4>
                              <Badge variant="secondary" className="text-xs">
                                {room.member_count} members
                              </Badge>
                            </div>
                            {room.topic && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {room.topic}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(room.room_id, `${room.name} Room ID`)}
                            >
                              {copiedItems.has(`${room.name} Room ID`) ? (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* All Other Rooms */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      🏠 All Rooms
                    </h3>
                    <div className="grid gap-3">
                      {matrixRooms.map((room) => (
                        <div key={room.room_id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{room.name}</h4>
                              <Badge variant="secondary" className="text-xs">
                                {room.member_count} members
                              </Badge>
                              {room.category && (
                                <Badge variant="outline" className="text-xs">
                                  {room.category}
                                </Badge>
                              )}
                            </div>
                            {room.topic && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {room.topic}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(room.room_id, `${room.name} Room ID`)}
                            >
                              {copiedItems.has(`${room.name} Room ID`) ? (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No rooms available at the moment</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account Management Tab */}
        <TabsContent value="account">
          <div className="grid gap-6">
            {/* Change Password */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Change Password
                </CardTitle>
                <CardDescription>
                  Update your password to keep your account secure
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>
                <Button 
                  onClick={handlePasswordChange}
                  disabled={changePasswordMutation.isPending}
                  className="w-full"
                >
                  {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
                </Button>
              </CardContent>
            </Card>

            {/* Update Phone Number */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  Update Phone Number
                </CardTitle>
                <CardDescription>
                  Change your phone number with bot verification
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!pendingVerification ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="new-phone">New Phone Number</Label>
                      <Input
                        id="new-phone"
                        type="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder="+1234567890"
                      />
                      <p className="text-sm text-muted-foreground">
                        Include country code. A verification code will be sent via Matrix bot.
                      </p>
                    </div>
                    <Button 
                      onClick={handlePhoneVerification}
                      disabled={requestPhoneVerificationMutation.isPending}
                      className="w-full"
                    >
                      {requestPhoneVerificationMutation.isPending ? 'Sending...' : 'Send Verification Code'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-blue-900">Verification Required</span>
                      </div>
                      <p className="text-sm text-blue-800">
                        Check your Matrix messages for a verification hash from the bot. 
                        Copy and paste it below to verify your phone number.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verification-hash">Verification Hash</Label>
                      <Input
                        id="verification-hash"
                        type="text"
                        value={verificationHash}
                        onChange={(e) => setVerificationHash(e.target.value)}
                        placeholder="Paste verification hash here"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleVerifyHash}
                        disabled={verifyPhoneMutation.isPending}
                        className="flex-1"
                      >
                        {verifyPhoneMutation.isPending ? 'Verifying...' : 'Verify & Update'}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setPendingVerification(null);
                          setVerificationHash('');
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Update Email */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Update Email Address
                </CardTitle>
                <CardDescription>
                  Change your email address for account recovery
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-email">New Email Address</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="your.email@example.com"
                  />
                  <p className="text-sm text-muted-foreground">
                    Current: {userProfile?.email || 'Not set'}
                  </p>
                </div>
                <Button 
                  onClick={() => updateEmailMutation.mutate({ email: newEmail })}
                  disabled={updateEmailMutation.isPending || !newEmail}
                  className="w-full"
                >
                  {updateEmailMutation.isPending ? 'Updating...' : 'Update Email'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Invite Friends Tab */}
        <TabsContent value="invite">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5" />
                  Invite a Friend
                </CardTitle>
                <CardDescription>
                  Send a personalized invitation to join the community
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invitee-name">Friend's Name</Label>
                  <Input
                    id="invitee-name"
                    type="text"
                    value={inviteForm.inviteeName}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, inviteeName: e.target.value }))}
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invitee-email">Friend's Email</Label>
                  <Input
                    id="invitee-email"
                    type="email"
                    value={inviteForm.inviteeEmail}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, inviteeEmail: e.target.value }))}
                    placeholder="friend@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invitee-phone">Friend's Phone Number (Optional)</Label>
                  <Input
                    id="invitee-phone"
                    type="tel"
                    value={inviteForm.inviteePhone}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, inviteePhone: e.target.value }))}
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Matrix Rooms to Add Friend To (Optional)</Label>
                  <div className="border rounded-md p-3 max-h-32 overflow-y-auto">
                    {roomsLoading ? (
                      <p className="text-sm text-muted-foreground">Loading rooms...</p>
                    ) : matrixRooms && matrixRooms.length > 0 ? (
                      <div className="space-y-2">
                        {matrixRooms.map((room: MatrixRoom) => (
                          <div key={room.room_id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`room-${room.room_id}`}
                              checked={inviteForm.roomIds.includes(room.room_id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setInviteForm(prev => ({ 
                                    ...prev, 
                                    roomIds: [...prev.roomIds, room.room_id] 
                                  }));
                                } else {
                                  setInviteForm(prev => ({ 
                                    ...prev, 
                                    roomIds: prev.roomIds.filter(id => id !== room.room_id) 
                                  }));
                                }
                              }}
                            />
                            <Label 
                              htmlFor={`room-${room.room_id}`} 
                              className="text-sm font-normal cursor-pointer"
                            >
                              {room.name} ({room.member_count} members)
                            </Label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No rooms available</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select which Matrix rooms your friend should be automatically added to when they accept the invitation.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-message">Personal Message (Optional)</Label>
                  <Textarea
                    id="invite-message"
                    value={inviteForm.message}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, message: e.target.value }))}
                    placeholder="Add a personal note to your invitation..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invitation Expires In</Label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((days) => (
                      <Button
                        key={days}
                        type="button"
                        variant={inviteForm.expiryDays === days ? "default" : "outline"}
                        size="sm"
                        onClick={() => setInviteForm(prev => ({ ...prev, expiryDays: days }))}
                      >
                        {days} day{days > 1 ? 's' : ''}
                      </Button>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select how long the invitation link remains valid
                  </p>
                </div>
                <Button 
                  onClick={handleSendInvitation}
                  disabled={createInvitationMutation.isPending || !inviteForm.inviteeEmail || !inviteForm.inviteeName}
                  className="w-full"
                >
                  {createInvitationMutation.isPending ? 'Sending Invitation...' : 'Send Invitation'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Need Multiple Invites?
                </CardTitle>
                <CardDescription>
                  For bulk invitations or special invite links
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  If you need to invite multiple people or create special invite links for events, 
                  please contact our moderation team who can help you with bulk invitations.
                </p>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setSelectedTab('contact')}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Request Bulk Invites from Moderators
                </Button>
              </CardContent>
            </Card>

            {/* Recent Invitations */}
            {myInvitations && myInvitations.invitations && myInvitations.invitations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    Your Recent Invitations
                  </CardTitle>
                  <CardDescription>
                    Invitations you've sent recently
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {myInvitations.invitations.slice(0, 3).map((invitation: any) => (
                      <div key={invitation.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{invitation.inviteeName || invitation.email}</p>
                          <p className="text-sm text-muted-foreground">{invitation.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Sent {new Date(invitation.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={invitation.status === 'accepted' ? 'default' : 
                                   invitation.status === 'expired' ? 'destructive' : 'secondary'}
                          >
                            {invitation.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  {myInvitations.total > 3 && (
                    <div className="mt-4 text-center">
                      <Button variant="outline" size="sm" asChild>
                        <a href="/users/invitations">View All Invitations</a>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Contact Admin Tab */}
        <TabsContent value="contact">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Message Admin Team
              </CardTitle>
              <CardDescription>
                Send a message to the community administrators
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-message">Your Message</Label>
                <Textarea
                  id="admin-message"
                  value={messageToAdmin}
                  onChange={(e) => setMessageToAdmin(e.target.value)}
                  placeholder="Type your message to the admin team here..."
                  rows={6}
                />
              </div>
              <Button 
                onClick={handleSendAdminMessage}
                disabled={sendAdminMessageMutation.isPending || !messageToAdmin.trim()}
                className="w-full"
              >
                {sendAdminMessageMutation.isPending ? 'Sending...' : 'Send Message'}
              </Button>
              
              <Separator />
              
              <div className="space-y-3">
                <h4 className="font-medium">Other Ways to Contact</h4>
                <div className="grid gap-2">
                  <Button variant="outline" className="justify-start" asChild>
                    <a 
                      href="https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      🆘 Signal Admin Group
                    </a>
                  </Button>
                  <Button variant="outline" className="justify-start" asChild>
                    <a 
                      href="https://forum.irregularchat.com" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      📋 Community Forum
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quick Links Tab */}
        <TabsContent value="links">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="w-5 h-5" />
                    Community Quick Links
                  </CardTitle>
                  <CardDescription>
                    Essential community resources and platforms
                  </CardDescription>
                </div>
                {session.user.isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingQuicklinks(!isEditingQuicklinks)}
                  >
                    {isEditingQuicklinks ? 'Done Editing' : 'Edit Links'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Admin Quick Link Add Form */}
              {session.user.isAdmin && isEditingQuicklinks && (
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="text-lg">Add New Quick Link</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="quicklink-title">Title</Label>
                        <Input
                          id="quicklink-title"
                          value={quicklinkForm.title}
                          onChange={(e) => setQuicklinkForm(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="Link Title"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="quicklink-icon">Icon (Emoji)</Label>
                        <Input
                          id="quicklink-icon"
                          value={quicklinkForm.icon}
                          onChange={(e) => setQuicklinkForm(prev => ({ ...prev, icon: e.target.value }))}
                          placeholder="🔗"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quicklink-url">URL</Label>
                      <Input
                        id="quicklink-url"
                        value={quicklinkForm.url}
                        onChange={(e) => setQuicklinkForm(prev => ({ ...prev, url: e.target.value }))}
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quicklink-description">Description</Label>
                      <Textarea
                        id="quicklink-description"
                        value={quicklinkForm.description}
                        onChange={(e) => setQuicklinkForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Brief description of this link"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          // TODO: Implement add quicklink mutation
                          console.log('Adding quicklink:', quicklinkForm);
                          setQuicklinkForm({ title: '', url: '', description: '', icon: '🔗' });
                        }}
                        disabled={!quicklinkForm.title || !quicklinkForm.url}
                      >
                        Add Link
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setQuicklinkForm({ title: '', url: '', description: '', icon: '🔗' })}
                      >
                        Clear
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {/* Database-managed community bookmarks */}
                {communityBookmarks && communityBookmarks.length > 0 ? (
                  communityBookmarks.map((bookmark: any) => (
                    <div key={bookmark.id} className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors relative">
                      <div className="text-2xl">{bookmark.icon || '🔗'}</div>
                      <div className="flex-1">
                        <h4 className="font-medium">{bookmark.title}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{bookmark.description}</p>
                        <div className="flex gap-2 mt-3">
                          <Button variant="outline" size="sm" asChild>
                            <a href={bookmark.url} target="_blank" rel="noopener noreferrer">
                              Visit <ExternalLink className="w-3 h-3 ml-1" />
                            </a>
                          </Button>
                          {session.user.isAdmin && isEditingQuicklinks && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  // TODO: Implement edit functionality
                                  setQuicklinkForm({
                                    title: bookmark.title,
                                    url: bookmark.url,
                                    description: bookmark.description,
                                    icon: bookmark.icon || '🔗',
                                  });
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  // TODO: Implement delete functionality
                                  console.log('Deleting bookmark:', bookmark.id);
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  /* Fallback to hardcoded links if no bookmarks are configured */
                  communityLinks.map((link) => (
                    <div key={link.name} className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="text-2xl">{link.icon}</div>
                      <div className="flex-1">
                        <h4 className="font-medium">{link.name}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{link.description}</p>
                        <Button variant="outline" size="sm" className="mt-3" asChild>
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            Visit <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Moderation Tab */}
        {(session.user.isModerator || session.user.isAdmin) && (
          <TabsContent value="moderation">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Moderation Tools
                  </CardTitle>
                  <CardDescription>
                    Quick access to moderation and user management features
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/users'}
                    >
                      <div className="text-2xl">👥</div>
                      <div className="text-center">
                        <div className="font-medium">User Management</div>
                        <div className="text-sm text-muted-foreground">
                          Manage community members
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/users/invitations'}
                    >
                      <div className="text-2xl">📧</div>
                      <div className="text-center">
                        <div className="font-medium">Invitations</div>
                        <div className="text-sm text-muted-foreground">
                          Manage user invitations
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/matrix'}
                    >
                      <div className="text-2xl">🔗</div>
                      <div className="text-center">
                        <div className="font-medium">Matrix Integration</div>
                        <div className="text-sm text-muted-foreground">
                          Room & messaging management
                        </div>
                      </div>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Admin Tab */}
        {session.user.isAdmin && (
          <TabsContent value="admin">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Admin Dashboard
                  </CardTitle>
                  <CardDescription>
                    System administration and analytics
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/admin'}
                    >
                      <div className="text-2xl">📊</div>
                      <div className="text-center">
                        <div className="font-medium">Analytics Dashboard</div>
                        <div className="text-sm text-muted-foreground">
                          System metrics & reports
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/users'}
                    >
                      <div className="text-2xl">👥</div>
                      <div className="text-center">
                        <div className="font-medium">User Management</div>
                        <div className="text-sm text-muted-foreground">
                          Manage all users & permissions
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.open('/users/create?returnTo=dashboard&tab=admin', '_blank')}
                    >
                      <div className="text-2xl">👤</div>
                      <div className="text-center">
                        <div className="font-medium">Add User</div>
                        <div className="text-sm text-muted-foreground">
                          Create new community members
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/users/invitations'}
                    >
                      <div className="text-2xl">📧</div>
                      <div className="text-center">
                        <div className="font-medium">Invitation Manager</div>
                        <div className="text-sm text-muted-foreground">
                          Track & manage invitations
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/matrix'}
                    >
                      <div className="text-2xl">🔗</div>
                      <div className="text-center">
                        <div className="font-medium">Matrix Integration</div>
                        <div className="text-sm text-muted-foreground">
                          Room & messaging management
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-center gap-2"
                      onClick={() => window.location.href = '/admin/settings'}
                    >
                      <div className="text-2xl">⚙️</div>
                      <div className="text-center">
                        <div className="font-medium">System Settings</div>
                        <div className="text-sm text-muted-foreground">
                          Configure dashboard settings
                        </div>
                      </div>
                    </Button>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Room Management</CardTitle>
                  <CardDescription>
                    Manage Matrix rooms and settings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Add new room form */}
                    <div className="border rounded-lg p-4">
                      <h4 className="font-medium mb-3">Create New Room</h4>
                      <div className="grid gap-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Input placeholder="Room name" />
                          <Input placeholder="Room alias (optional)" />
                        </div>
                        <Textarea placeholder="Room description" rows={2} />
                        <div className="flex gap-2">
                          <Button size="sm">Create Room</Button>
                          <Button size="sm" variant="outline">Cancel</Button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Existing rooms list */}
                    <div className="space-y-3">
                      <h4 className="font-medium">Existing Rooms</h4>
                      {matrixRooms && matrixRooms.length > 0 ? (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {matrixRooms.slice(0, 5).map((room: MatrixRoom) => (
                            <div key={room.room_id} className="flex items-center justify-between p-3 border rounded-md">
                              <div>
                                <div className="font-medium">{room.name}</div>
                                <div className="text-sm text-muted-foreground">
                                  {room.member_count} members • {room.category || 'General'}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline">Edit</Button>
                                <Button size="sm" variant="outline">Settings</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No rooms available</p>
                      )}
                      <Button variant="outline" size="sm" className="w-full">
                        View All Rooms
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Quick Admin Actions</CardTitle>
                  <CardDescription>
                    Frequently used administrative tasks
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3">
                    <Button variant="outline" className="justify-start" asChild>
                      <a href="/community" className="flex items-center gap-2">
                        🏘️ Community Timeline
                        <span className="text-sm text-muted-foreground ml-auto">View recent events</span>
                      </a>
                    </Button>
                    <Button variant="outline" className="justify-start" asChild>
                      <a href="/invites" className="flex items-center gap-2">
                        🎫 Invite Management
                        <span className="text-sm text-muted-foreground ml-auto">Create & manage invites</span>
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
} 