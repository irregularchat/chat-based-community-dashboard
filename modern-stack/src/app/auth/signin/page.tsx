'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasAuthentik, setHasAuthentik] = useState(false);

  // Check if Authentik is configured
  useEffect(() => {
    // We can't directly access environment variables in the client, so we'll check for the provider
    // by seeing if the Authentik provider is available in the sign-in options
    const checkAuthentikProvider = async () => {
      try {
        const response = await fetch('/api/auth/providers');
        const providers = await response.json();
        setHasAuthentik(providers.authentik !== undefined);
      } catch (error) {
        console.error('Error checking providers:', error);
        setHasAuthentik(false);
      }
    };

    checkAuthentikProvider();
  }, []);

  const handleOIDCSignIn = async () => {
    setIsLoading(true);
    setError('');
    try {
      await signIn('authentik', { callbackUrl: '/' });
    } catch {
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
    } catch {
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
          {hasAuthentik ? (
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
                    Sign in using your organization&apos;s single sign-on
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
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Only local authentication is available. Use the default admin credentials to get started.
                </AlertDescription>
              </Alert>
              
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
                    placeholder="admin"
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
                    placeholder="Enter your password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
              
              <div className="text-center text-sm text-gray-600">
                <p>Default admin credentials:</p>
                <p><strong>Username:</strong> admin</p>
                <p><strong>Password:</strong> shareme314</p>
              </div>
            </div>
          )}
          
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