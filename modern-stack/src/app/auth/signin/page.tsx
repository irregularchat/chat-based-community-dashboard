'use client';

import { signIn, getSession } from 'next-auth/react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleOIDCSignIn = async () => {
    setIsLoading(true);
    setError('');
    try {
      await signIn('authentik', { callbackUrl: '/' });
    } catch (err) {
      setError('Failed to sign in with Authentik');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocalSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await signIn('local', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid credentials');
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      setError('Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Sign In</CardTitle>
          <CardDescription className="text-center">
            Access your Community Dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="oidc" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="oidc">Authentik</TabsTrigger>
              <TabsTrigger value="local">Local</TabsTrigger>
            </TabsList>
            
            <TabsContent value="oidc" className="space-y-4">
              <div className="space-y-4">
                <Button
                  type="button"
                  onClick={handleOIDCSignIn}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Signing in...' : 'Sign in with Authentik'}
                </Button>
                <p className="text-sm text-gray-600 text-center">
                  Sign in using your organization's single sign-on
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="local" className="space-y-4">
              <form onSubmit={handleLocalSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username or Email</Label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
              {process.env.NODE_ENV === 'development' && (
                <p className="text-sm text-gray-600 text-center">
                  Local authentication for development
                </p>
              )}
            </TabsContent>
          </Tabs>
          
          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 