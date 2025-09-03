'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Users, 
  Phone, 
  Share, 
  Clock, 
  AlertCircle, 
  CheckCircle,
  ExternalLink,
  Calendar,
  Activity
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { toast } from 'sonner';
import Link from 'next/link';
import { QRCodeComponent } from '@/components/ui/qr-code';

export default function SignalInvitePage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isJoining, setIsJoining] = useState(false);
  
  const inviteToken = params.token as string;
  
  // Get invite details
  const { data: inviteData, isLoading } = trpc.signal.getSignalInviteByToken.useQuery({
    inviteToken
  }, {
    enabled: !!inviteToken
  });
  
  // Use invite mutation
  const useInviteMutation = trpc.signal.useSignalInvite.useMutation({
    onSuccess: (result) => {
      setIsJoining(false);
      if (result.autoApproved && result.joined) {
        toast.success(result.message, {
          description: "You've been automatically added to the Signal group!"
        });
        setTimeout(() => {
          router.push('/dashboard?tab=signal-groups');
        }, 2000);
      } else {
        toast.success(result.message);
        setTimeout(() => {
          router.push('/dashboard?tab=signal-groups');
        }, 1500);
      }
    },
    onError: (error) => {
      setIsJoining(false);
      toast.error(`Failed to join group: ${error.message}`);
    }
  });
  
  const handleJoinGroup = () => {
    if (!session) {
      toast.error('Please sign in to join Signal groups');
      router.push('/auth/signin');
      return;
    }
    
    setIsJoining(true);
    useInviteMutation.mutate({ inviteToken });
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading invite details...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!inviteData?.invite) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Invite Not Found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              This invite link is invalid or has expired.
            </p>
            <div className="flex gap-2">
              <Button asChild className="flex-1">
                <Link href="/dashboard">
                  Go to Dashboard
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/auth/signin">
                  Sign In
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const { invite } = inviteData;
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Join Signal Group
          </h1>
          <p className="text-gray-600">
            You've been invited to join a community Signal group
          </p>
        </div>
        
        {/* Main Invite Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Phone className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl">{invite.targetGroupName}</CardTitle>
                  <CardDescription>
                    Invited by {invite.creatorName}
                  </CardDescription>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {!invite.isValid && (
                  <Badge variant="destructive">
                    {invite.isExpired ? 'Expired' : invite.isMaxedOut ? 'Full' : 'Inactive'}
                  </Badge>
                )}
                {invite.isValid && (
                  <Badge variant="default">Active</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* QR Code for QR type invites */}
            {invite.inviteType === 'qr' && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <h4 className="font-medium text-gray-900 mb-4 text-center">Scan to Join</h4>
                <div className="flex justify-center">
                  <QRCodeComponent 
                    value={window.location.href}
                    size={200}
                    alt={`QR code to join ${invite.targetGroupName}`}
                    showDownload={false}
                    showCopy={false}
                  />
                </div>
                <p className="text-sm text-gray-600 text-center mt-3">
                  Scan this QR code with your phone's camera to join the group
                </p>
              </div>
            )}

            {/* Custom Message */}
            {invite.customMessage && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">Personal Message</h4>
                <p className="text-blue-800 text-sm leading-relaxed">
                  {invite.customMessage}
                </p>
              </div>
            )}
            
            {/* Invite Details */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Calendar className="w-4 h-4" />
                <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
              </div>
              
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Activity className="w-4 h-4" />
                <span>{invite.usageCount} people have used this invite</span>
              </div>
              
              {invite.maxUses && (
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <Users className="w-4 h-4" />
                  <span>{invite.currentUses}/{invite.maxUses} uses</span>
                </div>
              )}
              
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                <span>Created {new Date(invite.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            
            <Separator />
            
            {/* Join Action */}
            <div className="space-y-4">
              {!invite.isValid && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-red-900">Cannot Join Group</h4>
                      <p className="text-red-800 text-sm mt-1">
                        {invite.invalidReason}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {invite.isValid && (
                <>
                  {status === 'loading' ? (
                    <Button disabled className="w-full">
                      Loading...
                    </Button>
                  ) : !session ? (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600 text-center">
                        Sign in to your account to join this Signal group
                      </p>
                      <div className="flex gap-2">
                        <Button asChild className="flex-1">
                          <Link href="/auth/signin">
                            Sign In
                          </Link>
                        </Button>
                        <Button variant="outline" asChild>
                          <Link href="/auth/signup">
                            Sign Up
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button 
                      onClick={handleJoinGroup}
                      disabled={isJoining || useInviteMutation.isPending}
                      className="w-full"
                      size="lg"
                    >
                      {isJoining || useInviteMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Joining...
                        </>
                      ) : (
                        <>
                          <Phone className="w-4 h-4 mr-2" />
                          Join Signal Group
                        </>
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>
            
            {/* Help Text */}
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
              <h4 className="font-medium text-gray-900 mb-2">What happens next?</h4>
              <ul className="space-y-1 list-disc list-inside">
                <li>You'll be added to the Signal group automatically</li>
                <li>You can start chatting with other group members</li>
                <li>You'll receive a welcome message in the group</li>
                <li>You can leave the group anytime from your Signal app</li>
              </ul>
            </div>
          </CardContent>
        </Card>
        
        {/* Footer Links */}
        <div className="text-center space-y-4">
          <div className="flex justify-center gap-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">
                <ExternalLink className="w-4 h-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            
            <Button variant="outline" size="sm" asChild>
              <a 
                href="https://signal.org/download/" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <Phone className="w-4 h-4 mr-2" />
                Download Signal
              </a>
            </Button>
          </div>
          
          <p className="text-xs text-gray-500">
            Don't have Signal? Download it first, then return to this link to join the group.
          </p>
        </div>
      </div>
    </div>
  );
}