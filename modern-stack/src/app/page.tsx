'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function Home() {
  const { data: session, status } = useSession();
  const { data: currentUser } = trpc.auth.getCurrentUser.useQuery(undefined, {
    enabled: !!session,
  });

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Community Dashboard</CardTitle>
            <CardDescription className="text-center">
              Welcome to your modern community management platform
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Please sign in to access your dashboard
              </p>
              <Button onClick={() => signIn()} className="w-full">
                Sign In
              </Button>
            </div>
            <Separator />
            <div className="text-xs text-gray-500 text-center">
              <p>✅ Next.js 14 + TypeScript</p>
              <p>✅ Authentication with NextAuth.js</p>
              <p>✅ tRPC for type-safe APIs</p>
              <p>✅ Prisma ORM + PostgreSQL</p>
              <p>✅ Tailwind CSS + Shadcn/ui</p>
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
              <h1 className="text-2xl font-bold text-gray-900">Community Dashboard</h1>
              <p className="text-sm text-gray-600">Modern Stack Migration - Phase 2 Complete</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">
                  {session.user.name || session.user.username}
                </p>
                <p className="text-xs text-gray-500">{session.user.email}</p>
              </div>
              <Button variant="outline" onClick={() => signOut()}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🔐 Authentication
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  Active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>Provider:</strong> {session.user.provider || 'Unknown'}
                </p>
                <p className="text-sm">
                  <strong>Admin:</strong> {session.user.isAdmin ? 'Yes' : 'No'}
                </p>
                <p className="text-sm">
                  <strong>Moderator:</strong> {session.user.isModerator ? 'Yes' : 'No'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🔗 tRPC API
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  Connected
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>User ID:</strong> {session.user.id}
                </p>
                <p className="text-sm">
                  <strong>Database:</strong> {currentUser ? 'Connected' : 'Loading...'}
                </p>
                <p className="text-sm">
                  <strong>Type Safety:</strong> Full
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📊 Migration Status
                <Badge variant="outline" className="bg-purple-50 text-purple-700">
                  Phase 2
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>✅ Foundation:</strong> Complete
                </p>
                <p className="text-sm">
                  <strong>✅ Authentication:</strong> Complete
                </p>
                <p className="text-sm">
                  <strong>✅ API Layer:</strong> Complete
                </p>
                <p className="text-sm">
                  <strong>🚧 Next:</strong> Core Features
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {(session.user.isAdmin || session.user.isModerator) && (
          <div className="mt-8">
            <Card>
              <CardHeader>
                <CardTitle>🚀 Quick Actions</CardTitle>
                <CardDescription>
                  Access key features and management tools
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
                    disabled
                  >
                    <div className="text-2xl">🔗</div>
                    <div className="text-center">
                      <div className="font-medium">Matrix Integration</div>
                      <div className="text-sm text-muted-foreground">
                        Coming soon
                      </div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                    disabled
                  >
                    <div className="text-2xl">📊</div>
                    <div className="text-center">
                      <div className="font-medium">Analytics</div>
                      <div className="text-sm text-muted-foreground">
                        Coming soon
                      </div>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>🎯 Migration Progress</CardTitle>
              <CardDescription>
                Streamlit to Modern Stack Migration - 16 Week Project Plan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="font-medium mb-2">✅ Completed Phases:</h4>
                  <ul className="text-sm space-y-1 text-gray-600">
                    <li>• Phase 1: Foundation & Planning (Weeks 1-2)</li>
                    <li>• Phase 2: Core Infrastructure (Weeks 3-4)</li>
                    <li>• NextAuth.js with OIDC + Local Auth</li>
                    <li>• tRPC with full type safety</li>
                    <li>• Prisma ORM with PostgreSQL</li>
                    <li>• Shadcn/ui + Tailwind CSS</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">🚧 Next Steps:</h4>
                  <ul className="text-sm space-y-1 text-gray-600">
                    <li>• Phase 3: Core Features (Weeks 5-8)</li>
                    <li>• User Management System</li>
                    <li>• Data Tables with TanStack Table</li>
                    <li>• Form System with React Hook Form</li>
                    <li>• Matrix Integration</li>
                    <li>• Admin Dashboard</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
