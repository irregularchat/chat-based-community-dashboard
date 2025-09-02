'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Users, 
  Settings, 
  MessageSquare, 
  ExternalLink, 
  Phone, 
  Mail, 
  Lock, 
  Copy,
  CheckCircle,
  AlertCircle,
  Shield,
  BarChart3,
  UserPlus
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';


interface CommunityLink {
  name: string;
  url: string;
  description: string;
  icon: string;
}

export default function UserDashboard() {
  const { data: session } = useSession();
  const router = useRouter();
  
  // Set default tab based on user role
  const getDefaultTab = useCallback(() => {
    if (!session?.user) return 'links';
    if (session.user.isAdmin) return 'admin';
    if (session.user.isModerator) return 'moderation';
    return 'links'; // Regular users land on quick links
  }, [session?.user]);
  
  const [selectedTab, setSelectedTab] = useState(getDefaultTab());
  const [messageToAdmin, setMessageToAdmin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [verificationHash, setVerificationHash] = useState('');
  const [pendingVerification, setPendingVerification] = useState<'phone' | 'email' | null>(null);
  const [emailVerificationData, setEmailVerificationData] = useState<{email: string; fromEmail: string} | null>(null);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  
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
  
  // Get Signal Groups status
  const { data: signalStatus, refetch: refetchSignalStatus } = trpc.user.getSignalStatus.useQuery();

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
    const defaultInviteExpiry = (dashboardSettings as { default_invite_expiry_days?: number })?.default_invite_expiry_days || 1;
    setInviteForm(prev => ({ ...prev, expiryDays: defaultInviteExpiry }));
  }, [dashboardSettings]);

  // Update selected tab when session changes (for role-based navigation)
  useEffect(() => {
    if (session?.user) {
      setSelectedTab(getDefaultTab());
    }
  }, [session?.user?.isAdmin, session?.user?.isModerator, getDefaultTab, session?.user]);
  
  // Get community bookmarks
  const { data: communityBookmarks } = trpc.settings.getCommunityBookmarks.useQuery({
    isActive: true,
  });

  // Get dashboard announcements

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
    onSuccess: (data) => {
      toast.success(data.message || 'Signal verification code sent!');
      setPendingVerification('phone');
    },
    onError: (error) => {
      let errorMessage = error.message;
      let showSignalGroupOption = false;
      
      // Provide more helpful error messages
      if (error.message.includes('Failed to resolve phone number')) {
        errorMessage = 'Phone number not found on Signal. Your number must be registered with Signal Messenger to receive verification codes.';
        showSignalGroupOption = true;
      } else if (error.message.includes('Matrix service not configured')) {
        errorMessage = 'Messaging service not configured. Please contact an administrator.';
      } else if (error.message.includes('MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured')) {
        errorMessage = 'Signal bridge not configured. Please contact an administrator.';
      } else if (error.message.includes('Invalid phone number format')) {
        errorMessage = 'Invalid phone number format. Please include country code (e.g., +1 for US).';
      } else if (error.message.includes('Unsupported phone number format')) {
        errorMessage = 'Invalid phone number format. Please use a valid phone number with country code.';
      }
      
      // Show the error with additional guidance
      toast.error(errorMessage);
      
      // Show additional guidance for Signal-related errors
      if (showSignalGroupOption) {
        setTimeout(() => {
          toast.info('💡 Don\'t have Signal? Join our Signal INDOC group to request manual verification from a moderator.', {
            duration: 8000,
          });
        }, 2000);
      }
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
      let errorMessage = error.message;
      if (error.message.includes('Verification code expired')) {
        errorMessage = 'Verification code has expired. Please request a new one.';
      } else if (error.message.includes('Invalid verification code')) {
        errorMessage = 'Invalid verification code. Please check your Signal or Matrix messages.';
      }
      toast.error(errorMessage);
    },
  });

  const requestEmailVerificationMutation = trpc.user.requestEmailVerification.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || 'Email verification code sent!');
      setPendingVerification('email');
      setEmailVerificationData({
        email: data.email,
        fromEmail: data.fromEmail,
      });
    },
    onError: (error) => {
      let errorMessage = error.message;
      
      // Provide more helpful error messages
      if (error.message.includes('Email service is not configured')) {
        errorMessage = 'Email service not configured. Please contact an administrator.';
      } else if (error.message.includes('already in use')) {
        errorMessage = 'This email address is already in use by another account. Please use a different email.';
      } else if (error.message.includes('Failed to send verification email')) {
        errorMessage = 'Failed to send verification email. Please check your email address and try again.';
      }
      
      toast.error(errorMessage);
    },
  });

  const joinSignalGroupMutation = trpc.user.requestToJoinSignalGroup.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchSignalStatus();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const verifyEmailMutation = trpc.user.verifyEmail.useMutation({
    onSuccess: () => {
      toast.success('Email address verified and updated!');
      setNewEmail('');
      setVerificationHash('');
      setPendingVerification(null);
      setEmailVerificationData(null);
      refetchProfile();
    },
    onError: (error) => {
      let errorMessage = error.message;
      if (error.message.includes('Verification code expired')) {
        errorMessage = 'Verification code has expired. Please request a new one.';
      } else if (error.message.includes('Invalid verification code')) {
        errorMessage = 'Invalid verification code. Please check your email and try again.';
      } else if (error.message.includes('already in use')) {
        errorMessage = 'This email address is now in use by another account. Please use a different email.';
      }
      toast.error(errorMessage);
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
        expiryDays: (dashboardSettings as { default_invite_expiry_days?: number })?.default_invite_expiry_days || 1,
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

  const joinRoomsMutation = trpc.user.requestRoomJoin.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setSelectedRooms(new Set());
    },
    onError: (error) => {
      if (error.message === 'SIGNAL_VERIFICATION_REQUIRED') {
        toast.error('Signal verification required to join rooms');
        // Show a toast with redirect option
        setTimeout(() => {
          toast.info('Click here to verify your Signal account', {
            action: {
              label: 'Verify Signal',
              onClick: () => setSelectedTab('account')
            },
            duration: 8000,
          });
        }, 1000);
      } else {
        toast.error(`Failed to join rooms: ${error.message}`);
      }
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
    } catch {
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

  const handlePhoneVerification = async () => {
    if (!newPhone) {
      toast.error('Please enter a phone number');
      return;
    }

    // Import phone utilities for client-side validation
    const { normalizePhoneNumber } = await import('../../lib/phone-utils');
    const normalized = normalizePhoneNumber(newPhone);
    
    if (!normalized.isValid && normalized.error) {
      toast.error(normalized.error);
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

    if (pendingVerification === 'phone') {
      verifyPhoneMutation.mutate({
        phoneNumber: newPhone,
        verificationHash
      });
    } else if (pendingVerification === 'email') {
      verifyEmailMutation.mutate({
        email: newEmail,
        verificationCode: verificationHash
      });
    }
  };

  const handleEmailVerification = () => {
    if (!newEmail) {
      toast.error('Please enter an email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    requestEmailVerificationMutation.mutate({
      email: newEmail
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

  const handleRoomSelection = (roomId: string) => {
    setSelectedRooms(prev => {
      const newSet = new Set(prev);
      if (newSet.has(roomId)) {
        newSet.delete(roomId);
      } else {
        newSet.add(roomId);
      }
      return newSet;
    });
  };

  const handleJoinSelectedRooms = () => {
    if (selectedRooms.size === 0) {
      toast.error('Please select at least one room to join');
      return;
    }

    joinRoomsMutation.mutate({
      roomIds: Array.from(selectedRooms),
    });
  };

  const checkSignalVerification = () => {
    const userAttributes = userProfile?.attributes as Record<string, unknown> || {};
    const phoneNumber = userAttributes.phoneNumber as string;
    const hasSignalVerification = !!userProfile?.signalIdentity || !!phoneNumber;
    return hasSignalVerification;
  };

  const getRoomsByCategory = (category: string) => {
    if (!matrixRooms) return [];
    return matrixRooms.filter((room: unknown) => {
      const r = room as Record<string, unknown>;
      return (r.category as string)?.toLowerCase().includes(category.toLowerCase()) ||
        (r.topic as string)?.toLowerCase().includes(category.toLowerCase());
    });
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
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {session.user.name || session.user.username}!</h1>
          <p className="text-muted-foreground">
            Here&apos;s what&apos;s happening with your community
          </p>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto lg:grid lg:grid-cols-8 lg:overflow-x-visible">
          {/* Admin gets Admin tab first */}
          {session.user.isAdmin && (
            <TabsTrigger value="admin" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Admin</span>
            </TabsTrigger>
          )}
          {/* Moderators get Moderation tab first (after Admin if admin) */}
          {(session.user.isModerator || session.user.isAdmin) && (
            <TabsTrigger value="moderation" className="flex items-center gap-2 min-w-0 flex-shrink-0">
              <Shield className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Moderation</span>
            </TabsTrigger>
          )}
          {/* Quick Links comes first for regular users, earlier for admin/mods */}
          <TabsTrigger value="links" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Quick Links</span>
          </TabsTrigger>
          <TabsTrigger value="rooms" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <Users className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Rooms</span>
          </TabsTrigger>
          <TabsTrigger value="account" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <Settings className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
          <TabsTrigger value="invite" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <Mail className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Invite</span>
          </TabsTrigger>
          <TabsTrigger value="signal-groups" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <Phone className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Signal Groups</span>
          </TabsTrigger>
          <TabsTrigger value="contact" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Contact</span>
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
              {!checkSignalVerification() && (
                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <div className="text-amber-600">
                      🔐
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-amber-900">Signal Verification Required</h4>
                      <p className="text-sm text-amber-700 mt-1">
                        You need to verify your Signal account before joining community rooms. This ensures secure messaging and proper access to Matrix bridged channels.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100"
                        onClick={() => setSelectedTab('account')}
                      >
                        Verify Signal Account
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {checkSignalVerification() && selectedRooms.size > 0 && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-blue-900">
                        {selectedRooms.size} room{selectedRooms.size === 1 ? '' : 's'} selected
                      </h4>
                      <p className="text-sm text-blue-700">
                        Ready to join the selected rooms
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedRooms(new Set())}
                      >
                        Clear Selection
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleJoinSelectedRooms}
                        disabled={joinRoomsMutation.isPending}
                      >
                        {joinRoomsMutation.isPending ? 'Joining...' : `Join ${selectedRooms.size} Room${selectedRooms.size === 1 ? '' : 's'}`}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
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
                      {getRoomsByCategory('tech').map((room: unknown) => {
                        const roomData = room as Record<string, unknown>;
                        const roomId = roomData.room_id as string;
                        const roomName = roomData.name as string;
                        const memberCount = roomData.member_count as number;
                        const roomTopic = roomData.topic as string;
                        const isSignalVerified = checkSignalVerification();
                        const isSelected = selectedRooms.has(roomId);
                        
                        return (
                          <div key={roomId} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                            isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-muted/50'
                          }`}>
                            <div className="flex items-center gap-3 flex-1">
                              {isSignalVerified && (
                                <Checkbox
                                  id={`room-${roomId}`}
                                  checked={isSelected}
                                  onCheckedChange={() => handleRoomSelection(roomId)}
                                />
                              )}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{roomName}</h4>
                                  <Badge variant="secondary" className="text-xs">
                                    {memberCount} members
                                  </Badge>
                                </div>
                                {roomTopic && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {roomTopic}
                                  </p>
                                )}
                              </div>
                            </div>
                            {!isSignalVerified && (
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs text-amber-600">
                                  Signal verification required
                                </Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyToClipboard(roomId, `${roomName} Room ID`)}
                                >
                                  {copiedItems.has(`${roomName} Room ID`) ? (
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* General Rooms */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      💬 General Discussion
                    </h3>
                    <div className="grid gap-3">
                      {getRoomsByCategory('general').map((room: unknown) => {
                        const roomData = room as Record<string, unknown>;
                        const roomId = roomData.room_id as string;
                        const roomName = roomData.name as string;
                        const memberCount = roomData.member_count as number;
                        const roomTopic = roomData.topic as string;
                        const isSignalVerified = checkSignalVerification();
                        const isSelected = selectedRooms.has(roomId);
                        
                        return (
                          <div key={roomId} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                            isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-muted/50'
                          }`}>
                            <div className="flex items-center gap-3 flex-1">
                              {isSignalVerified && (
                                <Checkbox
                                  id={`room-general-${roomId}`}
                                  checked={isSelected}
                                  onCheckedChange={() => handleRoomSelection(roomId)}
                                />
                              )}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{roomName}</h4>
                                  <Badge variant="secondary" className="text-xs">
                                    {memberCount} members
                                  </Badge>
                                </div>
                                {roomTopic && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {roomTopic}
                                  </p>
                                )}
                              </div>
                            </div>
                            {!isSignalVerified && (
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs text-amber-600">
                                  Signal verification required
                                </Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyToClipboard(roomId, `${roomName} Room ID`)}
                                >
                                  {copiedItems.has(`${roomName} Room ID`) ? (
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* All Other Rooms */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      🏠 All Rooms
                    </h3>
                    <div className="grid gap-3">
                      {matrixRooms.map((room: unknown) => {
                        const roomData = room as Record<string, unknown>;
                        const roomId = roomData.room_id as string;
                        const roomName = roomData.name as string;
                        const memberCount = roomData.member_count as number;
                        const roomTopic = roomData.topic as string;
                        const roomCategory = roomData.category as string;
                        const isSignalVerified = checkSignalVerification();
                        const isSelected = selectedRooms.has(roomId);
                        
                        return (
                          <div key={roomId} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                            isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-muted/50'
                          }`}>
                            <div className="flex items-center gap-3 flex-1">
                              {isSignalVerified && (
                                <Checkbox
                                  id={`room-all-${roomId}`}
                                  checked={isSelected}
                                  onCheckedChange={() => handleRoomSelection(roomId)}
                                />
                              )}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{roomName}</h4>
                                  <Badge variant="secondary" className="text-xs">
                                    {memberCount} members
                                  </Badge>
                                  {roomCategory && (
                                    <Badge variant="outline" className="text-xs">
                                      {roomCategory}
                                    </Badge>
                                  )}
                                </div>
                                {roomTopic && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {roomTopic}
                                  </p>
                                )}
                              </div>
                            </div>
                            {!isSignalVerified && (
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs text-amber-600">
                                  Signal verification required
                                </Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyToClipboard(roomId, `${roomName} Room ID`)}
                                >
                                  {copiedItems.has(`${roomName} Room ID`) ? (
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <div className="text-blue-600">
                          📱
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-blue-900">Signal Messenger Verification</h4>
                          <p className="text-sm text-blue-700 mt-1">
                            This verification is for <strong>Signal Messenger</strong>. Your phone number must be registered with Signal to receive verification codes.
                          </p>
                          <p className="text-sm text-blue-700 mt-2">
                            <strong>Don&apos;t have Signal?</strong> You can join our Signal INDOC group to request manual verification from a moderator.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="new-phone">Phone Number (Signal Required)</Label>
                      <Input
                        id="new-phone"
                        type="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder="2125551234 or +12125551234"
                      />
                      <p className="text-sm text-muted-foreground">
                        Enter your <strong>Signal-registered</strong> phone number. If no country code is provided, +1 (US) will be assumed. 
                        Verification codes will be sent via Signal Messenger.
                      </p>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button 
                        onClick={handlePhoneVerification}
                        disabled={requestPhoneVerificationMutation.isPending}
                        className="flex-1"
                      >
                        {requestPhoneVerificationMutation.isPending ? 'Sending Signal Code...' : 'Send Signal Verification Code'}
                      </Button>
                      {process.env.NEXT_PUBLIC_SIGNAL_INDOC_LINK && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground whitespace-nowrap"
                          asChild
                        >
                          <a
                            href={process.env.NEXT_PUBLIC_SIGNAL_INDOC_LINK}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            📲 Manually Verify
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-blue-900">Verification Required</span>
                      </div>
                      <p className="text-sm text-blue-800">
                        Check your Signal or Matrix messages for a 6-digit verification code. 
                        Enter the code below to verify your phone number.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verification-hash">6-Digit Verification Code</Label>
                      <Input
                        id="verification-hash"
                        type="text"
                        value={verificationHash}
                        onChange={(e) => setVerificationHash(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter 6-digit code"
                        maxLength={6}
                        className="text-center text-lg font-mono tracking-widest"
                      />
                      <p className="text-xs text-muted-foreground">
                        Code expires in 15 minutes. If you don&apos;t receive it, try requesting a new code.
                      </p>
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

            {/* Update Email with Verification */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Update Email Address
                </CardTitle>
                <CardDescription>
                  Change your email address with email verification
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {pendingVerification !== 'email' ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-start space-x-3">
                        <div className="text-blue-600">
                          📧
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-blue-900">Email Verification Required</h4>
                          <p className="text-sm text-blue-700 mt-1">
                            To ensure account security, we&apos;ll send a verification code to your new email address before updating it.
                          </p>
                          <p className="text-sm text-blue-700 mt-2">
                            <strong>Verification emails will be sent from:</strong> {process.env.NEXT_PUBLIC_SMTP_FROM || emailVerificationData?.fromEmail || 'noreply@irregularchat.com'}
                          </p>
                        </div>
                      </div>
                    </div>
                    
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
                      onClick={handleEmailVerification}
                      disabled={requestEmailVerificationMutation.isPending}
                      className="w-full"
                    >
                      {requestEmailVerificationMutation.isPending ? 'Sending Verification Code...' : 'Send Email Verification Code'}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-blue-900">Email Verification Required</span>
                      </div>
                      <p className="text-sm text-blue-800">
                        We&apos;ve sent a 6-digit verification code to: <strong>{emailVerificationData?.email}</strong>
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        Check your email inbox (and spam folder) for the verification code.
                      </p>
                      {emailVerificationData?.fromEmail && (
                        <p className="text-xs text-blue-600 mt-2">
                          From: {emailVerificationData.fromEmail}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verification-hash">6-Digit Verification Code</Label>
                      <Input
                        id="verification-hash"
                        type="text"
                        value={verificationHash}
                        onChange={(e) => setVerificationHash(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter 6-digit code"
                        maxLength={6}
                        className="text-center text-lg font-mono tracking-widest"
                      />
                      <p className="text-xs text-muted-foreground">
                        Code expires in 15 minutes. If you don&apos;t receive the email, check your spam folder or request a new code.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleVerifyHash}
                        disabled={verifyEmailMutation.isPending || verificationHash.length !== 6}
                        className="flex-1"
                      >
                        {verifyEmailMutation.isPending ? 'Verifying...' : 'Verify & Update Email'}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setPendingVerification(null);
                          setVerificationHash('');
                          setEmailVerificationData(null);
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
                  <Label htmlFor="invitee-name">Friend&apos;s Name</Label>
                  <Input
                    id="invitee-name"
                    type="text"
                    value={inviteForm.inviteeName}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, inviteeName: e.target.value }))}
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invitee-email">Friend&apos;s Email</Label>
                  <Input
                    id="invitee-email"
                    type="email"
                    value={inviteForm.inviteeEmail}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, inviteeEmail: e.target.value }))}
                    placeholder="friend@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invitee-phone">Friend&apos;s Phone Number (Optional)</Label>
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
                        {matrixRooms.map((room: unknown) => {
                          const roomData = room as Record<string, unknown>;
                          const roomId = roomData.room_id as string;
                          const roomName = roomData.name as string;
                          const memberCount = roomData.member_count as number;
                          
                          return (
                            <div key={roomId} className="flex items-center space-x-2">
                              <Checkbox
                                id={`room-${roomId}`}
                                checked={inviteForm.roomIds.includes(roomId)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setInviteForm(prev => ({ 
                                      ...prev, 
                                      roomIds: [...prev.roomIds, roomId] 
                                    }));
                                  } else {
                                    setInviteForm(prev => ({ 
                                      ...prev, 
                                      roomIds: prev.roomIds.filter(id => id !== roomId) 
                                    }));
                                  }
                                }}
                              />
                              <Label 
                                htmlFor={`room-${roomId}`} 
                                className="text-sm font-normal cursor-pointer"
                              >
                                {roomName} ({memberCount} members)
                              </Label>
                            </div>
                          );
                        })}
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
                    Invitations you&apos;ve sent recently
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {myInvitations.invitations.slice(0, 3).map((invitation: { id: string; inviteeName?: string; email: string; createdAt: string; status: string; }) => (
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
                        <Link href="/users/invitations">View All Invitations</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        
        {/* Signal Groups Tab */}
        <TabsContent value="signal-groups">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  My Signal Status
                </CardTitle>
                <CardDescription>
                  View your Signal verification status and current group memberships
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SignalStatusCard />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Available Signal Groups
                </CardTitle>
                <CardDescription>
                  Discover and join Signal groups in the community
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AvailableSignalGroupsCard />
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
                  communityBookmarks.map((bookmark: { id: string; title: string; url: string; description: string; icon?: string; }) => (
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
                          {matrixRooms.slice(0, 5).map((room: unknown) => {
                            const roomData = room as Record<string, unknown>;
                            const roomId = roomData.room_id as string;
                            const roomName = roomData.name as string;
                            const memberCount = roomData.member_count as number;
                            const roomCategory = roomData.category as string;
                            
                            return (
                              <div key={roomId} className="flex items-center justify-between p-3 border rounded-md">
                                <div>
                                  <div className="font-medium">{roomName}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {memberCount} members • {roomCategory || 'General'}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline">Edit</Button>
                                  <Button size="sm" variant="outline">Settings</Button>
                                </div>
                              </div>
                            );
                          })}
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

// ============================================================================
// Signal Groups Components (v0.4.0 Phase 1)
// ============================================================================

function SignalStatusCard() {
  const { data: signalStatus, isLoading, refetch } = trpc.signal.getMySignalStatus.useQuery();

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading Signal status...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Signal Verification Status */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${signalStatus?.isSignalVerified ? 'bg-green-100' : 'bg-orange-100'}`}>
            {signalStatus?.isSignalVerified ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-orange-600" />
            )}
          </div>
          <div>
            <div className="font-medium">
              Signal Verification
            </div>
            <div className="text-sm text-muted-foreground">
              {signalStatus?.isSignalVerified ? 'Verified' : 'Not verified'}
            </div>
          </div>
        </div>
        {signalStatus?.phoneNumber && (
          <Badge variant="outline">
            {signalStatus.phoneNumber}
          </Badge>
        )}
      </div>

      {/* Current Group Memberships */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">My Signal Groups ({signalStatus?.totalGroups || 0})</h4>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
        
        {signalStatus?.groupMemberships && signalStatus.groupMemberships.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {signalStatus.groupMemberships.map((membership) => (
              <div key={membership.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="font-medium">{membership.groupName}</div>
                  {membership.description && (
                    <div className="text-sm text-muted-foreground">{membership.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Joined {new Date(membership.joinedAt).toLocaleDateString()}
                    {membership.memberCount && ` • ${membership.memberCount} members`}
                  </div>
                </div>
                <Badge variant="secondary">{membership.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Phone className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No Signal groups joined yet</p>
            <p className="text-sm">Browse available groups below to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AvailableSignalGroupsCard() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: availableGroups, isLoading, refetch } = trpc.signal.getAvailableSignalGroups.useQuery({
    page: currentPage,
    limit: 10,
    search: searchQuery || undefined
  });

  const joinGroupMutation = trpc.signal.requestSignalGroupJoin.useMutation({
    onSuccess: (result) => {
      if (result.autoApproved && result.joined) {
        // Auto-approved and successfully joined Signal group
        toast.success(result.message, {
          description: "You've been automatically added to the Signal group!"
        });
      } else if (result.autoApproved && !result.joined) {
        // Auto-approved but Signal group add failed
        toast.warning(result.message, {
          description: result.signalError || "Please contact an admin for Signal group access"
        });
      } else {
        // Pending approval
        toast.success(result.message, {
          description: "An admin will review your request shortly"
        });
      }
      // Refresh both the available groups and user's status
      refetch();
      // Also refresh the Signal status to show new membership
      if (result.autoApproved && result.joined) {
        // Delay slightly to allow database updates to propagate
        setTimeout(() => {
          window.location.reload(); // Force a full refresh to update all Signal data
        }, 1000);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleJoinGroup = (groupId: string) => {
    joinGroupMutation.mutate({ 
      groupId,
      message: "Hi! I'd like to join this group through the community dashboard."
    });
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading available groups...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="flex gap-2">
        <Input
          placeholder="Search groups..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
        />
        <Button variant="outline" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* Groups List */}
      {availableGroups?.groups && availableGroups.groups.length > 0 ? (
        <div className="space-y-3">
          {availableGroups.groups.map((group) => (
            <div key={group.groupId} className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{group.groupName}</div>
                  {group.requiresApproval && (
                    <Badge variant="outline" className="text-xs">
                      Requires Approval
                    </Badge>
                  )}
                </div>
                {group.description && (
                  <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {group.description}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{group.memberCount} members</span>
                  {group.tags && group.tags.length > 0 && (
                    <div className="flex gap-1">
                      {group.tags.slice(0, 3).map((tag, index) => (
                        <Badge key={index} variant="secondary" className="text-xs px-1 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <Button 
                size="sm" 
                onClick={() => handleJoinGroup(group.groupId)}
                disabled={joinGroupMutation.isLoading}
                className={joinGroupMutation.isLoading ? 'animate-pulse' : ''}
              >
                {joinGroupMutation.isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                    Joining...
                  </>
                ) : (
                  'Join Group'
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No available groups found</p>
          {searchQuery && <p className="text-sm">Try adjusting your search terms</p>}
        </div>
      )}

      {/* Pagination */}
      {availableGroups && availableGroups.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {availableGroups.page} of {availableGroups.totalPages} • {availableGroups.total} total groups
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(availableGroups.totalPages, p + 1))}
              disabled={currentPage === availableGroups.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
} 