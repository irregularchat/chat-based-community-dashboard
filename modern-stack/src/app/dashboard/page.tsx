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
  AlertCircle
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
  const [selectedTab, setSelectedTab] = useState('rooms');
  const [messageToAdmin, setMessageToAdmin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [verificationHash, setVerificationHash] = useState('');
  const [pendingVerification, setPendingVerification] = useState<'phone' | 'email' | null>(null);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  
  // Invitation form state
  const [inviteForm, setInviteForm] = useState({
    inviteeEmail: '',
    inviteeName: '',
    message: '',
    expiryDays: 7,
  });

  // Get available Matrix rooms
  const { data: matrixRooms, isLoading: roomsLoading } = trpc.matrix.getRooms.useQuery({});
  
  // Get user profile data
  const { data: userProfile, refetch: refetchProfile } = trpc.user.getProfile.useQuery();

  // Get dashboard settings
  const { data: dashboardSettings } = trpc.settings.getDashboardSettings.useQuery({});
  
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
    onSuccess: () => {
      toast.success('Message sent to admin successfully!');
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
        message: '',
        expiryDays: 7,
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
      message: inviteForm.message || undefined,
      expiryDays: inviteForm.expiryDays,
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
        <Badge variant="outline" className="px-3 py-1">
          <User className="w-4 h-4 mr-2" />
          Member
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
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
          <TabsTrigger value="links" className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Quick Links
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
              <CardTitle className="flex items-center gap-2">
                <ExternalLink className="w-5 h-5" />
                Community Quick Links
              </CardTitle>
              <CardDescription>
                Essential community resources and platforms
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {communityLinks.map((link) => (
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
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 