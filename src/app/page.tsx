'use client';

import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect authenticated users to the dashboard
  useEffect(() => {
    if (session) {
      router.push('/dashboard');
    }
  }, [session, router]);

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

  // This should not render since we redirect above, but just in case
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p>Redirecting to dashboard...</p>
      </div>
    </div>
  );
}
