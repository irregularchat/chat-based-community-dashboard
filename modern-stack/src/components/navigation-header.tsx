'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Home, 
  Users, 
  Activity, 
  Settings, 
  LogOut, 
  Shield, 
  User, 
  BarChart3,
  MessageSquare,
  Mail,
  Menu
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NavigationHeader() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  const handleNavigation = (path: string) => {
    router.push(path);
    setIsMenuOpen(false);
  };

  const isActive = (path: string) => {
    return pathname === path || (path !== '/' && pathname.startsWith(path));
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getUserDisplayName = () => {
    if (session?.user?.name) return session.user.name;
    if (session?.user?.username) return session.user.username;
    return session?.user?.email || 'User';
  };

  // Don't show header on login page
  if (pathname === '/auth/signin' || !session) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        {/* Logo/Brand */}
        <div className="mr-4 flex">
          <Button 
            variant="ghost" 
            className="p-0 hover:bg-transparent"
            onClick={() => handleNavigation('/')}
          >
            <h1 className="text-lg md:text-xl font-bold">Community Dashboard</h1>
          </Button>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-1 text-sm font-medium flex-1">
          <Button
            variant={isActive('/') || isActive('/dashboard') ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              "text-foreground/60 hover:text-foreground/80",
              isActive('/') || isActive('/dashboard') ? "text-foreground" : ""
            )}
            onClick={() => handleNavigation('/dashboard')}
          >
            <Home className="w-4 h-4 mr-2" />
            Dashboard
          </Button>

          <Button
            variant={isActive('/community') ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              "text-foreground/60 hover:text-foreground/80",
              isActive('/community') ? "text-foreground" : ""
            )}
            onClick={() => handleNavigation('/community')}
          >
            <Activity className="w-4 h-4 mr-2" />
            Community Timeline
          </Button>

          {(session.user.isModerator || session.user.isAdmin) && (
            <Button
              variant={isActive('/users') ? 'default' : 'ghost'}
              size="sm"
              className={cn(
                "text-foreground/60 hover:text-foreground/80",
                isActive('/users') ? "text-foreground" : ""
              )}
              onClick={() => handleNavigation('/users')}
            >
              <Users className="w-4 h-4 mr-2" />
              User Management
            </Button>
          )}

          {(session.user.isModerator || session.user.isAdmin) && (
            <Button
              variant={isActive('/matrix') ? 'default' : 'ghost'}
              size="sm"
              className={cn(
                "text-foreground/60 hover:text-foreground/80",
                isActive('/matrix') ? "text-foreground" : ""
              )}
              onClick={() => handleNavigation('/matrix')}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Matrix
            </Button>
          )}

          {session.user.isAdmin && (
            <Button
              variant={isActive('/admin') ? 'default' : 'ghost'}
              size="sm"
              className={cn(
                "text-foreground/60 hover:text-foreground/80",
                isActive('/admin') ? "text-foreground" : ""
              )}
              onClick={() => handleNavigation('/admin')}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Admin
            </Button>
          )}
        </nav>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex-1 flex justify-end mr-2">
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => handleNavigation('/dashboard')}>
                <Home className="w-4 h-4 mr-2" />
                Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNavigation('/community')}>
                <Activity className="w-4 h-4 mr-2" />
                Community Timeline
              </DropdownMenuItem>
              {(session.user.isModerator || session.user.isAdmin) && (
                <DropdownMenuItem onClick={() => handleNavigation('/users')}>
                  <Users className="w-4 h-4 mr-2" />
                  User Management
                </DropdownMenuItem>
              )}
              {(session.user.isModerator || session.user.isAdmin) && (
                <DropdownMenuItem onClick={() => handleNavigation('/matrix')}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Matrix
                </DropdownMenuItem>
              )}
              {session.user.isAdmin && (
                <DropdownMenuItem onClick={() => handleNavigation('/admin')}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Admin
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* User Menu */}
        <div className="flex items-center space-x-2">
          {/* User Role Badge */}
          <div className="hidden sm:block">
            {session.user.isAdmin && (
              <Badge variant="destructive" className="text-xs">
                <Shield className="w-3 h-3 mr-1" />
                Admin
              </Badge>
            )}
            {session.user.isModerator && !session.user.isAdmin && (
              <Badge variant="default" className="text-xs">
                <Shield className="w-3 h-3 mr-1" />
                Moderator
              </Badge>
            )}
            {!session.user.isAdmin && !session.user.isModerator && (
              <Badge variant="outline" className="text-xs">
                <User className="w-3 h-3 mr-1" />
                Member
              </Badge>
            )}
          </div>

          {/* User Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                className="relative h-8 w-8 rounded-full"
                aria-label={`User menu for ${getUserDisplayName()}`}
                aria-expanded={false}
                aria-haspopup="menu"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage 
                    src={session.user.image || undefined} 
                    alt={`Profile picture of ${getUserDisplayName()}`} 
                  />
                  <AvatarFallback aria-label={`${getUserDisplayName()} initials`}>
                    {getInitials(getUserDisplayName())}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="flex flex-col space-y-1 p-2">
                <p className="text-sm font-medium leading-none">{getUserDisplayName()}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {session.user.email}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleNavigation('/dashboard')}>
                <User className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleNavigation('/invites')}>
                <Mail className="w-4 h-4 mr-2" />
                Invites
              </DropdownMenuItem>
              {session.user.isAdmin && (
                <DropdownMenuItem onClick={() => handleNavigation('/admin/settings')}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
} 