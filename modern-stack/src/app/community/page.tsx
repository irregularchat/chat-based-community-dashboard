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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsSkeleton, UserListSkeleton, CardSkeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Send, MessageCircle, Users, UserPlus, UserMinus, Search, Filter, AlertTriangle, CheckCircle, X, Activity, Smartphone, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

export default function CommunityPage() {
  const { data: session } = useSession();
  const router = useRouter();
  
  // State for different tabs
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [directMessage, setDirectMessage] = useState('');
  const [roomMessage, setRoomMessage] = useState('');
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [removeUserId, setRemoveUserId] = useState('');
  const [removeMessage, setRemoveMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<('signal' | 'matrix')[]>(['signal', 'matrix']);
  const [selectedInviteUsers, setSelectedInviteUsers] = useState<string[]>([]);
  const [selectedRemoveUsers, setSelectedRemoveUsers] = useState<string[]>([]);
  const [removeFromAllRooms, setRemoveFromAllRooms] = useState(false);
  const [inviteUserSearch, setInviteUserSearch] = useState('');
  const [removeUserSearch, setRemoveUserSearch] = useState('');

  // API queries using unified community management
  const { data: serviceStatus, isLoading: statusLoading } = trpc.communityManagement.getServiceStatus.useQuery();
  
  const { data: communityUsers, isLoading: usersLoading } = trpc.communityManagement.getUsers.useQuery({
    platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
    search: userSearch || undefined,
  });

  const { data: communityRooms, isLoading: roomsLoading } = trpc.communityManagement.getRooms.useQuery({
    platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
    search: roomSearch || undefined,
  });

  // Mutations using unified community management
  const sendMessageMutation = trpc.communityManagement.sendMessage.useMutation({
    onSuccess: (data) => {
      toast.success(`Message sent successfully via ${data.platform}`);
      setDirectMessage('');
      setSelectedUsers([]);
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const sendMessageToMultipleMutation = trpc.communityManagement.sendMessageToMultiple.useMutation({
    onSuccess: (data) => {
      toast.success(`Message sent to ${data.successCount} users`);
      if (data.failureCount > 0) {
        toast.warning(`Failed to send to ${data.failureCount} users`);
      }
      setDirectMessage('');
      setSelectedUsers([]);
    },
    onError: (error) => {
      toast.error(`Failed to send messages: ${error.message}`);
    },
  });

  const broadcastToRoomMutation = trpc.communityManagement.broadcastToRoom.useMutation({
    onSuccess: (data) => {
      toast.success(`Message broadcast successfully via ${data.platform}`);
      setRoomMessage('');
      setSelectedRooms([]);
    },
    onError: (error) => {
      toast.error(`Failed to broadcast message: ${error.message}`);
    },
  });

  const inviteToRoomMutation = trpc.communityManagement.inviteToRoom.useMutation({
    onSuccess: (data) => {
      toast.success(`User invited successfully via ${data.platform}`);
      setInviteUserId('');
      setInviteMessage('');
      setSelectedRooms([]);
      setSelectedInviteUsers([]);
    },
    onError: (error) => {
      toast.error(`Failed to invite user: ${error.message}`);
    },
  });

  const removeFromRoomMutation = trpc.communityManagement.removeFromRoom.useMutation({
    onSuccess: (data) => {
      toast.success(`User removed successfully via ${data.platform}`);
      setRemoveUserId('');
      setRemoveMessage('');
      setSelectedRooms([]);
      setSelectedRemoveUsers([]);
    },
    onError: (error) => {
      toast.error(`Failed to remove user: ${error.message}`);
    },
  });

  const handleSendDirectMessage = async () => {
    if (!directMessage.trim() || selectedUsers.length === 0) {
      toast.error('Please select users and enter a message');
      return;
    }

    if (selectedUsers.length === 1) {
      await sendMessageMutation.mutateAsync({
        recipient: selectedUsers[0],
        message: directMessage,
      });
    } else {
      await sendMessageToMultipleMutation.mutateAsync({
        userIds: selectedUsers,
        message: directMessage,
      });
    }
  };

  const handleSendRoomMessage = async () => {
    if (!roomMessage.trim() || selectedRooms.length === 0) {
      toast.error('Please select rooms and enter a message');
      return;
    }

    // For now, send to each room individually
    // TODO: Add bulk room broadcast in future
    for (const roomId of selectedRooms) {
      await broadcastToRoomMutation.mutateAsync({
        roomId,
        message: roomMessage,
      });
    }
  };

  const handleInviteUser = async () => {
    const usersToInvite = selectedInviteUsers.length > 0 ? selectedInviteUsers : 
                          inviteUserId.trim() ? [inviteUserId] : [];
    
    if (usersToInvite.length === 0 || selectedRooms.length === 0) {
      toast.error('Please select at least one user and one room');
      return;
    }

    // For now, invite each user to each room individually
    // TODO: Add bulk operations in future
    for (const userId of usersToInvite) {
      for (const roomId of selectedRooms) {
        await inviteToRoomMutation.mutateAsync({
          userId,
          roomId,
        });
      }
    }
  };

  const handleRemoveUser = async () => {
    const usersToRemove = selectedRemoveUsers.length > 0 ? selectedRemoveUsers :
                          removeUserId.trim() ? [removeUserId] : [];
    
    if (usersToRemove.length === 0) {
      toast.error('Please select at least one user');
      return;
    }

    if (!removeFromAllRooms && selectedRooms.length === 0) {
      toast.error('Please select rooms or choose "Remove from all rooms"');
      return;
    }

    let roomsToRemoveFrom = selectedRooms;
    
    if (removeFromAllRooms) {
      roomsToRemoveFrom = communityRooms?.rooms?.map(room => room.id) || [];
    }

    // For now, remove each user from each room individually
    // TODO: Add bulk operations in future
    for (const userId of usersToRemove) {
      for (const roomId of roomsToRemoveFrom) {
        await removeFromRoomMutation.mutateAsync({
          userId,
          roomId,
        });
      }
    }
  };

  const getPlatformIcon = (platform: 'signal' | 'matrix') => {
    switch (platform) {
      case 'signal':
        return <Smartphone className="w-3 h-3" />;
      case 'matrix':
        return <MessageSquare className="w-3 h-3" />;
      default:
        return <Activity className="w-3 h-3" />;
    }
  };

  const getPlatformColor = (platform: 'signal' | 'matrix') => {
    switch (platform) {
      case 'signal':
        return 'bg-blue-50 text-blue-700';
      case 'matrix':
        return 'bg-green-50 text-green-700';
      default:
        return 'bg-gray-50 text-gray-700';
    }
  };

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

  if (statusLoading) {
    return (
      <div className="min-h-screen p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-4 mb-6">
            <CardSkeleton />
          </div>
          <TabsSkeleton tabCount={4} />
        </div>
      </div>
    );
  }

  if (!serviceStatus?.hasServices) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
              Community Services Unavailable
            </CardTitle>
            <CardDescription>
              No community services are currently active. Please contact your administrator to enable Signal CLI or Matrix functionality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm text-gray-600">
              <div>
                <p><strong>Available Services:</strong></p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  {serviceStatus?.serviceHealth?.map((service) => (
                    <li key={service.platform} className="flex items-center gap-2">
                      {getPlatformIcon(service.platform)}
                      <span className="capitalize">{service.platform}</span>
                      <Badge variant={service.isAvailable ? "default" : "secondary"}>
                        {service.isAvailable ? "Available" : "Unavailable"}
                      </Badge>
                      {service.error && (
                        <span className="text-red-500 text-xs">({service.error})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <p><strong>Configuration needed for Signal CLI:</strong></p>
                <ul className="list-disc list-inside space-y-1 mt-1">
                  <li>SIGNAL_CLI_REST_API_BASE_URL</li>
                  <li>Signal CLI registration and device linking</li>
                </ul>
              </div>
              
              <div>
                <p><strong>Configuration needed for Matrix:</strong></p>
                <ul className="list-disc list-inside space-y-1 mt-1">
                  <li>MATRIX_HOMESERVER</li>
                  <li>MATRIX_ACCESS_TOKEN</li>
                  <li>MATRIX_USER_ID</li>
                </ul>
              </div>
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
              <h1 className="text-2xl font-bold text-gray-900">Community Management</h1>
              <p className="text-sm text-gray-600">
                Unified messaging and user management across Signal CLI and Matrix
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {serviceStatus?.availableServices?.map((platform) => (
                <Badge key={platform} variant="outline" className={getPlatformColor(platform)}>
                  {getPlatformIcon(platform)}
                  <span className="ml-1 capitalize">{platform} Active</span>
                </Badge>
              ))}
              <Button
                variant="outline"
                onClick={() => router.push('/')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="direct-message" className="space-y-6">
          <div className="relative">
            <TabsList className="flex w-full overflow-x-auto scrollbar-hide lg:grid lg:grid-cols-4 lg:overflow-x-visible bg-muted p-1 rounded-md">
              <TabsTrigger value="direct-message" className="flex items-center gap-2 min-w-fit flex-shrink-0 px-3 py-2 text-sm whitespace-nowrap">
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Direct Messages</span>
                <span className="sm:hidden">DM</span>
              </TabsTrigger>
              <TabsTrigger value="room-message" className="flex items-center gap-2 min-w-fit flex-shrink-0 px-3 py-2 text-sm whitespace-nowrap">
                <Users className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Room Messages</span>
                <span className="sm:hidden">Rooms</span>
              </TabsTrigger>
              <TabsTrigger value="invite-users" className="flex items-center gap-2 min-w-fit flex-shrink-0 px-3 py-2 text-sm whitespace-nowrap">
                <UserPlus className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Invite Users</span>
                <span className="sm:hidden">Invite</span>
              </TabsTrigger>
              <TabsTrigger value="remove-users" className="flex items-center gap-2 min-w-fit flex-shrink-0 px-3 py-2 text-sm whitespace-nowrap">
                <UserMinus className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Remove Users</span>
                <span className="sm:hidden">Remove</span>
              </TabsTrigger>
            </TabsList>
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none lg:hidden" />
          </div>

          <TabsContent value="direct-message">
            <Card>
              <CardHeader>
                <CardTitle>Direct Messages</CardTitle>
                <CardDescription>
                  Send direct messages to users across Signal CLI and Matrix platforms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Platform Filter */}
                <div className="space-y-2">
                  <Label>Filter by Platform</Label>
                  <div className="flex gap-2">
                    {['signal', 'matrix'].map((platform) => (
                      <div key={platform} className="flex items-center space-x-2">
                        <Checkbox
                          id={`platform-${platform}`}
                          checked={selectedPlatforms.includes(platform as 'signal' | 'matrix')}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedPlatforms([...selectedPlatforms, platform as 'signal' | 'matrix']);
                            } else {
                              setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
                            }
                          }}
                        />
                        <Label htmlFor={`platform-${platform}`} className="flex items-center gap-1 text-sm">
                          {getPlatformIcon(platform as 'signal' | 'matrix')}
                          <span className="capitalize">{platform}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* User Selection */}
                <div className="space-y-4">
                  <Label>Select Users</Label>
                  
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users across platforms..."
                      className="pl-8"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                  </div>

                  {/* User List */}
                  {usersLoading ? (
                    <UserListSkeleton count={3} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {communityUsers && communityUsers.users.length > 0 ? (
                        <div className="space-y-2">
                          {communityUsers.users.map((user) => (
                            <div key={`${user.platform}-${user.id}`} className="flex items-center space-x-2">
                              <Checkbox
                                id={`user-${user.platform}-${user.id}`}
                                checked={selectedUsers.includes(user.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedUsers([...selectedUsers, user.id]);
                                  } else {
                                    setSelectedUsers(selectedUsers.filter(id => id !== user.id));
                                  }
                                }}
                              />
                              <Label htmlFor={`user-${user.platform}-${user.id}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{user.displayName}</span>
                                <Badge variant="secondary" className={`text-xs ${getPlatformColor(user.platform)}`}>
                                  {getPlatformIcon(user.platform)}
                                  <span className="ml-1 capitalize">{user.platform}</span>
                                </Badge>
                                <span className="text-xs text-gray-500">{user.id}</span>
                              </Label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-gray-500">No users found</p>
                      )}
                    </div>
                  )}

                  {selectedUsers.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded-md">
                      <p className="text-sm text-blue-700">
                        Selected {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                  <Label htmlFor="direct-message">Message</Label>
                  <Textarea
                    id="direct-message"
                    value={directMessage}
                    onChange={(e) => setDirectMessage(e.target.value)}
                    placeholder="Enter your message..."
                    rows={4}
                  />
                </div>

                {/* Send Button */}
                <Button
                  onClick={handleSendDirectMessage}
                  disabled={!directMessage.trim() || selectedUsers.length === 0 || sendMessageMutation.isPending || sendMessageToMultipleMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send Message to {selectedUsers.length} User{selectedUsers.length !== 1 ? 's' : ''}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="room-message">
            <Card>
              <CardHeader>
                <CardTitle>Room Messages</CardTitle>
                <CardDescription>
                  Send messages to rooms/groups across Signal CLI and Matrix platforms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Platform Filter */}
                <div className="space-y-2">
                  <Label>Filter by Platform</Label>
                  <div className="flex gap-2">
                    {['signal', 'matrix'].map((platform) => (
                      <div key={platform} className="flex items-center space-x-2">
                        <Checkbox
                          id={`room-platform-${platform}`}
                          checked={selectedPlatforms.includes(platform as 'signal' | 'matrix')}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedPlatforms([...selectedPlatforms, platform as 'signal' | 'matrix']);
                            } else {
                              setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
                            }
                          }}
                        />
                        <Label htmlFor={`room-platform-${platform}`} className="flex items-center gap-1 text-sm">
                          {getPlatformIcon(platform as 'signal' | 'matrix')}
                          <span className="capitalize">{platform}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Room Selection */}
                <div className="space-y-4">
                  <Label>Select Rooms/Groups</Label>
                  
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search rooms and groups..."
                      className="pl-8"
                      value={roomSearch}
                      onChange={(e) => setRoomSearch(e.target.value)}
                    />
                  </div>

                  {/* Room List */}
                  {roomsLoading ? (
                    <UserListSkeleton count={4} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {communityRooms && communityRooms.rooms.length > 0 ? (
                        <div className="space-y-2">
                          {communityRooms.rooms.map((room) => (
                            <div key={`${room.platform}-${room.id}`} className="flex items-center space-x-2">
                              <Checkbox
                                id={`room-${room.platform}-${room.id}`}
                                checked={selectedRooms.includes(room.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedRooms([...selectedRooms, room.id]);
                                  } else {
                                    setSelectedRooms(selectedRooms.filter(id => id !== room.id));
                                  }
                                }}
                              />
                              <Label htmlFor={`room-${room.platform}-${room.id}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{room.name}</span>
                                <Badge variant="secondary" className={`text-xs ${getPlatformColor(room.platform)}`}>
                                  {getPlatformIcon(room.platform)}
                                  <span className="ml-1 capitalize">{room.platform}</span>
                                </Badge>
                                {room.memberCount && (
                                  <span className="text-xs text-gray-500">
                                    {room.memberCount} members
                                  </span>
                                )}
                              </Label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-gray-500">No rooms found</p>
                      )}
                    </div>
                  )}

                  {selectedRooms.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded-md">
                      <p className="text-sm text-blue-700">
                        Selected {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                  <Label htmlFor="room-message">Message</Label>
                  <Textarea
                    id="room-message"
                    value={roomMessage}
                    onChange={(e) => setRoomMessage(e.target.value)}
                    placeholder="Enter your message..."
                    rows={4}
                  />
                </div>

                {/* Send Button */}
                <Button
                  onClick={handleSendRoomMessage}
                  disabled={!roomMessage.trim() || selectedRooms.length === 0 || broadcastToRoomMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send Message to {selectedRooms.length} Room{selectedRooms.length !== 1 ? 's' : ''}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invite-users">
            <Card>
              <CardHeader>
                <CardTitle>Invite Users to Rooms</CardTitle>
                <CardDescription>
                  Invite users to rooms/groups across Signal CLI and Matrix platforms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Selection */}
                <div className="space-y-2">
                  <Label>Select or Enter User(s)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-user-id"
                      value={inviteUserId}
                      onChange={(e) => {
                        setInviteUserId(e.target.value);
                        if (e.target.value) setSelectedInviteUsers([]);
                      }}
                      placeholder="User ID or select multiple users..."
                      className="flex-1"
                    />
                    <Select 
                      value=""
                      onValueChange={(value) => {
                        if (!selectedInviteUsers.includes(value)) {
                          setSelectedInviteUsers([...selectedInviteUsers, value]);
                          setInviteUserId('');
                        }
                      }}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select user..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[400px]">
                        <div className="sticky top-0 p-2 bg-background border-b z-10">
                          <Input
                            placeholder="Search users..."
                            className="h-8"
                            value={inviteUserSearch}
                            onChange={(e) => {
                              e.stopPropagation();
                              setInviteUserSearch(e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[340px]">
                          {(() => {
                            const filteredUsers = communityUsers?.users?.filter(user => {
                              if (!inviteUserSearch) return true;
                              const search = inviteUserSearch.toLowerCase();
                              return user.id.toLowerCase().includes(search) ||
                                     user.displayName.toLowerCase().includes(search);
                            }) || [];
                            
                            if (filteredUsers.length === 0) {
                              return (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {inviteUserSearch ? 'No users found matching your search' : 'No users available'}
                                </div>
                              );
                            }
                            
                            return filteredUsers.slice(0, 100).map((user) => (
                              <SelectItem key={`${user.platform}-${user.id}`} value={user.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{user.displayName}</span>
                                  <span className="text-xs text-muted-foreground">{user.id} ({user.platform})</span>
                                </div>
                              </SelectItem>
                            ));
                          })()}
                        </div>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Display selected users */}
                  {selectedInviteUsers.length > 0 && (
                    <div className="mt-2 p-3 bg-blue-50 rounded-md">
                      <p className="text-sm font-medium text-blue-900 mb-2">
                        Selected {selectedInviteUsers.length} user{selectedInviteUsers.length !== 1 ? 's' : ''}:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedInviteUsers.map((userId) => (
                          <Badge 
                            key={userId} 
                            variant="secondary" 
                            className="cursor-pointer"
                            onClick={() => setSelectedInviteUsers(selectedInviteUsers.filter(id => id !== userId))}
                          >
                            {userId}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Room Selection */}
                <div className="space-y-4">
                  <Label>Select Rooms to Invite User To</Label>
                  
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search rooms..."
                      className="pl-8"
                      value={roomSearch}
                      onChange={(e) => setRoomSearch(e.target.value)}
                    />
                  </div>

                  {roomsLoading ? (
                    <UserListSkeleton count={4} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {communityRooms && communityRooms.rooms.length > 0 ? (
                        <div className="space-y-2">
                          {communityRooms.rooms.map((room) => (
                            <div key={`${room.platform}-${room.id}`} className="flex items-center space-x-2">
                              <Checkbox
                                id={`invite-room-${room.platform}-${room.id}`}
                                checked={selectedRooms.includes(room.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedRooms([...selectedRooms, room.id]);
                                  } else {
                                    setSelectedRooms(selectedRooms.filter(id => id !== room.id));
                                  }
                                }}
                              />
                              <Label htmlFor={`invite-room-${room.platform}-${room.id}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{room.name}</span>
                                <Badge variant="secondary" className={`text-xs ${getPlatformColor(room.platform)}`}>
                                  {getPlatformIcon(room.platform)}
                                  <span className="ml-1 capitalize">{room.platform}</span>
                                </Badge>
                                {room.memberCount && (
                                  <span className="text-xs text-gray-500">
                                    {room.memberCount} members
                                  </span>
                                )}
                              </Label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-gray-500">No rooms found</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Welcome Message */}
                <div className="space-y-2">
                  <Label htmlFor="invite-message">Welcome Message (Optional)</Label>
                  <Textarea
                    id="invite-message"
                    value={inviteMessage}
                    onChange={(e) => setInviteMessage(e.target.value)}
                    placeholder="Welcome to our community! Feel free to introduce yourself..."
                    rows={3}
                  />
                </div>

                {/* Invite Button */}
                <Button
                  onClick={handleInviteUser}
                  disabled={
                    (selectedInviteUsers.length === 0 && !inviteUserId.trim()) || 
                    selectedRooms.length === 0 || 
                    inviteToRoomMutation.isPending
                  }
                  className="w-full sm:w-auto"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Invite {selectedInviteUsers.length > 0 ? selectedInviteUsers.length : 1} User{(selectedInviteUsers.length > 1 || (!inviteUserId && selectedInviteUsers.length === 0)) ? 's' : ''} to {selectedRooms.length} Room{selectedRooms.length !== 1 ? 's' : ''}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="remove-users">
            <Card>
              <CardHeader>
                <CardTitle>Remove Users from Rooms</CardTitle>
                <CardDescription>
                  Remove users from rooms/groups across Signal CLI and Matrix platforms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Selection */}
                <div className="space-y-2">
                  <Label>Select or Enter User(s)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="remove-user-id"
                      value={removeUserId}
                      onChange={(e) => {
                        setRemoveUserId(e.target.value);
                        if (e.target.value) setSelectedRemoveUsers([]);
                      }}
                      placeholder="User ID or select multiple users..."
                      className="flex-1"
                    />
                    <Select 
                      value=""
                      onValueChange={(value) => {
                        if (!selectedRemoveUsers.includes(value)) {
                          setSelectedRemoveUsers([...selectedRemoveUsers, value]);
                          setRemoveUserId('');
                        }
                      }}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select user..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[400px]">
                        <div className="sticky top-0 p-2 bg-background border-b z-10">
                          <Input
                            placeholder="Search users..."
                            className="h-8"
                            value={removeUserSearch}
                            onChange={(e) => {
                              e.stopPropagation();
                              setRemoveUserSearch(e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[340px]">
                          {(() => {
                            const filteredUsers = communityUsers?.users?.filter(user => {
                              if (!removeUserSearch) return true;
                              const search = removeUserSearch.toLowerCase();
                              return user.id.toLowerCase().includes(search) ||
                                     user.displayName.toLowerCase().includes(search);
                            }) || [];
                            
                            if (filteredUsers.length === 0) {
                              return (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {removeUserSearch ? 'No users found matching your search' : 'No users available'}
                                </div>
                              );
                            }
                            
                            return filteredUsers.slice(0, 100).map((user) => (
                              <SelectItem key={`${user.platform}-${user.id}`} value={user.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{user.displayName}</span>
                                  <span className="text-xs text-muted-foreground">{user.id} ({user.platform})</span>
                                </div>
                              </SelectItem>
                            ));
                          })()}
                        </div>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Display selected users */}
                  {selectedRemoveUsers.length > 0 && (
                    <div className="mt-2 p-3 bg-red-50 rounded-md">
                      <p className="text-sm font-medium text-red-900 mb-2">
                        Selected {selectedRemoveUsers.length} user{selectedRemoveUsers.length !== 1 ? 's' : ''} for removal:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedRemoveUsers.map((userId) => (
                          <Badge 
                            key={userId} 
                            variant="destructive" 
                            className="cursor-pointer"
                            onClick={() => setSelectedRemoveUsers(selectedRemoveUsers.filter(id => id !== userId))}
                          >
                            {userId}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Room Selection */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Select Rooms to Remove User From</Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="remove-from-all-rooms"
                        checked={removeFromAllRooms}
                        onCheckedChange={(checked) => {
                          setRemoveFromAllRooms(checked === true);
                          if (checked) {
                            setSelectedRooms([]);
                          }
                        }}
                      />
                      <Label htmlFor="remove-from-all-rooms" className="text-sm font-medium text-red-600">
                        Remove from ALL rooms
                      </Label>
                    </div>
                  </div>
                  
                  {!removeFromAllRooms && (
                    <>
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search rooms..."
                          className="pl-8"
                          value={roomSearch}
                          onChange={(e) => setRoomSearch(e.target.value)}
                        />
                      </div>

                      {roomsLoading ? (
                        <UserListSkeleton count={4} />
                      ) : (
                        <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                          {communityRooms && communityRooms.rooms.length > 0 ? (
                            <div className="space-y-2">
                              {communityRooms.rooms.map((room) => (
                                <div key={`${room.platform}-${room.id}`} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`remove-room-${room.platform}-${room.id}`}
                                    checked={selectedRooms.includes(room.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedRooms([...selectedRooms, room.id]);
                                      } else {
                                        setSelectedRooms(selectedRooms.filter(id => id !== room.id));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`remove-room-${room.platform}-${room.id}`} className="flex items-center gap-2 cursor-pointer">
                                    <span>{room.name}</span>
                                    <Badge variant="secondary" className={`text-xs ${getPlatformColor(room.platform)}`}>
                                      {getPlatformIcon(room.platform)}
                                      <span className="ml-1 capitalize">{room.platform}</span>
                                    </Badge>
                                    {room.memberCount && (
                                      <span className="text-xs text-gray-500">
                                        {room.memberCount} members
                                      </span>
                                    )}
                                  </Label>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-center text-gray-500">No rooms found</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Notification Message */}
                <div className="space-y-2">
                  <Label htmlFor="remove-message">Notification Message (Optional)</Label>
                  <Textarea
                    id="remove-message"
                    value={removeMessage}
                    onChange={(e) => setRemoveMessage(e.target.value)}
                    placeholder="User {username} has been removed from this room."
                    rows={3}
                  />
                  <p className="text-xs text-gray-500">
                    Use {'{username}'} to include the user&apos;s display name in the message
                  </p>
                </div>

                {/* Remove Button */}
                <div className="bg-red-50 p-4 rounded-md border border-red-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-800">Warning</p>
                      <p className="text-sm text-red-700">
                        This action will remove the user from {removeFromAllRooms ? 'ALL rooms' : 'the selected rooms'}. This cannot be undone.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleRemoveUser}
                    disabled={
                      (selectedRemoveUsers.length === 0 && !removeUserId.trim()) || 
                      (!removeFromAllRooms && selectedRooms.length === 0) || 
                      removeFromRoomMutation.isPending
                    }
                    variant="destructive"
                    className="mt-3 w-full sm:w-auto"
                  >
                    <UserMinus className="w-4 h-4 mr-2" />
                    {removeFromAllRooms 
                      ? `Remove ${selectedRemoveUsers.length > 0 ? selectedRemoveUsers.length : 1} User${(selectedRemoveUsers.length > 1 || (!removeUserId && selectedRemoveUsers.length === 0)) ? 's' : ''} from ALL ${communityRooms?.totalCount || 0} Rooms`
                      : `Remove ${selectedRemoveUsers.length > 0 ? selectedRemoveUsers.length : 1} User${(selectedRemoveUsers.length > 1 || (!removeUserId && selectedRemoveUsers.length === 0)) ? 's' : ''} from ${selectedRooms.length} Room${selectedRooms.length !== 1 ? 's' : ''}`
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}