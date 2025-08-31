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
import { ArrowLeft, Send, MessageCircle, Users, UserPlus, UserMinus, Search, Filter, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { toast } from 'sonner';

export default function MatrixPage() {
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
  const [includeSignalUsers, setIncludeSignalUsers] = useState(true);
  const [includeRegularUsers, setIncludeRegularUsers] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [removeUserSearch, setRemoveUserSearch] = useState('');
  const [removeFromAllRooms, setRemoveFromAllRooms] = useState(false);
  const [inviteUserSearch, setInviteUserSearch] = useState('');
  const [selectedInviteUsers, setSelectedInviteUsers] = useState<string[]>([]);
  const [selectedRemoveUsers, setSelectedRemoveUsers] = useState<string[]>([]);

  // API queries
  const { data: matrixConfig, isLoading: configLoading } = trpc.matrix.getConfig.useQuery();
  
  const { data: matrixUsers, isLoading: usersLoading } = trpc.matrix.getUsers.useQuery({
    search: userSearch || undefined,
    includeSignalUsers,
    includeRegularUsers,
  });

  const { data: matrixRooms, isLoading: roomsLoading } = trpc.matrix.getRooms.useQuery({
    category: selectedCategory || undefined,
    search: roomSearch || undefined,
  });

  const { data: categories } = trpc.matrix.getCategories.useQuery();

  // Mutations
  const sendDirectMessageMutation = trpc.matrix.sendDirectMessage.useMutation({
    onSuccess: () => {
      toast.success('Direct message sent successfully');
      setDirectMessage('');
      setSelectedUsers([]);
    },
    onError: (_error) => {
      toast.error('Failed to send direct message');
    },
  });

  const sendMessageToUsersMutation = trpc.matrix.sendMessageToUsers.useMutation({
    onSuccess: (data) => {
      toast.success(`Message sent to ${data.totalSent} users`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed to send to ${data.totalFailed} users`);
      }
      setDirectMessage('');
      setSelectedUsers([]);
    },
    onError: () => {
      toast.error('Failed to send messages');
    },
  });


  const sendMessageToRoomsMutation = trpc.matrix.sendMessageToRooms.useMutation({
    onSuccess: (data) => {
      toast.success(`Message sent to ${data.totalSent} rooms`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed to send to ${data.totalFailed} rooms`);
      }
      setRoomMessage('');
      setSelectedRooms([]);
    },
    onError: () => {
      toast.error('Failed to send messages to rooms');
    },
  });

  const inviteUserMutation = trpc.matrix.inviteUserToRooms.useMutation({
    onSuccess: (data) => {
      toast.success(`User invited to ${data.totalInvited} rooms`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed to invite to ${data.totalFailed} rooms`);
      }
      setInviteUserId('');
      setInviteMessage('');
      setSelectedRooms([]);
    },
    onError: () => {
      toast.error('Failed to invite user');
    },
  });

  const removeUserMutation = trpc.matrix.removeUserFromRooms.useMutation({
    onSuccess: (data) => {
      toast.success(`User removed from ${data.totalRemoved} rooms`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed to remove from ${data.totalFailed} rooms`);
      }
      setRemoveUserId('');
      setRemoveMessage('');
      setSelectedRooms([]);
    },
    onError: () => {
      toast.error('Failed to remove user');
    },
  });

  // Batch mutations for multiple users
  const inviteUsersMutation = trpc.matrix.inviteUsersToRooms.useMutation({
    onSuccess: (data) => {
      toast.success(`Invited ${data.usersProcessed} users to ${data.roomsProcessed} rooms`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed ${data.totalFailed} invitations`);
      }
      setSelectedInviteUsers([]);
      setInviteUserId('');
      setInviteMessage('');
      setSelectedRooms([]);
    },
    onError: () => {
      toast.error('Failed to invite users');
    },
  });

  const removeUsersMutation = trpc.matrix.removeUsersFromRooms.useMutation({
    onSuccess: (data) => {
      toast.success(`Removed ${data.usersProcessed} users from ${data.roomsProcessed} rooms`);
      if (data.totalFailed > 0) {
        toast.warning(`Failed ${data.totalFailed} removals`);
      }
      setSelectedRemoveUsers([]);
      setRemoveUserId('');
      setRemoveMessage('');
      setSelectedRooms([]);
      setRemoveFromAllRooms(false);
    },
    onError: () => {
      toast.error('Failed to remove users');
    },
  });


  const handleSendDirectMessage = async () => {
    if (!directMessage.trim() || selectedUsers.length === 0) {
      toast.error('Please select users and enter a message');
      return;
    }

    if (selectedUsers.length === 1) {
      await sendDirectMessageMutation.mutateAsync({
        userId: selectedUsers[0],
        message: directMessage,
      });
    } else {
      await sendMessageToUsersMutation.mutateAsync({
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

    await sendMessageToRoomsMutation.mutateAsync({
      roomIds: selectedRooms,
      message: roomMessage,
    });
  };

  const handleInviteUser = async () => {
    const usersToInvite = selectedInviteUsers.length > 0 ? selectedInviteUsers : 
                          inviteUserId.trim() ? [inviteUserId] : [];
    
    if (usersToInvite.length === 0 || selectedRooms.length === 0) {
      toast.error('Please select at least one user and one room');
      return;
    }

    if (usersToInvite.length > 1) {
      // Use batch mutation for multiple users
      await inviteUsersMutation.mutateAsync({
        userIds: usersToInvite,
        roomIds: selectedRooms,
        sendWelcome: !!inviteMessage,
        welcomeMessage: inviteMessage || undefined,
      });
    } else {
      // Use single user mutation
      await inviteUserMutation.mutateAsync({
        userId: usersToInvite[0],
        roomIds: selectedRooms,
        sendWelcome: !!inviteMessage,
        welcomeMessage: inviteMessage || undefined,
      });
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
      // Get all indexed rooms where the bot is present
      roomsToRemoveFrom = matrixRooms?.map(room => room.room_id) || [];
    }

    if (usersToRemove.length > 1) {
      // Use batch mutation for multiple users
      await removeUsersMutation.mutateAsync({
        userIds: usersToRemove,
        roomIds: roomsToRemoveFrom,
        sendMessage: !!removeMessage,
        message: removeMessage || undefined,
      });
    } else {
      // Use single user mutation
      await removeUserMutation.mutateAsync({
        userId: usersToRemove[0],
        roomIds: roomsToRemoveFrom,
        sendMessage: !!removeMessage,
        message: removeMessage || undefined,
      });
    }
  };


  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please sign in to access Matrix management</CardDescription>
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

  if (configLoading) {
    return (
      <div className="min-h-screen p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-4 mb-6">
            <CardSkeleton />
          </div>
          <TabsSkeleton tabCount={5} />
        </div>
      </div>
    );
  }

  if (!matrixConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
              Matrix Integration Disabled
            </CardTitle>
            <CardDescription>
              Matrix integration is not currently active. Please contact your administrator to enable Matrix functionality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-gray-600">
              <p><strong>Configuration needed:</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>MATRIX_HOMESERVER</li>
                <li>MATRIX_ACCESS_TOKEN</li>
                <li>MATRIX_USER_ID</li>
              </ul>
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
              <h1 className="text-2xl font-bold text-gray-900">Matrix Management</h1>
              <p className="text-sm text-gray-600">
                Manage Matrix messaging, rooms, and user interactions
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-green-50 text-green-700">
                <CheckCircle className="w-3 h-3 mr-1" />
                Matrix Active
              </Badge>
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
            {/* Mobile scroll indicator */}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none lg:hidden" />
          </div>

          <TabsContent value="direct-message">
            <Card>
              <CardHeader>
                <CardTitle>Direct Messages</CardTitle>
                <CardDescription>
                  Send direct messages to Matrix users
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Selection */}
                <div className="space-y-4">
                  <Label>Select Users</Label>
                  
                  {/* User Filters */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        className="pl-8"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="include-signal"
                          checked={includeSignalUsers}
                          onCheckedChange={(checked) => setIncludeSignalUsers(checked === true)}
                        />
                        <Label htmlFor="include-signal" className="text-sm">
                          Signal Users
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="include-regular"
                          checked={includeRegularUsers}
                          onCheckedChange={(checked) => setIncludeRegularUsers(checked === true)}
                        />
                        <Label htmlFor="include-regular" className="text-sm">
                          Regular Users
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* User List */}
                  {usersLoading ? (
                    <UserListSkeleton count={3} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {matrixUsers && matrixUsers.length > 0 ? (
                        <div className="space-y-2">
                          {matrixUsers.map((user) => (
                            <div key={user.userId} className="flex items-center space-x-2">
                              <Checkbox
                                id={`user-${user.userId}`}
                                checked={selectedUsers.includes(user.userId)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedUsers([...selectedUsers, user.userId]);
                                  } else {
                                    setSelectedUsers(selectedUsers.filter(id => id !== user.userId));
                                  }
                                }}
                              />
                              <Label htmlFor={`user-${user.userId}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{user.displayName || user.userId}</span>
                                {user.isSignalUser && (
                                  <Badge variant="secondary" className="text-xs">
                                    📱 Signal
                                  </Badge>
                                )}
                                <span className="text-xs text-gray-500">{user.userId}</span>
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
                  disabled={!directMessage.trim() || selectedUsers.length === 0 || sendDirectMessageMutation.isPending || sendMessageToUsersMutation.isPending}
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
                  Send messages to Matrix rooms by category or individually
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Room Selection */}
                <div className="space-y-4">
                  <Label>Select Rooms</Label>
                  
                  {/* Room Filters */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search rooms..."
                        className="pl-8"
                        value={roomSearch}
                        onChange={(e) => setRoomSearch(e.target.value)}
                      />
                    </div>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="w-[180px]">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories?.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Room List */}
                  {roomsLoading ? (
                    <UserListSkeleton count={4} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {matrixRooms && matrixRooms.length > 0 ? (
                        <div className="space-y-2">
                          {matrixRooms.map((room: { room_id: string; name?: string; category: string; }) => (
                            <div key={room.room_id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`room-${room.room_id}`}
                                checked={selectedRooms.includes(room.room_id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedRooms([...selectedRooms, room.room_id]);
                                  } else {
                                    setSelectedRooms(selectedRooms.filter(id => id !== room.room_id));
                                  }
                                }}
                              />
                              <Label htmlFor={`room-${room.room_id}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{room.name || 'Unnamed Room'}</span>
                                <Badge variant="outline" className="text-xs">
                                  {room.category}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  {room.member_count} members
                                </span>
                                {!room.configured && (
                                  <Badge variant="secondary" className="text-xs">
                                    Discovered
                                  </Badge>
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
                  <p className="text-xs text-gray-500">
                    ℹ️ Admin notice footer will be automatically appended
                  </p>
                </div>

                {/* Send Button */}
                <Button
                  onClick={handleSendRoomMessage}
                  disabled={!roomMessage.trim() || selectedRooms.length === 0 || sendMessageToRoomsMutation.isPending}
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
                  Invite Matrix users to selected rooms with optional welcome message
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Selection with Search and Multi-select */}
                <div className="space-y-2">
                  <Label>Select or Enter Matrix User(s)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-user-id"
                      value={inviteUserId}
                      onChange={(e) => {
                        setInviteUserId(e.target.value);
                        // Clear selected users when typing a manual entry
                        if (e.target.value) setSelectedInviteUsers([]);
                      }}
                      placeholder="@username:matrix.example.com or select multiple users..."
                      className="flex-1"
                      list="invite-user-suggestions"
                    />
                    <Select 
                      value=""
                      onValueChange={(value) => {
                        // Add to selected users for multi-select
                        if (!selectedInviteUsers.includes(value)) {
                          setSelectedInviteUsers([...selectedInviteUsers, value]);
                          setInviteUserId(''); // Clear manual input
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
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[340px]">
                          {(() => {
                            const filteredUsers = matrixUsers?.filter(user => user?.userId)
                              .filter(user => {
                                if (!inviteUserSearch) return true;
                                const search = inviteUserSearch.toLowerCase();
                                return user?.userId?.toLowerCase().includes(search) ||
                                       user?.displayName?.toLowerCase().includes(search);
                              }) || [];
                            
                            if (filteredUsers.length === 0) {
                              return (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {inviteUserSearch ? 'No users found matching your search' : 'No users available'}
                                </div>
                              );
                            }
                            
                            return filteredUsers.slice(0, 100).map((user) => (
                              <SelectItem key={user.userId} value={user.userId}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{user.displayName || user.userId?.split(':')[0].replace('@', '') || 'Unknown User'}</span>
                                  <span className="text-xs text-muted-foreground">{user.userId}</span>
                                </div>
                              </SelectItem>
                            ));
                          })()}
                        </div>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Type a Matrix user ID directly or select multiple users from the dropdown
                  </p>
                  
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
                            {userId.split(':')[0].replace('@', '')}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Room Selection - Reusing room selection logic */}
                <div className="space-y-4">
                  <Label>Select Rooms to Invite User To</Label>
                  
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search rooms..."
                        className="pl-8"
                        value={roomSearch}
                        onChange={(e) => setRoomSearch(e.target.value)}
                      />
                    </div>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="w-[180px]">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories?.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {roomsLoading ? (
                    <UserListSkeleton count={4} />
                  ) : (
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                      {matrixRooms && matrixRooms.length > 0 ? (
                        <div className="space-y-2">
                          {matrixRooms.map((room: { room_id: string; name?: string; category: string; }) => (
                            <div key={room.room_id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`invite-room-${room.room_id}`}
                                checked={selectedRooms.includes(room.room_id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedRooms([...selectedRooms, room.room_id]);
                                  } else {
                                    setSelectedRooms(selectedRooms.filter(id => id !== room.room_id));
                                  }
                                }}
                              />
                              <Label htmlFor={`invite-room-${room.room_id}`} className="flex items-center gap-2 cursor-pointer">
                                <span>{room.name || 'Unnamed Room'}</span>
                                <Badge variant="outline" className="text-xs">
                                  {room.category}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  {room.member_count} members
                                </span>
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
                    inviteUserMutation.isPending ||
                    inviteUsersMutation.isPending
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
                  Remove Matrix users from selected rooms with optional notification message
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Selection with Search and Multi-select */}
                <div className="space-y-2">
                  <Label>Select or Enter Matrix User(s)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="remove-user-id"
                      value={removeUserId}
                      onChange={(e) => {
                        setRemoveUserId(e.target.value);
                        // Clear selected users when typing a manual entry
                        if (e.target.value) setSelectedRemoveUsers([]);
                      }}
                      placeholder="@username:matrix.example.com or select multiple users..."
                      className="flex-1"
                      list="user-suggestions"
                    />
                    <Select 
                      value=""
                      onValueChange={(value) => {
                        // Add to selected users for multi-select
                        if (!selectedRemoveUsers.includes(value)) {
                          setSelectedRemoveUsers([...selectedRemoveUsers, value]);
                          setRemoveUserId(''); // Clear manual input
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
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[340px]">
                          {(() => {
                            const filteredUsers = matrixUsers?.filter(user => user?.userId)
                              .filter(user => {
                                if (!removeUserSearch) return true;
                                const search = removeUserSearch.toLowerCase();
                                return user?.userId?.toLowerCase().includes(search) ||
                                       user?.displayName?.toLowerCase().includes(search);
                              }) || [];
                            
                            if (filteredUsers.length === 0) {
                              return (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {removeUserSearch ? 'No users found matching your search' : 'No users available'}
                                </div>
                              );
                            }
                            
                            return filteredUsers.slice(0, 100).map((user) => (
                              <SelectItem key={user.userId} value={user.userId}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{user.displayName || user.userId?.split(':')[0].replace('@', '') || 'Unknown User'}</span>
                                  <span className="text-xs text-muted-foreground">{user.userId}</span>
                                </div>
                              </SelectItem>
                            ));
                          })()}
                        </div>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Type a Matrix user ID directly or select multiple users from the dropdown
                  </p>
                  
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
                            {userId.split(':')[0].replace('@', '')}
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
                            setSelectedRooms([]); // Clear room selection when "all rooms" is selected
                          }
                        }}
                      />
                      <Label htmlFor="remove-from-all-rooms" className="text-sm font-medium text-red-600">
                        Remove from ALL indexed rooms
                      </Label>
                    </div>
                  </div>
                  
                  {!removeFromAllRooms && (
                    <>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search rooms..."
                            className="pl-8"
                            value={roomSearch}
                            onChange={(e) => setRoomSearch(e.target.value)}
                          />
                        </div>
                        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                          <SelectTrigger className="w-[180px]">
                            <Filter className="w-4 h-4 mr-2" />
                            <SelectValue placeholder="All Categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {categories?.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {roomsLoading ? (
                        <UserListSkeleton count={4} />
                      ) : (
                        <div className="border rounded-md p-4 max-h-60 overflow-y-auto">
                          {matrixRooms && matrixRooms.length > 0 ? (
                            <div className="space-y-2">
                              {matrixRooms.map((room: { room_id: string; name?: string; category: string; }) => (
                                <div key={room.room_id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`remove-room-${room.room_id}`}
                                    checked={selectedRooms.includes(room.room_id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedRooms([...selectedRooms, room.room_id]);
                                      } else {
                                        setSelectedRooms(selectedRooms.filter(id => id !== room.room_id));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`remove-room-${room.room_id}`} className="flex items-center gap-2 cursor-pointer">
                                    <span>{room.name || 'Unnamed Room'}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {room.category}
                                    </Badge>
                                    <span className="text-xs text-gray-500">
                                      {room.member_count} members
                                    </span>
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
                        This action will remove the user from {removeFromAllRooms ? 'ALL indexed rooms' : 'the selected rooms'}. This cannot be undone.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleRemoveUser}
                    disabled={
                      (selectedRemoveUsers.length === 0 && !removeUserId.trim()) || 
                      (!removeFromAllRooms && selectedRooms.length === 0) || 
                      removeUserMutation.isPending ||
                      removeUsersMutation.isPending
                    }
                    variant="destructive"
                    className="mt-3 w-full sm:w-auto"
                  >
                    <UserMinus className="w-4 h-4 mr-2" />
                    {removeFromAllRooms 
                      ? `Remove ${selectedRemoveUsers.length > 0 ? selectedRemoveUsers.length : 1} User${(selectedRemoveUsers.length > 1 || (!removeUserId && selectedRemoveUsers.length === 0)) ? 's' : ''} from ALL ${matrixRooms?.length || 0} Indexed Rooms`
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